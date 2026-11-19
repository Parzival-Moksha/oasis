// An agent looks at itself and around, and keeps its own card (who it is in the Oasis).
//
//   node me.mjs card                 who you are: name, role, voice, look, place, your own words; and the card's file
//   node me.mjs look                 a front picture of your avatar, saved as a file (read it to see it)
//   node me.mjs around               four pictures of what is around you: ahead, right, behind, left
//   node me.mjs who "<text>"         your own who-you-are, a few sentences ("" clears it)
//   node me.mjs role "<sentence>"    your role in one sentence
//   node me.mjs home                 where you live (your home in each world, or your desk on the ring)
//   node me.mjs home here            make the spot you stand on your home (facing the plaza): no desk any more
//   node me.mjs home <x> <z>         your home at x, z in the world the owner is in
//   node me.mjs home clear           back to your desk on the ring
//
// A home is yours: build on the ground around it with the free world tools, within your budget (your card says
// how much). Homes live on the Oasis page server (OASIS_PAGE_URL, default http://127.0.0.1:4516); the owner's
// open page answers here / x z / clear, because only it knows the world it shows and where you stand.
//
// The pictures are rendered by the Oasis page the owner has open, so they show the world as it is now. They are
// taken when you ask, not sent with every message: a picture costs a few hundred tokens each time.
//
// Who is asking comes from the environment the engine starts each agent with: OASIS_AGENT_ID and
// OASIS_ENGINE_URL. Anywhere else (a desktop session, another kind of agent, a terminal):
// --agent <name, agent id or session id>, and OASIS_ENGINE_URL (default http://127.0.0.1:4530).
import { tokenHeaders } from '../src/token.js';
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const value = args[i + 1]; args.splice(i, 2); return value || null; };
const agent = flag('--agent') || flag('--session') || process.env.OASIS_AGENT_ID || '';
const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '');
const pageBase = (process.env.OASIS_PAGE_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '');
const [action, ...rest] = args;

async function cmd(body) {
  let response;
  try {
    response = await fetch(`${base}/api/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', ...tokenHeaders() }, body: JSON.stringify(body) });
  } catch {
    throw new Error(`the Oasis engine does not answer at ${base}`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.error || `engine answered ${response.status}`);
  // Commands that answer {ok, data} arrive wrapped once more by /api/cmd.
  return json.data && typeof json.data === 'object' && !Array.isArray(json.data) && 'data' in json.data ? json.data.data : json.data;
}

/** Which engine agent you are: { id, name, key } (key: the session id the homes are kept under). */
async function whoAmI() {
  const agents = await cmd({ cmd: 'listAgents' });
  const want = agent.toLowerCase();
  const me = (Array.isArray(agents) ? agents : []).find((a) => a.id === agent || a.sessionId === agent || String(a.name || '').toLowerCase() === want);
  if (!me) throw new Error(`no agent "${agent}" in the engine at ${base}`);
  return { id: me.id, name: me.name, key: me.sessionId || me.id };
}

async function homes(body) {
  let response;
  try {
    response = await fetch(`${pageBase}/api/village/homes`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error(`the Oasis page server does not answer at ${pageBase}`);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `the page server answered ${response.status}`);
  return json;
}

async function home(args) {
  const me = await whoAmI();
  const [first, second] = args;
  if (!first) {
    const file = await homes();
    const mine = Object.entries(file.homes || {}).filter(([, byAgent]) => byAgent[me.key]);
    if (!mine.length) console.log('You have no home: you sit at your desk on the ring. node me.mjs home here makes the spot you stand on your home.');
    for (const [world, byAgent] of mine) {
      const h = byAgent[me.key];
      console.log(`home in world ${world}: x ${h.x}, z ${h.z} (set by ${h.by === 'agent' ? 'you' : 'the owner'})`);
    }
    const waiting = (file.requests || []).filter((r) => r.agentKey === me.key);
    if (waiting.length) console.log(`waiting for the owner's page: ${waiting.map((r) => r.kind).join(', ')}`);
    return;
  }
  let request;
  if (first === 'here' || first === 'clear') request = { kind: first };
  else if (Number.isFinite(Number(first)) && Number.isFinite(Number(second))) request = { kind: 'at', x: Number(first), z: Number(second) };
  else throw new Error('usage: node me.mjs home [here | <x> <z> | clear]');
  const made = await homes({ action: 'request', agent: me.key, agentId: me.id, ...request });
  const id = made.request?.id;
  // The owner's open page answers within a few seconds.
  for (let i = 0; i < 16; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const file = await homes();
    const done = (file.done || []).find((d) => d.id === id);
    if (done) {
      console.log(done.ok ? `Done: ${done.note}.` : `Not done: ${done.note}.`);
      if (done.ok && request.kind !== 'clear') console.log('The ground around it is yours to build on with the free world tools; your card says how much.');
      return;
    }
  }
  console.log("No Oasis page has answered yet: it will be done when the owner's page is open (the request waits an hour).");
}

function printCard(c) {
  const line = (label, value) => { if (value) console.log(`${label.padEnd(7)} ${value}`); };
  line('name', c.name);
  line('role', c.role || '(none yet: node me.mjs role "<one sentence>")');
  line('voice', c.voice);
  line('look', c.look);
  line('world', c.world ? `${c.world}${c.home && c.home !== c.world ? ` (first seen in ${c.home})` : ''}` : '');
  line('place', c.place);
  console.log(`\nwho you are:\n${c.who || '(nothing yet: node me.mjs who "<a few sentences in your own words>")'}`);
  console.log(`\ncard file: ${c.file}`);
}

try {
  const need = () => { if (!agent) throw new Error('who are you? OASIS_AGENT_ID is not set: pass --agent <name, agent id or session id>'); };
  if (action === 'card') {
    need();
    printCard(await cmd({ cmd: 'getCharacter', agent }));
  } else if (action === 'who' || action === 'role') {
    need();
    if (!rest.length) throw new Error(`what should it say? node me.mjs ${action} "<text>"`);
    const text = rest.join(' ');
    const card = await cmd({ cmd: 'setCharacter', agent, [action]: text });
    console.log(action === 'who' ? `Your who-you-are is saved (${card.who.length} characters).` : `Your role is saved: ${card.role || '(cleared)'}`);
    console.log(`card file: ${card.file}`);
  } else if (action === 'look' || action === 'around') {
    need();
    const result = await cmd({ cmd: 'view', agent, view: action });
    console.log(action === 'look' ? 'Your avatar, from the front:' : 'What is around you (each picture looks one way from where you stand):');
    for (const p of result.pictures) console.log(`  ${(p.label || '').padEnd(8)} ${p.path}${p.note ? `\n           ${p.note}` : ''}`);
    console.log('Read the file(s) to see them.');
  } else if (action === 'home') {
    need();
    await home(rest);
  } else {
    console.log('usage: node me.mjs card | look | around | who "<text>" | role "<sentence>" | home [here | <x> <z> | clear]   [--agent <name, agent id or session id>]');
    process.exitCode = action ? 1 : 0;
  }
} catch (error) {
  console.error(`me: ${error.message}`);
  process.exitCode = 1;
}
