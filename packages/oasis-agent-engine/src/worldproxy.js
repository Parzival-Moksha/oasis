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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_TOOLS_ALLOWED, WORLD_SERVER } from './worldtools.js';

const PREFIX = `mcp__${WORLD_SERVER}__`;
export const FREE_WORLD_TOOLS = new Set(WORLD_TOOLS_ALLOWED.filter((t) => t.startsWith(PREFIX)).map((t) => t.slice(PREFIX.length)));

const url = process.argv[2];
let session = null;
let protocol = null;
const methods = new Map(); // request id -> method, to find the answer to tools/list

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

function filtered(msg) {
  if (msg?.id != null && !msg.method) {
    if (methods.get(msg.id) === 'tools/list' && Array.isArray(msg.result?.tools)) {
      msg.result.tools = msg.result.tools.filter((t) => FREE_WORLD_TOOLS.has(t.name));
    }
    if (msg.result?.protocolVersion) protocol = msg.result.protocolVersion;
    methods.delete(msg.id);
  }
  return msg;
}

async function forward(msg) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (session) headers['mcp-session-id'] = session;
  if (protocol) headers['mcp-protocol-version'] = protocol;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  if (res.status === 202 || res.status === 204) return;
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
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
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        const list = [].concat(parsed);
        for (const m of list) out(filtered(m));
        if (msg.id != null && list.some((m) => m.id === msg.id && !m.method)) { reader.cancel().catch(() => {}); return; }
      }
    }
    return;
  }
  if (type.includes('json')) {
    for (const m of [].concat(await res.json())) out(filtered(m));
    return;
  }
  if (msg.id != null) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `the Oasis MCP route answered HTTP ${res.status}` } });
}

function onMessage(msg) {
  if (msg?.method && msg.id != null) methods.set(msg.id, msg.method);
  if (msg?.method === 'tools/call' && !FREE_WORLD_TOOLS.has(msg.params?.name)) {
    methods.delete(msg.id);
    out({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: `${msg.params?.name} is not offered here: it spends credits or changes the owner's world, and this agent cannot ask him first.` }] } });
    return;
  }
  forward(msg).catch((err) => {
    if (msg?.id != null && msg.method) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `the Oasis is not reachable (${err.message})` } });
  });
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
    if (session) await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': session } }).catch(() => {});
    process.exit(0);
  });
}
