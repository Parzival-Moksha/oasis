// The Council's stage: agents on a circle around a point (a campfire), one at a time steps forward, speaks in
// its own voice with lip sync, and steps back. The walking and the speech happen in the Oasis page
// (src/components/village/village-council.ts); this is the door to it. A moderator (Anorak, or the
// scripts/council.mjs helper) calls the `council` command over POST /api/cmd; the engine hands the request to
// one page that said it can stage (`canStage`), and answers when the page reports the step done, so a scene
// can be run as a plain sequence of calls:
//
//   {cmd:'council', action:'start',   agents:['Anorak','Debugger','Tyler'], center:[x,z]?, radius?}
//   {cmd:'council', action:'prepare', agent:'Tyler', text:'…'}   -> {seconds}  the clip is made, its length known, nothing plays
//   {cmd:'council', action:'forward', agent:'Tyler'}             -> when it stands in front
//   {cmd:'council', action:'speak',   agent:'Tyler', text:'…'}   -> when the clip has ended: {seconds, text}
//   {cmd:'council', action:'speak',   agent:'Tyler', next:true}  -> the spoken line of its next reply instead
//   {cmd:'council', action:'back',    agent:'Tyler'}             -> when it is back in its place, facing the fire
//   {cmd:'council', action:'turn',    agent:'Tyler', text|next}  -> forward + speak + back in one call
//   {cmd:'council', action:'stop'}                               -> the voice stops, whoever stands in front steps back
//   {cmd:'council', action:'end'}                                -> everyone walks home
//   {cmd:'council', action:'status'}
//
// One request at a time: the page runs them in the order they arrive, so there is one voice at a time.
import { randomUUID } from 'node:crypto';

export const STAGE_ACTIONS = ['start', 'end', 'forward', 'back', 'speak', 'prepare', 'turn', 'stop', 'status'];
/** How long the engine waits for the page, per action (ms). A spoken line is 400 characters at most. */
export const STAGE_TIMEOUT = { start: 90000, end: 15000, forward: 45000, back: 45000, speak: 150000, prepare: 45000, turn: 240000, stop: 15000, status: 8000 };
/** Waiting for an agent's own next reply can take as long as its turn. */
export const STAGE_NEXT_EXTRA = 300000;

/** An agent by id, or by name (case-insensitive), or by the start of its name when only one agent's name starts so. */
export function resolveStageAgent(ref, agents) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const want = ref.trim().toLowerCase();
  const list = [...agents];
  const exact = list.find((a) => a.id === ref) || list.find((a) => (a.name || '').toLowerCase() === want);
  if (exact) return exact;
  const starts = list.filter((a) => (a.name || '').toLowerCase().startsWith(want));
  return starts.length === 1 ? starts[0] : null;
}

/**
 * @param {{pages: () => Array<{readyState:number, send:(s:string)=>void, canStage?:boolean, stageAt?:number}>, agents: () => Iterable<{id:string,name:string}>, log?: (...a:any[]) => void}} deps
 */
export function createStage(deps) {
  const waiting = new Map(); // requestId -> {resolve, timer, page, action}
  /** The page a running Council is staged on: it keeps the scene until it ends or that page goes away. */
  let scenePage = null;

  /** The page that stages: the one holding the running scene, else the one that said so last. */
  function stagePage() {
    const open = deps.pages().filter((ws) => ws.readyState === 1 && ws.canStage);
    if (scenePage && open.includes(scenePage)) return scenePage;
    scenePage = null;
    return open.sort((a, b) => (b.stageAt || 0) - (a.stageAt || 0))[0] || null;
  }

  /** A page's socket closed: its scene is gone, and whoever waits for it hears so now, not after the timeout. */
  function pageClosed(ws) {
    if (scenePage === ws) scenePage = null;
    for (const [requestId, w] of waiting) {
      if (w.page !== ws) continue;
      clearTimeout(w.timer);
      waiting.delete(requestId);
      w.resolve({ ok: false, error: `council ${w.action}: the Oasis page went away (reloaded or closed) before it was done; the scene has to be started again` });
    }
  }

  function request(msg = {}) {
    const action = String(msg.action || '');
    if (!STAGE_ACTIONS.includes(action)) throw new Error(`council: unknown action "${action}" (use ${STAGE_ACTIONS.join(', ')})`);
    const page = stagePage();
    if (!page) throw new Error('council: no Oasis page is open that can stage (open the Oasis in the village; an older page needs a reload)');
    if (action === 'start') scenePage = page;
    if (action === 'end') scenePage = null;
    const req = { action };
    const all = [...deps.agents()];
    if (action === 'start') {
      const refs = Array.isArray(msg.agents) ? msg.agents : [];
      if (!refs.length) throw new Error('council start: give agents: [names or ids]');
      req.agentIds = refs.map((ref) => {
        const agent = resolveStageAgent(ref, all);
        if (!agent) throw new Error(`council: no agent "${ref}"`);
        return agent.id;
      });
      if (new Set(req.agentIds).size !== req.agentIds.length) throw new Error('council start: an agent is named twice');
      if (Array.isArray(msg.center) && msg.center.length >= 2 && msg.center.every((n) => Number.isFinite(Number(n)))) req.center = [Number(msg.center[0]), Number(msg.center[msg.center.length - 1])];
      if (Number.isFinite(Number(msg.radius)) && Number(msg.radius) > 0) req.radius = Number(msg.radius);
      if (Number.isFinite(Number(msg.step)) && Number(msg.step) > 0) req.step = Number(msg.step);
    }
    if (['forward', 'back', 'speak', 'prepare', 'turn'].includes(action)) {
      const agent = resolveStageAgent(msg.agent ?? msg.agentId, all);
      if (!agent) throw new Error(`council ${action}: no agent "${msg.agent ?? msg.agentId ?? ''}"`);
      req.agentId = agent.id;
    }
    if (['speak', 'prepare', 'turn'].includes(action)) {
      if (typeof msg.text === 'string' && msg.text.trim()) req.text = msg.text.trim().slice(0, 2000);
      else if (msg.next && action !== 'prepare') {
        req.next = true;
        if (Number.isFinite(Number(msg.waitMs))) req.waitMs = Math.max(1000, Math.min(STAGE_NEXT_EXTRA, Number(msg.waitMs)));
      } else throw new Error(`council ${action}: give text, or next:true for the spoken line of its next reply`);
    }
    const requestId = randomUUID();
    const timeoutMs = STAGE_TIMEOUT[action] + (req.next ? (req.waitMs || STAGE_NEXT_EXTRA) : 0);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        resolve({ ok: false, error: `council ${action}: the page did not answer in ${Math.round(timeoutMs / 1000)} s` });
      }, timeoutMs);
      waiting.set(requestId, { resolve, timer, page, action });
      try {
        page.send(JSON.stringify({ type: 'stage.request', requestId, request: req }));
      } catch (e) {
        clearTimeout(timer);
        waiting.delete(requestId);
        resolve({ ok: false, error: `council ${action}: ${e.message}` });
      }
    });
  }

  /** The page's answer: {requestId, ok, data?, error?}. */
  function result({ requestId, ok, data, error } = {}) {
    const w = waiting.get(requestId);
    if (!w) return { ok: true, late: true };
    clearTimeout(w.timer);
    waiting.delete(requestId);
    w.resolve(ok ? { ok: true, data: data ?? {} } : { ok: false, error: typeof error === 'string' && error ? error : 'the page could not do it' });
    return { ok: true };
  }

  return { request, result, stagePage, pageClosed, waiting: () => waiting.size };
}
