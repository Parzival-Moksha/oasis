// An agent tells the owner something on Telegram, on its own: for what truly needs him now (a scheduled
// wake-up found something only he can decide, a thing broke). Once: the engine refuses a second message from
// the same agent within 30 minutes. Questions that can wait go to C:/7c_oasis/docs/grill/open.md instead.
//
//   node tell.mjs "<a few lines>"
//
// Who is writing comes from the environment the engine starts each agent with: OASIS_AGENT_ID and OASIS_ENGINE_URL.
// Anywhere else: --agent <name or id>, and OASIS_ENGINE_URL (default http://127.0.0.1:4530).
import { tokenHeaders } from '../src/token.js';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const value = args[i + 1]; args.splice(i, 2); return value || null; };
const agent = flag('--agent') || process.env.OASIS_AGENT_ID || '';
const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '');
const text = args.join(' ').trim();

try {
  if (!agent) throw new Error('who are you? OASIS_AGENT_ID is not set: pass --agent <name or id>');
  if (!text) throw new Error('what should it say? node tell.mjs "<a few lines>"');
  let response;
  try {
    response = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeaders() }, body: JSON.stringify({ cmd: 'tellOwner', agent, text }) });
  } catch {
    throw new Error(`the Oasis engine does not answer at ${base}`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.error || `engine answered ${response.status}`);
  console.log('Sent to the owner on Telegram.');
} catch (error) {
  console.error(`tell: ${error.message}`);
  process.exitCode = 1;
}
