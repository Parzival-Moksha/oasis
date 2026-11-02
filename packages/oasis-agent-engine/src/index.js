// Oasis agent engine: Claude Code sessions as agents, bridged to the Oasis over one WebSocket.
// Grew out of the 7c_oasis spike (C:/7c_oasis/spike, findings in its README).
//   ws://127.0.0.1:4530/ws   events out, commands in
//   POST /hook               Claude Code `type:"http"` hooks (optional observation path)
//   POST /api/cmd            same commands as the socket, for curl/debugging
//   GET  /api/agents, /api/sessions, /health
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Agent } from './agent.js';
import { Observer } from './observe.js';
import { HookObserver } from './hooks.js';
import { listSessions, isTranscriptPath, readLiveRegistry } from './sessions.js';
import { loadRoster, saveRoster, saveRosterNow } from './roster.js';
import { resolveClaude } from './claude.js';
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
let snapshotTimer = null;

const hub = {
  emit(agentId, kind, payload = {}) {
    const event = { ...payload, v: 1, agentId, ts: Date.now(), kind }; // envelope fields always win
    if (kind !== 'text.delta') {
      let list = backlog.get(agentId);
      if (!list) backlog.set(agentId, (list = []));
      list.push(event);
      if (list.length > BACKLOG) list.splice(0, list.length - BACKLOG);
    }
    broadcast({ type: 'event', event });
    if (/^(status|init|meta|model|context|exit|permission\.)/.test(kind)) scheduleSnapshot();
  },
  persist() {
    saveRoster(ROSTER_FILE, ownedAgents().map((a) => a.rosterEntry()));
  },
  log(...a) {
    console.log(new Date().toISOString().slice(11, 19), ...a);
  },
};

function ownedAgents() { return [...agents.values()].filter((a) => a.kind === 'owned'); }
function snapshots() { return [...agents.values()].map((a) => a.snapshot()); }
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

function newId(prefix) { return `${prefix}-${randomUUID().slice(0, 8)}`; }

function getAgent(id, { owned = false } = {}) {
  const a = agents.get(id);
  if (!a) throw new Error(`unknown agent ${id}`);
  if (owned && a.kind !== 'owned') throw new Error(`agent ${id} is read-only (${a.kind})`);
  return a;
}

// ------------------------------------------------------------------ commands
const commands = {
  listAgents: () => snapshots(),
  listLive: () => [...readLiveRegistry()].map(([sessionId, r]) => ({ sessionId, ...r })),

  async listSessions({ limit } = {}) {
    const sessions = await listSessions({ limit: limit || 150 });
    const owned = new Map(ownedAgents().map((a) => [a.sessionId, a.id]));
    const observed = new Map([...agents.values()].filter((a) => a.kind === 'observer').map((a) => [a.sessionPath.toLowerCase(), a.id]));
    return sessions.map((s) => ({ ...s, ownedBy: owned.get(s.sessionId) || null, observedBy: observed.get(String(s.path).toLowerCase()) || null }));
  },

  spawnAgent({ name, cwd, sessionId, model, permissionMode, effort, fork, force } = {}) {
    if (!cwd) throw new Error('cwd is required');
    cwd = path.resolve(cwd);
    if (!fs.existsSync(cwd)) throw new Error(`cwd does not exist: ${cwd}`);
    if (sessionId && !fork) {
      const dup = ownedAgents().find((a) => a.sessionId === sessionId);
      if (dup) throw new Error(`session ${sessionId} is already driven by agent ${dup.name}; use fork:true for a copy`);
      // Open in another process (desktop app, terminal)? Two writers fork the transcript (see README).
      const live = readLiveRegistry().get(sessionId);
      const ours = new Set(ownedAgents().map((a) => a.proc?.pid).filter(Boolean));
      if (live && !ours.has(live.pid) && !force) {
        throw new Error(`session is open in pid ${live.pid} (${live.entrypoint || live.kind}, ${live.status}); close it there, or spawn with fork:true (copy) or force:true`);
      }
    }
    const agent = new Agent({ id: newId('agent'), name: name || path.basename(cwd), cwd, sessionId, model, permissionMode, effort, fork }, hub);
    addAgent(agent);
    agent.start();
    hub.persist();
    scheduleSnapshot();
    return agent.snapshot();
  },

  send({ agentId, text, priority }) { return getAgent(agentId, { owned: true }).send(text, { priority }); },
  interrupt({ agentId, cancelQueued }) { return getAgent(agentId, { owned: true }).interrupt({ cancelQueued }); },
  setModel({ agentId, model }) { return getAgent(agentId, { owned: true }).setModel(model); },
  setPermissionMode({ agentId, mode }) { return getAgent(agentId, { owned: true }).setPermissionMode(mode); },
  respond({ agentId, requestId, behavior, message, answers, always, updatedInput }) {
    return getAgent(agentId, { owned: true }).respond(requestId, { behavior, message, answers, always, updatedInput });
  },
  contextUsage({ agentId }) { return getAgent(agentId, { owned: true }).refreshContext(); },

  kill({ agentId, keep = false }) {
    const a = getAgent(agentId);
    if (a.kind === 'owned') {
      a.kill();
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

  // Graceful stop that works on Windows too (signals from another process can't be caught there).
  shutdown() { setTimeout(() => shutdown('shutdown command'), 50); return { ok: true }; },
};

async function runCommand(msg) {
  const fn = commands[msg.cmd];
  if (!fn) throw new Error(`unknown command ${msg.cmd}`);
  return await fn(msg);
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
    if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, agents: agents.size, claude: resolveClaude() });
    if (req.method === 'GET' && url.pathname === '/api/agents') return sendJson(res, 200, snapshots());
    if (req.method === 'GET' && url.pathname === '/api/sessions') return sendJson(res, 200, await commands.listSessions({}));
    if (req.method === 'POST' && url.pathname === '/hook') {
      const body = JSON.parse((await readBody(req)) || '{}');
      try { onHook(body); } catch (e) { hub.log('hook error', e.message); }
      return sendJson(res, 200, {}); // {} = no decision; never block the hooked session
    }
    if (req.method === 'POST' && url.pathname === '/api/cmd') {
      const msg = JSON.parse(await readBody(req));
      return sendJson(res, 200, { ok: true, data: await runCommand(msg) });
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e.message });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
  ws.send(JSON.stringify({ type: 'hello', agents: snapshots(), backlog: bl, server: { port: PORT, claude: resolveClaude().how } }));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      const data = await runCommand(msg);
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
});
