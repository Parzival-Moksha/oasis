// The Oasis world tools for agents that never ask before an MCP call (Hermes): a stdio MCP server that forwards to
// the Oasis page server's HTTP MCP route and offers only the free tools of worldtools.js (looking, placing, moving,
// lighting, screenshots). Tools that spend credits or switch or wipe the owner's world are not listed, and a call to
// one gets an error result instead of reaching the Oasis.
//
//   node worldproxy.js <url>      (url: the Oasis MCP route, e.g. http://127.0.0.1:4516/api/mcp/oasis)
//
// Streamable HTTP client side: every stdin line (one JSON-RPC message) is POSTed; the answer comes back as JSON or as
// an SSE stream, and each message in it goes to stdout as one line. The mcp-session-id the server hands out rides on
// every later request; stdin closing ends the session (DELETE) and the process.
//
// The boundary fails closed: a batch is split and each part checked on its own; only known methods pass; every
// tools list is filtered, whatever request it answers; a request always gets an answer (an error when the Oasis gave
// none). When the Oasis forgets the session (2 h idle, or the page server restarted: HTTP 404), the proxy opens a new
// one with the client's own initialize and sends the request again, once.
//
// Not a sandbox: an agent with a shell can still reach the route itself (see the README, "Hermes agents").
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_TOOLS_ALLOWED, WORLD_SERVER } from './worldtools.js';
import { tokenHeaders } from './token.js';

const PREFIX = `mcp__${WORLD_SERVER}__`;
export const FREE_WORLD_TOOLS = new Set(WORLD_TOOLS_ALLOWED.filter((t) => t.startsWith(PREFIX)).map((t) => t.slice(PREFIX.length)));
/** Methods that may reach the Oasis. Lists and reads only, plus tools/call for a free tool. */
const METHODS = new Set(['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read', 'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel']);

const url = process.argv[2];
let session = null;
let protocol = null;
let initMsg = null; // the client's initialize, kept to open a new session when the Oasis forgets ours
let reopening = null;
let reN = 0;

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const fail = (id, message, code = -32000) => out({ jsonrpc: '2.0', id, error: { code, message } });

/** Every answer passes here: a tools list keeps only the free tools, whatever request it answers. */
function filtered(msg) {
  if (msg && typeof msg === 'object' && Array.isArray(msg.result?.tools)) {
    msg.result.tools = msg.result.tools.filter((t) => FREE_WORLD_TOOLS.has(t?.name));
  }
  if (msg?.result?.protocolVersion) protocol = msg.result.protocolVersion;
  return msg;
}

async function post(msg) {
  // The local key (token.js), when the Oasis runs with one: from OASIS_LOCAL_TOKEN (the engine passes it), else the file.
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...tokenHeaders() };
  if (session) headers['mcp-session-id'] = session;
  if (protocol) headers['mcp-protocol-version'] = protocol;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  return res;
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
  return [];
}

/** A new Oasis session with the client's own initialize (its answer stays here). */
function reopen() {
  if (!reopening) {
    reopening = (async () => {
      session = null;
      const id = `oasis-proxy-reopen-${++reN}`;
      const res = await post({ ...initMsg, id });
      for (const m of await messagesOf(res, id)) filtered(m);
      if (!session) throw new Error('the Oasis gave no session');
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => {});
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
  if (res.status === 202 || res.status === 204) return;
  const list = await messagesOf(res, msg.id);
  let answered = false;
  let errorText = '';
  for (const m of list) {
    if (m?.id === msg.id && !m.method) answered = true;
    if (m?.id == null && m?.error) { errorText = m.error.message || errorText; continue; } // e.g. "Unknown MCP session"
    out(filtered(m));
  }
  if (msg.id != null && !answered) fail(msg.id, `the Oasis MCP route gave no answer (HTTP ${res.status}${errorText ? `: ${errorText}` : ''})`);
}

function onMessage(msg) {
  if (Array.isArray(msg)) { for (const m of msg) onMessage(m); return; } // a batch: each part on its own
  if (!msg || typeof msg !== 'object') return;
  const isRequest = typeof msg.method === 'string' && msg.id != null;
  if (typeof msg.method !== 'string') return; // an answer from the client (we never ask it anything)
  if (!msg.method.startsWith('notifications/') && !METHODS.has(msg.method)) {
    if (isRequest) fail(msg.id, `${msg.method} is not offered here`, -32601);
    return;
  }
  if (msg.method === 'tools/call' && !FREE_WORLD_TOOLS.has(msg.params?.name)) {
    if (isRequest) out({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: `${msg.params?.name} is not offered here: it spends credits or changes the owner's world, and this agent cannot ask him first.` }] } });
    return;
  }
  if (msg.method === 'initialize') initMsg = { jsonrpc: '2.0', method: 'initialize', params: msg.params };
  forward(msg).catch((err) => { if (isRequest) fail(msg.id, `the Oasis is not reachable (${err.message})`); });
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (!url) { process.stderr.write('usage: node worldproxy.js <oasis mcp url>\n'); process.exit(2); }
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch { /* not JSON: ignore */ }
    }
  });
  process.stdin.on('end', async () => {
    if (session) await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session, ...tokenHeaders() } }).catch(() => {});
    process.exit(0);
  });
}
