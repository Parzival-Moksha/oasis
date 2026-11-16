// Restart smoke [3 haiku turns]: an agent that is mid-turn when the engine stops is carried on at the next start,
// and what was queued for it is delivered once (src/journal.js, src/resume.js, agent.js flushLeftovers).
// Starts its own test engines (port 4543 unless OASIS_PORT), one after the other, on a scratch roster:
//   run 1  a slow Bash turn, a second message queued behind it, then the engine is KILLED (an unplanned stop)
//   run 2  the agent is told to carry on by itself, the queued message arrives once, the turn finishes;
//          /health and hello say "restarted ... after an unplanned stop ..., 1 agent resumed";
//          then a new slow turn and the shutdown command (a planned stop)
//   run 3  killed about a second after it starts (a restart on top of a restart)
//   run 4  the agent is carried on again, and no message is in the transcript twice
// The real engine on 4530 is never touched.
//
//   node scripts/restart-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { findSessionFile } from '../src/sessions.js';
import { RESUME_TEXT } from '../src/resume.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4543);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-restart-smoke-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const JOURNAL = path.join(tmp, 'roster.journal.local.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

let engine = null;
const logs = [];
async function startEngine() {
  engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
    cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_TELEGRAM: '0' },
  });
  const mine = engine;
  for (const s of [mine.stdout, mine.stderr]) s.on('data', (d) => logs.push(String(d)));
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('the test engine did not come up');
}
/** An unplanned stop: the process is ended with no chance to say goodbye (TerminateProcess on Windows). */
async function killEngine() {
  const gone = new Promise((r) => engine.once('exit', r));
  engine.kill('SIGKILL');
  await gone;
  await sleep(3500); // its claude children notice their stdin closed and exit (seen: under 3 s)
}
async function waitExit() { if (engine.exitCode === null) await new Promise((r) => engine.once('exit', r)); await sleep(300); }

async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0; let hello = null;
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      // What happened before this page connected (the engine acts the moment it starts) is in the backlog.
      if (m.type === 'hello') { hello = m; for (const list of Object.values(m.backlog || {})) events.push(...list.filter((e) => !e.history)); res(); }
      if (m.type === 'reply') replies.get(m.id)?.(m);
      if (m.type === 'event' && !m.event.history) events.push(m.event);
    });
  });
  const cmd = (name, args = {}) => new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); });
  const next = async (pred, ms = 120000) => { const until = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > until) return null; await sleep(100); } };
  return { ws, events, hello, cmd, next, close: () => ws.close() };
}

const SLOW = (word, secs) => `Run this with the Bash tool and wait for it: node -e "setTimeout(()=>console.log('slow-done'),${secs * 1000})" . Then reply with its output and the word ${word}.`;
const journal = () => { try { return JSON.parse(fs.readFileSync(JOURNAL, 'utf8')); } catch { return null; } };

try {
  // ---- run 1: mid-turn, one message queued behind the turn, then killed
  await startEngine();
  let c = await connect();
  check('a first start has no restart line', c.hello.server?.restart?.line === null, JSON.stringify(c.hello.server?.restart));
  const sp = await c.cmd('spawnAgent', { name: 'restart-a', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false });
  const id = sp.data.id;
  const sessionId = sp.data.sessionId;
  await c.next((e) => e.agentId === id && e.kind === 'meta', 30000);
  await c.cmd('send', { agentId: id, text: SLOW('FINISHED', 20) });
  await c.next((e) => e.agentId === id && e.kind === 'tool.start' && e.name === 'Bash', 90000);
  const queued = await c.cmd('send', { agentId: id, text: 'Also: end your reply with the word MANGO.' });
  check('a message sent while the turn runs is queued', queued.ok && queued.data.midTurn === true);
  await sleep(600);
  const j1 = journal();
  check('the journal holds the queued message while the CLI has not taken it', j1?.queued?.[id]?.some((e) => e.uuid === queued.data.uuid), JSON.stringify(j1?.queued?.[id]?.map((e) => e.text.slice(0, 30))));
  c.close();
  await killEngine();

  // ---- run 2: carried on without anyone asking, the queued message delivered once
  await startEngine();
  c = await connect();
  const r2 = c.hello.server?.restart;
  check('hello: an unplanned stop, 1 agent resumed', r2?.stop?.planned === false && r2?.resumed?.length === 1 && r2.resumed[0].id === id, r2?.line);
  const note = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'resume', 30000);
  check('the agent is told to carry on', note?.text === RESUME_TEXT);
  const sign = await c.next((e) => e.agentId === id && e.kind === 'status' && e.status === 'working' && /resumed/.test(e.reason || ''), 5000);
  const snap = (await c.cmd('listAgents')).data.find((x) => x.id === id);
  check('its sign shows it was resumed', !!sign && typeof snap?.resumedAt === 'number', `status ${snap?.status} (${snap?.statusReason})`);
  const again = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && /MANGO/.test(e.text || ''), 60000);
  check('the queued message goes out again, under its old uuid', again?.uuid === queued.data.uuid, `${again?.uuid} vs ${queued.data.uuid}`);
  const end2 = await c.next((e) => e.agentId === id && e.kind === 'turn.end' && /MANGO/i.test(e.result || ''), 150000);
  check('the cut turn is finished, with the queued message in it', /slow-done/.test(end2?.result || '') && /FINISHED/.test(end2?.result || ''), JSON.stringify((end2?.result || '').slice(0, 120)));
  await sleep(1500);
  const sends2 = c.events.filter((e) => e.agentId === id && e.kind === 'user.sent');
  check('one carry-on note and one MANGO, nothing twice', sends2.filter((e) => e.auto === 'resume').length === 1 && sends2.filter((e) => /MANGO/.test(e.text)).length === 1, `${sends2.length} sends`);
  check('the journal is empty again', !journal()?.queued?.[id], JSON.stringify(journal()?.queued));
  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  check('/health carries the line', /^restarted at \d\d:\d\d after an unplanned stop around \d\d:\d\d, 1 agent resumed, 1 queued message delivered$/.test(health.restart?.line || ''), health.restart?.line);
  const snapAfter = (await c.cmd('listAgents')).data.find((x) => x.id === id);
  check('after that turn the sign is back to normal', snapAfter?.status === 'waiting' && snapAfter?.resumedAt === null, `${snapAfter?.status} resumedAt=${snapAfter?.resumedAt}`);

  // ---- a planned stop mid-turn, then a restart on top of a restart
  await c.cmd('send', { agentId: id, text: SLOW('PAPAYA', 20) });
  await c.next((e) => e.agentId === id && e.kind === 'tool.start' && e.name === 'Bash' && e.ts > Date.now() - 60000 && c.events.indexOf(e) > c.events.indexOf(end2), 90000);
  await sleep(500);
  await c.cmd('shutdown');
  c.close();
  await waitExit();
  const j2 = journal();
  check('a planned stop says goodbye in the journal', j2?.stop?.planned === true, JSON.stringify(j2?.stop));
  check('the roster says the agent was mid-turn', typeof JSON.parse(fs.readFileSync(ROSTER, 'utf8')).agents[0]?.turnOpenAt === 'number');

  await startEngine(); // run 3
  await sleep(1200);
  await killEngine();

  await startEngine(); // run 4
  c = await connect();
  const r4 = c.hello.server?.restart;
  check('after two restarts in a row the agent is still carried on', r4?.resumed?.length === 1, r4?.line);
  const end4 = await c.next((e) => e.agentId === id && e.kind === 'turn.end' && /PAPAYA/i.test(e.result || ''), 150000);
  check('and finishes what it was doing', /slow-done/.test(end4?.result || ''), JSON.stringify((end4?.result || '').slice(0, 120)));
  await sleep(1000);

  // The transcript: every user prompt once.
  const file = findSessionFile(sessionId, A);
  const seen = new Map();
  let notes = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'user' || m.isSidechain || !m.uuid) continue;
    const content = m.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
    if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) continue;
    seen.set(m.uuid, (seen.get(m.uuid) || 0) + 1);
    if (text.includes(RESUME_TEXT)) notes += 1;
  }
  check('no message is in the transcript twice', [...seen.values()].every((n) => n === 1), `${seen.size} prompts`);
  check('one carry-on note per cut (2, or 3 when run 3 got its note in before it was killed)', notes === 2 || notes === 3, `${notes} notes`);

  await c.cmd('kill', { agentId: id });
  await c.cmd('shutdown');
  c.close();
  await waitExit();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  try { engine?.kill(); } catch { /* gone */ }
  if (failed) console.log('engine log (last lines):\n' + logs.join('').split('\n').slice(-40).join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
