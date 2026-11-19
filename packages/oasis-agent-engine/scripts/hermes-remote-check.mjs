// A real Hermes on another machine, reached the way the village reaches it (src/hermes.js `remote`), from its own
// engine on port 4545 (OASIS_PORT) with a throwaway roster; never the real engine on 4530.
//
//   node packages/oasis-agent-engine/scripts/hermes-remote-check.mjs <ssh host> [address] [--turn]
//
// Without --turn: the line, `hermes acp`, a session (no model call). With --turn: one short message that asks for one
// free world tool (needs the Oasis page server up), and the reply. It leaves one Hermes session on that machine.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const args = process.argv.slice(2);
const turn = args.includes('--turn');
const [host, address] = args.filter((a) => !a.startsWith('--'));
if (!host) { console.log('usage: hermes-remote-check.mjs <ssh host> [address] [--turn]'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-hermes-check-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

if (await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken`);
const logs = [];
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: { ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: path.join(tmp, 'roster.local.json'), OASIS_TELEGRAM: '0', OASIS_LOOKS: '0', OASIS_CLIP_WATCHDOG: '0', OASIS_SCHEDULE_START_MS: '3600000', OASIS_RECONNECT_S: '1' },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));
for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false)); i++) await sleep(100);

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const events = []; const replies = new Map(); let n = 0;
await new Promise((res, rej) => { ws.on('error', rej); ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'hello') res(); if (m.type === 'reply') replies.get(m.id)?.(m); if (m.type === 'event') events.push(m.event); }); });
const cmd = async (name, a = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...a })); }); return r.ok ? r.data : Promise.reject(new Error(r.error)); };
const until = async (pred, ms) => { const end = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > end) return null; await sleep(100); } };

let code = 0;
try {
  const snap = await cmd('spawnAgent', { name: `${host} (check)`, runtime: 'hermes', remote: { host, ...(address ? { address } : {}) } });
  const init = await until((e) => e.agentId === snap.id && (e.kind === 'init' || (e.kind === 'status' && e.status === 'error')), 90000);
  if (!init || init.kind !== 'init') throw new Error(`no session: ${init?.reason || 'timeout'}`);
  console.log(`[${at()}] session ${init.sessionId} · Hermes ${init.hermesVersion} · model ${init.model} · cwd ${init.cwd} · world tools ${init.mcpServers.map((s) => s.name).join(',') || 'none'}`);
  if (turn) {
    await cmd('send', { agentId: snap.id, text: 'A check from the Oasis village, from Hermes builder: please call the get_world_info tool once, then answer in one short sentence with the name of the world.' });
    const end = await until((e) => e.agentId === snap.id && e.kind === 'turn.end', 300000);
    const mine = events.filter((e) => e.agentId === snap.id);
    const tools = mine.filter((e) => e.kind === 'tool.start').map((e) => e.name);
    const text = mine.filter((e) => e.kind === 'text').map((e) => e.text).join('\n');
    console.log(`[${at()}] turn: ${end ? `${end.outcome} ${end.reason}, ${Math.round(end.durationMs / 1000)} s, in ${end.usage?.input} out ${end.usage?.output}` : 'no end within 5 minutes'}`);
    console.log(`tools: ${tools.join(', ') || 'none'}`);
    console.log(`reply: ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
    if (!end || end.outcome === 'error') code = 1;
  }
  if (process.env.OASIS_HERMES_TRACE === '1') console.log(logs.join('').split(/\r?\n/).filter((l) => / update /.test(l)).join('\n'));
  await cmd('kill', { agentId: snap.id });
} catch (e) {
  console.log(`[${at()}] FAILED: ${e.message}`);
  console.log(logs.join('').split('\n').filter((l) => /\(check\)/.test(l)).slice(-12).join('\n'));
  code = 1;
} finally {
  await fetch(`http://127.0.0.1:${PORT}/api/cmd`, { method: 'POST', body: JSON.stringify({ cmd: 'shutdown' }) }).catch(() => {});
  if (engine.exitCode === null) await new Promise((r) => engine.once('exit', r));
  process.exit(code);
}
