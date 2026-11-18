// Schedule smoke [about 6 haiku turns]: agents wake up on their own (src/schedule.js), on a test engine with a fake
// clock (OASIS_FAKE_CLOCK=1, port 4545 unless OASIS_PORT). Never touches the real engine on 4530.
//   1  hourly: moving the clock past the hour wakes the agent once, tagged, and the turn is marked scheduled
//   2  busy: a slot that comes during the owner's turn waits for it, then goes out once
//   3  an appointment ("in 5m", a note) fires at its time; a one-off is gone afterwards
//   4  quiet hours hold the recurring wake-up back; the daily cap holds back the next one, not an appointment
//   5  the engine is off for five hours: one wake-up at start, not five; the thread from the transcript shows the tag
//
//   node scripts/schedule-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const PORT = Number(process.env.OASIS_PORT || 4545);
if (PORT === 4530) throw new Error('never on the real engine port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-schedule-smoke-'));
const ROSTER = path.join(tmp, 'roster.local.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failed = true; };

let engine = null;
const logs = [];
async function startEngine(env = {}) {
  engine = spawn(process.execPath, [path.join(PKG, 'src', 'index.js')], {
    cwd: path.resolve(PKG, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, OASIS_PORT: String(PORT), OASIS_ROSTER: ROSTER, OASIS_TELEGRAM: '0', OASIS_FAKE_CLOCK: '1', OASIS_SCHEDULE_START_MS: '0', OASIS_SCHEDULE_TICK_MS: '1000', OASIS_LOOKS: '0', ...env },
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
  await sleep(500);
}

async function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const events = []; const replies = new Map(); let n = 0; let hello = null;
  await new Promise((res, rej) => {
    ws.on('error', rej);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') { hello = m; for (const list of Object.values(m.backlog || {})) events.push(...list.filter((e) => !e.history)); res(); }
      if (m.type === 'reply') replies.get(m.id)?.(m);
      if (m.type === 'event' && !m.event.history) events.push(m.event);
    });
  });
  const cmd = async (name, args = {}) => { const r = await new Promise((res) => { const id = ++n; replies.set(id, res); ws.send(JSON.stringify({ id, cmd: name, ...args })); }); return r.ok ? (r.data && typeof r.data === 'object' && 'data' in r.data ? r.data.data : r.data) : Promise.reject(new Error(r.error)); };
  const next = async (pred, ms = 120000) => { const until = Date.now() + ms; for (;;) { const e = events.find(pred); if (e) return e; if (Date.now() > until) return null; await sleep(100); } };
  return { ws, events, hello, cmd, next, close: () => ws.close() };
}

/** Local time of the fake clock at the next full hour + minutes, as "YYYY-MM-DD HH:MM". */
const fmt = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

try {
  await startEngine();
  let c = await connect();
  // A fixed noon to start from, so the quiet hours (01:00-08:00) never get in the way by accident.
  const noon = new Date(); noon.setDate(noon.getDate() + 1); noon.setHours(12, 0, 0, 0);
  await c.cmd('clock', { at: fmt(noon.getTime()) });
  const sp = await c.cmd('spawnAgent', { name: 'sched-a', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false });
  const id = sp.id;
  await c.next((e) => e.agentId === id && e.kind === 'meta', 30000);
  const wakes = () => c.events.filter((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule');

  // ---- 1: hourly
  const set = await c.cmd('setSchedule', { agentId: id, every: 'hourly', prompt: 'Reply with the word WOKE only. No tools.' });
  check('setSchedule hourly: the next wake-up is the next full hour', set.nextWake?.at === noon.getTime() + 3600_000, `${set.label} -> ${set.nextWake && fmt(set.nextWake.at)}`);
  await c.cmd('clock', { at: fmt(noon.getTime() + 3600_000 + 60_000) }); // 13:01
  const w1 = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule', 15000);
  check('past the hour it wakes, tagged as the schedule\'s', !!w1 && /hourly/.test(w1.scheduled || '') && w1.text === 'Reply with the word WOKE only. No tools.', JSON.stringify(w1 && { scheduled: w1.scheduled, text: w1.text }));
  const e1 = await c.next((e) => e.agentId === id && e.kind === 'turn.end', 120000);
  check('the turn it starts is marked scheduled', e1?.scheduled === true && /WOKE/.test(e1?.result || ''), JSON.stringify({ scheduled: e1?.scheduled, result: (e1?.result || '').slice(0, 40) }));
  await sleep(3000);
  check('only once for that slot', wakes().length === 1, `${wakes().length} wake-ups`);

  // ---- 2: busy
  const from2 = c.events.length;
  await c.cmd('send', { agentId: id, text: 'Run this with the Bash tool and wait for it: node -e "setTimeout(()=>console.log(\'slow-done\'),15000)" . Then reply with its output.' });
  await c.next((e, i) => c.events.indexOf(e) >= from2 && e.agentId === id && e.kind === 'tool.start' && e.name === 'Bash', 90000);
  await c.cmd('clock', { advanceMs: 3600_000 }); // 14:01, while the turn runs
  await sleep(3000);
  check('a slot during the owner\'s turn waits', wakes().length === 1, `${wakes().length} wake-ups while busy`);
  const end2 = await c.next((e) => c.events.indexOf(e) >= from2 && e.agentId === id && e.kind === 'turn.end', 120000);
  check('the owner\'s turn is not marked scheduled', end2 && end2.scheduled === undefined);
  const w2 = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule' && e !== w1, 20000);
  check('after the turn it goes out, once', !!w2, `${wakes().length} wake-ups`);
  await c.next((e) => c.events.indexOf(e) > c.events.indexOf(w2) && e.agentId === id && e.kind === 'turn.end', 120000);
  await c.cmd('clock', { advanceMs: 2 * 3600_000 }); // two more slots while nothing ran: one wake
  await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule' && wakes().length >= 3, 15000);
  const last3 = wakes()[2];
  await c.next((e) => last3 && c.events.indexOf(e) > c.events.indexOf(last3) && e.agentId === id && e.kind === 'turn.end', 120000);
  await sleep(2500);
  check('two slots passed while it was idle between ticks: one wake-up', wakes().length === 3, `${wakes().length} wake-ups`);

  // ---- 3: an appointment
  await c.cmd('setSchedule', { agentId: id, every: 'off' });
  const ap = await c.cmd('addAppointment', { agentId: id, at: 'in 5m', note: 'The Council', prompt: 'Reply with the word COUNCIL only. No tools.', by: 'the smoke' });
  check('addAppointment', ap.appointment?.note === 'The Council' && ap.nextWake?.label.startsWith('appointment: The Council'), ap.appointment?.label);
  await c.cmd('clock', { advanceMs: 6 * 60_000 });
  const w3 = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule' && /Council/.test(e.scheduled || ''), 15000);
  const e3 = w3 && await c.next((e) => c.events.indexOf(e) > c.events.indexOf(w3) && e.agentId === id && e.kind === 'turn.end', 120000);
  const list3 = await c.cmd('listSchedules');
  check('the appointment fires at its time, and a one-off is gone', /COUNCIL/.test(e3?.result || '') && list3.agents.find((x) => x.agentId === id)?.appointments.length === 0, JSON.stringify((e3?.result || '').slice(0, 30)));

  // ---- 4: quiet hours and the cap
  await c.cmd('setSchedule', { agentId: id, every: 'hourly', prompt: 'Reply with the word WOKE only. No tools.' });
  await c.cmd('scheduleSettings', { quiet: { from: '00:00', to: '23:59' } });
  const before4 = wakes().length;
  await c.cmd('clock', { advanceMs: 3600_000 });
  await sleep(3000);
  check('quiet hours hold the recurring wake-up back', wakes().length === before4, `${wakes().length - before4} new`);
  const today = (await c.cmd('listSchedules')).agents.find((x) => x.agentId === id).wakesToday;
  await c.cmd('scheduleSettings', { quiet: null, dailyCap: today });
  await sleep(3000);
  check('at the cap the recurring wake-up is skipped, with a notice', wakes().length === before4 && c.events.some((e) => e.agentId === id && e.kind === 'notice' && /daily cap/.test(e.text || '')), `cap ${today}`);
  await c.cmd('addAppointment', { agentId: id, at: 'in 1m', note: 'over the cap', prompt: 'Reply with the word STILL only. No tools.' });
  await c.cmd('clock', { advanceMs: 2 * 60_000 });
  const w4 = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule' && /over the cap/.test(e.scheduled || ''), 15000);
  check('an appointment still fires at the cap', !!w4);
  if (w4) await c.next((e) => c.events.indexOf(e) > c.events.indexOf(w4) && e.agentId === id && e.kind === 'turn.end', 120000);
  await c.cmd('scheduleSettings', { dailyCap: 8 });

  // ---- 5: off for five hours
  const lastBefore = (await c.cmd('listSchedules')).agents.find((x) => x.agentId === id);
  c.close();
  await stopEngine();
  const offset = (lastBefore.lastWakeAt ? Math.max(lastBefore.lastWakeAt, Date.now()) : Date.now()) - Date.now();
  await startEngine({ OASIS_CLOCK_OFFSET_MS: String(Math.round(offset + 5 * 3600_000)) });
  c = await connect();
  const w5 = await c.next((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule', 20000);
  const e5 = w5 && await c.next((e) => c.events.indexOf(e) > c.events.indexOf(w5) && e.agentId === id && e.kind === 'turn.end', 120000);
  await sleep(3000);
  const at5 = c.events.filter((e) => e.agentId === id && e.kind === 'user.sent' && e.auto === 'schedule');
  check('five hours off: one wake-up at start, saying it was late', at5.length === 1 && /WOKE/.test(e5?.result || ''), `${at5.length} wake-up(s)`);
  // The thread read back from the transcript (a page that loads older history) still shows which ones were scheduled.
  const older = await c.cmd('olderHistory', { agentId: id, minEvents: 500 });
  const tagged = (older.events || []).filter((e) => e.kind === 'user' && e.scheduled);
  const notes = (older.events || []).filter((e) => e.kind === 'user' && /Oasis schedule/.test(e.text || ''));
  check('from the transcript: the scheduled messages are tagged, and the note is hidden', tagged.length >= 5 && notes.length === 0, `${tagged.length} tagged, ${notes.length} with the note showing`);
  await c.cmd('kill', { agentId: id });
  c.close();
  await stopEngine();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  try { engine?.kill(); } catch { /* gone */ }
  if (failed) console.log('engine log (last lines):\n' + logs.join('').split('\n').slice(-40).join('\n'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
