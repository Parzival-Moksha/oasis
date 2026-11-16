// The engine's journal: what must survive a restart besides the roster, written to disk the moment it changes.
//
// The roster already says who was mid-turn (each agent's `turnOpenAt`, roster.js). The journal adds what was on
// its way to an agent and is in no transcript yet:
//   queued    messages handed to an agent but not taken in by its CLI: written to its stdin while a turn ran
//             (they wait inside the process and die with it), or still waiting for their eyes picture
//   bridge    messages waiting for a desktop session's Oasis mod to collect them (bridge.js)
//   telegram  updates taken from the bot but not yet handed to an agent, and the agents that owe a reply there
//   run/stop  when this engine started, its last sign of life, and how it stopped (planned or not)
// On start the engine reads it (resume.js, index.js restoreRoster): mid-turn agents are told to carry on, queued
// messages go out again in order, under the same uuid, and one that already reached the transcript is skipped,
// so a second restart delivers nothing twice.
//
// One small JSON file, written whole and atomically (tmp + rename) on every change: a few writes per message.
// A crash can only lose the change being written, never corrupt the file.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ v: 1, run: null, stop: null, queued: {}, bridge: {}, telegram: { inbox: [], owed: [] } });
/** A sign of life this often; an unplanned stop is dated by the last one. */
export const ALIVE_MS = 15_000;

export class Journal {
  /** @param {string|null} file null: nothing is kept (unit tests of other modules). */
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.data = EMPTY();
    /** What the last run left: read once by load(), never changed afterwards. */
    this.previous = null;
    this.timer = null;
    this.failed = null;
  }

  /** Read what the previous run left, then start this run's record. Returns the previous journal (or null). */
  load({ pid = process.pid } = {}) {
    let prev = null;
    if (this.file) {
      try {
        const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (d && typeof d === 'object') prev = d;
      } catch { prev = null; }
    }
    this.previous = prev;
    const data = EMPTY();
    if (prev) {
      if (prev.queued && typeof prev.queued === 'object') {
        for (const [id, list] of Object.entries(prev.queued)) {
          const kept = (Array.isArray(list) ? list : []).filter((e) => e && typeof e.uuid === 'string' && typeof e.text === 'string');
          if (kept.length) data.queued[id] = kept;
        }
      }
      if (prev.bridge && typeof prev.bridge === 'object') {
        for (const [sid, list] of Object.entries(prev.bridge)) {
          const kept = (Array.isArray(list) ? list : []).filter((m) => m && typeof m.text === 'string');
          if (kept.length) data.bridge[sid] = kept;
        }
      }
      const tg = prev.telegram || {};
      data.telegram.inbox = (Array.isArray(tg.inbox) ? tg.inbox : []).filter((u) => u && typeof u.update_id === 'number');
      data.telegram.owed = (Array.isArray(tg.owed) ? tg.owed : []).filter((x) => typeof x === 'string');
    }
    const t = this.now();
    data.run = { startedAt: t, aliveAt: t, pid };
    this.data = data;
    this.save();
    return prev;
  }

  /** How the previous run ended: { at, planned, reason } or null when there was none. */
  previousStop() {
    const p = this.previous;
    if (!p?.run) return null;
    if (p.stop && typeof p.stop.at === 'number') return { at: p.stop.at, planned: p.stop.planned !== false, reason: p.stop.reason || null };
    // No goodbye: it was killed, crashed, or the machine went down. Its last sign of life dates it.
    return { at: typeof p.run.aliveAt === 'number' ? p.run.aliveAt : p.run.startedAt, planned: false, reason: null };
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      this.failed = null;
    } catch (e) {
      this.failed = e.message; // never take the engine down over its journal
    }
  }

  /** The sign of life, every ALIVE_MS. */
  beat() {
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (this.data.run) { this.data.run.aliveAt = this.now(); this.save(); } }, ALIVE_MS);
    this.timer.unref?.();
  }

  /** The goodbye: a planned stop (shutdown command, Ctrl+C, the window closing) or a crash that could still say so. */
  stop({ planned = true, reason = null } = {}) {
    clearInterval(this.timer);
    this.data.stop = { at: this.now(), planned, reason };
    this.save();
  }

  // ---------------------------------------------------------------- messages on their way to an agent
  /** @param {{uuid:string, text:string, at?:number, resume?:boolean, source?:string, priority?:string, images?:Array<{path:string,mediaType:string,name:string}>}} entry */
  queue(agentId, entry, { first = false } = {}) {
    const list = this.data.queued[agentId] || (this.data.queued[agentId] = []);
    if (list.some((e) => e.uuid === entry.uuid)) return;
    const kept = { at: this.now(), ...entry };
    if (first) list.unshift(kept); else list.push(kept);
    this.save();
  }

  /** Taken in by the CLI (it is in the transcript now), dropped, or refused: no longer ours to deliver. */
  done(agentId, uuid) {
    const list = this.data.queued[agentId];
    if (!list) return;
    const left = list.filter((e) => e.uuid !== uuid);
    if (left.length === list.length) return;
    if (left.length) this.data.queued[agentId] = left; else delete this.data.queued[agentId];
    this.save();
  }

  queuedFor(agentId) { return [...(this.data.queued[agentId] || [])]; }

  /** The agent is gone from the village: nothing is owed to it any more. */
  forget(agentId) {
    const owed = this.data.telegram.owed.filter((x) => x !== agentId);
    if (!this.data.queued[agentId] && owed.length === this.data.telegram.owed.length) return;
    delete this.data.queued[agentId];
    this.data.telegram.owed = owed;
    this.save();
  }

  /** Agents with a waiting message whose source starts with `prefix` ("tg:"). */
  agentsWithSource(prefix) {
    return Object.entries(this.data.queued).filter(([, list]) => list.some((e) => typeof e.source === 'string' && e.source.startsWith(prefix))).map(([id]) => id);
  }

  /** Is a message from this source (a Telegram update) already waiting for an agent? */
  hasSource(source) {
    return Object.values(this.data.queued).some((list) => list.some((e) => e.source === source));
  }

  // ---------------------------------------------------------------- bridge inboxes (bridge.js)
  setBridge(inboxes) {
    const next = {};
    for (const [sid, list] of Object.entries(inboxes || {})) if (Array.isArray(list) && list.length) next[sid] = list.map((m) => ({ text: m.text, at: m.at }));
    if (JSON.stringify(next) === JSON.stringify(this.data.bridge)) return;
    this.data.bridge = next;
    this.save();
  }

  bridgeInboxes() { return this.data.bridge; }

  // ---------------------------------------------------------------- telegram (telegram.js)
  /** An update taken from the bot, kept until it is handled: the bot never gives it out twice. */
  telegramTook(update) {
    if (this.data.telegram.inbox.some((u) => u.update_id === update.update_id)) return;
    this.data.telegram.inbox.push({ ...update, tries: 0 });
    this.save();
  }

  telegramHandled(updateId) {
    const left = this.data.telegram.inbox.filter((u) => u.update_id !== updateId);
    if (left.length === this.data.telegram.inbox.length) return;
    this.data.telegram.inbox = left;
    this.save();
  }

  /** Updates the last run took but never finished handling, oldest first; each call counts a try. */
  telegramLeft() {
    const list = this.data.telegram.inbox.map((u) => ({ ...u }));
    for (const u of this.data.telegram.inbox) u.tries = (u.tries || 0) + 1;
    if (list.length) this.save();
    return list;
  }

  /** Agents whose running or coming turn was started from Telegram: its reply goes back there. */
  setOwed(agentIds) {
    const next = [...new Set(agentIds)].sort();
    if (next.join('|') === [...this.data.telegram.owed].sort().join('|')) return;
    this.data.telegram.owed = next;
    this.save();
  }

  owed() { return [...this.data.telegram.owed]; }
}

/** Next to the roster: data/agent-engine.local.json -> data/agent-engine.journal.local.json. */
export function journalFileFor(rosterFile) {
  const dir = path.dirname(rosterFile);
  const base = path.basename(rosterFile);
  const name = /\.local\.json$/i.test(base) ? base.replace(/\.local\.json$/i, '.journal.local.json') : base.replace(/(\.json)?$/i, '.journal.json');
  return path.join(dir, name);
}
