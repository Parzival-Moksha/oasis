// One owned agent = one long-lived `claude -p --input-format stream-json` process.
//
// Verified behaviour this class relies on (Claude Code 2.1.316, see README FINDINGS):
// - The process stays alive across turns until stdin closes.
// - A user message written while a turn runs is folded into that turn at the next
//   tool-result boundary; if no boundary is left it runs as the next turn right after
//   the result. --replay-user-messages echoes each message (isReplay:true, same uuid)
//   at the moment the CLI actually takes it in, which is how we track "pending".
// - control_request {subtype:"interrupt"} stops the turn: result error_during_execution,
//   terminal_reason aborted_streaming / aborted_tools. Process stays usable.
// - control_request {subtype:"set_model", model} switches the model for the next turn.
// - control_request {subtype:"apply_flag_settings", settings:{effortLevel}} switches the thinking
//   effort live (null = back to the default). An unknown level is acknowledged but ignored, so
//   the engine reads the result back with {subtype:"get_settings"} (applied.effort). 2.1.318.
// - --permission-prompt-tool stdio routes permission prompts, AskUserQuestion and
//   ExitPlanMode to us as control_request {subtype:"can_use_tool"}.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnClaude, onLines } from './claude.js';
import { Normalizer, STATUS, clipDeep, summarizeTool } from './normalize.js';
import { findSessionFile } from './sessions.js';
import { readHistoryTail } from './history.js';
import { droppedAfterInterrupt, expiredAtResult, interruptApplies, matchReplay } from './pending.js';
import { worldToolsArgs } from './worldtools.js';
import { chromeArgs } from './chrome.js';

const SANDBOX_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sandbox');
const REVIEW_INPUT_MAX = 256 * 1024;
/** Eyes: agents whose name says Anorak see by default; the owner switches it per agent (session panel). */
export const EYES_DEFAULT = /anorak/i;
/** Said next to the picture, so the model knows what it is. Kept out of the thread (normalize.js strips it). */
export const EYES_CAPTION = '[Oasis eyes: what your avatar sees from its desk in the village as the owner says this.]';
/** `claude --effort` levels (2.1.318). Each model lists the ones it takes in initialize's models[].supportedEffortLevels. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Permission prompts show the owner exactly what will run, so the input is not clipped the way
 * feed events are. Only a pathological input (over 256 KB of JSON) gets clipped, and then the
 * clip marker ("… [+N chars]") stays visible to the reviewer.
 */
function reviewInput(input) {
  try {
    if (JSON.stringify(input ?? null).length <= REVIEW_INPUT_MAX) return input;
  } catch { /* fall through */ }
  return clipDeep(input, 20000);
}

function echoText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  return '';
}

export class Agent {
  /**
   * @param {{id:string,name:string,cwd:string,sessionId?:string,model?:string,permissionMode?:string,effort?:string,fork?:boolean,worldTools?:boolean,eyes?:boolean}} spec
   * @param {{emit:(agentId:string, kind:string, payload?:object)=>void, persist:()=>void, log:(...a:any[])=>void, eyes?:(agentId:string)=>Promise<{data:string,mediaType:string}|null>}} hub
   */
  constructor(spec, hub) {
    this.kind = 'owned';
    this.id = spec.id;
    this.name = spec.name;
    this.cwd = spec.cwd;
    this.sessionId = spec.sessionId || null;
    this.model = spec.model || null;
    this.permissionMode = spec.permissionMode || null;
    this.effort = spec.effort || null;
    this.resolvedEffort = null; // what the CLI actually runs with (get_settings applied.effort), e.g. the default when effort is null
    this.fork = !!spec.fork;
    this.forkedFrom = spec.fork ? spec.sessionId || null : null; // until the fork's first turn, sessionId is still the original's
    this.worldTools = spec.worldTools !== false; // the Oasis MCP server (worldtools.js); on unless the roster says false
    // Claude in Chrome (chrome.js): the owner's real browser, every call asking first. Off unless the roster says true.
    this.chrome = spec.chrome === true;
    this.restartPending = false;
    // Eyes: each message from the owner carries a picture from this agent's avatar (send()). Kept in the roster.
    this.eyes = typeof spec.eyes === 'boolean' ? spec.eyes : EYES_DEFAULT.test(this.name || '');
    this.sendChain = Promise.resolve(); // messages go out in the order they were sent, also while one waits for its picture
    this.hub = hub;
    this.proc = null;
    this.status = STATUS.IDLE;
    this.statusReason = 'not started';
    this.lastOutcome = null;
    this.control = new Map(); // request_id -> {resolve, timer}
    this.permissions = new Map(); // request_id -> request (from CLI)
    this.pendingUser = new Map(); // uuid -> {text, sentAt, turnWasRunning}
    this.hostDenied = new Set();
    this.turnRunning = false;
    this.interruptTurn = null; // turn index an interrupt was sent in (it never applies to a later turn)
    this.reqN = 0;
    this.stderrTail = [];
    this.meta = {}; // from initialize: models, account, version
    this.lastContext = null;
    this.killing = false;
    this.norm = new Normalizer(this.id, (kind, payload) => this.onEvent(kind, payload), { mode: 'live' });
    this.norm.ownerCtx = () => ({
      interrupted: interruptApplies(this.interruptTurn, this.turnIndex || 0),
      pendingPermissions: this.permissions.size,
      permissionMode: this.permissionMode,
      hostDenied: this.hostDenied,
    });
  }

  emit(kind, payload = {}) { this.hub.emit(this.id, kind, payload); }

  snapshot() {
    return {
      id: this.id, kind: this.kind, name: this.name, cwd: this.cwd, sessionId: this.sessionId,
      model: this.model, resolvedModel: this.norm.model, permissionMode: this.permissionMode,
      effectivePermissionMode: this.effectivePermissionMode || null, effort: this.effort,
      resolvedEffort: this.resolvedEffort, eyes: this.eyes, chrome: this.chrome, status: this.status, statusReason: this.statusReason, alive: !!this.proc,
      pid: this.proc?.pid || null, pendingUser: this.pendingUser.size,
      permissions: [...this.permissions.values()].map((r) => this.describePermission(r)),
      context: this.lastContext, models: this.meta.models || null,
    };
  }

  rosterEntry() {
    return { id: this.id, name: this.name, cwd: this.cwd, sessionId: this.sessionId, model: this.model, permissionMode: this.permissionMode, effort: this.effort, eyes: this.eyes, ...(this.worldTools ? {} : { worldTools: false }), ...(this.chrome ? { chrome: true } : {}) };
  }

  // ------------------------------------------------------------------ process
  buildArgs() {
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--replay-user-messages', '--forward-subagent-text',
      '--permission-prompt-tool', 'stdio',
    ];
    if (this.model) args.push('--model', this.model);
    if (this.permissionMode) args.push('--permission-mode', this.permissionMode);
    if (this.effort) args.push('--effort', this.effort);
    if (this.worldTools) args.push(...worldToolsArgs({ cwd: this.cwd }));
    if (this.chrome) args.push(...chromeArgs());
    if (this.sessionId) {
      // --resume finds a session by id even from another cwd (verified), so look in every project dir.
      const exists = !!findSessionFile(this.sessionId, this.cwd);
      if (exists) {
        args.push('--resume', this.sessionId);
        if (this.fork) args.push('--fork-session');
      } else {
        // Never-used session (no transcript yet): claim the id instead of resuming it.
        args.push('--session-id', this.sessionId);
      }
    } else {
      this.sessionId = randomUUID();
      args.push('--session-id', this.sessionId);
    }
    return args;
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(this.cwd)) {
      this.setStatus(STATUS.ERROR, `cwd does not exist: ${this.cwd}`);
      this.emit('error', { message: `cwd does not exist: ${this.cwd}` });
      return;
    }
    const args = this.buildArgs();
    if (args.includes('--resume') && !this.historyShown) this.replayHistory();
    this.fork = false; // only fork on the first start
    // Note: with 5.x models TodoWrite is not offered in -p mode (CLAUDE_CODE_ENABLE_TODO_TOOLS=1 did not
    // change that in 2.1.316). Todos arrive as TaskCreate/TaskUpdate calls, which the normalizer maps.
    // SendUserFile is off in -p mode unless the host shows files by path; the Oasis does (files.js, /file/<id>).
    // Checked with 2.1.318: the init tool list gains SendUserFile, and its result lists each validated path.
    const env = { CLAUDE_CODE_ATTACHMENTS_BY_PATH: '1' };
    // Scratch agents live inside the 7c_oasis repo: keep them off the owner's auto-memory.
    if (path.resolve(this.cwd).toLowerCase().startsWith(SANDBOX_ROOT.toLowerCase())) env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    this.hub.log(`[${this.name}] spawn claude ${args.join(' ')} (cwd ${this.cwd})`);
    const proc = spawnClaude(args, { cwd: this.cwd, env });
    this.proc = proc;
    this.killing = false;
    this.stderrTail = [];
    this.turnRunning = false;
    this.pendingUser.clear();
    this.persist();
    onLines(proc.stdout, (line) => this.onLine(line));
    onLines(proc.stderr, (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      this.hub.log(`[${this.name}] stderr: ${line}`);
    });
    proc.on('error', (err) => {
      this.emit('error', { message: `spawn failed: ${err.message}` });
    });
    proc.on('exit', (code, signal) => this.onExit(code, signal));
    this.setStatus(STATUS.IDLE, 'ready');
    // Zero-cost handshake: returns models, account, commands. No API turn is spent.
    this.request('initialize', {}).then(async (r) => {
      if (r?.ok) {
        const d = r.data || {};
        this.meta = {
          models: (d.models || []).map((m) => ({
            value: m.value, resolvedModel: m.resolvedModel, displayName: m.displayName,
            ...(m.supportsEffort ? { supportsEffort: true, supportedEffortLevels: m.supportedEffortLevels || [] } : {}),
          })),
          subscription: d.account?.subscriptionType || null,
          version: d.claude_code_version,
          permissionMode: d.current_permission_mode,
        };
        if (!this.permissionMode && d.current_permission_mode) this.effectivePermissionMode = d.current_permission_mode;
        await this.readEffort();
        this.emit('meta', { models: this.meta.models, subscription: this.meta.subscription, claudeCodeVersion: this.meta.version, permissionMode: d.current_permission_mode, resolvedEffort: this.resolvedEffort });
      }
    });
  }

  /** The effort the process runs with right now (zero cost). undefined when the CLI could not say. */
  async readEffort() {
    const s = await this.request('get_settings', {}, 10000);
    if (!s.ok) return undefined;
    this.resolvedEffort = s.data?.applied?.effort ?? null;
    return this.resolvedEffort;
  }

  /** Show the resumed conversation's recent past in the feed (read from the transcript, no API call). */
  replayHistory() {
    this.historyShown = true;
    const file = findSessionFile(this.sessionId, this.cwd);
    if (!file) return;
    try {
      // The last 256 KB. Each event keeps its line's offset (`at`), so the page can load what came before (history.js).
      for (const event of readHistoryTail(file, this.id, 256 * 1024)) {
        const { v: _v, agentId: _agentId, ts: _ts, kind, ...payload } = event;
        this.emit(kind, payload);
      }
      this.emit('notice', { subtype: 'history', text: `resumed ${this.sessionId.slice(0, 8)}: history above is from the transcript` });
    } catch (e) {
      this.hub.log(`[${this.name}] history replay failed: ${e.message}`);
    }
  }

  onExit(code, signal) {
    const wasKilling = this.killing;
    this.proc = null;
    for (const [, c] of this.control) { clearTimeout(c.timer); c.resolve({ ok: false, error: 'process exited' }); }
    this.control.clear();
    for (const id of this.permissions.keys()) this.emit('permission.resolved', { requestId: id, behavior: 'cancelled' });
    this.permissions.clear();
    this.pendingUser.clear();
    this.turnRunning = false;
    // Background subagents live inside this process: they stopped with it.
    this.norm.endOpenSubagents('stopped', 'the agent process stopped');
    this.emit('exit', { code, signal, stderr: wasKilling ? undefined : this.stderrTail.slice(-5) });
    if (wasKilling || code === 0) this.setStatus(STATUS.IDLE, wasKilling ? 'stopped' : 'exited');
    else this.setStatus(STATUS.ERROR, `claude exited (code ${code}${signal ? ', ' + signal : ''})`);
    // A switch that changes the start arguments (Chrome): come back with them, same session.
    if (this.restartPending) {
      this.restartPending = false;
      setTimeout(() => { if (!this.proc) this.start(); }, 300);
    }
  }

  write(obj) {
    if (!this.proc) throw new Error('agent process not running');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Send a control_request and await its control_response. */
  request(subtype, fields = {}, timeoutMs = 20000) {
    if (!this.proc) return Promise.resolve({ ok: false, error: 'not running' });
    const request_id = `oasis_${++this.reqN}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.control.delete(request_id); resolve({ ok: false, error: 'timeout' }); }, timeoutMs);
      this.control.set(request_id, { resolve, timer, subtype });
      try { this.write({ type: 'control_request', request_id, request: { subtype, ...fields } }); }
      catch (e) { clearTimeout(timer); this.control.delete(request_id); resolve({ ok: false, error: e.message }); }
    });
  }

  // ------------------------------------------------------------------ stdout
  onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this.hub.log(`[${this.name}] non-JSON stdout: ${line.slice(0, 200)}`); return; }
    switch (msg.type) {
      case 'control_response': return this.onControlResponse(msg.response || {});
      case 'control_request': return this.onControlRequest(msg);
      case 'control_cancel_request': return this.onControlCancel(msg.request_id);
      default: break;
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      this.turnRunning = true;
      this.turnIndex = (this.turnIndex || 0) + 1;
      if (msg.session_id && msg.session_id !== this.sessionId) { this.sessionId = msg.session_id; this.persist(); }
      this.effectivePermissionMode = msg.permissionMode;
      this.setStatus(STATUS.WORKING, 'turn started');
    }
    if (msg.type === 'user' && msg.isReplay) this.onReplay(msg);
    this.norm.handleStream(msg);
    if (msg.type === 'result') this.afterResult();
  }

  onControlResponse(r) {
    const c = this.control.get(r.request_id);
    if (!c) return;
    clearTimeout(c.timer);
    this.control.delete(r.request_id);
    if (r.subtype === 'success') c.resolve({ ok: true, data: r.response || {} });
    else c.resolve({ ok: false, error: r.error || 'error' });
  }

  onControlRequest(msg) {
    const req = msg.request || {};
    if (req.subtype === 'can_use_tool') {
      const entry = { requestId: msg.request_id, ...req, receivedAt: Date.now() };
      this.permissions.set(msg.request_id, entry);
      this.emit('permission.request', this.describePermission(entry));
      this.setStatus(STATUS.DECISION, req.tool_name === 'AskUserQuestion' ? 'question' : req.tool_name === 'ExitPlanMode' ? 'plan' : 'permission');
      return;
    }
    // Anything else the CLI might ask a host (hook callbacks, MCP, dialogs) is unsupported here.
    try {
      this.write({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: `Oasis host does not handle ${req.subtype}` } });
    } catch { /* process gone */ }
  }

  onControlCancel(requestId) {
    if (this.permissions.delete(requestId)) {
      this.emit('permission.resolved', { requestId, behavior: 'cancelled' });
      this.recomputeStatus();
    }
  }

  describePermission(r) {
    const requestKind = r.tool_name === 'AskUserQuestion' ? 'question' : r.tool_name === 'ExitPlanMode' ? 'plan' : 'permission';
    return {
      requestId: r.requestId, requestKind, toolName: r.tool_name, toolUseId: r.tool_use_id,
      input: reviewInput(r.input), summary: summarizeTool(r.tool_name, r.input), description: r.description || null,
      suggestions: r.permission_suggestions || [], blockedPath: r.blocked_path || null,
      decisionReason: r.decision_reason || null,
    };
  }

  onReplay(msg) {
    // Match the echo to the message(s) we sent: same uuid, else every pending text it contains
    // (the CLI can merge queued messages). No match = a CLI-generated echo (e.g. set_model's).
    for (const key of matchReplay(this.pendingUser, { uuid: msg.uuid, text: echoText(msg.message?.content) })) {
      const p = this.pendingUser.get(key);
      this.pendingUser.delete(key);
      // folded = taken into the turn that was already running when we sent it (not a new turn).
      const folded = p.turnWasRunning && p.turnIndex === this.turnIndex;
      this.emit('user.consumed', { uuid: key, folded, waitedMs: Date.now() - p.sentAt });
    }
  }

  /** Forget a pending message that will never be echoed, so the agent cannot stay `working` forever. */
  dropPending(key, reason) {
    const p = this.pendingUser.get(key);
    if (!p) return;
    this.pendingUser.delete(key);
    this.emit('user.consumed', { uuid: key, folded: false, waitedMs: Date.now() - p.sentAt, dropped: reason });
  }

  afterResult() {
    this.turnRunning = false;
    for (const key of expiredAtResult(this.pendingUser, this.turnIndex || 0)) this.dropPending(key, 'expired');
    this.interruptTurn = null;
    this.hostDenied.clear();
    // Zero-cost context meter after each turn.
    this.refreshContext();
    this.recomputeStatus();
    // Chrome was switched during the turn: restart now that it is over (unless more messages wait).
    if (this.restartPending && !this.pendingUser.size) this.kill();
  }

  onEvent(kind, payload) {
    if (kind === 'turn.end') this.lastOutcome = payload;
    this.emit(kind, payload);
  }

  async refreshContext() {
    const r = await this.request('get_context_usage', {}, 10000);
    if (!r.ok) return;
    const d = r.data;
    this.lastContext = { usedTokens: d.totalTokens, maxTokens: d.maxTokens, percent: d.percentage, model: d.model };
    this.emit('context', this.lastContext);
  }

  // ------------------------------------------------------------------ status
  setStatus(status, reason) {
    if (status === this.status && reason === this.statusReason) return;
    this.status = status;
    this.statusReason = reason;
    this.emit('status', { status, reason });
  }

  recomputeStatus() {
    if (!this.proc) return;
    if (this.permissions.size) return this.setStatus(STATUS.DECISION, [...this.permissions.values()][0].tool_name === 'AskUserQuestion' ? 'question' : 'permission');
    if (this.turnRunning) return this.setStatus(STATUS.WORKING, 'turn running');
    if (this.pendingUser.size) return this.setStatus(STATUS.WORKING, `${this.pendingUser.size} queued message(s)`);
    const o = this.lastOutcome;
    if (!o) return this.setStatus(STATUS.IDLE, 'ready');
    if (o.outcome === 'error') return this.setStatus(STATUS.ERROR, o.reason);
    if (o.outcome === 'needs-decision') return this.setStatus(STATUS.DECISION, o.reason);
    return this.setStatus(STATUS.WAITING, o.reason);
  }

  // ------------------------------------------------------------------ commands
  /**
   * A message from the owner. With eyes on, the Oasis page is first asked for a picture from this agent's avatar
   * (hub.eyes: about 1.5 s at most, null when no page answers) and it rides in the same user message as an image
   * block. The text always goes out, with or without the picture, and in the order it was sent.
   */
  send(text, { priority } = {}) {
    if (!text || !text.trim()) return Promise.reject(new Error('empty message'));
    const run = this.sendChain.then(() => this.sendNow(text, { priority }));
    this.sendChain = run.catch(() => {});
    return run;
  }

  async sendNow(text, { priority } = {}) {
    if (!this.proc) this.start();
    if (!this.proc) throw new Error(this.statusReason);
    let picture = null;
    if (this.eyes && this.hub.eyes) {
      try { picture = await this.hub.eyes(this.id); } catch { picture = null; }
      if (!this.proc) throw new Error(this.statusReason || 'agent process not running');
    }
    const uuid = randomUUID();
    const turnWasRunning = this.turnRunning;
    this.pendingUser.set(uuid, { text, sentAt: Date.now(), turnWasRunning, turnIndex: this.turnIndex || 0 });
    const content = picture?.data
      ? [
        { type: 'text', text },
        { type: 'image', source: { type: 'base64', media_type: picture.mediaType || 'image/jpeg', data: picture.data } },
        { type: 'text', text: EYES_CAPTION },
      ]
      : text;
    const msg = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '', uuid };
    if (priority === 'now' || priority === 'later') msg.priority = priority;
    try { this.write(msg); } catch (e) { this.pendingUser.delete(uuid); throw e; }
    this.norm.openTurn();
    this.emit('user.sent', { uuid, text, midTurn: turnWasRunning, priority: msg.priority || 'next', ...(picture?.data ? { eyes: true } : {}) });
    // An open permission / question / plan still blocks the CLI: talking to it doesn't resolve that.
    if (this.permissions.size) this.recomputeStatus();
    else this.setStatus(STATUS.WORKING, turnWasRunning ? 'message queued mid-turn' : 'message sent');
    return { uuid, midTurn: turnWasRunning };
  }

  async interrupt({ cancelQueued = false } = {}) {
    if (!this.proc) return { ok: false, error: 'not running' };
    // Flag the running turn only: a turn that starts after this one is not interrupted by it.
    this.interruptTurn = this.turnRunning ? (this.turnIndex || 0) : null;
    const r = await this.request('interrupt', cancelQueued ? { cancel_queued: true } : {});
    if (r.ok) {
      const drop = cancelQueued ? [...this.pendingUser.keys()] : droppedAfterInterrupt(this.pendingUser, r.data?.still_queued);
      for (const key of drop) this.dropPending(key, cancelQueued ? 'cancelled' : 'dropped by interrupt');
      this.recomputeStatus();
    }
    this.emit('notice', { subtype: 'interrupt', text: r.ok ? `Interrupt sent${r.data?.still_queued?.length ? `, ${r.data.still_queued.length} message(s) still queued` : ''}` : `Interrupt failed: ${r.error}` });
    return r;
  }

  async setModel(model) {
    if (!this.proc) { this.model = model; this.persist(); this.emit('model', { model, applied: 'on next start' }); return { ok: true, data: { model } }; }
    const r = await this.request('set_model', { model });
    if (r.ok) {
      this.model = model;
      this.persist();
      // Another model can run the same effort setting at another level (or none): report what it runs with now.
      await this.readEffort();
      this.emit('model', { model, resolved: r.data?.model, resolvedEffort: this.resolvedEffort });
    }
    return r;
  }

  /**
   * Thinking effort: low | medium | high | xhigh | max, or null / 'default' for the CLI's default.
   * Live through apply_flag_settings (no restart, no turn), also while a turn runs: the next model
   * request uses it. The CLI acknowledges levels it ignores, so the result is read back.
   */
  async setEffort(effort) {
    const level = effort && effort !== 'default' ? String(effort) : null;
    if (level && !EFFORT_LEVELS.includes(level)) return { ok: false, error: `unknown effort "${level}" (use ${EFFORT_LEVELS.join(', ')} or default)` };
    if (!this.proc) {
      this.effort = level;
      this.persist();
      this.emit('effort', { effort: level, applied: 'on next start' });
      return { ok: true, data: { effort: level } };
    }
    const r = await this.request('apply_flag_settings', { settings: { effortLevel: level } });
    if (!r.ok) return r;
    const resolved = await this.readEffort();
    if (level && resolved !== undefined && resolved !== level) {
      return { ok: false, error: `the CLI kept effort ${resolved || 'default'}: ${this.norm.model || this.model || 'this model'} may not take "${level}"` };
    }
    this.effort = level;
    this.persist();
    this.emit('effort', { effort: level, resolvedEffort: this.resolvedEffort });
    return { ok: true, data: { effort: level, resolvedEffort: this.resolvedEffort } };
  }

  /**
   * Claude in Chrome on or off (kept in the roster). The CLI only reads --chrome at start, so the
   * process restarts with the same session: now when idle, after the turn when one runs, and on the
   * next start when it is not running.
   */
  setChrome(on) {
    const chrome = !!on;
    if (chrome === this.chrome && !this.restartPending) return { ok: true, data: { chrome, applied: 'unchanged' } };
    this.chrome = chrome;
    this.persist();
    let applied = 'on next start';
    if (this.proc) {
      this.restartPending = true;
      if (this.turnRunning || this.pendingUser.size) applied = 'after this turn';
      else { applied = 'now'; this.kill(); }
    }
    this.emit('chrome', { chrome, applied });
    return { ok: true, data: { chrome, applied } };
  }

  /** Eyes on or off (kept in the roster). Applies to the next message. */
  setEyes(on) {
    this.eyes = !!on;
    this.persist();
    this.emit('eyes', { eyes: this.eyes });
    return { ok: true, data: { eyes: this.eyes } };
  }

  async setPermissionMode(mode) {
    // `mode` events trigger a snapshot (index.js), so every client's picker follows the change.
    if (!this.proc) { this.permissionMode = mode; this.persist(); this.emit('mode', { permissionMode: mode, applied: 'on next start' }); return { ok: true }; }
    const r = await this.request('set_permission_mode', { mode });
    if (r.ok) {
      this.permissionMode = mode;
      this.effectivePermissionMode = mode;
      this.persist();
      this.emit('mode', { permissionMode: mode });
    }
    return r;
  }

  /**
   * Answer a can_use_tool request.
   * behavior: 'allow' | 'deny'. answers: {questionText: label} for AskUserQuestion.
   * always: apply the CLI's permission_suggestions (e.g. acceptEdits for the session).
   */
  respond(requestId, { behavior, message, answers, always, updatedInput } = {}) {
    const req = this.permissions.get(requestId);
    if (!req) throw new Error(`no pending request ${requestId}`);
    let response;
    if (behavior === 'allow') {
      const input = { ...(updatedInput || req.input || {}) };
      if (answers && req.tool_name === 'AskUserQuestion') input.answers = answers;
      response = { behavior: 'allow', updatedInput: input };
      if (always && req.permission_suggestions?.length) response.updatedPermissions = req.permission_suggestions;
    } else {
      response = { behavior: 'deny', message: message || 'Denied by the owner in the Oasis.' };
      if (req.tool_use_id) this.hostDenied.add(req.tool_use_id);
    }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
    this.permissions.delete(requestId);
    this.emit('permission.resolved', { requestId, behavior, toolName: req.tool_name });
    this.recomputeStatus();
    return { ok: true };
  }

  /** A fork that hasn't had its first turn yet still carries the original session id: someone else may hold that one. */
  forkPending() { return !!this.forkedFrom && this.forkedFrom === this.sessionId; }

  /** now: stop at once (letting go of a session someone else opened), instead of closing stdin and waiting 3 s. */
  kill({ now = false } = {}) {
    if (!this.proc) { this.setStatus(STATUS.IDLE, 'stopped'); return; }
    this.killing = true;
    const proc = this.proc;
    if (now) { proc.kill(); return; }
    try { proc.stdin.end(); } catch { /* ignore */ }
    setTimeout(() => { if (this.proc === proc) proc.kill(); }, 3000);
  }

  persist() { this.hub.persist(); }
}
