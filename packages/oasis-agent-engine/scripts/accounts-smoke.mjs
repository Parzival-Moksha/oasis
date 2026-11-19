// Accounts smoke [no real turns]: failover between Claude accounts (src/accounts.js), on a test engine (port 4547
// unless OASIS_PORT) that runs a fake `claude` (scripts/fake-claude.js). The fake refuses with the real usage-limit
// shape for an account marked out, so no real account is ever touched. Never on the real engine (4530).
//   1  auto: an agent runs on the account the file prefers; utilization is learnt per account
//   2  account a runs out mid-work: the refused turn runs again on b (same session, carry-on note), an idle agent on a
//      moves to b at once, and a 529 on b is not taken for a limit
//   3  every account out: agents wait with the time, scheduled wake-ups are held back, the log says it once
//   4  a comes back (the clock moves past its reset): the waiting agent goes on on a by itself, the held wake-up goes once
//   5  the token never shows: not in hello, the snapshots, the roster, the engine log
//
//   node scripts/accounts-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4547);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-accounts-smoke-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const ACCOUNTS = path.join(tmp, 'claude-accounts.local.json');
const STATE = path.join(tmp, 'fake-state.json');
const FAKE_LOG = path.join(tmp, 'fake-claude.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };
const fake = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const fakeLog = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const nowS = () => Math.floor(Date.now() / 1000);

fs.writeFileSync(ACCOUNTS, JSON.stringify({ accounts: [
  { id: 'a', label: 'Account A', token: 'tok-a', priority: 1 },
  { id: 'b', label: 'Account B', token: 'tok-b', priority: 2 },
] }));
fake({ weekly: { a: nowS() + 2 * 86400, b: nowS() + 5 * 86400 } });

const logs = [];
const engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
  cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_ACCOUNTS: ACCOUNTS, OASIS_TELEGRAM: '0', OASIS_LOOKS: '0',
    OASIS_FAKE_CLOCK: '1', OASIS_SCHEDULE_START_MS: '0', OASIS_SCHEDULE_TICK_MS: '1000',
    OASIS_CLAUDE_BIN: path.join(HERE, 'fake-claude.js'), FAKE_CLAUDE_STATE: STATE, FAKE_CLAUDE_LOG: FAKE_LOG,
  },
});
for (const s of [engine.stdout, engine.stderr]) s.on('data', (d) => logs.push(String(d)));

async function connect() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* not yet */ } await sleep(100); }
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0; let hello = null; const raw = [];
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (data) => {
      raw.push(String(data));
      const m = JSON.parse(String(data));
      if (m.type === 'hello') { hello = m; res(); }
      if (m.type === 'reply') replies.get(m.id)?.(m);
      if (m.type === 'event') events.push(m.event);
    });
  });
  const cmd = async (name, args = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); }); if (!r.ok) throw new Error(r.error); return r.data && typeof r.data === 'object' && 'data' in r.data ? r.data.data : r.data; };
  const next = async (pred, ms = 20000) => { const until = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > until) return null; await sleep(50); } };
  return { ws, events, raw, hello, cmd, next };
}

try {
  const c = await connect();
  const sp = (name) => c.cmd('spawnAgent', { name, cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false });
  const x = await sp('acct-x');
  const y = await sp('acct-y');
  await sleep(800);
  const send = async (id, text) => { const from = c.events.length; await c.cmd('send', { agentId: id, text }); return c.next((e) => c.events.indexOf(e) >= from && e.agentId === id && e.kind === 'turn.end'); };

  // ---- 1
  const e1 = await send(x.id, 'hello');
  check('auto: the agent runs on the account the file prefers', /^ok from a: hello/.test(e1?.result || ''), JSON.stringify(e1?.result));
  const v1 = await c.cmd('listAccounts');
  const a1 = v1.accounts.find((a) => a.id === 'a');
  check('utilization is learnt per account', a1?.windows?.seven_day?.utilization === 0.42, JSON.stringify(a1?.windows));
  const snap1 = (await c.cmd('listAgents')).find((a) => a.id === x.id);
  check('the agent\'s snapshot names its account', snap1?.account?.id === 'a' && snap1.account.label === 'Account A', JSON.stringify(snap1?.account));

  // ---- 2
  await send(y.id, 'warm up'); // y runs on a too, then waits idle
  fake({ weekly: { a: nowS() + 2 * 86400, b: nowS() + 5 * 86400 }, out: { a: { resetsAt: nowS() + 3 * 3600, window: 'five_hour' } } });
  const from2 = c.events.length;
  await c.cmd('send', { agentId: x.id, text: 'do the work' });
  const refused = await c.next((e) => c.events.indexOf(e) >= from2 && e.agentId === x.id && e.kind === 'turn.end' && e.limit);
  check('a refusal for usage is recognised', refused?.limit?.kind === 'usage_limit_reached' && refused.limit.account === 'a', JSON.stringify(refused?.limit));
  const again = await c.next((e) => c.events.indexOf(e) > c.events.indexOf(refused) && e.agentId === x.id && e.kind === 'turn.end');
  check('the refused turn runs again on b, told to carry on', /^ok from b: Your last turn was cut off/.test(again?.result || ''), JSON.stringify(again?.result));
  const starts = fakeLog().filter((l) => l.start);
  const xStarts = starts.filter((l) => l.session === x.sessionId);
  check('same session, one process at a time', xStarts.length === 2 && xStarts[1].account === 'b' && fakeLog().some((l) => l.exit && l.pid === xStarts[0].pid && l.at <= xStarts[1].at), `${xStarts.map((l) => l.account).join(' -> ')}`);
  await sleep(1500);
  const ySnap = (await c.cmd('listAgents')).find((a) => a.id === y.id);
  check('an idle agent on a moves to b at once', ySnap?.account?.id === 'b', JSON.stringify(ySnap?.account));
  const v2 = await c.cmd('listAccounts');
  check('a is out until its reset', v2.accounts.find((a) => a.id === 'a')?.exhaustedUntil > Date.now() + 2 * 3600_000, v2.accounts.find((a) => a.id === 'a')?.why);
  fake({ weekly: { a: nowS() + 2 * 86400, b: nowS() + 5 * 86400 }, out: { a: { resetsAt: nowS() + 3 * 3600, window: 'five_hour' } }, overload: { b: true } });
  const over = await send(x.id, 'during an overload');
  await sleep(500);
  const v3 = await c.cmd('listAccounts');
  check('a 529 is not taken for a limit', over && !over.limit && !v3.accounts.find((a) => a.id === 'b')?.exhaustedUntil, JSON.stringify(over?.result).slice(0, 60));

  // ---- 3
  fake({ out: { a: { resetsAt: nowS() + 3 * 3600, window: 'five_hour' }, b: { resetsAt: nowS() + 6 * 3600, window: 'seven_day' }, cli: { resetsAt: nowS() + 8 * 3600, window: 'five_hour' } } });
  await c.cmd('setSchedule', { agentId: y.id, every: 'hourly', prompt: 'Scheduled check.' });
  const from3 = c.events.length;
  await c.cmd('send', { agentId: x.id, text: 'the last task' });
  await c.next((e) => c.events.indexOf(e) >= from3 && e.agentId === x.id && e.kind === 'turn.end' && e.limit && e.limit.account === 'b');
  const cliTry = await c.next((e) => c.events.indexOf(e) >= from3 && e.agentId === x.id && e.kind === 'turn.end' && e.limit && e.limit.account === 'cli', 10000);
  await sleep(1000);
  const x3 = (await c.cmd('listAgents')).find((a) => a.id === x.id);
  check('every account out: the agent waits, saying until when', !!cliTry && x3?.status === 'error' && /every account is out of usage until \d\d:\d\d/.test(x3.statusReason || '') && x3.parked, x3?.statusReason);
  const wakesBefore = c.events.filter((e) => e.agentId === y.id && e.kind === 'user.sent' && e.auto === 'schedule').length;
  await c.cmd('clock', { advanceMs: 3600_000 + 60_000 });
  await sleep(2500);
  check('scheduled wake-ups are held back', c.events.filter((e) => e.agentId === y.id && e.kind === 'user.sent' && e.auto === 'schedule').length === wakesBefore);
  check('the outage is said once', logs.join('').split('Every Claude account is out of usage').length - 1 === 1);

  // ---- 4: a comes back hours before its reset (the owner upgraded the plan): the owner writes to the waiting agent,
  // the engine checks the accounts with a tiny turn instead of trusting the reset time, and the agent goes on.
  const isCheck = (l) => l.start && l.noTools;
  const checksBefore = fakeLog().filter(isCheck).length;
  fake({ out: { b: { resetsAt: nowS() + 6 * 3600, window: 'seven_day' }, cli: { resetsAt: nowS() + 8 * 3600, window: 'five_hour' } } });
  const from4 = c.events.length;
  const parkedReply = await c.cmd('send', { agentId: x.id, text: 'are you there?' }).catch((e) => ({ error: e.message }));
  const back = await c.next((e) => c.events.indexOf(e) >= from4 && e.agentId === x.id && e.kind === 'turn.end' && !e.limit, 20000);
  check('a lifts early: writing to the waiting agent checks the accounts and it goes on on a', /^ok from a: Your last turn was cut off/.test(back?.result || ''), `${JSON.stringify(back?.result)} ${JSON.stringify(parkedReply).slice(0, 80)}`);
  const checks = fakeLog().filter(isCheck);
  check('the check was a tiny haiku turn, no tools', checks.length > checksBefore && checks.every((l) => l.model === 'haiku' && !l.resume), `${checks.length - checksBefore} checks`);
  const wake = await c.next((e) => c.events.indexOf(e) >= from4 && e.agentId === y.id && e.kind === 'user.sent' && e.auto === 'schedule', 20000);
  await sleep(2500);
  check('the held wake-up goes out, once', !!wake && c.events.filter((e) => c.events.indexOf(e) >= from4 && e.agentId === y.id && e.kind === 'user.sent' && e.auto === 'schedule').length === 1);
  const x4 = (await c.cmd('listAgents')).find((a) => a.id === x.id);
  check('its status is no longer waiting for an account', x4 && !x4.parked && x4.account?.id === 'a', `${x4?.status} ${x4?.statusReason}`);

  // ---- 5
  const everything = [JSON.stringify(c.hello), c.raw.join('\n'), fs.readFileSync(ROSTER, 'utf8'), logs.join('')].join('\n');
  check('the token never shows (hello, every message, the roster, the engine log)', !/tok-a|tok-b/.test(everything));
  await c.cmd('kill', { agentId: x.id });
  await c.cmd('kill', { agentId: y.id });
  await c.cmd('shutdown');
  c.ws.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await sleep(1500);
  try { engine.kill(); } catch { /* gone */ }
  if (failed) console.log('engine log (last lines):\n' + logs.join('').split('\n').slice(-30).join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
