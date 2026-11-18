// An agent picks its own voice (the one its avatar speaks with in the Oasis).
//
//   node voice.mjs list            the voices: key, name, what it sounds like
//   node voice.mjs set <key>       speak with that voice from the next reply on
//   node voice.mjs clear           give the choice up (back to the voice it was dealt)
//
// Who is asking comes from the environment the engine starts each agent with: OASIS_AGENT_ID and
// OASIS_ENGINE_URL. Outside an agent: --agent <name or id> and OASIS_ENGINE_URL (default http://127.0.0.1:4530).
// The owner's pick in the agent's settings menu wins over this.
import { tokenHeaders } from '../src/token.js';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const value = args[i + 1]; args.splice(i, 2); return value || null; };
const agent = flag('--agent') || process.env.OASIS_AGENT_ID || '';
const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '');
const [action, key] = args;

async function cmd(body) {
  const response = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeaders() }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.error || `engine answered ${response.status}`);
  // Commands that answer {ok, data} arrive wrapped once more by /api/cmd.
  return json.data && typeof json.data === 'object' && !Array.isArray(json.data) && 'data' in json.data ? json.data.data : json.data;
}

try {
  if (action === 'list') {
    const voices = await cmd({ cmd: 'listVoices' });
    for (const voice of voices) console.log(`${voice.key.padEnd(9)} ${voice.name.padEnd(15)} ${voice.sound}`);
    console.log('\nPick one: node voice.mjs set <key>');
  } else if (action === 'set' || action === 'clear') {
    if (!agent) throw new Error('who are you? OASIS_AGENT_ID is not set: pass --agent <name or id>');
    if (action === 'set' && !key) throw new Error('which voice? node voice.mjs set <key> (see: node voice.mjs list)');
    const result = await cmd({ cmd: 'chooseVoice', agent, voice: action === 'set' ? key : null });
    console.log(result.voiceChoice ? `Your voice is now "${result.voiceChoice}". It is used from your next spoken line on (unless the owner picked another for you).` : 'Choice cleared: you speak with the voice you were dealt.');
  } else {
    console.log('usage: node voice.mjs list | set <key> | clear   [--agent <name or id>]');
    process.exitCode = action ? 1 : 0;
  }
} catch (error) {
  console.error(`voice: ${error.message}`);
  process.exitCode = 1;
}
