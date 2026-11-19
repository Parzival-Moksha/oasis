// worldproxy.js test (src/worldproxy.js, the free-tools-only MCP proxy for Hermes agents). No model, no money.
//   node packages/oasis-agent-engine/scripts/worldproxy-smoke.mjs
// Against the real Oasis route when the page server (127.0.0.1:4516) is up: only the free tools are listed; a paid or
// world-wiping tool, inside a batch or alone, an unknown method and a call without params are refused. Against a fake
// server: an SSE tools list is filtered, and a session the server forgot is opened again and the call answered.
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FREE_WORLD_TOOLS, startWorldGateServer } from '../src/worldproxy.js';

const PROXY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worldproxy.js');
const run = (url, lines, wait = 3000) => new Promise((resolve) => {
  const p = spawn(process.execPath, [PROXY, url], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  (async () => { for (const l of lines) { if (typeof l === 'number') { await new Promise((r) => setTimeout(r, l)); continue; } p.stdin.write(JSON.stringify(l) + '\n'); } await new Promise((r) => setTimeout(r, wait)); p.stdin.end(); })();
  p.on('exit', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
});
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
let ok = true; const check = (l, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', l, x); if (!c) ok = false; };
// 1. real Oasis route: list + batch with a paid tool + unknown method
const oasisUp = await fetch('http://127.0.0.1:4516/api/mcp/oasis').then(() => true, () => false);
if (!oasisUp) console.log('SKIP the real route (the Oasis page server is not up)');
const real = !oasisUp ? [] : await run('http://127.0.0.1:4516/api/mcp/oasis', [init, 2500, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, [{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'clear_world', arguments: {} } }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'generate_image' } }], { jsonrpc: '2.0', id: 5, method: 'sampling/createMessage', params: {} }, { jsonrpc: '2.0', id: 6, method: 'tools/call' }]);
const by = (id) => real.find((m) => m.id === id);
if (oasisUp) {
check('real: only the free tools listed', by(2)?.result?.tools?.length === FREE_WORLD_TOOLS.size && by(2).result.tools.every((t) => FREE_WORLD_TOOLS.has(t.name)), by(2)?.result?.tools?.length);
check('batch: clear_world refused', by(3)?.result?.isError === true);
check('batch: generate_image refused', by(4)?.result?.isError === true);
check('unknown method refused', by(5)?.error?.code === -32601);
check('tools/call without params refused', by(6)?.result?.isError === true);
}
// 2. fake server that forgets the session after the first list
let sessions = 0; let lists = 0; let current = null; let inits = 0;
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
  if (req.method === 'DELETE') { res.end(); return; }
  const m = JSON.parse(b);
  if (m.method === 'initialize') { inits++; current = `s${++sessions}`; res.setHeader('mcp-session-id', current); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })); return; }
  if (req.headers['mcp-session-id'] !== current) { res.statusCode = 404; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unknown MCP session' } })); return; }
  if (!m.id) { res.statusCode = 202; res.end(); return; }
  if (m.method === 'tools/list') { lists++; if (lists === 1) current = 'forgotten'; res.setHeader('content-type', 'text/event-stream'); res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'get_world_info' }, { name: 'clear_world' }] } })}\n\n`); return; }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok ' + m.params?.name }] } }));
}); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));
const fake = await run(`http://127.0.0.1:${srv.address().port}/mcp`, [init, 500, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, 500, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_world_info', arguments: {} } }], 1500);
const f = (id) => fake.find((m) => m.id === id);
check('fake: SSE list filtered', f(2)?.result?.tools?.length === 1 && f(2).result.tools[0].name === 'get_world_info');
check('fake: forgotten session reopened, call answered', f(3)?.result?.content?.[0]?.text === 'ok get_world_info', `inits ${inits}`);
check('fake: the reopen answer is not passed to the client', !fake.some((m) => String(m.id).startsWith('oasis-gate')));
srv.close();

// 3. the HTTP gate (remote agents) against the real route: a client that connects twice (Hermes 0.23 connects again at
// every turn start) gets its tools both times. Seen 2026-11-19: the second initialize went out on the old Oasis session
// and the Oasis refused it ("Server already initialized"), so Og's turns failed.
if (oasisUp) {
  const gate = await startWorldGateServer('http://127.0.0.1:4516/api/mcp/oasis');
  const connect = async () => {
    const post = async (body, sid) => {
      const r = await fetch(`http://127.0.0.1:${gate.port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(sid ? { 'mcp-session-id': sid } : {}) }, body: JSON.stringify(body) });
      return { sid: r.headers.get('mcp-session-id'), body: r.status === 202 ? null : await r.json() };
    };
    const a = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, a.sid);
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, a.sid);
    return { init: a.body, tools: list.body?.result?.tools?.length };
  };
  const first = await connect();
  const second = await connect();
  check('gate: a second connection initializes too', !!second.init?.result?.protocolVersion, JSON.stringify(second.init?.error || ''));
  check('gate: both connections list the free tools', first.tools === FREE_WORLD_TOOLS.size && second.tools === FREE_WORLD_TOOLS.size, `${first.tools}, ${second.tools}`);
  await gate.close();
}
console.log(ok ? 'ALL PASSED' : 'FAILED');
process.exit(ok ? 0 : 1);
