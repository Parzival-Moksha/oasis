// Telegram smoke [2 haiku turns]: the engine's Telegram line (src/telegram.js) end to end, against a fake Bot API.
// Starts its own test engine (port 4541 unless OASIS_PORT) with OASIS_TELEGRAM=1 pointed at a local stub, so the real
// bot and the real engine on 4530 are never touched. Checks: a stranger is ignored, /agents, a routed message comes
// back as the agent's reply, a permission card turns into a ping, /checkin now (0 turns), offset saved.
//
//   node scripts/telegram-smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4541);
if (PORT === 4530) throw new Error('never on the real engine port');
const TOKEN = '42:smoke-fake-token';
const CHAT = '777';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-tg-smoke-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

// --- the fake Bot API
const sent = [];
let updates = [];
let nextId = 1;
const push = (message) => updates.push({ update_id: nextId++, message: { chat: { id: Number(CHAT) }, date: Math.floor(Date.now() / 1000), ...message } });
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m || m[1] !== TOKEN) { res.writeHead(404); return res.end('{"ok":false,"error_code":404}'); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (m[2] === 'getUpdates') {
      const until = Date.now() + (body.timeout || 0) * 1000;
      while (!updates.some((u) => u.update_id >= (body.offset || 0)) && Date.now() < until) await sleep(50);
      updates = updates.filter((u) => u.update_id >= (body.offset || 0));
      return json({ ok: true, result: updates });
    }
    if (m[2] === 'sendMessage') { sent.push(String(body.text)); console.log('  tg <-', JSON.stringify(String(body.text).slice(0, 160))); }
    return json({ ok: true, result: { message_id: sent.length } });
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${stub.address().port}`;
fs.writeFileSync(path.join(tmp, 'tg.json'), JSON.stringify({ enabled: true, botToken: TOKEN, chatId: CHAT, pollingEnabled: false }));

// --- a test engine with the line on
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  env: {
    ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.json'), OASIS_TELEGRAM: '1',
    OASIS_TELEGRAM_API: apiBase, OASIS_TELEGRAM_CONFIG: path.join(tmp, 'tg.json'), OASIS_TELEGRAM_STATE: path.join(tmp, 'tg-state.json'),
    OASIS_TELEGRAM_PING_MS: '4000', OASIS_TELEGRAM_CHECKIN_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const engineLog = [];
const keep = (d) => { for (const l of String(d).split('\n')) if (l.trim()) { engineLog.push(l); if (/telegram/.test(l)) console.log('  engine:', l); } };
engine.stdout.on('data', keep);
engine.stderr.on('data', keep);

async function waitFor(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = pred(); if (v) return v; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}

try {
  await waitFor(() => engineLog.some((l) => l.includes('Oasis agent engine on')), 15000, 'the engine');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const replies = new Map();
  const events = [];
  let n = 0;
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'reply') replies.get(m.id)?.(m); if (m.type === 'event') events.push(m.event); });
  const cmd = (name, args = {}) => new Promise((r) => { const id = ++n; replies.set(id, r); ws.send(JSON.stringify({ id, cmd: name, ...args })); });

  const st = await cmd('telegram');
  check('the line is on in this engine', st.ok && st.data.enabled && st.data.polling, JSON.stringify(st.data));
  const sp = await cmd('spawnAgent', { name: 'smoke-tg', cwd: A, model: 'haiku', permissionMode: 'default', worldTools: false });
  const id = sp.data.id;
  await waitFor(() => events.some((e) => e.agentId === id && e.kind === 'meta'), 30000, 'initialize');

  push({ chat: { id: 1 }, text: 'smoke: I am a stranger, say STRANGER' });
  push({ text: '/agents' });
  await waitFor(() => sent.find((t) => t.includes('smoke-tg')), 10000, '/agents');
  check('/agents lists the agent with a colour', sent.some((t) => /^[⚪🔵🟢🟠🔴] smoke-tg · /mu.test(t)), sent.at(-1));

  // [0 turns] the evening check-in, on demand: read from the Oasis page server's work counter (a GET, nothing written)
  const beforeCheckin = sent.length;
  push({ text: '/checkin now' });
  const checkin = await waitFor(() => sent.slice(beforeCheckin)[0], 15000, 'the check-in');
  const webUp = await fetch('http://127.0.0.1:4516/api/village/work', { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
  check('/checkin now sends the day from the work counter', webUp ? /^🕘 \d\d:\d\d check-in · /.test(checkin) && /(Vow kept|You sucked today|No vow running)/.test(checkin) : /^No check-in right now/.test(checkin), JSON.stringify(checkin.split(/\n/)[0]));
  const st2 = await cmd('telegram');
  check('the check-in state is reported', st2.data?.checkin?.time === '21:00' && st2.data.checkin.lastSent === null, JSON.stringify(st2.data?.checkin));

  // [turn 1] routed by name; the final text comes back under the agent's name
  push({ text: 'smoke-tg: Reply with only the word PONG.' });
  const reply = await waitFor(() => sent.find((t) => t.includes('PONG')), 120000, 'the reply');
  check('the reply comes back with the name first', /^<b>smoke-tg<\/b>\n[\s\S]*PONG/.test(reply), JSON.stringify(reply));
  const user = events.find((e) => e.agentId === id && e.kind === 'user.sent');
  check('the agent got the message tagged [Telegram]', user?.text === '[Telegram] Reply with only the word PONG.', user?.text);

  // [turn 2] a permission card left open -> one ping after OASIS_TELEGRAM_PING_MS
  const before = sent.length;
  push({ text: '@smoke Use the Write tool to create tg-ping.txt containing hi. Nothing else.' });
  const perm = await waitFor(() => events.find((e) => e.agentId === id && e.kind === 'permission.request'), 120000, 'a permission card');
  const ping = await waitFor(() => sent.slice(before).find((t) => t.startsWith('🟠')), 15000, 'the ping');
  check('a ping names the agent and the tool', /^🟠 smoke-tg needs you: allow Write/.test(ping), ping);
  await sleep(4500);
  check('only one ping for that state', sent.slice(before).filter((t) => t.startsWith('🟠')).length === 1);
  await cmd('respond', { agentId: id, requestId: perm.requestId, behavior: 'deny', message: 'Smoke test: denied.' });
  await waitFor(() => events.find((e) => e.agentId === id && e.kind === 'turn.end' && e.ts > perm.ts), 120000, 'turn 2 end');
  await waitFor(() => sent.length > before + 1, 10000, 'the second reply');
  check('the turn after the ping is answered too', sent.length > before + 1, JSON.stringify(sent.at(-1)).slice(0, 160));

  check('the stranger never reached the agent', !events.some((e) => e.kind === 'user.sent' && /STRANGER/.test(e.text || '')) && engineLog.some((l) => l.includes('ignored a message from chat 1')));
  const state = JSON.parse(fs.readFileSync(path.join(tmp, 'tg-state.json'), 'utf8'));
  check('the offset is saved', state.offset === nextId, `offset ${state.offset}, next ${nextId}`);
  check('no token in the engine log', !engineLog.some((l) => l.includes(TOKEN)));
  fs.rmSync(path.join(A, 'tg-ping.txt'), { force: true });
  await cmd('kill', { agentId: id });
  await cmd('shutdown');
  ws.close();
} catch (e) {
  check('smoke ran to the end', false, e.message);
  engine.kill();
} finally {
  await sleep(1500);
  if (engine.exitCode === null) engine.kill();
  stub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? 'FAILED' : 'ALL PASS');
  process.exit(failed ? 1 : 0);
}
