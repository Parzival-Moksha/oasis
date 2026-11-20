// Oasis agent engine: Claude Code sessions as agents, bridged to the Oasis over one WebSocket.
// Grew out of the 7c_oasis spike (C:/7c_oasis/spike, findings in its README).
//   ws://127.0.0.1:4530/ws   events out, commands in
//   POST /hook               Claude Code `type:"http"` hooks (optional observation path)
//   POST /api/cmd            same commands as the socket, for curl/debugging
//   ws://127.0.0.1:4530/listen  live dictation (Moonshine, see ears.js; ?engine=elevenlabs: scribe-live.js)
//   GET  /api/agents, /api/sessions, /health
//   GET  /file/<id>          a file an agent sent with SendUserFile (files.js; only those, by random id)
import { tokenAllowed } from './token.js';
import { setting } from './settings.js';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Agent } from './agent.js';
import { HermesAgent } from './hermes.js';
import { Observer } from './observe.js';
import { HookObserver } from './hooks.js';
import { listSessions, isTranscriptPath, readLiveRegistry, readLiveEntries, pidAlive, findSessionFile } from './sessions.js';
import { execFileSync } from 'node:child_process';
import { checkIn, isBridged, queueForBridge, aliveBridges, dumpInboxes, restoreInboxes } from './bridge.js';
import { Journal, journalFileFor } from './journal.js';
import { restartLine, transcriptTurnOpen, wasMidTurn } from './resume.js';
import { Characters, characterNote, cardStamp, charactersDirFor } from './character.js';
import { Looks } from './looks.js';
import { Accounts, CACHE_COLD_MS, CLI, accountsFilesFor, paceLine } from './accounts.js';
import { tinyTurn } from './probe.js';
import { LIMIT_RESUME_TEXT } from './agent.js';
import { Scheduler, DEFAULT_PROMPT, EVERY, REPEATS, appointmentLabel, describeSchedule, localDate, normalizeAppointment, normalizeSchedule, parseWhen, scheduleSettingsFileFor } from './schedule.js';
import os from 'node:os';
import { readOlderHistory } from './history.js';
import { loadRoster, saveRoster, saveRosterNow } from './roster.js';
import { takeVoiceMessage } from './scribe.js';
import { takePictures } from './pictures.js';
import { resolveClaude } from './claude.js';
import { listen as earsListen, warmEars, earsStatus, stopEars } from './ears.js';
import { listenScribe, hasLiveScribe, LIVE_SCRIBE_MODEL } from './scribe-live.js';
import { readTextFile, serveAttachment, writeTextFile } from './files.js';
import { startClipWatchdog, stopClipWatchdog, clipWatchdogState } from './clip-watchdog.js';
import { startTelegram } from './telegram.js';
import { AgentHours } from './agent-hours.js';
import { tokenHeaders } from './token.js';
import { listVoices } from './voice.js';
import { createStage, resolveStageAgent } from './stage.js';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..'); // af_oasis
const ROSTER_FILE = process.env.OASIS_ROSTER || path.join(ROOT, 'data', 'agent-engine.local.json');
/** What must survive a restart besides the roster (journal.js): next to the roster file. */
const journal = new Journal(process.env.OASIS_JOURNAL || journalFileFor(ROSTER_FILE));
/** Who each agent is: one md file per session (character.js), and what each avatar looks like (looks.js). */
const CHARACTERS_DIR = process.env.OASIS_CHARACTERS || charactersDirFor(ROSTER_FILE);
const characters = new Characters(CHARACTERS_DIR);
/** The command an agent runs to see itself, look around and edit its card. */
const ME_SCRIPT = path.resolve(HERE, '..', 'scripts', 'me.mjs').replace(/\\/g, '/');
const looks = new Looks({
  file: path.join(CHARACTERS_DIR, '_looks.json'),
  publicDir: path.join(ROOT, 'public'),
  enabled: process.env.OASIS_LOOKS !== '0',
  log: (...a) => hub.log(...a),
  // A new description goes into the card of everyone who wears that avatar.
  onDescribed: (avatar) => { for (const a of agents.values()) if (a.sessionId && characters.read(a.sessionId).fields.avatar === avatar) refreshLook(a.sessionId); },
});
/** OASIS_RESUME=0: mid-turn agents come back as "stopped mid-turn" and wait for a word, as before. */
const RESUME_ON = process.env.OASIS_RESUME !== '0';
/** This start, for /health and the HUD's engine pill: when, how the last run ended, who was told to carry on. */
const restart = { startedAt: Date.now(), stop: null, resumed: [], redelivered: 0, line: null };
const PORT = Number(process.env.OASIS_PORT || 4530);
// The clock schedules run on. A test engine (OASIS_FAKE_CLOCK=1, never on 4530) can move it with the `clock` command.
const FAKE_CLOCK = process.env.OASIS_FAKE_CLOCK === '1' && PORT !== 4530;
// OASIS_CLOCK_OFFSET_MS starts a test engine's clock ahead (a restart "hours later").
const clock = { offset: FAKE_CLOCK ? Number(process.env.OASIS_CLOCK_OFFSET_MS) || 0 : 0 };
const now = () => Date.now() + clock.offset;
/** The command an agent runs to tell the owner on Telegram, once (scripts/tell.mjs). */
const TELL_SCRIPT = path.resolve(HERE, '..', 'scripts', 'tell.mjs').replace(/\\/g, '/');
// Claude accounts (accounts.js): which one each agent runs on, and moving on when one runs out of usage.
const accountFiles = accountsFilesFor(ROSTER_FILE);
const accounts = new Accounts({
  file: process.env.OASIS_ACCOUNTS || accountFiles.file,
  stateFile: process.env.OASIS_ACCOUNTS_STATE || accountFiles.stateFile,
  now,
  // It may log while the engine is still being set up (before `hub` exists): the same format, straight to the console.
  log: (...a) => console.log(new Date().toISOString().slice(11, 19), ...a),
  onChange: () => accountsChanged(),
});
const scheduler = new Scheduler({
  blocked: () => accounts.allExhausted(),
  agents: () => ownedAgents(),
  now,
  settingsFile: process.env.OASIS_SCHEDULE_SETTINGS || scheduleSettingsFileFor(ROSTER_FILE),
  log: (...a) => hub.log(...a),
  tell: TELL_SCRIPT,
  onChange: () => scheduleSnapshot(),
  tickMs: Number(process.env.OASIS_SCHEDULE_TICK_MS) || 15_000,
});
const HOST = process.env.OASIS_HOST || '127.0.0.1';
const BACKLOG = 400;

// ------------------------------------------------------------------ hub
const agents = new Map(); // id -> Agent | Observer | HookObserver
/** The agents' working hours, booked in the Oasis's work book from here, open page or not (agent-hours.js). */
const agentHours = new AgentHours({ headers: tokenHeaders, enabled: process.env.OASIS_AGENT_HOURS !== '0' && process.env.OASIS_FAKE_CLAUDE !== '1', log: (...a) => hub.log(...a) });
const backlog = new Map(); // id -> events[]
const clients = new Set();
let pendingShow = null; // { agentId, at }: the agent /oasis asked to show, for the page that is about to connect
let snapshotTimer = null;
let telegram = null; // the owner's Telegram line (telegram.js), only in the real engine

const hub = {
  emit(agentId, kind, payload = {}) {
    const event = { ...payload, v: 1, agentId, ts: Date.now(), kind }; // envelope fields always win
    if (kind === 'removed') {
      // The agent is gone: drop its backlog and announce it once.
      backlog.delete(agentId);
      broadcast({ type: 'event', event });
      telegram?.onEvent(event);
      return;
    }
    // Late events of a removed agent (a killed process exiting) would recreate its backlog forever.
    // Hook markers for a just-killed session (recentlyRemoved) still go out, but are never stored.
    if (!agents.has(agentId)) {
      if (kind === 'hook') broadcast({ type: 'event', event });
      return;
    }
    if (kind !== 'text.delta') {
      let list = backlog.get(agentId);
      if (!list) backlog.set(agentId, (list = []));
      list.push(event);
      if (list.length > BACKLOG) list.splice(0, list.length - BACKLOG);
    }
    broadcast({ type: 'event', event });
    telegram?.onEvent(event);
    agentHours.onEvent(event, agents.get(agentId));
    if (/^(status|init|meta|model|mode|effort|eyes|speak|voice|chrome|schedule|account|context|exit|permission\.)/.test(kind)) scheduleSnapshot();
  },
  eyes: (agentId) => captureEyes(agentId),
  journal,
  stopping: () => shuttingDown,
  /** Schedules (schedule.js): when an agent wakes next, how often it woke today, and a look when it turned idle. */
  nextWake: (agent) => scheduler.nextWakeOf(agent),
  wakesToday: (agent) => scheduler.countToday(agent),
  scheduleCheck: (agent) => { try { scheduler.check(agent); } catch (e) { hub.log(`[${agent.name}] schedule check failed: ${e.message}`); } },
  /** Claude accounts (accounts.js). The token only ever goes into a child's environment (accountEnv). */
  chooseAccount: (agent) => accounts.choose(accountAsk(agent)) || accountComingBackFirst(),
  accountEnv: (id) => accounts.envFor(id),
  accountLabel: (id) => accountLabel(id),
  noteAccount: (id, account) => accounts.noteAccount(id, account),
  recordRateLimit: (id, info) => accounts.record(id, info),
  allAccountsOut: () => accounts.allExhausted(),
  /** The owner wrote to an agent that waits for an account: ask the accounts now rather than trust their reset times. */
  checkAccountsNow: () => { void checkOutAccounts({ asked: true }).catch((e) => hub.log(`accounts: check failed: ${e.message}`)); },
  firstAccountReset: () => accounts.firstReset(),
  /** When an account is back from being out (ms), or null. */
  accountBackAt: (id) => accounts.view().accounts.find((a) => a.id === id)?.exhaustedUntil || null,
  now: () => now(),
  onLimit: (agent, limit) => failover(agent, limit),
  /** The who-you-are note for an agent and what it was made from (agent.js sends it when due). */
  character: (agent) => characterFor(agent),
  /** Where this engine listens: agents get it as OASIS_ENGINE_URL. */
  url: `http://${HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST}:${PORT}`,
  persist() {
    saveRoster(ROSTER_FILE, ownedAgents().map((a) => a.rosterEntry()));
  },
  log(...a) {
    console.log(new Date().toISOString().slice(11, 19), ...a);
  },
};

function ownedAgents() { return [...agents.values()].filter((a) => a.kind === 'owned'); }
function snapshots() { return [...agents.values()].map((a) => withBridge(a.snapshot())); }
/** A watched session whose mod is checking in can be talked to: what you say goes through the bridge (bridge.js). */
function withBridge(s) {
  if (s.kind === 'owned' || !isBridged(s.sessionId)) return s;
  return { ...s, bridged: true, readOnly: false };
}
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}
function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => broadcast({ type: 'agents', agents: snapshots() }), 60);
}
/** New agents: announce them before their first events so clients can place them. */
function addAgent(a) {
  agents.set(a.id, a);
  clearTimeout(snapshotTimer);
  broadcast({ type: 'agents', agents: snapshots() });
}

// ------------------------------------------------------------------ eyes
// A picture from an agent's own avatar, taken by an Oasis page (VillageEyes.tsx renders the scene once from the
// desk and answers over this socket). Pages that can do it say so with the `canSee` command. The first picture
// wins; no page, no picture, or EYES_MS without an answer resolves null and the message goes out as text.
const EYES_MS = Number(process.env.OASIS_EYES_MS || 1500);
const EYES_MAX = 1024 * 1024; // base64 chars; an 800x450 jpeg is about 100 KB
const eyesWaiting = new Map(); // requestId -> {done, left}
function captureEyes(agentId) {
  const pages = [...clients].filter((ws) => ws.readyState === 1 && ws.canSee);
  if (!pages.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const done = (picture) => { clearTimeout(timer); eyesWaiting.delete(requestId); resolve(picture); };
    const timer = setTimeout(() => done(null), EYES_MS);
    eyesWaiting.set(requestId, { done, left: pages.length });
    const ask = JSON.stringify({ type: 'eyes.request', requestId, agentId });
    for (const ws of pages) ws.send(ask);
  });
}

const stage = createStage({ pages: () => [...clients], agents: () => agents.values(), log: (...a) => hub.log(...a) });

// ------------------------------------------------------------------ characters
/** "Orion. You are a tall …" from the card's avatar and the description of that avatar, when there is one. */
function lookLine(avatar, avatarName) {
  if (!avatar && !avatarName) return '';
  const name = avatarName || String(avatar).split('/').pop().replace(/\.vrm$/i, '');
  const description = looks.get(avatar);
  return description ? `the avatar "${name}". ${description}` : `the avatar "${name}"`;
}

function refreshLook(sessionId) {
  const card = characters.read(sessionId);
  if (card.fields.avatar) characters.setFacts(sessionId, { look: lookLine(card.fields.avatar, null) });
}

/** The card of an agent (made on first use, with its name) -> { note, stamp, card }; null without a session. */
function characterFor(agent) {
  if (!agent?.sessionId || !characters.fileFor(agent.sessionId)) return null;
  const card = characters.setFacts(agent.sessionId, { name: agent.name || undefined });
  return { note: characterNote(card, { file: card.file, tools: ME_SCRIPT, showFiles: agent.kind === 'owned' }), stamp: cardStamp(card), card };
}

/** An agent by id, session id or name (exact, else the one name that starts with it). */
function findAgent(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const list = [...agents.values()];
  return list.find((a) => a.id === ref) || list.find((a) => a.sessionId && a.sessionId === ref) || resolveStageAgent(ref, list);
}

/** Watched sessions that were told who they are in this run: session id -> the card's stamp then. */
const bridgeTold = new Map();

// Pictures on request (scripts/me.mjs look | around): an Oasis page renders them (VillageEyes.tsx) and answers over
// the socket, like eyes. Kept as files, because an agent reads a picture from a path.
const VIEW_MS = Number(process.env.OASIS_VIEW_MS || 5000);
const VIEW_DIR = path.join(os.tmpdir(), 'oasis-agent-engine-views');
const viewsWaiting = new Map(); // requestId -> {done, left}
function captureViews(agentId, view) {
  const pages = [...clients].filter((ws) => ws.readyState === 1 && ws.canSee);
  if (!pages.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const done = (pictures) => { clearTimeout(timer); viewsWaiting.delete(requestId); resolve(pictures); };
    const timer = setTimeout(() => done(null), VIEW_MS);
    viewsWaiting.set(requestId, { done, left: pages.length });
    const ask = JSON.stringify({ type: 'view.request', requestId, agentId, view });
    for (const ws of pages) ws.send(ask);
  });
}

function saveViews(agent, view, pictures) {
  fs.mkdirSync(VIEW_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return pictures.map((p, i) => {
    const ext = p.mediaType === 'image/png' ? '.png' : p.mediaType === 'image/webp' ? '.webp' : '.jpg';
    const label = String(p.label || `${i + 1}`).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const file = path.join(VIEW_DIR, `${agent.id}-${view}-${label}-${stamp}${ext}`);
    fs.writeFileSync(file, Buffer.from(p.data, 'base64'));
    return { path: file.replace(/\\/g, '/'), label: p.label || null, note: p.note || null };
  });
}

// ------------------------------------------------------------------ accounts: failover
function accountLabel(id) {
  if (!id) return null;
  const alias = accounts.aliasOf(id);
  if (alias) return accounts.get(alias)?.label || alias;
  const a = accounts.get(id);
  if (!a) return id;
  return a.id === CLI && a.plan ? `CLI login (${a.plan})` : a.label;
}

/**
 * What choose() needs to know of an agent (accounts.js): its pin, its account, Chrome, how long since its last turn
 * (its prompt cache), its last move, and how many other agents are active on each account (a turn in the last hour).
 */
function accountAsk(agent) {
  const t = now();
  const loads = {};
  for (const other of ownedAgents()) {
    if (other === agent || !other.accountId || !other.proc) continue;
    const last = other.lastTurnAt || other.lastOutcome?.at || 0;
    const active = other.turnOpenAt || (last && t - last < CACHE_COLD_MS);
    if (!active) continue;
    const id = other.accountId === CLI && accounts.aliasOf(CLI) ? accounts.aliasOf(CLI) : other.accountId;
    loads[id] = (loads[id] || 0) + 1;
  }
  const busy = Boolean(agent.turnOpenAt);
  // Its last turn: this run's, else the one the roster kept from before an engine restart.
  const last = agent.lastTurnAt || agent.lastOutcome?.at || 0;
  return { pin: agent.accountPin, current: agent.accountId, chrome: agent.chrome, idleMs: busy ? 0 : last ? t - last : Infinity, movedAt: agent.accountMovedAt || 0, loads };
}

/** Per account, the week used against the week gone and the dry date at the last 6 h's rate (accounts.js paceLine). */
function paceLines() {
  const t = now();
  return accounts.view(t).accounts.filter((a) => !a.sameAs).map((a) => paceLine(accountLabel(a.id), a.pace, t));
}

/** Every account is out: start a process on the one that comes back first (a start spends nothing). */
function accountComingBackFirst() {
  const list = accounts.view().accounts.filter((a) => !a.sameAs).sort((a, b) => (a.exhaustedUntil || 0) - (b.exhaustedUntil || 0));
  return list[0] ? { id: list[0].id, label: list[0].label } : null;
}

let accountsTimer = null;
function accountsChanged() {
  clearTimeout(accountsTimer);
  accountsTimer = setTimeout(() => { broadcast({ type: 'accounts', ...accounts.view() }); scheduleSnapshot(); }, 200);
}

let outageTold = false;
/**
 * A turn of `agent` was refused for usage (agent.js afterResult). That account is out until its reset; the agent stops
 * and resumes the same session on the next account with a carry-on note, so the refused turn runs again. Idle agents
 * on the same account move now; busy ones move before their next turn (agent.js sendNow). Every account out: they
 * wait, the owner gets one Telegram line, and accountsTick() resumes them when the first account is back.
 */
function failover(agent, limit) {
  const from = agent.accountId;
  if (from) accounts.exhaust(from, { resetsAt: limit.resetsAt, window: limit.window, kind: limit.kind });
  if (accounts.allExhausted()) {
    agent.park(accounts.firstReset(), true);
    tellOutage();
    return;
  }
  agent.sendChain = agent.sendChain
    .then(async () => {
      await agent.switchAccount(`${accountLabel(from)} is out of usage`);
      await agent.flushLeftovers({ resume: true, resumeText: LIMIT_RESUME_TEXT });
    })
    .catch((e) => hub.log(`[${agent.name}] failover failed: ${e.message}`));
  for (const other of ownedAgents()) {
    if (other === agent || !other.proc || !other.isIdle() || !accounts.sameQuota(from || '').includes(other.accountId)) continue;
    other.sendChain = other.sendChain.then(() => other.switchAccount(`${accountLabel(from)} is out of usage`)).catch((e) => hub.log(`[${other.name}] move failed: ${e.message}`));
  }
}

function tellOutage() {
  if (outageTold) return;
  outageTold = true;
  const first = accounts.firstReset();
  const when = first ? new Date(first).toTimeString().slice(0, 5) : 'later';
  const line = `⏸ Every Claude account is out of usage. The village waits and goes on by itself at ${when} at the latest; it checks every 10 minutes in case one comes back sooner (an upgrade, extra usage).`;
  hub.log(`accounts: ${line}`);
  try { telegram?.say(line); } catch { /* no Telegram: the HUD says it */ }
}

/**
 * A reset time is a forecast, not a fact: the owner may upgrade the plan or buy extra usage, and then an account takes
 * turns again hours early (19 Nov: Yahoo marked out until 18:00 at 14:37, taking turns again by 15:00, and the village
 * sat still). So while an account is marked out, the engine asks it with one tiny haiku turn (probe.js): every
 * CHECK_EVERY_MS by itself, and at once (at most every CHECK_ASKED_MS) when the owner writes to a waiting agent or
 * presses "check now". A refused check costs nothing; a taken one a few dozen tokens. Taken: the account is back and
 * the waiting agents go on (accountsTick). Refused: it stays out, with the reset that refusal gave.
 */
const CHECK_EVERY_MS = 10 * 60_000;
const CHECK_ASKED_MS = 30_000;
const lastCheck = new Map(); // account id -> when it was last checked (the engine's clock)
let lastAskedCheck = 0;
let checking = null;
function checkOutAccounts({ asked = false } = {}) {
  if (checking) return checking;
  if (asked) {
    if (Date.now() - lastAskedCheck < CHECK_ASKED_MS) return Promise.resolve([]);
    lastAskedCheck = Date.now();
  }
  const due = accounts.outToCheck().filter((a) => asked || now() - (lastCheck.get(a.id) || 0) >= CHECK_EVERY_MS);
  if (!due.length) return Promise.resolve([]);
  checking = Promise.all(due.map(async (a) => {
    lastCheck.set(a.id, now());
    const r = await tinyTurn(a.token);
    const label = accountLabel(a.id);
    if (r.ok && !r.refused) {
      if (r.usage) accounts.record(a.id, r.usage);
      accounts.revive(a.id);
      return { id: a.id, back: true };
    }
    if (r.ok && r.refused) {
      if (r.usage) accounts.record(a.id, r.usage);
      if (r.usage?.resetsAt) accounts.exhaust(a.id, { resetsAt: r.usage.resetsAt, window: r.usage.rateLimitType, kind: r.kind });
      hub.log(`accounts: checked ${label}: still out`);
      return { id: a.id, back: false };
    }
    hub.log(`accounts: checked ${label}: no answer (${r.reason})`);
    return { id: a.id, back: false, reason: r.reason };
  }))
    .then(async (out) => { if (out.some((x) => x.back)) await accountsTick(); return out; })
    .finally(() => { checking = null; });
  return checking;
}

/** Every 15 s, and when the test clock moves: an account is back, so the agents that waited go on. */
async function accountsTick() {
  if (accounts.allExhausted()) return;
  if (outageTold) { outageTold = false; hub.log('accounts: an account is back'); accountsChanged(); }
  for (const a of ownedAgents()) {
    if (!a.parked) continue;
    a.sendChain = a.sendChain.then(() => a.unpark()).catch((e) => hub.log(`[${a.name}] resume after the outage failed: ${e.message}`));
  }
}
setInterval(() => { accounts.reload(); void accountsTick(); void checkOutAccounts().catch((e) => hub.log(`accounts: check failed: ${e.message}`)); }, 15_000).unref();

/** An owned agent by id, session or name, for the schedule commands. */
function scheduleAgent(ref) {
  const a = findAgent(ref);
  if (!a) throw new Error(`unknown agent ${ref ?? ''}`);
  if (a.kind !== 'owned') throw new Error(`${a.name} runs in another window: only agents the Oasis runs can wake up on a schedule`);
  return a;
}

function scheduleView(a) {
  const next = scheduler.nextWakeOf(a);
  return {
    agentId: a.id, name: a.name, schedule: a.schedule, label: describeSchedule(a.schedule),
    appointments: a.appointments.map((x) => ({ ...x, label: appointmentLabel(x) })),
    nextWake: next, wakesToday: scheduler.countToday(a), lastWakeAt: a.wake?.lastAt || null, today: localDate(now()),
  };
}

function newId(prefix) { return `${prefix}-${randomUUID().slice(0, 8)}`; }

/** The longest name rename accepts (names show on tags, cards and Telegram lines). */
const RENAME_MAX = 40;

function getAgent(id, { owned = false } = {}) {
  const a = agents.get(id);
  if (!a) throw new Error(`unknown agent ${id}`);
  if (owned && a.kind !== 'owned') throw new Error(`agent ${id} is read-only (${a.kind})`);
  return a;
}

// ------------------------------------------------------------------ commands
const commands = {
  // Voice typing through ElevenLabs has nothing to warm; Moonshine (chosen, or no ElevenLabs key) loads its model.
  warmEars({ engine } = {}) {
    if (engine === 'elevenlabs' && hasLiveScribe()) return { warming: false, ready: true, model: `elevenlabs ${LIVE_SCRIBE_MODEL}` };
    return warmEars((m) => hub.log(m));
  },
  listAgents: () => snapshots(),
  listLive: () => [...readLiveRegistry()].map(([sessionId, r]) => ({ sessionId, ...r })),

  async listSessions({ limit } = {}) {
    const sessions = await listSessions({ limit: limit || 150 });
    const owned = new Map(ownedAgents().map((a) => [a.sessionId, a.id]));
    const observed = new Map([...agents.values()].filter((a) => a.kind === 'observer').map((a) => [a.sessionPath.toLowerCase(), a.id]));
    return sessions.map((s) => ({ ...s, ownedBy: owned.get(s.sessionId) || null, observedBy: observed.get(String(s.path).toLowerCase()) || null }));
  },

  // runtime: 'claude' (default) or 'hermes' (hermes.js: a Hermes Agent over ACP; command / hermesHome say which one and where).
  // remote {host, hermes?, home?, cwd?, worldPort?}: a Hermes on another machine over SSH; its local cwd defaults to the home folder.
  async spawnAgent({ name, cwd, sessionId, model, permissionMode, effort, fork, force, move, createCwd, worldTools, chrome, runtime, command, hermesHome, remote } = {}) {
    if (runtime === 'hermes' && remote && !cwd) cwd = os.homedir();
    if (runtime && runtime !== 'claude' && runtime !== 'hermes') throw new Error(`unknown runtime ${runtime} (claude or hermes)`);
    if (!cwd) throw new Error('cwd is required');
    cwd = path.resolve(cwd);
    if (!fs.existsSync(cwd)) {
      // Only on an explicit ask (the picker's "create it" button): a typo should not leave folders behind.
      if (!createCwd || sessionId) throw new Error(`cwd does not exist: ${cwd}`);
      fs.mkdirSync(cwd, { recursive: true });
    }
    if (sessionId && !fork) {
      const dup = ownedAgents().find((a) => a.sessionId === sessionId);
      if (dup) throw new Error(`session ${sessionId} is already driven by agent ${dup.name}; use fork:true for a copy`);
      // Open in another process (desktop app, terminal)? Two writers fork the transcript (see README).
      const live = readLiveRegistry().get(sessionId);
      const ours = new Set(ownedAgents().map((a) => a.proc?.pid).filter(Boolean));
      if (live && !ours.has(live.pid) && !force) {
        if (!move) throw new Error(`session is open in pid ${live.pid} (${live.entrypoint || live.kind}, ${live.status}); close it there, or spawn with move:true (same session, the other process stops), fork:true (copy) or force:true`);
        await stopOtherHolders(sessionId, ours);
      }
    }
    const agent = runtime === 'hermes'
      ? new HermesAgent({ id: newId('agent'), name: name || (remote?.host ?? path.basename(cwd)), cwd, sessionId, model, permissionMode, worldTools, command, hermesHome, remote }, hub)
      : new Agent({ id: newId('agent'), name: name || path.basename(cwd), cwd, sessionId, model, permissionMode, effort, fork, worldTools, chrome: chrome === true }, hub);
    addAgent(agent);
    agent.start();
    hub.persist();
    scheduleSnapshot();
    return agent.snapshot();
  },

  /** An Oasis page that can take eyes pictures says so once per connection. */
  canSee({ on = true } = {}, ws) { if (ws) ws.canSee = !!on; return { ok: true }; },
  /** A page's answer to eyes.request: {requestId, data (base64), mediaType}, or no data when it has no view of that agent. */
  eyesFrame({ requestId, data, mediaType }) {
    const w = eyesWaiting.get(requestId);
    if (!w) return { ok: true, late: true };
    if (typeof data === 'string' && data && data.length <= EYES_MAX && /^image\/(jpeg|png|webp)$/.test(mediaType || '')) w.done({ data, mediaType });
    else if (--w.left <= 0) w.done(null);
    return { ok: true };
  },
  setEyes({ agentId, on }) { return getAgent(agentId, { owned: true }).setEyes(on); },
  /** Voice for an agent (voice.js): its replies end with a <spoken> line the page says out loud. */
  setSpeak({ agentId, on }) { return getAgent(agentId, { owned: true }).setSpeak(on); },
  /** The voices an agent can have (the page's list, voice.js). */
  listVoices: () => listVoices(),
  /** An agent picks its own voice (scripts/voice.mjs); `agent`: its id or name. voice: a key of the list, or null to give it up. */
  chooseVoice({ agentId, agent, voice }) {
    const a = resolveStageAgent(agentId ?? agent, ownedAgents());
    if (!a) throw new Error(`unknown agent ${agentId ?? agent ?? ''}`);
    return a.setVoiceChoice(voice ?? null);
  },
  // The Council's stage (stage.js): the moderator's calls go to the Oasis page that walks and speaks the agents.
  council(msg) { return stage.request(msg); },
  /** An Oasis page that can stage says so once per connection (the last one to say so stages). */
  canStage({ on = true } = {}, ws) { if (ws) { ws.canStage = !!on; ws.stageAt = Date.now(); } return { ok: true }; },
  /** A page's answer to stage.request. */
  stageResult(msg) { return stage.result(msg); },

  /** images: pictures pasted or dropped in the Oasis ([{ data: base64, mediaType, name }], pictures.js). */
  send({ agentId, text, priority, images, source }) {
    const a = getAgent(agentId);
    const hasPictures = Array.isArray(images) && images.length > 0;
    if (a.kind !== 'owned' && hasPictures) {
      throw new Error('pictures cannot go to this session yet: it runs in another window and the Oasis mod only carries text there. Send the text alone, or use Move it here to send pictures');
    }
    if (a.kind === 'owned') return a.send(text, { priority, images: hasPictures ? takePictures(images) : [], ...(typeof source === 'string' ? { source } : {}) });
    // A watched session: only if it runs the Oasis mod, which submits it there as a prompt of that same session.
    if (!text || !text.trim()) throw new Error('empty message');
    if (!isBridged(a.sessionId)) throw new Error('watching only: this session runs somewhere else without the Oasis plugin; use Move it here to talk to it');
    // A session in another window gets its who-you-are note in the text itself (the mod only carries text): with
    // the first message of this engine run and when its card changed. The thread hides it (normalize.js).
    const you = characterFor(a);
    const tell = you?.note && bridgeTold.get(a.sessionId) !== you.stamp;
    queueForBridge(a.sessionId, tell ? `${text}

${you.note}` : text);
    if (tell) bridgeTold.set(a.sessionId, you.stamp);
    journal.setBridge(dumpInboxes());
    return { queued: true, viaBridge: true };
  },
  /**
   * A voice message recorded in the Oasis: kept as a playable file, transcribed by ElevenLabs Scribe
   * (scribe.js, the Telegram module's key and request), and the transcript sent like a typed message.
   */
  async voiceMessage({ agentId, audio, mime, durationMs, priority }) {
    const a = getAgent(agentId, { owned: true });
    const names = [...agents.values()].map((x) => x.name).filter(Boolean);
    const { fileId, mime: type, transcript } = await takeVoiceMessage({ audioBase64: audio, mime, keyterms: names });
    if (!transcript) return { ok: false, error: 'Scribe heard no words in that recording.' };
    const voice = { fileId, mime: type, ...(typeof durationMs === 'number' ? { durationMs: Math.round(durationMs) } : {}) };
    const sent = await a.send(transcript, { priority, voice });
    return { ok: true, data: { transcript, fileId, uuid: sent?.uuid } };
  },
  /** The md reader (files.js): a text file an agent sent, read and saved back. */
  readFile({ fileId }) { return readTextFile(fileId); },
  writeFile({ fileId, text, expectedMtimeMs, force }) { return writeTextFile(fileId, text, { expectedMtimeMs: typeof expectedMtimeMs === 'number' ? expectedMtimeMs : null, force: force === true }); },
  interrupt({ agentId, cancelQueued }) { return getAgent(agentId, { owned: true }).interrupt({ cancelQueued }); },
  setModel({ agentId, model }) { return getAgent(agentId, { owned: true }).setModel(model); },
  /**
   * restart: true (the owner confirmed a switch the running CLI refused) restarts the agent in that mode. Only from an
   * Oasis page's socket (a browser always sends its Origin): not over HTTP, not from scripts, so an agent can't raise
   * its own or another agent's permissions with a command. (A local process can still forge an Origin.)
   */
  setPermissionMode({ agentId, mode, restart }, ws) {
    const confirmed = restart === true && Boolean(ws?.oasisPage);
    if (restart === true && !confirmed) throw new Error('only the owner, from the Oasis page, can restart an agent into another mode');
    return getAgent(agentId, { owned: true }).setPermissionMode(mode, { restart: confirmed });
  },
  setEffort({ agentId, effort }) { return getAgent(agentId, { owned: true }).setEffort(effort); },
  /** Claude in Chrome for an agent (chrome.js): restarts its process with the same session. */
  setChrome({ agentId, chrome }) { return getAgent(agentId, { owned: true }).setChrome(chrome); },
  respond({ agentId, requestId, behavior, message, answers, always, updatedInput }) {
    return getAgent(agentId, { owned: true }).respond(requestId, { behavior, message, answers, always, updatedInput });
  },
  contextUsage({ agentId }) { return getAgent(agentId, { owned: true }).refreshContext(); },

  kill({ agentId, keep = false, now = false }) {
    const a = getAgent(agentId);
    if (a.kind === 'owned') {
      a.kill({ now });
      if (a.sessionId) {
        recentlyRemoved.set(a.sessionId, a.id);
        setTimeout(() => recentlyRemoved.delete(a.sessionId), 30000).unref();
      }
    } else a.stop?.();
    if (!keep || a.kind !== 'owned') {
      journal.forget(agentId);
      agents.delete(agentId);
      hub.emit(agentId, 'status', { status: 'idle', reason: 'removed' });
      hub.emit(agentId, 'removed', {});
      hub.persist();
    }
    scheduleSnapshot();
    return { ok: true };
  },
  /**
   * A new name for an agent the Oasis runs ({agentId or agent, name}). The roster, the snapshot and the character
   * card's name line follow; Telegram and the stage find agents by their name when asked, so they follow too. The
   * session, its seat and home, voice, skin, schedule and history are keyed on its id or session and stay.
   * Refused when another owned agent has that name (any case).
   */
  rename({ agentId, agent, name }) {
    const a = findAgent(agentId ?? agent);
    if (!a) throw new Error(`unknown agent ${agentId ?? agent ?? ''}`);
    if (a.kind !== 'owned') throw new Error(`${a.name} runs in another window: only agents the Oasis runs can be renamed here`);
    const next = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!next) throw new Error('a name is needed');
    if (next.length > RENAME_MAX) throw new Error(`a name of at most ${RENAME_MAX} characters`);
    const clash = ownedAgents().find((x) => x !== a && (x.name || '').trim().toLowerCase() === next.toLowerCase());
    if (clash) throw new Error(`another agent is already called ${clash.name}`);
    const old = a.name;
    if (old === next) return a.snapshot();
    // Voice on/off is read from the name when it was never set (Anorak speaks by default): keep what it has now.
    a.speakSet = true;
    a.name = next;
    if (a.sessionId && characters.fileFor(a.sessionId)) characters.setFacts(a.sessionId, { name: next });
    hub.log(`[${next}] renamed from ${old}`);
    hub.persist();
    scheduleSnapshot();
    return a.snapshot();
  },
  restart({ agentId }) {
    const a = getAgent(agentId, { owned: true });
    const wasDown = !a.proc;
    a.start();
    // What its last process never took in goes out again, in order.
    if (wasDown && a.proc) a.sendChain = a.sendChain.then(() => a.flushLeftovers()).catch(() => {});
    return a.snapshot();
  },
  /**
   * The Oasis page says what it knows about agents (VillagePresence.tsx), whenever it changes:
   * [{ agentId, avatar, avatarName, thumb, voice, world, place }]. It goes into each agent's card (character.js),
   * and an avatar nobody has described yet gets its description (looks.js).
   */
  presence({ agents: list } = {}) {
    let n = 0;
    for (const p of Array.isArray(list) ? list.slice(0, 200) : []) {
      const a = p && agents.get(p.agentId);
      if (!a?.sessionId || !characters.fileFor(a.sessionId)) continue;
      const avatar = typeof p.avatar === 'string' ? p.avatar.replace(/[?#].*$/, '') : undefined;
      if (avatar) looks.want(avatar, p.thumb);
      characters.setFacts(a.sessionId, {
        name: a.name || undefined,
        ...(avatar ? { avatar, look: lookLine(avatar, typeof p.avatarName === 'string' ? p.avatarName : null) } : {}),
        ...(typeof p.voice === 'string' ? { voice: p.voice } : {}),
        ...(typeof p.world === 'string' ? { world: p.world } : {}),
        ...(typeof p.place === 'string' ? { place: p.place } : {}),
      });
      n += 1;
    }
    return { ok: true, data: { agents: n } };
  },
  /** An agent's card: { file, name, role, who, voice, look, avatar, world, home, place, note }. `agent`: id, session or name. */
  getCharacter({ agentId, agent }) {
    const a = findAgent(agentId ?? agent);
    const c = a && characterFor(a);
    if (!c) throw new Error(a ? `${a.name} has no session yet` : `unknown agent ${agentId ?? agent ?? ''}`);
    return { ok: true, data: { agentId: a.id, file: c.card.file, ...c.card.fields, who: c.card.who, note: c.note } };
  },
  /** The owner's or the agent's own words on the card: `role` (one sentence), `who` (a few). It is told again with its next message. */
  setCharacter({ agentId, agent, role, who }) {
    const a = findAgent(agentId ?? agent);
    if (!a?.sessionId) throw new Error(a ? `${a.name} has no session yet` : `unknown agent ${agentId ?? agent ?? ''}`);
    characterFor(a);
    characters.setOwn(a.sessionId, { ...(typeof role === 'string' ? { role } : {}), ...(typeof who === 'string' ? { who } : {}) });
    return commands.getCharacter({ agentId: a.id });
  },
  /**
   * Pictures for an agent, on request: view "look" (its own avatar from the front) or "around" (four pictures of what
   * is around it). Rendered by an open Oasis page, saved as files -> { pictures: [{ path, label, note }] }. Without a
   * page: "look" falls back to the avatar's gallery thumbnail.
   */
  async view({ agentId, agent, view = 'look' }) {
    const a = findAgent(agentId ?? agent);
    if (!a) throw new Error(`unknown agent ${agentId ?? agent ?? ''}`);
    if (view !== 'look' && view !== 'around') throw new Error('view: look or around');
    const pictures = (await captureViews(a.id, view) || []).filter((p) => p && typeof p.data === 'string' && p.data.length <= EYES_MAX && /^image\/(jpeg|png|webp)$/.test(p.mediaType || '')).slice(0, 6);
    if (pictures.length) return { ok: true, data: { pictures: saveViews(a, view, pictures), live: true } };
    if (view === 'look') {
      const card = a.sessionId ? characters.read(a.sessionId) : null;
      const avatar = card?.fields.avatar;
      const thumb = avatar ? looks.thumbFor(avatar) : null;
      if (thumb) return { ok: true, data: { pictures: [{ path: thumb.replace(/\\/g, '/'), label: 'thumbnail', note: 'The Oasis is not open in a browser right now: this is your avatar\'s gallery picture, not a live view.' }], live: false } };
    }
    return { ok: false, error: 'no picture: the Oasis is not open in a browser tab right now (it renders them), or this agent has no place in it yet' };
  },
  /** A page's answer to view.request: {requestId, pictures: [{data, mediaType, label, note}]}; none when it cannot. */
  viewFrames({ requestId, pictures }) {
    const w = viewsWaiting.get(requestId);
    if (!w) return { ok: true, late: true };
    if (Array.isArray(pictures) && pictures.length) w.done(pictures);
    else if (--w.left <= 0) w.done(null);
    return { ok: true };
  },
  // ---- schedules (schedule.js): the HTTP API takes the same commands (POST /api/cmd), so Anorak can set them.
  /**
   * An agent's recurring wake-up: every off | hourly | 3h | 6h | daily | weekly, at "HH:MM" (daily, weekly; for the
   * intervals the first slot of the day), day 0-6 or a name (weekly, 0 = Sunday), prompt (its standing prompt; ""
   * goes back to the default). Fields left out keep their value.
   */
  setSchedule({ agentId, agent, every, at, day, prompt }) {
    const a = scheduleAgent(agentId ?? agent);
    const old = a.schedule || {};
    if (every !== undefined && !EVERY.includes(every)) throw new Error(`every: one of ${EVERY.join(', ')}`);
    const dayIndex = typeof day === 'string' ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(day.trim().toLowerCase().slice(0, 3)) : day;
    const next = normalizeSchedule({
      every: every ?? old.every ?? 'off',
      at: at ?? old.at,
      day: dayIndex ?? old.day,
      prompt: prompt !== undefined ? prompt : old.prompt,
      // A new rhythm starts now: slots before this moment never fire. Only the prompt changed: the rhythm goes on.
      since: every !== undefined || at !== undefined || day !== undefined ? now() : old.since,
    }, now());
    a.schedule = next;
    a.persist();
    a.emit('schedule', { schedule: next });
    scheduleSnapshot();
    return { ok: true, data: scheduleView(a) };
  },
  /** A one-off or repeating appointment: at ("16:20", "wed 16:20", "2026-11-25 16:20", "in 30m", ms), repeat (daily, weekly), note, prompt, by. */
  addAppointment({ agentId, agent, at, repeat, note, prompt, by }) {
    const a = scheduleAgent(agentId ?? agent);
    if (repeat != null && repeat !== '' && !REPEATS.includes(repeat)) throw new Error(`repeat: ${REPEATS.join(' or ')} (or leave it out)`);
    const appt = normalizeAppointment({ at, repeat, note, prompt, by }, now());
    if (appt.at < now() - 60_000) throw new Error(`that time has passed (${new Date(appt.at).toString().slice(0, 21)})`);
    if (a.appointments.length >= 50) throw new Error('50 appointments at most per agent');
    a.appointments = [...a.appointments, appt].sort((x, y) => x.at - y.at);
    a.persist();
    a.emit('schedule', { appointment: appt });
    hub.log(`[${a.name}] schedule: ${appointmentLabel(appt)}${by ? ` (set by ${by})` : ''}`);
    scheduleSnapshot();
    return { ok: true, data: { appointment: { ...appt, label: appointmentLabel(appt) }, ...scheduleView(a) } };
  },
  removeAppointment({ agentId, agent, id }) {
    const a = scheduleAgent(agentId ?? agent);
    const before = a.appointments.length;
    a.appointments = a.appointments.filter((x) => x.id !== id);
    if (a.appointments.length === before) throw new Error(`no appointment ${id} for ${a.name}`);
    a.persist();
    a.emit('schedule', { removed: id });
    scheduleSnapshot();
    return { ok: true, data: scheduleView(a) };
  },
  /** Wake an agent now, the schedule's way (a one-off appointment at this minute): when it is idle, or after its turn. */
  wakeNow({ agentId, agent, prompt, note, by }) {
    const a = scheduleAgent(agentId ?? agent);
    const appt = normalizeAppointment({ at: now(), note: note || 'woken now', prompt: prompt || a.schedule?.prompt || DEFAULT_PROMPT, by }, now());
    a.appointments = [...a.appointments, appt];
    a.persist();
    const result = scheduler.check(a);
    return { ok: true, data: { result: result || 'waiting', ...scheduleView(a) } };
  },
  /** Every owned agent's schedule, appointments and next wake-up, with the settings. */
  listSchedules() {
    return { ok: true, data: { settings: scheduler.settings, defaultPrompt: DEFAULT_PROMPT, now: now(), agents: ownedAgents().map(scheduleView) } };
  },
  /** Quiet hours ({ from, to } or null for none) and the daily cap of recurring wake-ups per agent. */
  scheduleSettings({ quiet, dailyCap } = {}) {
    const patch = {};
    if (quiet !== undefined) patch.quiet = quiet;
    if (dailyCap !== undefined) patch.dailyCap = dailyCap;
    const settings = Object.keys(patch).length ? scheduler.setSettings(patch) : scheduler.settings;
    return { ok: true, data: { settings, defaultPrompt: DEFAULT_PROMPT } };
  },
  /** An agent writes to the owner on Telegram (scripts/tell.mjs), once in a while. */
  tellOwner({ agentId, agent, text }) {
    const a = findAgent(agentId ?? agent);
    if (!a) throw new Error(`unknown agent ${agentId ?? agent ?? ''}`);
    if (!telegram) throw new Error('the Telegram line is not running in this engine');
    return { ok: true, data: telegram.tell(a.id, a.name, text) };
  },
  // ---- Claude accounts (accounts.js): never a token here, only ids and labels.
  /** The accounts, which one is the village default, how full each is, which are out until when. */
  listAccounts() { return { ok: true, data: accounts.view() }; },
  /** The village's account: "auto" (the one whose week ends first) or an account id. Applies from each agent's next turn. */
  /** Ask every account marked out with one tiny turn now (the HUD's "check now", agents, scripts). */
  async checkAccounts() { const checked = await checkOutAccounts({ asked: true }); return { ok: true, data: { checked, ...accounts.view() } }; },
  setDefaultAccount({ account }) { return { ok: true, data: { villageDefault: accounts.setVillageDefault(account), ...accounts.view() } }; },
  /** Pin one agent to an account (null: back to the village's choice). An idle agent moves now. */
  setAccount({ agentId, agent, account }) {
    const a = scheduleAgent(agentId ?? agent);
    const pin = account && account !== 'auto' ? String(account) : null;
    if (pin && !accounts.get(pin)) throw new Error(`no account "${pin}" (${accounts.all().map((x) => x.id).join(', ')})`);
    a.accountPin = pin;
    a.persist();
    const want = hub.chooseAccount(a);
    if (a.proc && a.isIdle() && want && want.id !== a.accountId) a.sendChain = a.sendChain.then(() => a.switchAccount('pinned by the owner')).catch(() => {});
    scheduleSnapshot();
    return { ok: true, data: { agentId: a.id, accountPin: pin, account: want } };
  },
  /** Test engines only (OASIS_FAKE_CLOCK=1): move the schedules' clock. advanceMs adds; at sets it to that time. */
  clock({ advanceMs, at } = {}) {
    if (!FAKE_CLOCK) throw new Error('the clock can only be moved in a test engine (OASIS_FAKE_CLOCK=1)');
    if (typeof advanceMs === 'number') clock.offset += advanceMs;
    if (at !== undefined) { const t = parseWhen(at, now()); if (t === null) throw new Error('at: a time'); clock.offset = t - Date.now(); }
    scheduler.tick();
    void accountsTick();
    accountsChanged();
    scheduleSnapshot();
    return { ok: true, data: { now: now(), iso: new Date(now()).toString() } };
  },
  /** This start: when, how the last run ended, who was told to carry on, the line the HUD shows. */
  restartInfo: () => restartInfo(),

  async observe({ sessionPath, name }) {
    if (!sessionPath || !isTranscriptPath(sessionPath)) throw new Error('sessionPath must be a .jsonl under ~/.claude/projects');
    const existing = [...agents.values()].find((a) => a.kind === 'observer' && a.sessionPath.toLowerCase() === path.resolve(sessionPath).toLowerCase());
    if (existing) return existing.snapshot();
    const obs = new Observer({ id: newId('obs'), name, sessionPath }, hub);
    addAgent(obs);
    await obs.start();
    scheduleSnapshot();
    return obs.snapshot();
  },
  unobserve({ agentId }) { return commands.kill({ agentId }); },

  history({ agentId }) { return backlog.get(agentId) || []; },
  /** The Telegram line's state; {pings: true|false} switches pings. */
  telegram(args) { return telegram ? telegram.command(args) : { enabled: false }; },

  /**
   * The session's past before `before` (a transcript byte offset from an event's `at`; null = the end of the file), or
   * before the line of tool use `anchor` (owned agents' live entries have no offset). Read from the transcript, no API
   * call. -> {events (history: true, each with `at`), from (where the next piece ends), done (reached the first line)}
   */
  olderHistory({ agentId, before = null, anchor = null, minEvents, maxBytes }) {
    const a = getAgent(agentId);
    const file = a.sessionPath || a.transcriptPath || (a.sessionId ? findSessionFile(a.sessionId, a.cwd) : null);
    if (!file || !fs.existsSync(file)) throw new Error('no transcript for this agent yet');
    return readOlderHistory(file, a.id, {
      before: typeof before === 'number' ? before : null,
      anchor: typeof anchor === 'string' ? anchor : null,
      minEvents: Math.max(1, Math.min(Number(minEvents) || 150, 2000)),
      maxBytes: Math.max(64 * 1024, Math.min(Number(maxBytes) || 4 * 1024 * 1024, 32 * 1024 * 1024)),
    });
  },

  // Graceful stop that works on Windows too (signals from another process can't be caught there).
  shutdown() { setTimeout(() => shutdown('shutdown command'), 50); return { ok: true }; },
};

// ------------------------------------------------------------------ one writer per session
// A session is its transcript; whichever process has it open holds the pen. Two holders each keep their own copy of
// the conversation in memory and branch the transcript. "Move here" stops the other (idle) holder and resumes the
// same session here; when the session is opened somewhere else again (the owner types in the desktop app), the
// Oasis lets go and watches the transcript instead. Both sides resume from the file, so neither loses a turn.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const where = (e) => (e.entrypoint === 'claude-desktop' ? 'the desktop app' : e.entrypoint === 'cli' ? 'a terminal' : `${e.entrypoint || e.kind || 'another process'}`);

function isClaudeProcess(pid) {
  try {
    const out = process.platform === 'win32'
      ? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    return /(^|[\\/",])(claude|node)(\.exe)?"?(,|\s|$)/im.test(out);
  } catch { return false; }
}

async function stopOtherHolders(sessionId, ours) {
  // The registry flips to idle a moment after a turn ends, so give a busy holder a few seconds first.
  const patience = Date.now() + 6000;
  let others;
  for (;;) {
    others = readLiveEntries().filter((e) => e.sessionId === sessionId && !ours.has(e.pid));
    const busy = others.find((e) => e.status && e.status !== 'idle');
    if (!busy) break;
    if (Date.now() > patience) throw new Error(`it is working in ${where(busy)} right now (${busy.status}); move it when it is done`);
    await sleep(300);
  }
  for (const e of others) {
    if (!isClaudeProcess(e.pid)) throw new Error(`pid ${e.pid} does not look like a claude process; not stopping it`);
    hub.log(`move: stopping ${where(e)} (pid ${e.pid}), which holds session ${sessionId.slice(0, 8)}`);
    try { process.kill(e.pid); } catch (err) { if (err.code !== 'ESRCH') throw err; }
  }
  const until = Date.now() + 8000;
  while (others.some((e) => pidAlive(e.pid))) {
    if (Date.now() > until) throw new Error('the other process did not stop');
    await sleep(150);
  }
}

const releasing = new Set();
/** Agents coming back at start whose last process may still be going away (waitOutOrphan): not "opened elsewhere". */
const restoring = new Set();
async function letGoOfSessionsOpenElsewhere() {
  const owned = ownedAgents();
  if (!owned.length) return;
  const ours = new Set(owned.map((a) => a.proc?.pid).filter(Boolean));
  const entries = readLiveEntries();
  for (const a of owned) {
    if (!a.sessionId || a.forkPending() || releasing.has(a.id) || restoring.has(a.id)) continue;
    const other = entries.find((e) => e.sessionId === a.sessionId && !ours.has(e.pid));
    if (!other) continue;
    releasing.add(a.id);
    try {
      hub.log(`[${a.name}] session ${a.sessionId.slice(0, 8)} was opened in ${where(other)} (pid ${other.pid}): letting go, watching it instead`);
      const sessionPath = findSessionFile(a.sessionId, a.cwd);
      commands.kill({ agentId: a.id, now: true });
      if (sessionPath) await commands.observe({ sessionPath, name: a.name });
    } catch (e) {
      hub.log(`[${a.name}] letting go failed: ${e.message}`);
    } finally {
      releasing.delete(a.id);
    }
  }
}
// Only when spawns are direct: through the cmd.exe fallback our own claude pid is unknown and would look foreign.
if (!resolveClaude().shell) setInterval(() => { void letGoOfSessionsOpenElsewhere(); }, 2000).unref();
else hub.log('claude runs through cmd.exe: the one-writer watch is off');
// A bridged session that stops checking in (closed, or the mod was removed) goes back to read-only in the Oasis.
let bridgedBefore = new Set();
setInterval(() => {
  const now = aliveBridges();
  if (now.size !== bridgedBefore.size || [...now].some((id) => !bridgedBefore.has(id))) scheduleSnapshot();
  bridgedBefore = now;
}, 2000).unref();

async function runCommand(msg, ws = null) {
  const fn = commands[msg.cmd];
  if (!fn) throw new Error(`unknown command ${msg.cmd}`);
  return await fn(msg, ws);
}

/** Control requests resolve to {ok:false, error} instead of throwing; report those as failed replies. */
function failedResult(data) {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.ok === false);
}

// ------------------------------------------------------------------ hooks
const recentlyRemoved = new Map(); // sessionId -> agentId (hooks keep arriving while a killed process exits)

function onHook(body) {
  const sid = body.session_id;
  if (!sid) return;
  hub.log(`hook ${body.hook_event_name}${body.tool_name ? ' ' + body.tool_name : ''} session=${sid.slice(0, 8)}`);
  const owned = ownedAgents().find((a) => a.sessionId === sid);
  const ownerId = owned?.id || recentlyRemoved.get(sid);
  if (ownerId) {
    // The live stream already covers this agent; record that the hook fired, nothing more.
    hub.emit(ownerId, 'hook', { event: body.hook_event_name, toolName: body.tool_name || null });
    return;
  }
  if (body.hook_event_name === 'SessionEnd' && !agents.has(`hook-${sid.slice(0, 8)}`)) return;
  const id = `hook-${sid.slice(0, 8)}`;
  let h = agents.get(id);
  if (!h) {
    h = new HookObserver({ id, sessionId: sid, cwd: body.cwd, transcriptPath: body.transcript_path }, hub);
    addAgent(h);
    scheduleSnapshot();
  }
  h.apply(body);
}

// ------------------------------------------------------------------ http + ws
// A web page in the owner's browser could otherwise open ws://localhost:4530 and drive agents.
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];
function originAllowed(origin) {
  if (!origin) return true; // node clients, curl, Claude Code hooks
  try {
    const u = new URL(origin);
    return LOOPBACK.includes(u.hostname);
  } catch {
    return false;
  }
}

// A DNS-rebinding page reaches 127.0.0.1 under its own name and sends same-origin GETs
// without an Origin header, so the Host header must be a loopback name as well.
function hostAllowed(host) {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK.includes(name.toLowerCase());
}

// With a local key (token.js), every request carries it, except the two that cannot: /health (the plugin asks
// whether the Oasis is up before it has a key; it says nothing private) and /hook (Claude Code's own http hooks).
const OPEN_PATHS = new Set(['/health', '/hook']);
function requestAllowed(req, url) {
  if (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin)) return false;
  return OPEN_PATHS.has(url?.pathname) || tokenAllowed(req, url);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' }); // no CORS: the Oasis page talks over /ws
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!requestAllowed(req, url)) return sendJson(res, 403, { error: 'not allowed: this Oasis asks for its local key (open it with /oasis or scripts/oasis.mjs)' });
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/file/')) return serveAttachment(url.pathname.slice('/file/'.length), res, req);
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, agents: agents.size, clients: clients.size, restart: restartInfo(), accounts: accounts.view(), pace: paceLines(), claude: resolveClaude(), ears: earsStatus(), clipWatchdog: clipWatchdogState(), liveScribe: { model: LIVE_SCRIBE_MODEL, ready: hasLiveScribe() }, places: { missions: setting('missionsDir'), grill: setting('grillFile'), questions: setting('questionsDir') } });
    if (req.method === 'GET' && url.pathname === '/api/agents') return sendJson(res, 200, snapshots());
    if (req.method === 'GET' && url.pathname === '/api/sessions') return sendJson(res, 200, await commands.listSessions({}));
    if (req.method === 'POST' && url.pathname === '/hook') {
      const body = JSON.parse((await readBody(req)) || '{}');
      try { onHook(body); } catch (e) { hub.log('hook error', e.message); }
      return sendJson(res, 200, {}); // {} = no decision; never block the hooked session
    }
    if (req.method === 'POST' && url.pathname === '/bridge/poll') {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      const { messages, cameAlive } = checkIn(body);
      if (messages.length) journal.setBridge(dumpInboxes()); // collected: no longer ours to keep
      if (cameAlive) { hub.log(`bridge: session ${body.sessionId.slice(0, 8)} connected (${body.surface || 'no surface'}, ${body.cwd || '?'})`); scheduleSnapshot(); }
      return sendJson(res, 200, { messages });
    }
    // /oasis in a Claude Code session (plugins/oasis): make sure that session stands in the village (watch its
    // transcript if nothing has it yet) and ask the open Oasis pages to walk the camera to it. A page that connects
    // in the next 90 s (the browser /oasis just opened) is told in its hello.
    // The Oasis mod asks who its session is in the village (plugins/oasis): the same note an engine agent gets.
    if (req.method === 'POST' && url.pathname === '/bridge/character') {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      const agent = typeof body.sessionId === 'string' ? [...agents.values()].find((a) => a.sessionId === body.sessionId) : null;
      const c = agent ? characterFor(agent) : null;
      return sendJson(res, 200, c ? { ok: true, note: c.note, stamp: c.stamp, agentId: agent.id, owned: agent.kind === 'owned' } : { ok: true, note: null });
    }
    if (req.method === 'POST' && url.pathname === '/bridge/open') {
      const body = JSON.parse((await readBody(req, 64 * 1024)) || '{}');
      if (typeof body.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) return sendJson(res, 400, { ok: false, error: 'sessionId must be a session uuid' });
      let agent = [...agents.values()].find((a) => a.sessionId === body.sessionId);
      if (!agent) {
        const file = findSessionFile(body.sessionId, typeof body.cwd === 'string' ? body.cwd : undefined);
        if (file) agent = await commands.observe({ sessionPath: file });
      }
      const agentId = agent?.id || null;
      pendingShow = agentId ? { agentId, at: Date.now() } : null;
      if (agentId) broadcast({ type: 'show', agentId });
      return sendJson(res, 200, { ok: true, agentId, clients: clients.size });
    }
    if (req.method === 'POST' && url.pathname === '/bridge/event') {
      const body = JSON.parse((await readBody(req, 256 * 1024)) || '{}');
      const watcher = [...agents.values()].find((a) => a.kind !== 'owned' && a.sessionId === body.sessionId);
      if (watcher && body.kind === 'text' && typeof body.text === 'string') {
        hub.emit(watcher.id, 'text.delta', { messageId: null, index: Number(body.index) || 0, text: body.text, parentToolUseId: null });
      }
      return sendJson(res, 200, {});
    }
    if (req.method === 'POST' && url.pathname === '/api/cmd') {
      const msg = JSON.parse(await readBody(req));
      const data = await runCommand(msg);
      if (failedResult(data)) return sendJson(res, 400, { ok: false, error: data.error || `${msg.cmd} failed`, data });
      return sendJson(res, 200, { ok: true, data });
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e.message });
  }
});

const wss = new WebSocketServer({ noServer: true });
const earsWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/listen' && requestAllowed(req, url)) {
    earsWss.handleUpgrade(req, socket, head, (ws) => {
      // Voice typing through ElevenLabs when the page asks for it and there is a key; local Moonshine otherwise.
      if (url.searchParams.get('engine') === 'elevenlabs' && hasLiveScribe()) return listenScribe(ws, url, (m) => hub.log(m));
      earsListen(ws, url, (m) => hub.log(m)).catch((e) => { try { ws.send(JSON.stringify({ t: 'error', text: e.message })); ws.close(); } catch { /* gone */ } });
    });
    return;
  }
  if (url.pathname !== '/ws' || !requestAllowed(req, url)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  // A browser tab of the Oasis (it sends its Origin): only such a socket may confirm a mode restart.
  ws.oasisPage = Boolean(req?.headers?.origin) && originAllowed(req.headers.origin);
  clients.add(ws);
  const bl = {};
  for (const [id, list] of backlog) if (agents.has(id)) bl[id] = list;
  const show = pendingShow && Date.now() - pendingShow.at < 90000 && agents.has(pendingShow.agentId) ? pendingShow.agentId : undefined;
  pendingShow = null;
  ws.send(JSON.stringify({ type: 'hello', agents: snapshots(), backlog: bl, server: { port: PORT, claude: resolveClaude().how, restart: restartInfo(), accounts: accounts.view() }, ...(show ? { show } : {}) }));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      const data = await runCommand(msg, ws);
      if (failedResult(data)) {
        ws.send(JSON.stringify({ type: 'reply', id: msg.id ?? null, cmd: msg.cmd, ok: false, error: data.error || `${msg.cmd} failed`, data }));
        return;
      }
      ws.send(JSON.stringify({ type: 'reply', id: msg.id ?? null, cmd: msg.cmd, ok: true, data }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'reply', id: msg.id ?? null, cmd: msg.cmd, ok: false, error: e.message }));
    }
  });
  ws.on('close', () => { clients.delete(ws); stage.pageClosed(ws); });
});

// ------------------------------------------------------------------ boot + shutdown
function restartInfo() {
  return { startedAt: restart.startedAt, stop: restart.stop, resumed: restart.resumed, redelivered: restart.redelivered, line: restart.line };
}

/** The last lines of a session's transcript (the last 256 KB), or null without one. */
function transcriptEnd(sessionId, cwd) {
  try {
    const file = sessionId ? findSessionFile(sessionId, cwd) : null;
    if (!file) return null;
    const size = fs.statSync(file).size;
    const n = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(n);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, n, size - n); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    return n < size ? lines.slice(1) : lines; // the first piece may be half a line
  } catch { return null; }
}

/**
 * The last run's claude process for this agent, if it outlived its engine (a crash leaves it a few seconds: its
 * stdin closes and it exits by itself; seen to take under 3 s). Two processes on one session branch its transcript,
 * so the new one waits for it, and stops it if it does not go.
 */
async function waitOutOrphan(e) {
  const pid = Number(e.pid);
  if (!pid || pid === process.pid || !pidAlive(pid)) return;
  const live = readLiveEntries().find((x) => x.pid === pid);
  if (!live || live.sessionId !== e.sessionId) return; // the pid is someone else's by now
  const until = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < until) await sleep(200);
  if (!pidAlive(pid)) return;
  if (!isClaudeProcess(pid)) return;
  hub.log(`[${e.name}] the last run's process (pid ${pid}) still holds session ${String(e.sessionId).slice(0, 8)}: stopping it`);
  try { process.kill(pid); } catch { /* gone */ }
  const gone = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < gone) await sleep(150);
}

/**
 * Agents come back at their desks with their sessions. One that was mid-turn when the last run stopped (resume.js
 * wasMidTurn: the roster's turnOpenAt, checked against the transcript) is told once to carry on, and messages that
 * were on their way to an agent (journal.js) go out again, in order. All of it also after an unplanned stop.
 */
async function restoreRoster() {
  const stop = journal.previousStop();
  restart.stop = stop;
  const entries = loadRoster(ROSTER_FILE).filter((e) => e?.id && e.cwd);
  const jobs = [];
  for (const e of entries) {
    const open = typeof e.turnOpenAt === 'number' || (stop && !stop.planned) ? transcriptEnd(e.sessionId, e.cwd) : null;
    const midTurn = wasMidTurn(e, open ? transcriptTurnOpen(open) : null, stop);
    const { pid: _pid, turnOpenAt, ...spec } = e;
    // Mid-turn shows as "stopped mid-turn" (outcome.js) until the carry-on note is out, and stays so if it cannot go.
    const Runtime = spec.runtime === 'hermes' ? HermesAgent : Agent;
    const agent = new Runtime(midTurn ? { ...spec, turnOpenAt: typeof turnOpenAt === 'number' ? turnOpenAt : (stop?.at || Date.now()) } : spec, hub);
    agents.set(agent.id, agent);
    const resume = midTurn && RESUME_ON;
    if (resume) restart.resumed.push({ id: agent.id, name: agent.name });
    restoring.add(agent.id);
    jobs.push((async () => {
      try { await waitOutOrphan(e); } finally { restoring.delete(agent.id); }
      if (shuttingDown) return;
      agent.start(); // resumes e.sessionId (or claims it if no transcript exists yet)
      if (!agent.proc) return;
      const run = agent.sendChain.then(() => agent.flushLeftovers({ resume }));
      agent.sendChain = run.catch(() => {});
      const done = await run.catch((err) => { hub.log(`[${agent.name}] resume failed: ${err.message}`); return null; });
      if (done?.delivered) { restart.redelivered += done.delivered; restart.line = restartLine(restart); }
      if (resume && !done?.resumed) hub.log(`[${agent.name}] was mid-turn but could not be told to carry on`);
      else if (resume) hub.log(`[${agent.name}] was mid-turn: told to carry on${done.delivered ? `, ${done.delivered} queued message(s) delivered` : ''}`);
    })());
  }
  const waiting = restoreInboxes(journal.bridgeInboxes());
  if (waiting) hub.log(`${waiting} message(s) wait again for their desktop sessions (bridge)`);
  restart.line = restartLine(restart);
  if (entries.length) hub.log(`restored ${entries.length} agent(s) from ${ROSTER_FILE}`);
  if (restart.line) hub.log(restart.line + (stop?.reason ? ` (last stop: ${stop.reason})` : ''));
  scheduleSnapshot();
  await Promise.all(jobs);
  // Schedules start once everyone is back, a little later, so a carry-on note goes before any wake-up. A wake-up that
  // came due while the engine was off goes out then, once.
  scheduler.start({ delayMs: Number(process.env.OASIS_SCHEDULE_START_MS ?? 20_000) });
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  const working = ownedAgents().filter((a) => a.turnOpenAt);
  hub.log(`${sig}: stopping ${ownedAgents().length} agent(s)${working.length ? `; mid-turn, to be resumed at the next start: ${working.map((a) => a.name).join(', ')}` : ''}`);
  // The goodbye: who is mid-turn (the roster's turnOpenAt), what waits for whom (the journal, already on disk), and
  // that this stop was meant.
  saveRosterNow(ROSTER_FILE, ownedAgents().map((a) => a.rosterEntry()));
  journal.setBridge(dumpInboxes());
  journal.stop({ planned: true, reason: sig });
  scheduler.stop();
  stopEars();
  stopClipWatchdog();
  telegram?.stop();
  for (const a of agents.values()) { if (a.kind === 'owned') a.kill(); else a.stop?.(); }
  setTimeout(() => {
    for (const a of ownedAgents()) a.proc?.kill();
    process.exit(0);
  }, 3500).unref();
  server.close();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows: closing the console window arrives as SIGHUP (about 10 s before the process is ended), Ctrl+Break as SIGBREAK.
process.on('SIGHUP', () => shutdown('the window closed'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
// A crash that can still speak says when and why, so the next start does not have to guess.
process.on('uncaughtException', (err) => {
  console.error(err);
  if (!shuttingDown) {
    try { saveRosterNow(ROSTER_FILE, ownedAgents().map((a) => a.rosterEntry())); } catch { /* the journal still says it */ }
    journal.stop({ planned: false, reason: `crash: ${String(err?.message || err).slice(0, 200)}` });
  }
  process.exit(1);
});
process.on('exit', () => { for (const a of ownedAgents()) { try { a.proc?.kill(); } catch { /* ignore */ } } });

// A mouse a browser left confined is given back (Windows; clip-watchdog.js).
startClipWatchdog((m) => hub.log(m));

server.listen(PORT, HOST, () => {
  hub.log(`Oasis agent engine on http://${HOST}:${PORT}  (ws /ws)  claude: ${resolveClaude().how}`);
  journal.load();
  journal.beat();
  // Telegram first (it only starts polling on the next tick): a resumed agent that owes a reply there is known to it.
  agentHours.start();
  telegram = startTelegram({ port: PORT, root: ROOT, log: hub.log, journal, listAgents: snapshots, send: (agentId, text, opts) => commands.send({ agentId, text, ...(opts?.source ? { source: opts.source } : {}) }), interrupt: (agentId) => commands.interrupt({ agentId }) });
  void restoreRoster();
});
