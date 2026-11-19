// Hermes runtime smoke test (src/hermes.js): its own engine on port 4545 (OASIS_PORT), a throwaway roster and a
// sandbox Hermes home in the temp folder, never the real engine on 4530 or the owner's Hermes profiles.
//
//   node packages/oasis-agent-engine/scripts/hermes-smoke.mjs
//
// Needs Hermes Agent installed (OASIS_HERMES_BIN, else the Windows installer's venv) and a local model server:
// Ollama on 127.0.0.1:11434 with HERMES_SMOKE_MODEL (default qwen35-9b-agent:latest). About five local turns, no money.
// The Oasis page server (127.0.0.1:4516) being up lets turn 1 use a world tool; without it that check is skipped.
// 1. A Hermes agent at a desk: init, a message, text streamed, a world tool through worldproxy.js, a clean turn end.
// 2. A refused tool: worldproxy.js answers a call to a tool it does not offer (no model turn).
// 3. Restart: the agent comes back from the roster with session/load and remembers turn 1.
// 4. A permission card nobody answers goes away after 60 s (Hermes denies by itself).
// 5. A planned restart mid-turn: turnOpenAt and the journal survive; the agent is told to carry on and gets the message again.
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
const MODEL = process.env.HERMES_SMOKE_MODEL || 'qwen35-9b-agent:latest';
const MODEL_URL = process.env.HERMES_SMOKE_MODEL_URL || 'http://127.0.0.1:11434/v1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-hermes-smoke-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const HOME = path.join(tmp, 'hermes-home');
const CWD = path.join(tmp, 'desk');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(CWD, { recursive: true });
// HERMES_SMOKE_FROM=<a profile folder>: a copy of its config.yaml, SOUL.md and .env (its model and key), so the
// test's sessions never land in the real profile. Else the local model above. Hermes refuses a model under 64K context.
const FROM = process.env.HERMES_SMOKE_FROM;
if (FROM) for (const f of ['config.yaml', 'SOUL.md', '.env']) { if (fs.existsSync(path.join(FROM, f))) fs.copyFileSync(path.join(FROM, f), path.join(HOME, f)); }
else fs.writeFileSync(path.join(HOME, 'config.yaml'), [
  'model:', `  default: "${MODEL}"`, '  provider: custom', `  base_url: ${MODEL_URL}`, '  context_length: 65536', '  ollama_num_ctx: 65536', '',
].join('\n'));
// HERMES_SMOKE_PHASES=3: stop after phase 3 (on a paid model: two turns, a few cents).
const LAST = Number(process.env.HERMES_SMOKE_PHASES) || 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

let engine = null;
const logs = [];
async function startEngine() {
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
  await sleep(1500);
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
  const until = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(200); }
  };
  return { ws, events, cmd, until };
}
const oasisUp = await fetch('http://127.0.0.1:4516/api/mcp/oasis', { method: 'GET' }).then(() => true, () => false);

try {
  // ---------------------------------------------------------------- 1. a Hermes agent answers
  await startEngine();
  let c = await connect();
  const snap = await c.cmd('spawnAgent', { name: 'Hermes smoke', cwd: CWD, runtime: 'hermes', hermesHome: HOME });
  check('spawned with runtime hermes', snap.runtime === 'hermes' && snap.kind === 'owned');
  const init = await c.until((e) => e.agentId === snap.id && e.kind === 'init', 180000, 'init');
  check('init: a Hermes session, version and model', /^[0-9a-f-]{36}$/.test(init.sessionId || '') && !!init.hermesVersion && !!init.model, `${init.hermesVersion} ${init.model}`);
  const ask = oasisUp
    ? 'Call the get_world_info tool once. Then answer in one short sentence: what is the name of the world?'
    : 'Answer in one short sentence: what is two plus two?';
  const t0 = Date.now();
  await c.cmd('send', { agentId: snap.id, text: ask });
  const end1 = await c.until((e) => e.agentId === snap.id && e.kind === 'turn.end', 600000, 'turn 1 end');
  const mine = c.events.filter((e) => e.agentId === snap.id);
  check('user.sent then user.consumed', mine.some((e) => e.kind === 'user.sent') && mine.some((e) => e.kind === 'user.consumed'));
  check('text streamed (text.delta) and kept (text)', mine.some((e) => e.kind === 'text.delta') && mine.some((e) => e.kind === 'text' && e.text.trim()));
  check('turn.end done-waiting, no error', end1.outcome !== 'error' && !end1.isError, `${end1.outcome} ${end1.reason}, ${Math.round((Date.now() - t0) / 1000)} s, in ${end1.usage?.input} out ${end1.usage?.output}`);
  if (oasisUp) {
    const tool = mine.find((e) => e.kind === 'tool.start' && e.name === 'mcp__oasis__get_world_info');
    const done = tool && mine.find((e) => e.kind === 'tool.end' && e.toolUseId === tool.toolUseId);
    check('world tool through worldproxy: tool.start + tool.end', !!done && !done.isError, done ? clipLine(done.output) : 'no call');
  } else console.log('SKIP  world tool (the Oasis page server is not up)');
  check('context meter from usage_update', mine.some((e) => e.kind === 'context' && e.maxTokens >= 64000));
  const answer1 = mine.filter((e) => e.kind === 'text').map((e) => e.text).join('\n');
  console.log(`      reply: ${clipLine(answer1)}`);
  console.log(`      voice line: ${/<spoken>[\s\S]+<\/spoken>\s*$/.test(answer1.trim()) ? 'yes, at the end' : 'missing'}; cost estimate: ${end1.costUsd ?? 0}`);
  const s1 = (await c.cmd('listAgents')).find((a) => a.id === snap.id);
  check('status waiting after the turn', s1.status === 'waiting' || s1.status === 'needs-decision', `${s1.status} (${s1.statusReason})`);
  const sessionId = init.sessionId;

  // ---------------------------------------------------------------- 2. a tool the proxy does not offer
  const refused = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(PKG, 'src', 'worldproxy.js'), 'http://127.0.0.1:9/none'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('\n')) { p.stdin.end(); resolve(JSON.parse(out.split('\n')[0])); } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'generate_image', arguments: {} } }) + '\n');
  });
  check('worldproxy refuses a paid tool without calling the Oasis', refused.id === 7 && refused.result?.isError === true);

  // ---------------------------------------------------------------- 3. restart: back from the roster, same session
  c.ws.close();
  await stopEngine();
  const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  const entry = (Array.isArray(roster) ? roster : roster.agents || []).find((a) => a.id === snap.id);
  check('roster keeps runtime, home and session', entry?.runtime === 'hermes' && entry?.hermesHome === HOME && entry?.sessionId === sessionId);
  await startEngine();
  c = await connect();
  const init2 = await c.until((e) => e.agentId === snap.id && e.kind === 'init', 180000, 'init after restart');
  check('same Hermes session after the restart (session/load)', init2.sessionId === sessionId);
  check('old conversation replayed as history', c.events.some((e) => e.agentId === snap.id && e.history && e.kind === 'text'));
  const before = c.events.length;
  await c.cmd('send', { agentId: snap.id, text: 'What did you answer me a moment ago? Repeat it in one short sentence.' });
  const end2 = await c.until((e, i) => c.events.indexOf(e) >= before && e.agentId === snap.id && e.kind === 'turn.end', 600000, 'turn 2 end');
  const answer2 = c.events.slice(before).filter((e) => e.agentId === snap.id && e.kind === 'text').map((e) => e.text).join('\n');
  console.log(`      reply: ${clipLine(answer2)}`);
  check('turn 2 ends cleanly', end2.outcome !== 'error');
  const key = oasisUp ? /zen|workshop|world/i : /4|four/i;
  check('it remembers turn 1', key.test(answer2), String(key));

  if (LAST < 4) throw Object.assign(new Error('stop'), { stop: true });
  // ---------------------------------------------------------------- 4. a permission card nobody answers
  // Hermes asks before `rm -rf` (its dangerous-command list) and denies by itself after 60 s. The folder is empty
  // scratch inside the test desk; if Hermes ran it without asking, only that folder would go.
  fs.mkdirSync(path.join(CWD, 'scratch'), { recursive: true });
  const before4 = c.events.length;
  await c.cmd('send', { agentId: snap.id, text: 'Run exactly this terminal command and nothing else: rm -rf scratch' });
  const ask4 = await c.until((e) => c.events.indexOf(e) >= before4 && e.agentId === snap.id && (e.kind === 'permission.request' || e.kind === 'turn.end'), 300000, 'a permission card');
  check('a dangerous command arrives as a permission card', ask4.kind === 'permission.request', ask4.kind === 'permission.request' ? clipLine(ask4.summary) : 'no card: it ran or refused');
  if (ask4.kind === 'permission.request') {
    const s4 = (await c.cmd('listAgents')).find((a) => a.id === snap.id);
    check('status needs-decision while the card is open', s4.status === 'needs-decision');
    const gone = await c.until((e) => c.events.indexOf(e) >= before4 && e.agentId === snap.id && e.kind === 'permission.resolved' && e.requestId === ask4.requestId, 90000, 'the card to expire');
    check('the card goes away by itself after 60 s', gone.behavior === 'expired');
    // It may ask again; anything else it asks is denied from here.
    const p_done = new Set();
    const end4 = await new Promise((resolve, reject) => {
      const t = setInterval(() => {
        const fresh = c.events.slice(before4).filter((e) => e.agentId === snap.id);
        for (const p of fresh.filter((e) => e.kind === 'permission.request' && e.requestId !== ask4.requestId && !p_done.has(e.requestId))) { p_done.add(p.requestId); c.cmd('respond', { agentId: snap.id, requestId: p.requestId, behavior: 'deny' }).catch(() => {}); }
        const end = fresh.find((e) => e.kind === 'turn.end');
        if (end) { clearInterval(t); resolve(end); }
      }, 300);
      setTimeout(() => { clearInterval(t); reject(new Error('turn 4 did not end')); }, 400000);
    });
    check('turn 4 ends', end4.outcome !== 'error', `${end4.outcome} ${end4.reason}`);
    check('the scratch folder is still there', fs.existsSync(path.join(CWD, 'scratch')));
  }

  // ---------------------------------------------------------------- 5. a planned restart in the middle of a turn
  const before5 = c.events.length;
  const sent5 = await c.cmd('send', { agentId: snap.id, text: 'Count from 1 to 40, one number per line, then say DONE.' });
  await c.until((e) => c.events.indexOf(e) >= before5 && e.agentId === snap.id && e.kind === 'text.delta', 300000, 'turn 5 to start streaming');
  c.ws.close();
  await stopEngine();
  const entry5 = JSON.parse(fs.readFileSync(ROSTER, 'utf8')).agents.find((a) => a.id === snap.id);
  check('a planned stop mid-turn keeps turnOpenAt in the roster', typeof entry5?.turnOpenAt === 'number');
  const journal5 = JSON.parse(fs.readFileSync(path.join(tmp, fs.readdirSync(tmp).find((f) => /journal/.test(f))), 'utf8'));
  check('the cut-off message is still in the journal', JSON.stringify(journal5).includes(sent5.uuid));
  await startEngine();
  c = await connect();
  const resumed = await c.until((e) => e.agentId === snap.id && e.kind === 'user.sent' && e.auto === 'resume', 180000, 'the carry-on note');
  check('told to carry on after the restart', !!resumed);
  const again = await c.until((e) => e.agentId === snap.id && e.kind === 'user.sent' && e.uuid === sent5.uuid, 30000, 'the cut-off message again');
  check('the cut-off message is delivered again, same uuid', !!again);
  const end5 = await c.until((e) => e.agentId === snap.id && e.kind === 'turn.end' && !e.history, 600000, 'turn 5 end');
  const answer5 = c.events.filter((e) => e.agentId === snap.id && e.kind === 'text' && !e.history).map((e) => e.text).join('\n');
  check('turn 5 finishes after the restart', end5.outcome !== 'error' && /DONE/i.test(answer5), clipLine(answer5.slice(-80)));
  await c.cmd('kill', { agentId: snap.id }).catch(() => {});
  c.ws.close();
} catch (e) {
  if (!e.stop) check('no exception', false, e.message);
} finally {
  if (engine) await stopEngine();
  if (failed) console.log(logs.join('').split('\n').filter((l) => /Hermes smoke|error|Error/.test(l)).slice(-30).join('\n'));
  console.log(failed ? 'FAILED' : 'ALL PASSED', `(scratch: ${tmp})`);
  process.exit(failed ? 1 : 0);
}

function clipLine(s) { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > 160 ? t.slice(0, 160) + '…' : t; }
