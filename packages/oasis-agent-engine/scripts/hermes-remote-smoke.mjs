// Remote Hermes agents (src/hermes.js `remote`, a Hermes on another machine over SSH) without a second machine:
// scripts/fake-ssh.mjs plays ssh (it does the -R forward for real and can play a dead network or a host that is off),
// scripts/fake-acp.mjs plays the Hermes on the other side, and a fake Oasis MCP route plays the page server. No model,
// no money, about a minute. Its own engine on port 4545 (OASIS_PORT); never the real engine on 4530.
//
//   node packages/oasis-agent-engine/scripts/hermes-remote-smoke.mjs
//
// 1. The line: ssh gets BatchMode, keep-alive and the reverse forward; Hermes works in the remote home folder.
// 2. World tools through the line: only the free tools reach the remote Hermes; clear_world never reaches the Oasis.
// 3. The network drops mid-turn, the host stays off for two tries, comes back: the agent reconnects by itself, loads
//    its session, is told to carry on and gets the cut-off message again.
// 4. The network drops while idle: no retries; the next message brings the line back.
// 5. The host is off when a message is sent: three tries, then it gives up; the message waits and goes out with the
//    next one.
// 6. A stop while a retry is waiting: no more tries.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-hermes-remote-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const SSH_DIR = path.join(tmp, 'ssh');
const FAKE_DIR = path.join(tmp, 'pi');
fs.mkdirSync(SSH_DIR, { recursive: true });
fs.mkdirSync(FAKE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const lines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const sshCalls = () => lines(path.join(SSH_DIR, 'ssh-calls.jsonl'));
const opened = () => lines(path.join(FAKE_DIR, 'opened.jsonl'));
const prompts = () => lines(path.join(FAKE_DIR, 'prompts.jsonl'));
const flag = (name, on) => { const f = path.join(SSH_DIR, name); if (on) fs.writeFileSync(f, ''); else fs.rmSync(f, { force: true }); };

// ---------------------------------------------------------------- a fake Oasis MCP route
const oasisCalls = [];
const oasis = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 200 : 405).end(); return; }
    const m = JSON.parse(b);
    oasisCalls.push(m.method === 'tools/call' ? `call ${m.params?.name}` : m.method);
    if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'oasis-1' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-oasis', version: '0' } } })); return; }
    if (m.id == null) { res.writeHead(202).end(); return; }
    if (m.method === 'tools/list') {
      const tools = ['get_world_info', 'clear_world', 'generate_image'].map((name) => ({ name, inputSchema: { type: 'object' } }));
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools } })}\n\n`);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'World "Fake Oasis"' }] } }));
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => oasis.on('listening', r));

// ---------------------------------------------------------------- the engine
let engine = null;
const logs = [];
async function startEngine() {
  if (await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken by another engine`);
  engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
    cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: {
      ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_TELEGRAM: '0', OASIS_LOOKS: '0', OASIS_CLIP_WATCHDOG: '0', OASIS_SCHEDULE_START_MS: '3600000',
      OASIS_WEB_URL: `http://127.0.0.1:${oasis.address().port}`, OASIS_RECONNECT_S: '1,2,3', FAKE_PORT_SHIFT: '1000',
      OASIS_SSH: JSON.stringify([process.execPath, path.join(HERE, 'fake-ssh.mjs')]), FAKE_SSH_DIR: SSH_DIR,
      FAKE_SSH_REMOTE: JSON.stringify([process.execPath, path.join(HERE, 'fake-acp.mjs'), FAKE_DIR]),
    },
  });
  for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('the test engine did not come up');
}
async function stopEngine() {
  await fetch(`http://127.0.0.1:${PORT}/api/cmd`, { method: 'POST', body: JSON.stringify({ cmd: 'shutdown' }) }).catch(() => {});
  if (engine.exitCode === null) await new Promise((r) => engine.once('exit', r));
  await sleep(800);
}
async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0;
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') { for (const list of Object.values(m.backlog || {})) events.push(...list); res(); }
      if (m.type === 'reply') replies.get(m.id)?.(m);
      if (m.type === 'event') events.push(m.event);
    });
  });
  const cmd = async (name, args = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); }); return r.ok ? r.data : Promise.reject(new Error(r.error)); };
  const until = async (from, pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) { const e = events.slice(from).find(pred); if (e) return e; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(50); }
  };
  return { ws, events, cmd, until, mark: () => events.length };
}

try {
  await startEngine();
  const c = await connect();
  const snap = await c.cmd('spawnAgent', { name: 'Og (fake)', runtime: 'hermes', remote: { host: 'og' } });
  const id = snap.id;
  const kindOf = (kind) => (e) => e.agentId === id && e.kind === kind && !e.history;
  const status = async () => (await c.cmd('listAgents')).find((a) => a.id === id);
  const reply = (from) => c.events.slice(from).filter(kindOf('text')).map((e) => e.text).join('');

  // 1. the line
  const init = await c.until(0, kindOf('init'), 15000, 'init');
  const call = sshCalls()[0];
  const opts = (call?.options || []).map((o) => o.join(' '));
  check('ssh: the host, BatchMode, keep-alive, no tty', call?.host === 'og' && opts.includes('-o BatchMode=yes') && opts.includes('-o ServerAliveInterval=15') && opts.includes('-T'));
  const fwd = opts.find((o) => o.startsWith('-R '));
  const worldPort = Number(fwd?.split(':')[1]);
  check('ssh: a reverse forward for the world tools, same port both ends', fwd === `-R 127.0.0.1:${worldPort}:127.0.0.1:${worldPort}`, fwd);
  check('the remote line becomes `hermes acp` in the home folder', /^cd && /.test(call.remote) && /exec "\$H" acp$/.test(call.remote));
  check('Hermes works in the remote home folder', opened()[0]?.cwd === '/home/fake' && init.cwd === 'og:/home/fake', init.cwd);
  check('it is given the world tools at the forwarded port', opened()[0]?.mcpServers?.[0]?.url === `http://127.0.0.1:${worldPort}/mcp`);

  // 2. world tools through the line
  let m = c.mark();
  await c.cmd('send', { agentId: id, text: 'WORLD please' });
  await c.until(m, kindOf('turn.end'), 15000, 'world turn');
  const w = reply(m);
  check('the remote Hermes sees only the free tools', /world tools: get_world_info;/.test(w), w);
  check('it reads the world through the line', /World "Fake Oasis"/.test(w));
  check('no forward warning: the line carries the world tools', !logs.join('').includes('remote port forwarding failed'));
  check('clear_world is refused and never reaches the Oasis', /clear_world refused: true/.test(w) && !oasisCalls.includes('call clear_world'), oasisCalls.join(','));

  // 3. the network drops mid-turn; the host stays off for two tries; then it comes back
  m = c.mark();
  const sent = await c.cmd('send', { agentId: id, text: 'SLOW drop me' });
  await c.until(m, kindOf('text.delta'), 10000, 'slow turn');
  const callsBefore = sshCalls().length;
  flag('down', true);
  flag('drop', true);
  await c.until(m, (e) => kindOf('status')(e) && /trying again in 1 s \(1\/3\)/.test(e.reason), 60000, 'the first retry');
  flag('drop', false);
  await c.until(m, (e) => kindOf('status')(e) && /\(2\/3\)/.test(e.reason), 10000, 'the second retry');
  check('while the host is off, it keeps trying', sshCalls().length >= callsBefore + 1, `${sshCalls().length - callsBefore} more ssh calls`);
  flag('down', false);
  const back = await c.until(m, (e) => kindOf('user.sent')(e) && e.auto === 'resume', 15000, 'the carry-on note');
  check('back by itself, told to carry on', !!back);
  await c.until(m, (e) => kindOf('user.sent')(e) && e.uuid === sent.uuid, 10000, 'the cut-off message again');
  const end3 = await c.until(c.events.indexOf(back), kindOf('turn.end'), 20000, 'the resumed turn');
  check('its session loaded again over the new line', opened().some((o) => o.how === 'load' && o.sessionId === init.sessionId));
  const p3 = prompts().slice(-1)[0]?.text || '';
  check('one prompt: carry on + the cut-off message; the turn finishes', /Carry on/i.test(p3) && /SLOW drop me/.test(p3) && end3.outcome === 'done-waiting');

  // 4. the network drops while idle
  m = c.mark();
  flag('drop', true);
  const idle = await c.until(m, (e) => kindOf('status')(e) && e.status === 'error', 10000, 'the idle drop');
  check('an idle drop: shown, no retries', /not reachable/.test(idle.reason) && !/trying again/.test(idle.reason), idle.reason);
  flag('drop', false);
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'hello again' });
  await c.until(m, kindOf('turn.end'), 15000, 'the turn after the idle drop');
  check('the next message brings the line back', /echo: hello again/.test(reply(m)), reply(m));

  // 5. the host is off when a message is sent: it gives up, the message waits
  await c.cmd('kill', { agentId: id, keep: true }); // a clean stop first (kept at its desk), so the next send starts the line
  await c.until(c.mark() - 1, (e) => e.agentId === id && e.kind === 'exit', 10000, 'stop').catch(() => {});
  await sleep(500);
  flag('down', true);
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'first, while it is off' });
  const gaveUp = await c.until(m, (e) => kindOf('status')(e) && /gave up/.test(e.reason), 30000, 'giving up');
  check('host off: three tries, then it gives up', !!gaveUp, gaveUp.reason);
  flag('down', false);
  const beforeP = prompts().length;
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'second, now it is on' });
  await c.until(m, kindOf('turn.end'), 15000, 'the turn after it came back');
  const p5 = prompts().slice(beforeP).map((p) => p.text).join(' | ');
  check('the waiting message goes out with the next one', /first, while it is off/.test(p5) && /second, now it is on/.test(p5), p5.slice(0, 160));

  // 5b. an address for a host whose name does not resolve: HostName + the host key under its own name
  m = c.mark();
  const addr = await c.cmd('spawnAgent', { name: 'Og by address', runtime: 'hermes', remote: { host: 'og', address: '192.168.1.149' } });
  await c.until(m, (e) => e.agentId === addr.id && e.kind === 'init', 15000, 'init by address');
  const byAddr = sshCalls().slice(-1)[0].options.map((o) => o.join(' '));
  check('an address: HostName and HostKeyAlias (the name from ssh -G)', byAddr.includes('-o HostName=192.168.1.149') && byAddr.includes('-o HostKeyAlias=og.fake.local'), byAddr.filter((o) => /Host/.test(o)).join(', '));
  await c.cmd('kill', { agentId: addr.id });

  // 6. a stop while a retry waits
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'SLOW stop me' });
  await c.until(m, kindOf('text.delta'), 10000, 'slow turn');
  flag('down', true);
  flag('drop', true);
  await c.until(m, (e) => kindOf('status')(e) && /trying again/.test(e.reason), 10000, 'a retry waiting');
  await c.cmd('kill', { agentId: id, keep: true });
  const n6 = sshCalls().length;
  await sleep(4000);
  check('a stop cancels the retries', sshCalls().length === n6 && (await status()).status === 'idle', (await status()).statusReason);
  flag('down', false);
  flag('drop', false);
  c.ws.close();
} catch (e) {
  check('no exception', false, e.message);
} finally {
  if (engine && engine.exitCode === null) await stopEngine();
  oasis.close();
  if (failed) console.log(logs.join('').split('\n').filter((l) => /Og \(fake\)|error|Error/.test(l)).slice(-30).join('\n'));
  console.log(failed ? 'FAILED' : 'ALL PASSED', `(scratch: ${tmp})`);
  process.exit(failed ? 1 : 0);
}
