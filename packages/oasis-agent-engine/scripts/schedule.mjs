// Schedules: when agents wake up on their own (the engine's schedule.js). For Anorak and for the owner's shell.
//
//   node schedule.mjs list                                       every agent's schedule, appointments, next wake-up
//   node schedule.mjs set <agent> <off|hourly|3h|6h|daily|weekly> [HH:MM] [weekday]
//   node schedule.mjs prompt <agent> "<standing prompt>"         its own standing prompt ("" for the default)
//   node schedule.mjs add <agent> "<when>" "<note>" [--repeat daily|weekly] [--prompt "<what it is told>"]
//        when: "16:20" (the next one), "wed 16:20", "tomorrow 9:00", "2026-11-25 16:20", "in 30m"
//   node schedule.mjs remove <agent> <appointment id>
//   node schedule.mjs wake <agent>                               wake it now (after its turn, when it is busy)
//   node schedule.mjs settings [--quiet 01:00-08:00|off] [--cap 8]
//
// <agent>: a name (or the start of one), an agent id or a session id. OASIS_ENGINE_URL (default
// http://127.0.0.1:4530). Appointments set here say who set them: OASIS_AGENT_ID's agent, else "the owner's shell".
import { tokenHeaders } from '../src/token.js';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const value = args[i + 1]; args.splice(i, 2); return value ?? null; };
const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '');

async function cmd(body) {
  let response;
  try {
    response = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeaders() }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`the Oasis engine does not answer at ${base}`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.error || `engine answered ${response.status}`);
  return json.data && typeof json.data === 'object' && !Array.isArray(json.data) && 'data' in json.data ? json.data.data : json.data;
}

const when = (ms) => (ms ? new Date(ms).toString().slice(0, 21) : '-');
function show(view) {
  console.log(`${view.name}: ${view.label}${view.schedule?.prompt ? ' (own prompt)' : ''} · next ${view.nextWake ? `${when(view.nextWake.at)} (${view.nextWake.label})` : 'none'} · woke ${view.wakesToday}× today`);
  for (const a of view.appointments || []) console.log(`   ${a.id}  ${a.label}`);
}

try {
  const [action, ...rest] = args;
  let by = process.env.OASIS_AGENT_ID || '';
  if (by) { try { by = (await cmd({ cmd: 'getCharacter', agentId: by })).name || by; } catch { /* the id will do */ } } else by = "the owner's shell";
  if (action === 'list') {
    const all = await cmd({ cmd: 'listSchedules' });
    const q = all.settings.quiet;
    console.log(`quiet hours ${q ? `${q.from}-${q.to}` : 'off'} · daily cap ${all.settings.dailyCap} recurring wake-ups per agent\n`);
    for (const v of all.agents) show(v);
  } else if (action === 'set') {
    const [agent, every, at, day] = rest;
    if (!agent || !every) throw new Error('node schedule.mjs set <agent> <off|hourly|3h|6h|daily|weekly> [HH:MM] [weekday]');
    show(await cmd({ cmd: 'setSchedule', agent, every, ...(at ? { at } : {}), ...(day ? { day } : {}) }));
  } else if (action === 'prompt') {
    const [agent, ...words] = rest;
    if (!agent) throw new Error('node schedule.mjs prompt <agent> "<standing prompt>"');
    show(await cmd({ cmd: 'setSchedule', agent, prompt: words.join(' ') }));
  } else if (action === 'add') {
    const repeat = flag('--repeat');
    const prompt = flag('--prompt');
    const [agent, at, ...note] = args.slice(1);
    if (!agent || !at) throw new Error('node schedule.mjs add <agent> "<when>" "<note>" [--repeat daily|weekly] [--prompt "<text>"]');
    const result = await cmd({ cmd: 'addAppointment', agent, at, note: note.join(' '), ...(repeat ? { repeat } : {}), ...(prompt ? { prompt } : {}), by });
    console.log(`Set: ${result.appointment.label} -> ${when(result.appointment.at)} (id ${result.appointment.id})`);
  } else if (action === 'remove') {
    const [agent, id] = rest;
    if (!agent || !id) throw new Error('node schedule.mjs remove <agent> <appointment id>');
    show(await cmd({ cmd: 'removeAppointment', agent, id }));
  } else if (action === 'wake') {
    const [agent] = rest;
    if (!agent) throw new Error('node schedule.mjs wake <agent>');
    const r = await cmd({ cmd: 'wakeNow', agent, by });
    console.log(r.result === 'woke' ? `${r.name} is waking up.` : `${r.name} is busy: it wakes when its turn ends.`);
  } else if (action === 'settings') {
    const quiet = flag('--quiet');
    const cap = flag('--cap');
    const patch = {};
    if (quiet) {
      if (/^(off|none)$/i.test(quiet)) patch.quiet = null;
      else { const m = quiet.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/); if (!m) throw new Error('--quiet 01:00-08:00, or off'); patch.quiet = { from: m[1], to: m[2] }; }
    }
    if (cap !== null) patch.dailyCap = Number(cap);
    const r = await cmd({ cmd: 'scheduleSettings', ...patch });
    console.log(`quiet hours ${r.settings.quiet ? `${r.settings.quiet.from}-${r.settings.quiet.to}` : 'off'} · daily cap ${r.settings.dailyCap}`);
  } else {
    console.log('usage: node schedule.mjs list | set | prompt | add | remove | wake | settings   (see the top of this file)');
    process.exitCode = action ? 1 : 0;
  }
} catch (error) {
  console.error(`schedule: ${error.message}`);
  process.exitCode = 1;
}
