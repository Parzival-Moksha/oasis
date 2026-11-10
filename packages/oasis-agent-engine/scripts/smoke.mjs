// WebSocket smoke test for the Oasis agent engine. Start it first (pnpm dev:engine from the af_oasis root).
//
//   node scripts/smoke.mjs basic     [0 turns]  hello, sessions, spawn + initialize, setModel, observe, hook
//   node scripts/smoke.mjs turns     [3 turns]  mid-turn message + todo, interrupt, AskUserQuestion via host
//   node scripts/smoke.mjs restore   [0 turns]  after a server restart: roster restored + resumed, then cleanup
//   node scripts/smoke.mjs world     [1 turn]   the Oasis MCP server loads and its free tools run without a card
//   node scripts/smoke.mjs handoff   [3 turns]  move here + let go between two engines (OASIS_WS and OASIS_WS2)
//   node scripts/smoke.mjs effort    [0 turns]  --effort at spawn, live setEffort (apply_flag_settings), roster keeps it
//   node scripts/smoke.mjs eyes      [2 turns]  a message carries a picture from the agent's avatar (this script plays the page)
//
// Only touches packages/oasis-agent-engine/sandbox/* scratch agents. Uses haiku and tiny prompts.
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { findSessionFile } from '../src/sessions.js';
import { spawnClaude, onLines } from '../src/claude.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const B = path.join(PKG, 'sandbox', 'agent-b');
const URL_ = process.env.OASIS_WS || 'ws://127.0.0.1:4530/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url = URL_) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events = [];
    const waiters = [];
    const pending = new Map();
    let n = 0;
    let hello = null;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') { hello = m; resolve(api); return; }
      if (m.type === 'reply') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } return; }
      if (m.type === 'event') {
        const e = m.event;
        events.push(e);
        if (e.kind !== 'text.delta' && !e.agentId.startsWith('obs-')) console.log('  ev', e.agentId.slice(0, 14).padEnd(14), e.kind.padEnd(18), brief(e));
        for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
      }
    });
    ws.on('error', reject);
    const api = {
      ws, events, get hello() { return hello; },
      cmd(cmd, args = {}) {
        const id = ++n;
        return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, cmd, ...args })); });
      },
      next(pred, ms = 120000) {
        return new Promise((res, rej) => {
          const w = { pred, resolve: res };
          waiters.push(w);
          setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout waiting for event')); } }, ms);
        });
      },
      close() { ws.close(); },
    };
  });
}

function brief(e) {
  const { v, agentId, ts, kind, ...rest } = e;
  void v; void agentId; void ts; void kind;
  const s = JSON.stringify(rest);
  return s.length > 220 ? s.slice(0, 220) + '…' : s;
}

function check(label, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

const phases = {
  async basic() {
    const c = await connect();
    check('hello received', !!c.hello, `agents=${c.hello.agents.length} claude=${c.hello.server.claude}`);
    const s = await c.cmd('listSessions', { limit: 40 });
    check('listSessions', s.ok && s.data.length > 0, `${s.data.length} sessions, newest: ${s.data[0]?.title} (${s.data[0]?.cwd})`);

    const sp = await c.cmd('spawnAgent', { name: 'smoke-a', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions' });
    check('spawnAgent', sp.ok, sp.ok ? `id=${sp.data.id} session=${sp.data.sessionId}` : sp.error);
    const meta = await c.next((e) => e.agentId === sp.data.id && e.kind === 'meta', 30000).catch(() => null);
    check('initialize -> meta (models list)', !!meta, meta ? `${meta.models?.length} models, ${meta.subscription}` : '');
    const dup = await c.cmd('spawnAgent', { name: 'dup', cwd: A, sessionId: sp.data.sessionId });
    check('refuses to drive the same session twice', !dup.ok, dup.error);
    const sm = await c.cmd('setModel', { agentId: sp.data.id, model: 'sonnet' });
    check('setModel (control request, no turn)', sm.ok && /sonnet/.test(sm.data?.data?.model || ''), JSON.stringify(sm.data));
    const k = await c.cmd('kill', { agentId: sp.data.id });
    check('kill', k.ok);

    // agent-b has a project-level `type:"http"` hook config. Without a turn, only lifecycle hooks can fire.
    const spb = await c.cmd('spawnAgent', { name: 'smoke-b', cwd: B, model: 'haiku', permissionMode: 'default' });
    const hk = await c.next((e) => e.agentId === spb.data.id && e.kind === 'hook', 8000).catch(() => null);
    console.log(`INFO  http SessionStart hook at process start: ${hk ? 'arrived' : 'did not arrive within 8s'}`);
    const endHook = c.next((e) => e.agentId === spb.data.id && e.kind === 'hook' && e.event === 'SessionEnd', 10000).catch(() => null);
    await c.cmd('kill', { agentId: spb.data.id });
    check('project http hook reached POST /hook (SessionEnd on kill, zero quota)', !!(await endHook));

    // Observe a real, live session read-only: the newest transcript that is not a sandbox one.
    const target = s.data.find((x) => x.cwd && !/sandbox/i.test(x.cwd));
    const ob = await c.cmd('observe', { sessionPath: target.path });
    check('observe', ob.ok, ob.ok ? `${target.title} -> status ${ob.data.status} (${ob.data.statusReason})` : ob.error);
    await sleep(1500);
    const n = c.events.filter((e) => e.agentId === ob.data.id).length;
    check('observe replayed history as events', n > 0, `${n} events; kinds: ${[...new Set(c.events.filter((e) => e.agentId === ob.data.id).map((e) => e.kind))].join(',')}`);
    await c.cmd('unobserve', { agentId: ob.data.id });

    const bad = await c.cmd('observe', { sessionPath: 'C:/Windows/win.ini' });
    check('observe refuses non-transcript paths', !bad.ok, bad.error);

    // Synthetic hook POST (what a `type:"http"` hook sends) for a session nobody owns.
    const hookEvP = c.next((e) => e.agentId.startsWith('hook-00000000') && e.kind === 'tool.start', 5000).catch(() => null);
    const res = await fetch('http://127.0.0.1:4530/hook', { method: 'POST', body: JSON.stringify({ session_id: '00000000-0000-4000-8000-000000000000', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_use_id: 'toolu_x', cwd: B }) });
    check('POST /hook -> normalized tool.start on a hook observer', res.ok && !!(await hookEvP), `${res.status} ${await res.text()}`);
    await c.cmd('kill', { agentId: 'hook-00000000' });
    c.close();
  },

  async turns() {
    const c = await connect();
    // ---- turn 1: todo + slow tool + a message sent mid-turn
    const a = (await c.cmd('spawnAgent', { name: 'agent-a', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions' })).data;
    await c.next((e) => e.agentId === a.id && e.kind === 'meta', 30000);
    await c.cmd('send', { agentId: a.id, text: 'Use TodoWrite to make a 2-item todo list ("wait", "answer"). Then run this with the Bash tool: node -e "setTimeout(()=>console.log(\'slow-done\'),12000)" . Then mark both todos completed and reply with the command output.' });
    const todo = await c.next((e) => e.agentId === a.id && e.kind === 'todo', 90000).catch(() => null);
    check('todo event (TodoWrite or TaskCreate/TaskUpdate)', !!todo, todo ? `${todo.source}: ${JSON.stringify(todo.todos)}` : '');
    const bash = await c.next((e) => e.agentId === a.id && e.kind === 'tool.start' && e.name === 'Bash', 90000);
    await sleep(1500);
    const mid = await c.cmd('send', { agentId: a.id, text: 'Also: end your final reply with the word KIWI.' });
    check('send while the tool runs is accepted', mid.ok && mid.data.midTurn === true, JSON.stringify(mid.data));
    const consumed = await c.next((e) => e.agentId === a.id && e.kind === 'user.consumed' && e.uuid === mid.data.uuid, 90000).catch(() => null);
    check('mid-turn message folded into the running turn', !!consumed && consumed.folded === true, consumed ? `waited ${consumed.waitedMs} ms` : '');
    const end1 = await c.next((e) => e.agentId === a.id && e.kind === 'turn.end', 120000);
    check('turn.end done-waiting', end1.outcome === 'done-waiting', `${end1.reason} cost=$${end1.costUsd} ctx=${end1.contextTokens}/${end1.contextWindow}`);
    check('reply honours the mid-turn message', /KIWI/.test(end1.result || ''), JSON.stringify(end1.result));
    void bash;
    const st1 = await c.next((e) => e.agentId === a.id && e.kind === 'status' && e.status === 'waiting', 10000).catch(() => null);
    check('status -> waiting', !!st1);
    const ctx = await c.next((e) => e.agentId === a.id && e.kind === 'context', 15000).catch(() => null);
    check('context event (get_context_usage)', !!ctx, ctx ? `${ctx.usedTokens}/${ctx.maxTokens} (${ctx.percent}%)` : '');

    // ---- turn 2: interrupt a long-running tool
    await c.cmd('send', { agentId: a.id, text: 'Run this with the Bash tool and wait for it: node -e "setTimeout(()=>console.log(\'late\'),45000)" . Then reply with its output.' });
    await c.next((e) => e.agentId === a.id && e.kind === 'tool.start' && e.name === 'Bash', 90000);
    await sleep(2500);
    const ir = await c.cmd('interrupt', { agentId: a.id });
    check('interrupt control request', ir.ok && ir.data.ok, JSON.stringify(ir.data));
    const end2 = await c.next((e) => e.agentId === a.id && e.kind === 'turn.end', 30000).catch(() => null);
    check('interrupted turn ends as done-waiting/interrupted', end2?.reason === 'interrupted', end2 ? `${end2.subtype} terminal=${end2.terminalReason}` : 'no turn.end');
    const tend = c.events.filter((e) => e.agentId === a.id && e.kind === 'tool.end').pop();
    console.log('      last tool.end after interrupt:', tend ? JSON.stringify(tend.output).slice(0, 160) : 'none');

    // ---- turn 3: AskUserQuestion answered through the host
    const b = (await c.cmd('spawnAgent', { name: 'agent-b', cwd: B, model: 'haiku', permissionMode: 'default' })).data;
    await c.next((e) => e.agentId === b.id && e.kind === 'meta', 30000);
    await c.cmd('send', { agentId: b.id, text: 'Use the AskUserQuestion tool to ask me whether I prefer tea or coffee (two options). Then reply with exactly my choice in one word.' });
    const pr = await c.next((e) => e.agentId === b.id && e.kind === 'permission.request', 90000).catch(() => null);
    check('AskUserQuestion arrives as permission.request requestKind=question', pr?.requestKind === 'question', pr ? pr.summary : 'none');
    const stDec = c.events.filter((e) => e.agentId === b.id && e.kind === 'status').pop();
    check('status -> needs-decision while asking', stDec?.status === 'needs-decision', stDec?.reason);
    if (pr) {
      const q = pr.input.questions[0];
      const pick = q.options.find((o) => /tea/i.test(o.label)) || q.options[0];
      const rr = await c.cmd('respond', { agentId: b.id, requestId: pr.requestId, behavior: 'allow', answers: { [q.question]: pick.label } });
      check('respond allow + answers', rr.ok, JSON.stringify(rr.data || rr.error));
    }
    const end3 = await c.next((e) => e.agentId === b.id && e.kind === 'turn.end', 90000).catch(() => null);
    check('answer reached the model', /tea/i.test(end3?.result || ''), JSON.stringify(end3?.result));
    console.log('roster now:', fs.readFileSync(path.join(PKG, '..', '..', 'data', 'agent-engine.local.json'), 'utf8').replace(/\s+/g, ' ').slice(0, 400));
    c.close();
  },

  // [0 turns] Thinking effort per agent: the spawn flag, then live switches through apply_flag_settings,
  // read back with get_settings. OASIS_ROSTER (a test engine's roster file) adds the persistence check.
  async effort() {
    const c = await connect();
    const sp = await c.cmd('spawnAgent', { name: 'smoke-effort', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', effort: 'low', worldTools: false });
    check('spawn with effort low', sp.ok, sp.ok ? sp.data.id : sp.error);
    const id = sp.data.id;
    const meta = await c.next((e) => e.agentId === id && e.kind === 'meta', 30000).catch(() => null);
    const haiku = meta?.models?.find((m) => m.value === 'haiku');
    check('meta lists effort levels per model', Array.isArray(haiku?.supportedEffortLevels) && haiku.supportedEffortLevels.includes('low'), JSON.stringify(haiku));
    check('--effort low is what the process runs with', meta?.resolvedEffort === 'low', `resolvedEffort=${meta?.resolvedEffort}`);

    const evP = c.next((e) => e.agentId === id && e.kind === 'effort', 10000).catch(() => null);
    const hi = await c.cmd('setEffort', { agentId: id, effort: 'high' });
    check('setEffort high, live (no restart, no turn)', hi.ok && hi.data?.data?.resolvedEffort === 'high', JSON.stringify(hi.data ?? hi.error));
    const ev = await evP;
    check('effort event', ev?.effort === 'high' && ev?.resolvedEffort === 'high', ev ? brief(ev) : 'none');
    await sleep(200);
    const snap = (await c.cmd('listAgents')).data.find((x) => x.id === id);
    check('snapshot carries the effort, same process', snap?.effort === 'high' && snap?.resolvedEffort === 'high' && snap?.pid === sp.data.pid, `effort=${snap?.effort} resolved=${snap?.resolvedEffort} pid ${sp.data.pid} -> ${snap?.pid}`);

    const bad = await c.cmd('setEffort', { agentId: id, effort: 'turbo' });
    check('refuses an unknown level', !bad.ok, bad.error);
    const max = await c.cmd('setEffort', { agentId: id, effort: 'max' });
    check('setEffort max', max.ok && max.data?.data?.resolvedEffort === 'max', JSON.stringify(max.data ?? max.error));
    const def = await c.cmd('setEffort', { agentId: id, effort: 'default' });
    check('setEffort default goes back to the CLI default', def.ok && def.data?.data?.effort === null && typeof def.data?.data?.resolvedEffort === 'string', JSON.stringify(def.data ?? def.error));
    const modelEvP = c.next((e) => e.agentId === id && e.kind === 'model', 10000).catch(() => null);
    await c.cmd('setModel', { agentId: id, model: 'sonnet' });
    const modelEv = await modelEvP;
    check('a model switch reports the effort the new model runs at', typeof modelEv?.resolvedEffort === 'string', modelEv ? brief(modelEv) : 'none');

    // A stopped process: the level waits for the next start, which passes it as --effort.
    const exitP = c.next((e) => e.agentId === id && e.kind === 'exit', 10000).catch(() => null);
    await c.cmd('kill', { agentId: id, keep: true });
    await exitP;
    const off = await c.cmd('setEffort', { agentId: id, effort: 'xhigh' });
    check('setEffort on a stopped agent is kept for its next start', off.ok && off.data?.data?.effort === 'xhigh', JSON.stringify(off.data ?? off.error));
    if (process.env.OASIS_ROSTER) {
      await sleep(400); // the roster write is debounced
      const roster = JSON.parse(fs.readFileSync(process.env.OASIS_ROSTER, 'utf8'));
      const entry = roster.agents.find((x) => x.id === id);
      check('roster keeps the effort', entry?.effort === 'xhigh', JSON.stringify(entry));
    }
    const meta2P = c.next((e) => e.agentId === id && e.kind === 'meta', 30000).catch(() => null);
    await c.cmd('restart', { agentId: id });
    const meta2 = await meta2P;
    check('the restarted process runs at that effort', meta2?.resolvedEffort === 'xhigh', `resolvedEffort=${meta2?.resolvedEffort}`);
    await c.cmd('kill', { agentId: id });
    c.close();
  },

  // [1 turn] World tools (worldtools.js): a fresh agent gets the Oasis MCP server and may use its free tools
  // without a permission card. Needs the Oasis page server (pnpm dev, port 4516) running.
  async world() {
    const c = await connect();
    const a = (await c.cmd('spawnAgent', { name: 'smoke-world', cwd: A, model: 'haiku', permissionMode: 'default' })).data;
    await c.next((e) => e.agentId === a.id && e.kind === 'meta', 30000);
    const initP = c.next((e) => e.agentId === a.id && e.kind === 'init', 60000).catch(() => null);
    const permP = c.next((e) => e.agentId === a.id && e.kind === 'permission.request', 120000).then((e) => ({ perm: e })).catch(() => null);
    const endP = c.next((e) => e.agentId === a.id && e.kind === 'turn.end', 120000).then((e) => ({ end: e })).catch(() => null);
    await c.cmd('send', { agentId: a.id, text: 'Call the Oasis MCP tool get_world_info once (its name ends in __get_world_info; look it up with ToolSearch if you have to), then reply with only the world name it returned.' });
    const init = await initP;
    // The server comes from the engine's --mcp-config ("oasis", tools mcp__oasis__*) or, when the Oasis plugin is
    // installed, from the plugin ("plugin:oasis:oasis", tools mcp__plugin_oasis_oasis__*). Never both.
    const oasis = (init?.mcpServers || []).filter((s) => s.name === 'oasis' || s.name === 'plugin:oasis:oasis');
    check('one oasis MCP server', oasis.length === 1 && oasis[0].status !== 'failed', JSON.stringify(oasis));
    const first = await Promise.race([permP, endP]);
    check('get_world_info ran without a permission card', !!first?.end, first?.perm ? `asked for ${first.perm.toolName}` : first?.end ? `turn took ${first.end.durationMs} ms` : 'no turn.end');
    const calls = c.events.filter((e) => e.agentId === a.id && e.kind === 'tool.start' && /^mcp__(plugin_oasis_)?oasis__/.test(e.name || '')).map((e) => e.name);
    check('the agent called get_world_info', calls.some((n) => n.endsWith('__get_world_info')), `${calls.join(', ') || 'no oasis tool call'} -> ${JSON.stringify(first?.end?.result || '').slice(0, 120)}`);
    const prefixes = new Set(calls.map((n) => n.slice(0, n.lastIndexOf('__'))));
    check('its tools come from one server only', prefixes.size === 1, [...prefixes].join(', '));
    await c.cmd('kill', { agentId: a.id });
    c.close();
  },

  // [2 turns] Eyes: a message to an agent with eyes on carries a picture from its avatar, as an image block of the
  // same user message. This script plays the Oasis page: it says canSee and answers eyes.request with a plain
  // red picture, then asks the agent what colour it sees.
  async eyes() {
    const c = await connect();
    const sp = await c.cmd('spawnAgent', { name: 'smoke-eyes', cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false });
    const id = sp.data.id;
    await c.next((e) => e.agentId === id && e.kind === 'meta', 30000);
    check('eyes are off by default (the name is not Anorak)', sp.data.eyes === false, `eyes=${sp.data.eyes}`);

    const on = await c.cmd('setEyes', { agentId: id, on: true });
    check('setEyes on', on.ok && on.data?.data?.eyes === true, JSON.stringify(on.data ?? on.error));
    await sleep(200);
    check('snapshot carries eyes', (await c.cmd('listAgents')).data.find((x) => x.id === id)?.eyes === true);
    if (process.env.OASIS_ROSTER) {
      await sleep(300);
      const entry = JSON.parse(fs.readFileSync(process.env.OASIS_ROSTER, 'utf8')).agents.find((x) => x.id === id);
      check('roster keeps eyes', entry?.eyes === true, JSON.stringify(entry));
    }

    // A page that can see but never answers: the message still goes out, after about 1.5 s, as text.
    await c.cmd('canSee', { on: true });
    let asked = 0;
    let answer = false;
    c.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type !== 'eyes.request') return;
      asked += 1;
      if (answer) c.cmd('eyesFrame', { requestId: m.requestId, data: redPng(64, 64).toString('base64'), mediaType: 'image/png' });
    });
    let t0 = Date.now();
    const end1 = c.next((e) => e.agentId === id && e.kind === 'turn.end', 120000).catch(() => null);
    const slow = await c.cmd('send', { agentId: id, text: 'Remember the word PAPAYA. Reply only: OK' });
    const waited = Date.now() - t0;
    const sent1 = c.events.find((e) => e.agentId === id && e.kind === 'user.sent' && e.uuid === slow.data?.uuid);
    check('a page that never answers: the text goes out alone after the timeout', slow.ok && asked === 1 && !sent1?.eyes && waited >= 1300 && waited < 3000, `asked=${asked} waited ${waited} ms eyes=${sent1?.eyes}`);
    await end1;

    answer = true;
    t0 = Date.now();
    const end2 = c.next((e) => e.agentId === id && e.kind === 'turn.end', 120000).catch(() => null);
    const fast = await c.cmd('send', { agentId: id, text: 'A picture is attached to this message. Reply with two words only: the main colour of the picture, then the word I asked you to remember.' });
    const took = Date.now() - t0;
    const sent2 = c.events.find((e) => e.agentId === id && e.kind === 'user.sent' && e.uuid === fast.data?.uuid);
    check('a page that answers: the picture rides with the message', fast.ok && sent2?.eyes === true && took < 1000, `eyes=${sent2?.eyes} in ${took} ms`);
    const e2 = await end2;
    check('the model saw the picture in that same turn', /red/i.test(e2?.result || '') && /papaya/i.test(e2?.result || ''), JSON.stringify(e2?.result));
    const shown = c.events.filter((e) => e.agentId === id && e.kind === 'user').map((e) => e.text);
    check('the thread shows only what the owner said', shown.length > 0 && !shown.some((t) => /Oasis eyes/.test(t)), JSON.stringify(shown.map((t) => t.slice(0, 40))));
    await c.cmd('kill', { agentId: id });
    c.close();
  },

  // [3 turns] One writer per session. X (OASIS_WS) holds a session, Y (OASIS_WS2) is the Oasis and moves it over
  // (same id, X's process stops, X lets go). Then a plain `claude` process opens it again, like the desktop app
  // would, and Y lets go and watches.
  async handoff() {
    const X = await connect(URL_);
    const Y = await connect(process.env.OASIS_WS2 || 'ws://127.0.0.1:4533/ws');
    const opts = { cwd: A, model: 'haiku', permissionMode: 'bypassPermissions', worldTools: false };
    const turnEnd = (c, id) => c.next((e) => e.agentId === id && e.kind === 'turn.end', 120000).catch(() => null);
    const a = (await X.cmd('spawnAgent', { name: 'holder', ...opts })).data;
    await X.next((e) => e.agentId === a.id && e.kind === 'meta', 30000);
    let endX = turnEnd(X, a.id);
    await X.cmd('send', { agentId: a.id, text: 'Remember the word PAPAYA. Reply only: OK' });
    await endX;
    const sid = a.sessionId;

    const refused = await Y.cmd('spawnAgent', { name: 'mover', sessionId: sid, ...opts });
    check('a session held elsewhere is refused without move', !refused.ok, refused.error);
    const exitP = X.next((e) => e.agentId === a.id && e.kind === 'exit', 15000).catch(() => null);
    const moved = await Y.cmd('spawnAgent', { name: 'mover', sessionId: sid, move: true, ...opts });
    check('move: same session id', moved.ok && moved.data.sessionId === sid, moved.ok ? moved.data.sessionId : moved.error);
    check('move: the other holder stopped', !!(await exitP));
    const b = moved.data;
    const endY = turnEnd(Y, b.id);
    await Y.cmd('send', { agentId: b.id, text: 'What word did I ask you to remember? Reply with the word only.' });
    const e2 = await endY;
    check('the moved session remembers the turn made before the move', /papaya/i.test(e2?.result || ''), JSON.stringify(e2?.result));

    const xAgents = (await X.cmd('listAgents')).data;
    check('X let go of the moved session and watches it', !xAgents.some((x) => x.id === a.id) && xAgents.some((x) => x.kind === 'observer' && x.name === 'holder'));

    // "The desktop app": a plain claude process resumes the session and asks something.
    const letGo = Y.next((e) => e.agentId === b.id && e.kind === 'removed', 30000).catch(() => null);
    const desk = spawnClaude(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--permission-mode', 'bypassPermissions', '--resume', sid], { cwd: A });
    const deskResult = new Promise((res) => {
      onLines(desk.stdout, (line) => { try { const m = JSON.parse(line); if (m.type === 'result') res(m.result); } catch { /* ignore */ } });
      setTimeout(() => res(null), 120000);
    });
    desk.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'What did I ask you in my last message, and what did you answer? One short line.' }, parent_tool_use_id: null, session_id: '' }) + '\n');
    check('the Oasis let go when the session was opened elsewhere again', !!(await letGo));
    await sleep(500);
    const obs = (await Y.cmd('listAgents')).data.find((x) => x.kind === 'observer' && x.name === 'mover');
    check('and watches it instead', !!obs);
    const r3 = await deskResult;
    desk.stdin.end();
    check('the reopened session sees the turn made in the Oasis', /papaya/i.test(r3 || ''), JSON.stringify(r3));

    // The transcript must stay one line of conversation: no message with two children.
    const file = findSessionFile(sid, A);
    const kids = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let m; try { m = JSON.parse(line); } catch { continue; }
      if ((m.type !== 'user' && m.type !== 'assistant') || m.isSidechain || !m.parentUuid) continue;
      kids.set(m.parentUuid, (kids.get(m.parentUuid) || 0) + 1);
    }
    const branches = [...kids.values()].filter((n) => n > 1).length;
    check('the transcript did not branch', branches === 0, `${branches} branch point(s) in ${path.basename(file)}`);

    for (const c of [X, Y]) for (const x of (await c.cmd('listAgents')).data) await c.cmd('kill', { agentId: x.id });
    X.close(); Y.close();
  },

  // [0 turns] Spawn agent-a on an existing sandbox session id (resume, no message sent).
  async seed() {
    const c = await connect();
    const sessionId = process.argv[3];
    const r = await c.cmd('spawnAgent', { name: 'agent-a', cwd: A, sessionId, model: 'haiku', permissionMode: 'bypassPermissions' });
    check('spawn as agent from an existing session', r.ok, r.ok ? `resume ${r.data.sessionId}` : r.error);
    await sleep(500);
    c.close();
  },

  async restore() {
    const c = await connect();
    const agents = c.hello.agents.filter((x) => x.kind === 'owned');
    check('agents restored after restart', agents.length > 0, agents.map((x) => `${x.name}:${x.sessionId?.slice(0, 8)} alive=${x.alive}`).join(', '));
    const a = agents.find((x) => x.name === 'agent-a');
    if (a) {
      // get_context_usage on the resumed process: no turn, but proves the history was loaded
      // (a brand-new session in this folder measures ~22k tokens of system prompt + tools).
      const ctxP = c.next((e) => e.agentId === a.id && e.kind === 'context', 15000).catch(() => null);
      await c.cmd('contextUsage', { agentId: a.id });
      const ctx = await ctxP;
      check('resumed agent has prior context loaded', !!ctx && ctx.usedTokens > 30000, ctx ? `${ctx.usedTokens} tokens` : '');
    }
    for (const x of agents) await c.cmd('kill', { agentId: x.id });
    const left = (await c.cmd('listAgents')).data.filter((x) => x.kind === 'owned');
    check('cleanup: no owned agents left', left.length === 0);
    c.close();
  },
};

/** A plain red PNG (zlib is all it takes), standing in for the picture a page would take. */
function redPng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3, 20);
  row[0] = 0; // filter: none
  for (let x = 0; x < width; x += 1) row[1 + x * 3] = 230;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const phase = process.argv[2] || 'basic';
if (!phases[phase]) { console.log('phases:', Object.keys(phases).join(', ')); process.exit(1); }
phases[phase]().then(() => setTimeout(() => process.exit(process.exitCode || 0), 300)).catch((e) => { console.error(e); process.exit(1); });
