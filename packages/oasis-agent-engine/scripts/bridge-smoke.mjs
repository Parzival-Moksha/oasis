// Bridge smoke [2 haiku turns]: a session that runs the Oasis mod (plugins/oasis) can be talked to from the Oasis
// while it keeps running where it is. A plain `claude -p` process with --plugin-dir stands in for the desktop app.
//
//   OASIS_PORT=4532 OASIS_ROSTER=<tmp> node src/index.js        (a test engine; never the real one on 4530)
//   OASIS_WS=ws://127.0.0.1:4532/ws node scripts/bridge-smoke.mjs
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { spawnClaude, onLines } from '../src/claude.js';
import { findSessionFile } from '../src/sessions.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const MOD = path.resolve(PKG, '..', '..', 'plugins', 'oasis');
const WS_URL = process.env.OASIS_WS || 'ws://127.0.0.1:4532/ws';
const ENGINE = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

const ws = new WebSocket(WS_URL);
const events = [];
const replies = new Map();
let n = 0;
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'reply') replies.get(m.id)?.(m);
  if (m.type === 'event') events.push(m.event);
});
const cmd = (name, args = {}) => new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); });

// "The desktop app": one long-lived process with the mod loaded.
const sessionId = randomUUID();
const desk = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
  '--permission-mode', 'bypassPermissions', '--session-id', sessionId, '--plugin-dir', MOD], { cwd: A, env: { OASIS_ENGINE_URL: ENGINE } });
const results = [];
const stderr = [];
onLines(desk.stdout, (line) => { try { const m = JSON.parse(line); if (m.type === 'result') results.push(m.result); } catch { /* ignore */ } });
onLines(desk.stderr, (line) => stderr.push(line));
const waitResult = async (count, ms = 90000) => { const until = Date.now() + ms; while (results.length < count && Date.now() < until) await sleep(200); return results[count - 1]; };

desk.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the word READY only.' }, parent_tool_use_id: null, session_id: '' }) + '\n');
const first = await waitResult(1);
check('the desk session answered its own prompt', /ready/i.test(first || ''), JSON.stringify(first));

const file = findSessionFile(sessionId, A);
const ob = await cmd('observe', { sessionPath: file, name: 'desk' });
check('the Oasis watches it', ob.ok, ob.error || '');
let snap = null;
for (let i = 0; i < 20 && !snap?.bridged; i += 1) {
  await sleep(300);
  snap = (await cmd('listAgents')).data.find((a) => a.id === ob.data.id);
}
check('the mod checked in: the watched session is talkable', !!snap?.bridged && snap.readOnly === false, JSON.stringify({ bridged: snap?.bridged, readOnly: snap?.readOnly }));

const sent = await cmd('send', { agentId: ob.data.id, text: 'Reply with the word KIWI only.' });
check('send from the Oasis is queued for the bridge', sent.ok && sent.data?.viaBridge === true, sent.error || '');
const second = await waitResult(2);
check('the same process ran it as a turn of the same session', /kiwi/i.test(second || ''), JSON.stringify(second));
await sleep(1500);
const deltas = events.filter((e) => e.agentId === ob.data.id && e.kind === 'text.delta').map((e) => e.text).join('');
check('the reply streamed into the Oasis as it was written', /kiwi/i.test(deltas), JSON.stringify(deltas));
const seen = events.some((e) => e.agentId === ob.data.id && e.kind === 'user' && /KIWI/.test(e.text || ''));
check('the Oasis thread shows the message from the transcript', seen);

const kids = new Map();
let sessions = new Set();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.sessionId) sessions.add(m.sessionId);
  if ((m.type !== 'user' && m.type !== 'assistant') || m.isSidechain || !m.parentUuid) continue;
  kids.set(m.parentUuid, (kids.get(m.parentUuid) || 0) + 1);
}
check('one session, one line of conversation', sessions.size === 1 && [...kids.values()].every((k) => k === 1), `${sessions.size} session id(s), ${[...kids.values()].filter((k) => k > 1).length} branch point(s)`);

desk.stdin.end();
await sleep(2000);
await cmd('unobserve', { agentId: ob.data.id });
ws.close();
if (failed && stderr.length) console.log('desk stderr:', stderr.slice(-8).join('\n'));
process.exit(failed ? 1 : 0);
