// The Council's stage from a shell: the moderator's calls, one per line of a scene. Each returns when the
// step is done (src/stage.js; the Oasis page does the walking and the speaking).
//
//   node council.mjs start Anorak Debugger Tyler [--center x,z] [--radius 3.2]
//   node council.mjs prepare Tyler "What I did this week…"     -> how many seconds the clip will take; nothing plays
//   node council.mjs forward Tyler
//   node council.mjs speak Tyler "What I did this week…"       -> returns when the clip has ended
//   node council.mjs speak Tyler --next [--wait 120]           -> the spoken line of Tyler's next reply instead
//   node council.mjs back Tyler
//   node council.mjs turn Tyler "…" | --next                   -> forward + speak + back
//   node council.mjs stop | end | status
//
// OASIS_ENGINE_URL (default http://127.0.0.1:4530). Prints the engine's answer as JSON; exit code 1 on failure.
import { tokenHeaders } from '../src/token.js';
const args = process.argv.slice(2);
const flag = (name, takesValue = true) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = takesValue ? args[i + 1] : true;
  args.splice(i, takesValue ? 2 : 1);
  return value ?? null;
};
const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '');
const center = flag('--center');
const radius = flag('--radius');
const wait = flag('--wait');
const next = flag('--next', false);
const [action, ...rest] = args;

const body = { cmd: 'council', action };
if (action === 'start') {
  body.agents = rest;
  if (center) body.center = center.split(',').map(Number);
  if (radius) body.radius = Number(radius);
} else if (['forward', 'back', 'speak', 'prepare', 'turn'].includes(action)) {
  body.agent = rest[0];
  if (next) body.next = true;
  else if (rest.length > 1) body.text = rest.slice(1).join(' ');
  if (wait) body.waitMs = Number(wait) * 1000;
}

if (!action) {
  console.log('usage: node council.mjs start <agents…> | prepare|speak|turn <agent> "<text>"|--next | forward|back <agent> | stop | end | status');
} else {
  try {
    const response = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeaders() }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    console.log(JSON.stringify(json.ok === false || !response.ok ? { ok: false, error: json.error || `engine answered ${response.status}` } : (json.data?.data ?? json.data ?? {}), null, 1));
    if (json.ok === false || !response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`council: ${error.message}`);
    process.exitCode = 1;
  }
}
