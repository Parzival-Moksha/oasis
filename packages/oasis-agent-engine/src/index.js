// Oasis agent engine: Claude Code sessions as agents, bridged to the Oasis over one WebSocket.
// Grew out of the 7c_oasis spike (C:/7c_oasis/spike, findings in its README).
//   ws://127.0.0.1:4530/ws   events out, commands in
//   POST /hook               Claude Code `type:"http"` hooks (optional observation path)
//   POST /api/cmd            same commands as the socket, for curl/debugging
//   ws://127.0.0.1:4530/listen  live dictation (Moonshine, see ears.js; ?engine=elevenlabs: scribe-live.js)
//   GET  /api/agents, /api/sessions, /health
//   GET  /file/<id>          a file an agent sent with SendUserFile (files.js; only those, by random id)
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Agent } from './agent.js';
import { Observer } from './observe.js';
import { HookObserver } from './hooks.js';
import { listSessions, isTranscriptPath, readLiveRegistry, readLiveEntries, pidAlive, findSessionFile } from './sessions.js';
import { execFileSync } from 'node:child_process';
import { checkIn, isBridged, queueForBridge, aliveBridges } from './bridge.js';
import { readOlderHistory } from './history.js';
import { loadRoster, saveRoster, saveRosterNow } from './roster.js';
import { takeVoiceMessage } from './scribe.js';
import { takePictures } from './pictures.js';
import { resolveClaude } from './claude.js';
import { listen as earsListen, warmEars, earsStatus, stopEars } from './ears.js';
import { listenScribe, hasLiveScribe, LIVE_SCRIBE_MODEL } from './scribe-live.js';
import { serveAttachment } from './files.js';
import { startTelegram } from './telegram.js';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..'); // af_oasis
const ROSTER_FILE = process.env.OASIS_ROSTER || path.join(ROOT, 'data', 'agent-engine.local.json');
const PORT = Number(process.env.OASIS_PORT || 4530);
const HOST = process.env.OASIS_HOST || '127.0.0.1';
const BACKLOG = 400;

// ------------------------------------------------------------------ hub
const agents = new Map(); // id -> Agent | Observer | HookObserver
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
    if (/^(status|init|meta|model|mode|effort|eyes|speak|chrome|context|exit|permission\.)/.test(kind)) scheduleSnapshot();
  },
  eyes: (agentId) => captureEyes(agentId),
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

function newId(prefix) { return `${prefix}-${randomUUID().slice(0, 8)}`; }

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

  async spawnAgent({ name, cwd, sessionId, model, permissionMode, effort, fork, force, move, createCwd, worldTools, chrome } = {}) {
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
    const agent = new Agent({ id: newId('agent'), name: name || path.basename(cwd), cwd, sessionId, model, permissionMode, effort, fork, worldTools, chrome: chrome === true }, hub);
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

  /** images: pictures pasted or dropped in the Oasis ([{ data: base64, mediaType, name }], pictures.js). */
  send({ agentId, text, priority, images }) {
    const a = getAgent(agentId);
    const hasPictures = Array.isArray(images) && images.length > 0;
    if (a.kind !== 'owned' && hasPictures) {
      throw new Error('pictures cannot go to this session yet: it runs in another window and the Oasis mod only carries text there. Send the text alone, or use Move it here to send pictures');
    }
    if (a.kind === 'owned') return a.send(text, { priority, images: hasPictures ? takePictures(images) : [] });
    // A watched session: only if it runs the Oasis mod, which submits it there as a prompt of that same session.
    if (!text || !text.trim()) throw new Error('empty message');
    if (!isBridged(a.sessionId)) throw new Error('watching only: this session runs somewhere else without the Oasis plugin; use Move it here to talk to it');
    queueForBridge(a.sessionId, text);
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
  interrupt({ agentId, cancelQueued }) { return getAgent(agentId, { owned: true }).interrupt({ cancelQueued }); },
  setModel({ agentId, model }) { return getAgent(agentId, { owned: true }).setModel(model); },
  setPermissionMode({ agentId, mode }) { return getAgent(agentId, { owned: true }).setPermissionMode(mode); },
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
      agents.delete(agentId);
      hub.emit(agentId, 'status', { status: 'idle', reason: 'removed' });
      hub.emit(agentId, 'removed', {});
      hub.persist();
    }
    scheduleSnapshot();
    return { ok: true };
  },
  restart({ agentId }) {
    const a = getAgent(agentId, { owned: true });
    a.start();
    return a.snapshot();
  },

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
async function letGoOfSessionsOpenElsewhere() {
  const owned = ownedAgents();
  if (!owned.length) return;
  const ours = new Set(owned.map((a) => a.proc?.pid).filter(Boolean));
  const entries = readLiveEntries();
  for (const a of owned) {
    if (!a.sessionId || a.forkPending() || releasing.has(a.id)) continue;
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

function requestAllowed(req) {
  return hostAllowed(req.headers.host) && originAllowed(req.headers.origin);
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
  if (!requestAllowed(req)) return sendJson(res, 403, { error: 'origin not allowed' });
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/file/')) return serveAttachment(url.pathname.slice('/file/'.length), res, req);
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, agents: agents.size, clients: clients.size, claude: resolveClaude(), ears: earsStatus(), liveScribe: { model: LIVE_SCRIBE_MODEL, ready: hasLiveScribe() } });
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
      if (cameAlive) { hub.log(`bridge: session ${body.sessionId.slice(0, 8)} connected (${body.surface || 'no surface'}, ${body.cwd || '?'})`); scheduleSnapshot(); }
      return sendJson(res, 200, { messages });
    }
    // /oasis in a Claude Code session (plugins/oasis): make sure that session stands in the village (watch its
    // transcript if nothing has it yet) and ask the open Oasis pages to walk the camera to it. A page that connects
    // in the next 90 s (the browser /oasis just opened) is told in its hello.
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
  if (url.pathname === '/listen' && requestAllowed(req)) {
    earsWss.handleUpgrade(req, socket, head, (ws) => {
      // Voice typing through ElevenLabs when the page asks for it and there is a key; local Moonshine otherwise.
      if (url.searchParams.get('engine') === 'elevenlabs' && hasLiveScribe()) return listenScribe(ws, url, (m) => hub.log(m));
      earsListen(ws, url, (m) => hub.log(m)).catch((e) => { try { ws.send(JSON.stringify({ t: 'error', text: e.message })); ws.close(); } catch { /* gone */ } });
    });
    return;
  }
  if (url.pathname !== '/ws' || !requestAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  const bl = {};
  for (const [id, list] of backlog) if (agents.has(id)) bl[id] = list;
  const show = pendingShow && Date.now() - pendingShow.at < 90000 && agents.has(pendingShow.agentId) ? pendingShow.agentId : undefined;
  pendingShow = null;
  ws.send(JSON.stringify({ type: 'hello', agents: snapshots(), backlog: bl, server: { port: PORT, claude: resolveClaude().how }, ...(show ? { show } : {}) }));
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
  ws.on('close', () => clients.delete(ws));
});

// ------------------------------------------------------------------ boot + shutdown
function restoreRoster() {
  const entries = loadRoster(ROSTER_FILE);
  for (const e of entries) {
    if (!e?.id || !e.cwd) continue;
    const agent = new Agent(e, hub);
    agents.set(agent.id, agent);
    agent.start(); // resumes e.sessionId (or claims it if no transcript exists yet)
  }
  if (entries.length) hub.log(`restored ${entries.length} agent(s) from ${ROSTER_FILE}`);
}

let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  hub.log(`${sig}: stopping ${ownedAgents().length} agent(s)`);
  saveRosterNow(ROSTER_FILE, ownedAgents().map((a) => a.rosterEntry()));
  stopEars();
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
process.on('exit', () => { for (const a of ownedAgents()) { try { a.proc?.kill(); } catch { /* ignore */ } } });

server.listen(PORT, HOST, () => {
  hub.log(`Oasis agent engine on http://${HOST}:${PORT}  (ws /ws)  claude: ${resolveClaude().how}`);
  restoreRoster();
  telegram = startTelegram({ port: PORT, root: ROOT, log: hub.log, listAgents: snapshots, send: (agentId, text) => commands.send({ agentId, text }), interrupt: (agentId) => commands.interrupt({ agentId }) });
});
