// Claude accounts: which subscription each agent's `claude` runs on, and moving on when one runs out.
// The mission: C:/7c_oasis/docs/missions/account-failover.md (the limit signals as found, the plan).
//
// The accounts file, outside git (data/claude-accounts.local.json; scripts/add-account.mjs writes it):
//   { "accounts": [ { "id": "yahoo", "label": "Yahoo (Max)", "token": "<claude setup-token>", "priority": 2,
//                     "email": "…", "plan": "Claude Max" } ] }
// plus the CLI's own login, the account with no token (id "cli"). When the CLI login's email is one of the token
// accounts, they are one account (one quota) and only the token account is offered.
// The token never leaves this module except into a child's environment (CLAUDE_CODE_OAUTH_TOKEN, which the CLI
// keeps out of the agent's own shell). Snapshots, logs, the WebSocket and the page only ever see id, label, email.
//
// What the engine learns, kept in data/claude-accounts.state.local.json (no tokens): each account's windows from its
// own rate_limit_events ({ five_hour | seven_day | …: utilization, resetsAt, status }), and when it is exhausted
// until. Exhausted: a turn on it was refused with usage_limit_reached / model_requires_usage_credits.
//
// Choosing (choose()): an agent's pin, else (Claude in Chrome on) the CLI login, the one full login where Chrome tools
// exist, else the village default, else `auto`. Auto spreads the village so every account drains towards its own
// reset instead of one emptying first (19 Nov: 21 agents landed on one account and emptied it in ten minutes):
//   - an agent keeps its account while its prompt cache is warm (a move restarts its process on another account and
//     re-reads its whole context there), so it moves only when it was idle CACHE_COLD_MS, or its account is projected
//     to run dry before its reset while another has room (at most every MOVE_GAP_MS);
//   - a fresh choice goes to the account with the most room per agent: what is left of its week over the time to its
//     reset (tokens left at a reset are lost, so the week that ends first gets more), divided by the agents active on
//     it; an account near its 5-hour limit counts a quarter. Ties: priority, the order in the file, the CLI login last.
// pace(): the week used against the week gone, and the day it runs dry at the last 6 hours' rate (samples kept in the
// state file), for /health and the builders' pace. Pure enough to unit-test with a fake clock
// (src/lib/__tests__/agent-engine-accounts.test.ts).
import fs from 'node:fs';
import path from 'node:path';

export const CLI = 'cli';
/** api_error kinds that mean the account (or its model line) is out of usage: failover. Nothing else is. */
export const LIMIT_KINDS = new Set(['usage_limit_reached', 'model_requires_usage_credits']);
/** A refusal that did not say when it resets: try the account again after this long (a refused try costs nothing). */
export const UNKNOWN_RESET_MS = 60 * 60_000;
/** Reset times a few seconds early in the clock of the API: wait a little past them. */
const RESET_GRACE_MS = 30_000;
export const WEEK_MS = 7 * 86_400_000;
/** The prompt cache lives an hour at most: an agent idle this long loses nothing by moving to another account. */
export const CACHE_COLD_MS = 60 * 60_000;
/** A warm agent is moved off an account running ahead of its reset at most this often. */
export const MOVE_GAP_MS = 3 * 60 * 60_000;
/** The rate a dry date is projected at: the last this long. */
export const PACE_SPAN_MS = 6 * 60 * 60_000;
const SAMPLE_EVERY_MS = 5 * 60_000;
const SAMPLES_KEEP_MS = 24 * 60 * 60_000;

const toMs = (t) => (typeof t !== 'number' || !Number.isFinite(t) ? null : t < 1e12 ? t * 1000 : t);
const clean = (s, max = 80) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** The accounts file's entries, checked: [{id, label, token, priority, email, plan}]. */
export function parseAccounts(data) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(data?.accounts) ? data.accounts : []) {
    const id = clean(a?.id, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const token = typeof a?.token === 'string' ? a.token.trim() : '';
    if (!id || id === CLI || seen.has(id) || !token) continue;
    seen.add(id);
    out.push({ id, label: clean(a.label) || id, token, priority: Number.isFinite(Number(a.priority)) ? Number(a.priority) : 100, email: clean(a.email, 200) || null, plan: clean(a.plan, 60) || null });
  }
  return out;
}

export class Accounts {
  /**
   * @param {{ file: string|null, stateFile?: string|null, now?: () => number, log?: (...a: any[]) => void, onChange?: () => void }} o
   */
  constructor(o) {
    this.file = o.file || null;
    this.stateFile = o.stateFile || null;
    this.now = o.now || Date.now;
    this.log = o.log || (() => {});
    this.onChange = o.onChange || (() => {});
    this.mtime = null;
    this.tokens = [];
    this.cliInfo = { email: null, plan: null };
    const state = (this.stateFile && readJson(this.stateFile)) || {};
    /** id -> { windows: {type: {utilization, resetsAt, status, at}}, exhaustedUntil, why } */
    this.state = state.accounts && typeof state.accounts === 'object' ? state.accounts : {};
    // Figures saved before the engine read `unifiedWindows` came from the event's top-level field, which is not a
    // window's usage (it froze Yahoo at "99%" on 19 Nov while claude.ai said 66%). Unknown until the next event.
    for (const s of Object.values(this.state)) {
      for (const [name, w] of Object.entries(s?.windows || {})) if (w && w.source !== 'unified') s.windows[name] = { ...w, utilization: null, source: 'status-only' };
    }
    this.villageDefault = typeof state.villageDefault === 'string' ? state.villageDefault : 'auto';
    if (state.cli && typeof state.cli === 'object') this.cliInfo = { email: state.cli.email || null, plan: state.cli.plan || null };
    this.reload();
  }

  /** Re-read the accounts file when it changed (an add-account run while the engine is up). */
  reload() {
    if (!this.file) return false;
    let mtime = null;
    try { mtime = fs.statSync(this.file).mtimeMs; } catch { mtime = null; }
    if (mtime === this.mtime) return false;
    this.mtime = mtime;
    const before = this.tokens.map((a) => a.id).join(',');
    this.tokens = mtime === null ? [] : parseAccounts(readJson(this.file));
    const after = this.tokens.map((a) => a.id).join(',');
    if (before !== after) this.log(`accounts: ${this.tokens.length ? this.tokens.map((a) => a.label).join(', ') : 'none in the file'} + the CLI login`);
    return true;
  }

  saveState() {
    if (!this.stateFile) return;
    try { writeJson(this.stateFile, { villageDefault: this.villageDefault, cli: this.cliInfo, accounts: this.state, updatedAt: new Date(this.now()).toISOString() }); } catch (e) { this.log(`accounts: saving state failed (${e.message})`); }
  }

  /** Every account, CLI login last, as the engine uses them: [{id, label, token|null, priority, email, plan}]. */
  all() {
    this.reload();
    const cli = { id: CLI, label: 'CLI login', token: null, priority: 1000, email: this.cliInfo.email, plan: this.cliInfo.plan };
    return [...this.tokens, cli];
  }

  /** The CLI login is the same account as a token one (same email): one quota, offered once (as the token one). */
  aliasOf(id) {
    if (id !== CLI || !this.cliInfo.email) return null;
    return this.tokens.find((a) => a.email && a.email.toLowerCase() === this.cliInfo.email.toLowerCase())?.id || null;
  }

  /** Ids that share one quota with `id` (itself, and the CLI login or the token account it is). */
  sameQuota(id) {
    const ids = new Set([id]);
    const alias = this.aliasOf(CLI);
    if (alias && (id === CLI || id === alias)) { ids.add(CLI); ids.add(alias); }
    return [...ids];
  }

  get(id) {
    return this.all().find((a) => a.id === id) || null;
  }

  /** What the CLI login is, learnt from an agent's free initialize (account.email, subscriptionType). */
  noteAccount(id, account) {
    if (id !== CLI || !account?.email) return;
    if (this.cliInfo.email === account.email && this.cliInfo.plan === (account.subscriptionType || null)) return;
    this.cliInfo = { email: account.email, plan: account.subscriptionType || null };
    this.saveState();
    this.onChange();
  }

  stateOf(id) {
    return this.state[id] || (this.state[id] = { windows: {}, exhaustedUntil: null, why: null });
  }

  isExhausted(id, now = this.now()) {
    return this.sameQuota(id).some((x) => (this.state[x]?.exhaustedUntil || 0) > now);
  }

  /**
   * A rate_limit_event on this account. Each window's usage comes from `unifiedWindows` (CLI 2.1.323:
   * { five_hour | seven_day | seven_day_overage_included: { utilization 0-1, resetsAt (s), status } }), the only place
   * the CLI puts every window's figure. The top-level fields describe "the currently limiting window" and usually
   * carry no utilization at all: from them only that window's status and reset are kept, never a number, and a
   * figure the event did not send is never carried over. Unknown stays unknown.
   */
  record(id, info, now = this.now()) {
    if (!id || !info) return;
    const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : null;
    for (const x of this.sameQuota(id)) {
      const s = this.stateOf(x);
      if (unified) {
        for (const [name, w] of Object.entries(unified)) {
          if (!w || typeof w !== 'object') continue;
          s.windows[name] = { utilization: typeof w.utilization === 'number' ? w.utilization : null, resetsAt: toMs(w.resetsAt), status: w.status || null, at: now, source: 'unified' };
          if (name === 'seven_day' && typeof w.utilization === 'number') this.sample(s, w.utilization, toMs(w.resetsAt), now);
        }
      }
      const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : null;
      if (type && !(unified && unified[type])) {
        const prev = s.windows[type];
        // The limiting window, said without a figure: its status and reset only; a figure stays only while it is fresh.
        const fresh = prev?.source === 'unified' && now - (prev.at || 0) < 10 * 60_000;
        s.windows[type] = { utilization: fresh ? prev.utilization : null, resetsAt: toMs(info.resetsAt) ?? prev?.resetsAt ?? null, status: info.status || null, at: now, source: fresh ? 'unified' : 'status-only' };
      }
    }
    this.saveState();
    this.onChange();
  }

  /** One sample of the weekly figure (pace()): one per SAMPLE_EVERY_MS, a day of them, only of the current week. */
  sample(s, u, resetsAt, now) {
    const list = (Array.isArray(s.history) ? s.history : []).filter((x) => x.r === resetsAt && now - x.at < SAMPLES_KEEP_MS);
    const last = list[list.length - 1];
    if (last && now - last.at < SAMPLE_EVERY_MS) list[list.length - 1] = { at: last.at, u: Math.max(last.u, u), r: resetsAt };
    else list.push({ at: now, u, r: resetsAt });
    s.history = list;
  }

  /**
   * The week of an account against the clock: { used, elapsed (0-1), resetsAt, perHour (of the week, at the last 6 h's
   * rate), dryAt, dryBeforeReset, ahead, at } or null when its week is unknown. used null: no figure yet.
   */
  pace(id, now = this.now()) {
    const s = this.state[this.aliasOf(id) || id];
    const w = s?.windows?.seven_day;
    if (!w?.resetsAt) return null;
    const elapsed = Math.min(1, Math.max(0, (now - (w.resetsAt - WEEK_MS)) / WEEK_MS));
    const used = typeof w.utilization === 'number' ? w.utilization : null;
    const list = (Array.isArray(s.history) ? s.history : []).filter((x) => x.r === w.resetsAt);
    let perMs = null;
    if (used !== null && list.length) {
      // From the last sample at least 6 h old (the average over the whole 6 h, idle hours included), else the oldest.
      const older = list.filter((x) => x.at <= now - PACE_SPAN_MS);
      const base = older.length ? older[older.length - 1] : list[0];
      if (now - base.at >= 30 * 60_000) perMs = Math.max(0, (used - base.u) / (now - base.at));
    }
    const dryAt = used !== null && perMs ? Math.round(now + (1 - used) / perMs) : null;
    return {
      used, elapsed, resetsAt: w.resetsAt, at: w.at,
      perHour: perMs === null ? null : perMs * 3_600_000,
      dryAt, dryBeforeReset: dryAt !== null && dryAt < w.resetsAt,
      ahead: used !== null && used > elapsed,
    };
  }

  /** Room per hour an account has left this week (fraction of its week), for spreading; unknown counts as on pace. */
  roomPerHour(id, now = this.now()) {
    const p = this.pace(id, now);
    const left = p?.resetsAt ? Math.max(1, (p.resetsAt - now) / 3_600_000) : WEEK_MS / 2 / 3_600_000;
    // Unknown: as if on pace, at half weight, so known room wins and an unknown account is still tried (one turn tells).
    const unused = p && p.used !== null ? Math.max(0, 1 - p.used) : (p ? Math.max(0.05, 1 - p.elapsed) : 0.5) / 2;
    const five = this.state[this.aliasOf(id) || id]?.windows?.five_hour;
    const nearFive = typeof five?.utilization === 'number' && five.utilization >= 0.85 && (five.resetsAt || 0) > now;
    return (unused / left) * (nearFive ? 0.25 : 1);
  }

  /**
   * A turn on this account was refused for usage: out until `resetsAt` (ms or s), or for UNKNOWN_RESET_MS when the
   * refusal did not say. -> the time it is out until.
   */
  exhaust(id, { resetsAt = null, window = null, kind = 'usage_limit_reached' } = {}, now = this.now()) {
    const until = (toMs(resetsAt) || now + UNKNOWN_RESET_MS) + RESET_GRACE_MS;
    for (const x of this.sameQuota(id)) {
      const s = this.stateOf(x);
      s.exhaustedUntil = Math.max(s.exhaustedUntil || 0, until);
      s.kind = kind;
      s.why = `${kind === 'model_requires_usage_credits' ? 'model line out of usage credits' : `${window || 'usage'} limit`}`;
    }
    this.log(`accounts: ${this.get(id)?.label || id} is out (${this.stateOf(id).why}) until ${new Date(until).toString().slice(0, 21)}`);
    this.saveState();
    this.onChange();
    return until;
  }

  /**
   * A check turn on this account was taken (probe.js): it is not out after all, whatever reset time it was given
   * (the owner upgraded the plan, bought extra usage, or the limit lifted early). -> true when it was marked out.
   */
  revive(id, now = this.now()) {
    const was = this.isExhausted(id, now);
    for (const x of this.sameQuota(id)) {
      const s = this.stateOf(x);
      s.exhaustedUntil = null;
      s.kind = null;
      s.why = null;
    }
    if (was) {
      this.log(`accounts: ${this.get(id)?.label || id} takes turns again (checked before its reset)`);
      this.saveState();
      this.onChange();
    }
    return was;
  }

  /** Accounts marked out that a check turn could bring back: [{id, token}] (an alias once; a model line waits its time). */
  outToCheck(now = this.now()) {
    const aliased = this.aliasOf(CLI);
    return this.all()
      .filter((a) => !(a.id === CLI && aliased) && this.isExhausted(a.id, now))
      .filter((a) => this.sameQuota(a.id).every((x) => this.state[x]?.kind !== 'model_requires_usage_credits'))
      .map((a) => ({ id: a.id, token: a.token }));
  }

  /** The accounts that may take a turn now (an alias offered once). */
  available(now = this.now()) {
    const aliased = this.aliasOf(CLI);
    return this.all().filter((a) => !(a.id === CLI && aliased) && !this.isExhausted(a.id, now));
  }

  allExhausted(now = this.now()) {
    return this.available(now).length === 0;
  }

  /** When the first exhausted account comes back (ms), or null. */
  firstReset(now = this.now()) {
    const times = this.all().map((a) => this.state[a.id]?.exhaustedUntil || 0).filter((t) => t > now);
    return times.length ? Math.min(...times) : null;
  }

  /** The weekly reset an account is known to have, for `auto` (earliest first). */
  weeklyReset(id) {
    const w = this.state[id]?.windows || {};
    return w.seven_day?.resetsAt || w.seven_day_opus?.resetsAt || null;
  }

  /**
   * The account a turn of this agent should run on: { id, label, why? } or null when every account is out.
   * o: { pin, current (its account now), chrome (Claude in Chrome on), idleMs (since its last turn), movedAt (its last
   * move), loads ({ accountId: agents active on it, this one not counted }) }. See the head of this file.
   */
  choose({ pin = null, current = null, chrome = false, idleMs = Infinity, movedAt = 0, loads = {} } = {}, now = this.now()) {
    const ok = this.available(now);
    if (!ok.length) return null;
    const resolve = (id) => (id && id !== 'auto' ? ok.find((a) => a.id === id || (id === CLI && a.id === this.aliasOf(CLI))) : null);
    const pinned = resolve(pin);
    if (pinned) return { id: pinned.id, label: pinned.label };
    // Chrome tools only exist on the full login: the CLI login itself, never its token (even when it is one quota with one).
    if (chrome && !this.isExhausted(CLI, now)) return { id: CLI, label: this.get(CLI).label };
    const byDefault = resolve(this.villageDefault);
    if (byDefault) return { id: byDefault.id, label: byDefault.label };
    const canon = (id) => (id === CLI && this.aliasOf(CLI) ? this.aliasOf(CLI) : id);
    const score = (a) => this.roomPerHour(a.id, now) / (1 + (loads[a.id] || 0));
    const ranked = [...ok].sort((a, b) => score(b) - score(a) || a.priority - b.priority);
    const best = ranked[0];
    const mine = current ? ok.find((a) => a.id === canon(current)) : null;
    if (mine && idleMs < CACHE_COLD_MS) {
      // Warm: it stays, unless its account runs dry before its reset while the best one would not, and it has not moved lately.
      const hot = this.pace(mine.id, now)?.dryBeforeReset;
      const cool = best.id !== mine.id && !this.pace(best.id, now)?.dryBeforeReset && score(best) > score(mine);
      if (!(hot && cool && now - (movedAt || 0) >= MOVE_GAP_MS)) return { id: mine.id, label: mine.label };
      return { id: best.id, label: best.label, why: `${mine.label} runs ahead of its weekly reset` };
    }
    return { id: best.id, label: best.label };
  }

  /** The environment a `claude` on this account needs (null drops the variable: the CLI login). Engine-only. */
  envFor(id) {
    const a = this.tokens.find((x) => x.id === id);
    return a ? { CLAUDE_CODE_OAUTH_TOKEN: a.token } : { CLAUDE_CODE_OAUTH_TOKEN: null };
  }

  setVillageDefault(id) {
    const want = !id || id === 'auto' ? 'auto' : String(id);
    if (want !== 'auto' && !this.get(want)) throw new Error(`no account "${want}" (${this.all().map((a) => a.id).join(', ')})`);
    this.villageDefault = want;
    this.saveState();
    this.onChange();
    return want;
  }

  /** For snapshots, the HUD and the settings: never a token. */
  view(now = this.now()) {
    const aliased = this.aliasOf(CLI);
    return {
      villageDefault: this.villageDefault,
      firstReset: this.firstReset(now),
      allExhausted: this.allExhausted(now),
      accounts: this.all().map((a) => ({
        id: a.id, label: a.label, email: a.email, plan: a.plan, priority: a.priority, cli: a.id === CLI, sameAs: a.id === CLI ? aliased : null,
        exhaustedUntil: (this.state[a.id]?.exhaustedUntil || 0) > now ? this.state[a.id].exhaustedUntil : null,
        why: (this.state[a.id]?.exhaustedUntil || 0) > now ? this.state[a.id].why : null,
        windows: this.state[a.id]?.windows || {},
        pace: a.id === CLI && aliased ? null : this.pace(a.id, now),
      })),
    };
  }
}

const day = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

/**
 * One line per account for /health and the builders' pace (Anorak slows them when one runs ahead):
 * "Yahoo.fr: week 12% used, 21% of it gone (behind pace); at the last 6 h's rate 0.9% an hour: dry Sat 21 Nov 14:00,
 * 6 days before its reset (Fri 27 Nov 08:00)".
 */
export function paceLine(label, p, now = Date.now()) {
  if (!p) return `${label}: its week is unknown until it takes a turn`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const reset = day(p.resetsAt);
  if (p.used === null) return `${label}: week usage unknown until its next turn, ${pct(p.elapsed)} of the week gone (resets ${reset})`;
  const head = `${label}: week ${pct(p.used)} used, ${pct(p.elapsed)} of it gone (${p.ahead ? 'ahead of pace' : 'behind pace'})`;
  if (p.perHour === null) return `${head}; not enough samples yet for a rate (resets ${reset})`;
  if (!p.dryAt) return `${head}; nothing used in the last 6 h, lasts to its reset (${reset})`;
  const rate = `${(p.perHour * 100).toFixed(p.perHour * 100 >= 1 ? 1 : 2)}% an hour`;
  if (!p.dryBeforeReset) return `${head}; at the last 6 h's rate ${rate}: lasts to its reset (${reset})`;
  const early = p.resetsAt - p.dryAt;
  const ahead = early >= 86_400_000 ? `${Math.round(early / 86_400_000)} days` : `${Math.max(1, Math.round(early / 3_600_000))} h`;
  return `${head}; at the last 6 h's rate ${rate}: dry ${day(p.dryAt)}, ${ahead} before its reset (${reset})`;
}

/** Next to the roster: data/agent-engine.local.json -> data/claude-accounts.local.json and its state file. */
export function accountsFilesFor(rosterFile) {
  const dir = path.dirname(rosterFile);
  return { file: path.join(dir, 'claude-accounts.local.json'), stateFile: path.join(dir, 'claude-accounts.state.local.json') };
}

/** What a refused turn said about the limit: { kind, resetsAt, window } from the stream's messages, or null. */
export function limitFrom(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'rate_limit_event' && msg.rate_limit_info?.status === 'rejected') {
    return { kind: null, resetsAt: toMs(msg.rate_limit_info.resetsAt), window: msg.rate_limit_info.rateLimitType || null };
  }
  const kind = msg.api_error || msg.message?.api_error || null;
  if ((msg.type === 'assistant' || msg.type === 'result') && LIMIT_KINDS.has(kind)) return { kind, resetsAt: null, window: null };
  return null;
}
