// Bridge: sessions that run the Oasis plugin's mod (plugins/oasis at the repo root) check in here about once a second.
// The session keeps running where it is (the desktop app, a terminal); the Oasis watches it (an Observer tails its
// transcript, and the mod streams the reply text as it is written), and what the owner says in the Oasis waits here
// until the mod picks it up and submits it as a prompt of that same session. One process, two windows, no fork.
//   POST /bridge/poll   {sessionId, cwd, surface}      -> {messages: [{text}]}   (check in + collect)
//   POST /bridge/event  {sessionId, kind:'text', text, index}                    (reply text as it streams)
const ALIVE_MS = 4000; // the mod polls every second; three missed polls and the session counts as gone
const KEEP_MS = 60000; // a message nobody collects in a minute is dropped (the session went away meanwhile)

/** @type {Map<string, {lastSeen:number, cwd:string|null, surface:string|null, inbox:Array<{text:string, at:number}>}>} */
const bridges = new Map();

export function checkIn({ sessionId, cwd = null, surface = null }) {
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('sessionId must be a session uuid');
  const now = Date.now();
  let b = bridges.get(sessionId);
  const wasAlive = !!b && now - b.lastSeen < ALIVE_MS;
  if (!b) bridges.set(sessionId, (b = { lastSeen: now, cwd, surface, inbox: [] }));
  b.lastSeen = now;
  b.cwd = cwd || b.cwd;
  b.surface = surface || b.surface;
  const messages = b.inbox.filter((m) => now - m.at < KEEP_MS).map((m) => ({ text: m.text }));
  b.inbox = [];
  return { messages, cameAlive: !wasAlive };
}

export function isBridged(sessionId) {
  const b = sessionId && bridges.get(sessionId);
  return !!b && Date.now() - b.lastSeen < ALIVE_MS;
}

export function queueForBridge(sessionId, text) {
  if (!isBridged(sessionId)) throw new Error('that session is not connected to the Oasis right now');
  bridges.get(sessionId).inbox.push({ text, at: Date.now() });
}

/** Every inbox that holds something, for the journal (journal.js): {sessionId: [{text, at}]}. */
export function dumpInboxes() {
  const out = {};
  for (const [id, b] of bridges) if (b.inbox.length) out[id] = b.inbox.map((m) => ({ text: m.text, at: m.at }));
  return out;
}

/**
 * After an engine restart: messages that were still waiting for a session's mod wait again, for KEEP_MS from now.
 * The session counts as connected again at its next poll, about a second later, and collects them then.
 */
export function restoreInboxes(inboxes, now = Date.now()) {
  let n = 0;
  for (const [sessionId, list] of Object.entries(inboxes || {})) {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !Array.isArray(list)) continue;
    const inbox = list.filter((m) => m && typeof m.text === 'string').map((m) => ({ text: m.text, at: now }));
    if (!inbox.length) continue;
    const b = bridges.get(sessionId);
    if (b) b.inbox.push(...inbox); else bridges.set(sessionId, { lastSeen: 0, cwd: null, surface: null, inbox });
    n += inbox.length;
  }
  return n;
}

/** Session ids whose bridge is alive right now (to notice one going quiet). */
export function aliveBridges() {
  const now = Date.now();
  return new Set([...bridges].filter(([, b]) => now - b.lastSeen < ALIVE_MS).map(([id]) => id));
}
