// WebSocket smoke test for the Oasis agent engine. Start it first (pnpm dev:engine from the af_oasis root).
//
//   node scripts/smoke.mjs basic     [0 turns]  hello, sessions, spawn + initialize, setModel, observe, hook
//   node scripts/smoke.mjs turns     [3 turns]  mid-turn message + todo, interrupt, AskUserQuestion via host
//   node scripts/smoke.mjs restore   [0 turns]  after a server restart: roster restored + resumed, then cleanup
//
// Only touches packages/oasis-agent-engine/sandbox/* scratch agents. Uses haiku and tiny prompts.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const A = path.join(PKG, 'sandbox', 'agent-a');
const B = path.join(PKG, 'sandbox', 'agent-b');
const URL_ = process.env.OASIS_WS || 'ws://127.0.0.1:4530/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_);
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

const phase = process.argv[2] || 'basic';
if (!phases[phase]) { console.log('phases:', Object.keys(phases).join(', ')); process.exit(1); }
phases[phase]().then(() => setTimeout(() => process.exit(process.exitCode || 0), 300)).catch((e) => { console.error(e); process.exit(1); });
