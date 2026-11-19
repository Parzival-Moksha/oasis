// The Hermes runtime (src/hermes.js) against a fake ACP agent (scripts/fake-acp.mjs): no model, no money, no GPU,
// about 40 s. Its own engine on port 4545 (OASIS_PORT) and a throwaway roster; never the real engine on 4530.
//
//   node packages/oasis-agent-engine/scripts/hermes-runtime-smoke.mjs
//
// 1. A reply, a tool call, the context meter.
// 2. Messages sent during a turn go out together as the next prompt; a slash command goes alone.
// 3. Interrupt: session/cancel, the turn ends as "interrupted".
// 4. A permission card answered "allow always" reaches the agent as allow_session.
// 5. A planned restart mid-turn: turnOpenAt and the journal survive; after the restart the agent is told to carry on,
//    gets the cut-off message again under its old uuid, and its conversation is loaded back (history).
// 6. A start that cannot open a session: the process is stopped and the sign says why.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const FAKE = path.join(HERE, 'fake-acp.mjs');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-hermes-runtime-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const DESK = path.join(tmp, 'desk');
const FAKE_DIR = path.join(tmp, 'fake');
fs.mkdirSync(DESK, { recursive: true });
fs.mkdirSync(FAKE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const prompts = () => { try { return fs.readFileSync(path.join(FAKE_DIR, 'prompts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

let engine = null;
const logs = [];
async function startEngine() {
  if (await fetch(`http://127.0.0.1:${PORT}/health`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken by another engine`);
  engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
    cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_TELEGRAM: '0', OASIS_LOOKS: '0', OASIS_CLIP_WATCHDOG: '0', OASIS_SCHEDULE_START_MS: '3600000' },
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
  const mark = () => events.length;
  const until = async (from, pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) { const e = events.slice(from).find(pred); if (e) return e; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(50); }
  };
  return { ws, events, cmd, until, mark };
}

try {
  await startEngine();
  let c = await connect();
  const snap = await c.cmd('spawnAgent', { name: 'Fake Hermes', cwd: DESK, runtime: 'hermes', command: [process.execPath, FAKE, FAKE_DIR] });
  const id = snap.id;
  const mine = (from, kind) => (e) => e.agentId === id && e.kind === kind && !e.history;

  // 1. a reply, a tool call, the context meter
  let m = c.mark();
  await c.cmd('send', { agentId: id, text: 'hello there' });
  let end = await c.until(m, mine(m, 'turn.end'), 15000, 'turn 1');
  const text1 = c.events.slice(m).filter((e) => e.agentId === id && e.kind === 'text').map((e) => e.text).join('');
  check('a reply', end.outcome === 'done-waiting' && /echo: hello there/.test(text1), text1);
  check('the first prompt carries the engine notes (voice, who you are)', /\[Oasis voice:/.test(prompts()[0]?.text || ''));
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'TOOL please' });
  await c.until(m, mine(m, 'turn.end'), 15000, 'tool turn');
  const t = c.events.slice(m).filter((e) => e.agentId === id);
  check('tool.start and tool.end, named like the Oasis tools', t.some((e) => e.kind === 'tool.start' && e.name === 'mcp__oasis__get_world_info') && t.some((e) => e.kind === 'tool.end' && /Fake/.test(e.output)));
  const toolText = t.filter((e) => e.kind === 'text').map((e) => e.text).join('');
  check('a replayed answer with reasoning (Hermes 0.23) is dropped', toolText.trim() === 'The world is Fake.', JSON.stringify(toolText.slice(0, 80)));
  check('context meter', t.some((e) => e.kind === 'context' && e.maxTokens === 65536));

  // 2. messages during a turn: together next; a slash command alone
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'SLOW counting' });
  await c.until(m, mine(m, 'text.delta'), 10000, 'slow turn to stream');
  await c.cmd('send', { agentId: id, text: 'second message' });
  await c.cmd('send', { agentId: id, text: 'third message' });
  await c.cmd('send', { agentId: id, text: '/compact' });
  await c.cmd('send', { agentId: id, text: 'after the command' });
  const before = prompts().length;
  // The slow turn, then [second + third], then /compact, then the message after it: four turn ends.
  for (let i = 0; i < 200 && c.events.slice(m).filter(mine(m, 'turn.end')).length < 4; i++) await sleep(100);
  check('four turns: the slow one, the two together, the command, the one after', c.events.slice(m).filter(mine(m, 'turn.end')).length === 4);
  await sleep(300);
  const p2 = prompts().slice(before - 1).map((p) => p.text.split('\n[Oasis')[0].trim());
  check('queued messages went out as one prompt after the turn', p2.some((x) => /second message/.test(x) && /third message/.test(x)), JSON.stringify(p2));
  check('the slash command went alone', p2.includes('/compact'));
  check('then the message after it', p2.some((x) => /^after the command/.test(x)));

  // 3. interrupt
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'SLOW interrupt me' });
  await c.until(m, mine(m, 'text.delta'), 10000, 'slow turn');
  await c.cmd('interrupt', { agentId: id });
  end = await c.until(m, mine(m, 'turn.end'), 10000, 'interrupted turn');
  check('interrupt ends the turn as interrupted', end.reason === 'interrupted' && end.outcome === 'done-waiting', end.reason);

  // 4. a permission card answered "allow always"
  m = c.mark();
  await c.cmd('send', { agentId: id, text: 'PERMIT please' });
  const card = await c.until(m, mine(m, 'permission.request'), 10000, 'permission card');
  const s4 = (await c.cmd('listAgents')).find((a) => a.id === id);
  check('card: needs-decision, the command shown', s4.status === 'needs-decision' && card.input?.command === 'rm -rf x' && card.suggestions.length === 1, card.summary);
  await c.cmd('respond', { agentId: id, requestId: card.requestId, behavior: 'allow', always: true });
  await c.until(m, mine(m, 'turn.end'), 10000, 'permission turn');
  const text4 = c.events.slice(m).filter((e) => e.agentId === id && e.kind === 'text').map((e) => e.text).join('');
  check('allow always reaches it as allow_session', /permission: allow_session/.test(text4), text4);

  // 5. a planned restart mid-turn
  m = c.mark();
  const sent = await c.cmd('send', { agentId: id, text: 'SLOW restart me' });
  await c.until(m, mine(m, 'text.delta'), 10000, 'slow turn');
  c.ws.close();
  await stopEngine();
  const entry = JSON.parse(fs.readFileSync(ROSTER, 'utf8')).agents.find((a) => a.id === id);
  check('a planned stop mid-turn keeps turnOpenAt', typeof entry?.turnOpenAt === 'number');
  const journal = fs.readFileSync(path.join(tmp, 'roster.journal.local.json'), 'utf8');
  check('the cut-off message is still in the journal', journal.includes(sent.uuid));
  const beforeRestart = prompts().length;
  await startEngine();
  c = await connect();
  const history = await c.until(0, (e) => e.agentId === id && e.history && e.kind === 'text', 10000, 'history').catch(() => null);
  check('the conversation is loaded back (history)', !!history);
  const note = await c.until(0, (e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'resume', 10000, 'carry-on note').catch(() => null);
  check('told to carry on', !!note);
  const again = await c.until(0, (e) => e.agentId === id && e.kind === 'user.sent' && e.uuid === sent.uuid, 10000, 'the message again').catch(() => null);
  check('the cut-off message delivered again, same uuid', !!again);
  end = await c.until(0, (e) => e.agentId === id && e.kind === 'turn.end' && !e.history, 20000, 'the resumed turn');
  const p5 = prompts().slice(beforeRestart);
  check('one prompt: the carry-on note and the message', p5.length === 1 && /Carry on/i.test(p5[0].text) && /SLOW restart me/.test(p5[0].text), JSON.stringify(p5.map((p) => p.text.slice(0, 80))));
  check('the resumed turn finishes', end.outcome === 'done-waiting');
  await sleep(300);
  const j2 = JSON.parse(fs.readFileSync(path.join(tmp, 'roster.journal.local.json'), 'utf8'));
  check('the journal is empty for it afterwards', !JSON.stringify(j2.queued?.[id] || []).includes(sent.uuid));

  // 6. a start that cannot open a session
  m = c.mark();
  const bad = await c.cmd('spawnAgent', { name: 'Fake Hermes no session', cwd: DESK, runtime: 'hermes', command: [process.execPath, FAKE, FAKE_DIR, '--fail-open'] });
  await c.until(m, (e) => e.agentId === bad.id && e.kind === 'exit', 10000, 'the failed start to stop');
  await sleep(300);
  const s6 = (await c.cmd('listAgents')).find((a) => a.id === bad.id);
  check('no session: stopped, the sign says why', s6.status === 'error' && /no session/.test(s6.statusReason) && !s6.alive, s6.statusReason);

  for (const a of [id, bad.id]) await c.cmd('kill', { agentId: a }).catch(() => {});
  c.ws.close();
} catch (e) {
  check('no exception', false, e.message);
} finally {
  if (engine && engine.exitCode === null) await stopEngine();
  if (failed) console.log(logs.join('').split('\n').filter((l) => /Fake Hermes|error|Error/.test(l)).slice(-30).join('\n'));
  console.log(failed ? 'FAILED' : 'ALL PASSED', `(scratch: ${tmp})`);
  process.exit(failed ? 1 : 0);
}
