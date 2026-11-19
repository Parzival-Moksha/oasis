// The Oasis world tools for agents that never ask before an MCP call (Hermes): a gate in front of the Oasis page
// server's HTTP MCP route that offers only the free tools of worldtools.js (looking, placing, moving, lighting,
// screenshots). Tools that spend credits or switch or wipe the owner's world are not listed, and a call to one gets an
// error result instead of reaching the Oasis.
//
// Two faces, one gate (createWorldGate):
//   node worldproxy.js <url>   a stdio MCP server: a Hermes on this machine starts it (hermes.js, ACP mcpServers).
//   startWorldGateServer(url)  an HTTP MCP endpoint on 127.0.0.1: a Hermes on another machine reaches it through the
//                              SSH line's reverse forward (hermes.js, remote agents). One per agent, in the engine.
//
// Upstream, the gate is a streamable-HTTP client with one Oasis session: every message is POSTed, the answer comes
// back as JSON or as an SSE stream. The boundary fails closed: a batch is split and each part checked on its own;
// only known methods pass; every tools list is filtered, whatever request it answers; a request always gets an answer
// (an error when the Oasis gave none). When the Oasis forgets the session (2 h idle, or the page server restarted:
// HTTP 404), the gate opens a new one with the client's own initialize and sends the request again, once. The local
// key (token.js) rides on every request when the Oasis runs with one.
//
// Not a sandbox: an agent with a shell can still reach the route itself (see the README, "Hermes agents").
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WORLD_TOOLS_ALLOWED, WORLD_SERVER } from './worldtools.js';
import { tokenHeaders } from './token.js';

const PREFIX = `mcp__${WORLD_SERVER}__`;
export const FREE_WORLD_TOOLS = new Set(WORLD_TOOLS_ALLOWED.filter((t) => t.startsWith(PREFIX)).map((t) => t.slice(PREFIX.length)));
/** Methods that may reach the Oasis. Lists and reads only, plus tools/call for a free tool. */
const METHODS = new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read', 'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel']);
const BODY_MAX = 4 * 1024 * 1024;

const fail = (id, message, code = -32000) => ({ jsonrpc: '2.0', id, error: { code, message } });
const refusedTool = (id, name) => ({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `${name} is not offered here: it spends credits or changes the owner's world, and this agent cannot ask him first.` }] } });

/** A tools list keeps only the free tools, whatever request it answers. */
function filtered(msg) {
  if (msg && typeof msg === 'object' && Array.isArray(msg.result?.tools)) {
    msg.result.tools = msg.result.tools.filter((t) => FREE_WORLD_TOOLS.has(t?.name));
  }
  return msg;
}

/** The messages in an answer (JSON or SSE). With an id, an SSE stream is read until the answer to it has come. */
async function messagesOf(res, id) {
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    const found = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try { found.push(...[].concat(JSON.parse(data))); } catch { continue; }
        if (id != null && found.some((m) => m?.id === id && !m.method)) { reader.cancel().catch(() => {}); return found; }
      }
    }
    return found;
  }
  if (type.includes('json')) { try { return [].concat(await res.json()); } catch { return []; } }
  await res.body?.cancel().catch(() => {});
  return [];
}

/**
 * The gate: handle(msg) takes one JSON-RPC message (or a batch) from the agent and resolves with the messages that go
 * back to it (none for a notification). close() ends the Oasis session.
 */
export function createWorldGate(url, { headers: extraHeaders = tokenHeaders } = {}) {
  let session = null;
  let protocol = null;
  let initMsg = null; // the client's initialize, kept to open a new session when the Oasis forgets ours
  let reopening = null;
  let reN = 0;

  async function post(msg) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extraHeaders() };
    if (session) headers['mcp-session-id'] = session;
    if (protocol) headers['mcp-protocol-version'] = protocol;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session = sid;
    return res;
  }

  const seen = (m) => { if (m?.result?.protocolVersion) protocol = m.result.protocolVersion; return filtered(m); };

  function reopen() {
    if (!reopening) {
      reopening = (async () => {
        session = null;
        const id = `oasis-gate-reopen-${++reN}`;
        const res = await post({ ...initMsg, id });
        for (const m of await messagesOf(res, id)) seen(m);
        if (!session) throw new Error('the Oasis gave no session');
        await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).then((r) => r.body?.cancel().catch(() => {}), () => {});
      })().finally(() => { reopening = null; });
    }
    return reopening;
  }

  async function forward(msg, again = true) {
    if (reopening) await reopening.catch(() => {});
    const res = await post(msg);
    if (res.status === 404 && again && initMsg && msg.method !== 'initialize') {
      await res.body?.cancel().catch(() => {});
      await reopen();
      return forward(msg, false);
    }
    if (res.status === 202 || res.status === 204) { await res.body?.cancel().catch(() => {}); return []; }
    const list = await messagesOf(res, msg.id);
    const back = [];
    let answered = false;
    let errorText = '';
    for (const m of list) {
      if (m?.id === msg.id && !m.method) answered = true;
      if (m?.id == null && m?.error) { errorText = m.error.message || errorText; continue; } // e.g. "Unknown MCP session"
      back.push(seen(m));
    }
    if (msg.id != null && !answered) back.push(fail(msg.id, `the Oasis MCP route gave no answer (HTTP ${res.status}${errorText ? `: ${errorText}` : ''})`));
    return back;
  }

  async function handle(msg) {
    if (Array.isArray(msg)) return (await Promise.all(msg.map(handle))).flat(); // a batch: each part on its own
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return []; // answers from the client: we ask it nothing
    const isRequest = msg.id != null;
    if (!msg.method.startsWith('notifications/') && !METHODS.has(msg.method)) return isRequest ? [fail(msg.id, `${msg.method} is not offered here`, -32601)] : [];
    if (msg.method === 'tools/call' && !FREE_WORLD_TOOLS.has(msg.params?.name)) return isRequest ? [refusedTool(msg.id, msg.params?.name)] : [];
    if (msg.method === 'initialize') {
      initMsg = { jsonrpc: '2.0', method: 'initialize', params: msg.params };
      // A client that connects again (Hermes 0.23 does at every turn start) begins a new Oasis session: sent on the
      // old one, the Oasis refuses it ("Server already initialized", HTTP 400). The old one is closed.
      if (session) {
        const old = session;
        session = null;
        protocol = null;
        fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': old, ...extraHeaders() } }).then((r) => r.body?.cancel().catch(() => {}), () => {});
      }
    }
    try {
      return await forward(msg);
    } catch (err) {
      return isRequest ? [fail(msg.id, `the Oasis is not reachable (${err.message})`)] : [];
    }
  }

  async function close() {
    if (session) await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session, ...extraHeaders() } }).catch(() => {});
    session = null;
  }

  return { handle, close };
}

/**
 * The gate as an HTTP MCP endpoint on 127.0.0.1 (any path). The agent sees one session of its own; the gate keeps
 * its own Oasis session behind it. GET (a server-to-client stream) is not offered: 405, which MCP clients accept.
 * -> Promise<{ port, close() }>
 */
export function startWorldGateServer(url, { port = 0, host = '127.0.0.1' } = {}) {
  const gate = createWorldGate(url);
  const sessionId = randomUUID();
  const server = http.createServer((req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST, DELETE' }).end(); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > BODY_MAX) { res.writeHead(413).end(); req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify(fail(null, 'not JSON', -32700))); return; }
      const back = await gate.handle(msg);
      const headers = { 'mcp-session-id': sessionId };
      if (!back.length) { res.writeHead(202, headers).end(); return; }
      res.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(msg) ? back : back.length === 1 ? back[0] : back));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve({ port: server.address().port, close: async () => { await gate.close(); await new Promise((r) => server.close(() => r())); } });
    });
  });
}

// ------------------------------------------------------------------ stdio face
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const url = process.argv[2];
  if (!url) { process.stderr.write('usage: node worldproxy.js <oasis mcp url>\n'); process.exit(2); }
  const gate = createWorldGate(url);
  const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      gate.handle(msg).then((back) => back.forEach(out));
    }
  });
  process.stdin.on('end', async () => { await gate.close(); process.exit(0); });
}
