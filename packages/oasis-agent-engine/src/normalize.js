// Normalize Claude Code output into the Oasis event schema (v1).
//
// Two inputs share one normalizer:
//   - live stream-json stdout messages (owned agents)      -> handleStream(msg)
//   - transcript .jsonl records (observe mode, read-only)  -> handleRecord(rec)
//
// Every event: { v: 1, agentId, ts, kind, ...payload }. Schema: packages/oasis-agent-engine/README.md.

import { attachmentsFromResult, attachmentForReadImage } from './files.js';
import { ENGINE_NOTE } from './voice.js';
import { SCHEDULE_NOTE } from './schedule.js';

export const STATUS = Object.freeze({
  WORKING: 'working',
  WAITING: 'waiting',
  DECISION: 'needs-decision',
  ERROR: 'error',
  IDLE: 'idle',
});

const DECISION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const MAX_AGENT_RUNS = 200;
const MAX_STR = 2000;
const MAX_TODOS = 100;

export function clip(s, n = MAX_STR) {
  if (typeof s !== 'string') return s;
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s;
}

/** Deep-clip long strings so a Write of a big file doesn't flood the socket. */
export function clipDeep(v, n = MAX_STR, depth = 0) {
  if (typeof v === 'string') return clip(v, n);
  if (!v || typeof v !== 'object' || depth > 6) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clipDeep(x, n, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = clipDeep(x, n, depth + 1);
  return out;
}

export function summarizeTool(name, input = {}) {
  const i = input || {};
  const base = (p) => (typeof p === 'string' ? p.split(/[\\/]/).slice(-2).join('/') : '');
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return `${name} ${base(i.file_path || i.notebook_path)}`;
    case 'Bash': case 'PowerShell': return `${name}: ${clip(String(i.command || ''), 120)}`;
    case 'Grep': return `Grep "${clip(String(i.pattern || ''), 60)}"${i.path ? ' in ' + base(i.path) : ''}`;
    case 'Glob': return `Glob ${i.pattern || ''}`;
    case 'WebFetch': return `WebFetch ${i.url || ''}`;
    case 'WebSearch': return `WebSearch "${clip(String(i.query || ''), 80)}"`;
    case 'Agent': case 'Task': return `${name}: ${i.description || i.subagent_type || 'subagent'}`;
    case 'TodoWrite': return `TodoWrite (${(i.todos || []).length} items)`;
    case 'AskUserQuestion': return `Question: ${clip(String(i.questions?.[0]?.question || ''), 120)}`;
    case 'ExitPlanMode': return 'Plan ready for approval';
    case 'ToolSearch': return `ToolSearch ${i.query || ''}`;
    case 'Skill': return `Skill ${i.skill || i.command || ''}`;
    default: {
      const s = JSON.stringify(i);
      return `${name}${s && s !== '{}' ? ' ' + clip(s, 100) : ''}`;
    }
  }
}

export function toolResultText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : typeof b === 'string' ? b : '')).join('\n');
  }
  return JSON.stringify(content);
}

/** The engine's own notes in a user message (the eyes caption, the voice note: voice.js): for the model, not for the thread. */
const EYES_NOTE = ENGINE_NOTE;
/** The who-you-are note inside a text (a message that went to another window through the bridge carries it inline). */
const YOU_NOTE_INLINE = /\s*\[Oasis you: [^\]]*\]/g;
function textOfUserContent(content) {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((b) => b?.type === 'text' && !EYES_NOTE.test(b.text || '')).map((b) => b.text).join('\n')
      : '';
  return text.includes('[Oasis you: ') ? text.replace(YOU_NOTE_INLINE, '') : text;
}

function contextFromUsage(u) {
  if (!u) return null;
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

/**
 * `<task-notification><task-id>…</task-id><tool-use-id>…</tool-use-id><status>completed</status>
 * <summary>…</summary><result>…</result></task-notification>`, the user-role message that reports a
 * background subagent's end (Claude Code 2.1.318). null for any other text.
 */
export function parseTaskNotification(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('<task-notification>')) return null;
  const tag = (name) => {
    const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? m[1].trim() : null;
  };
  return { taskId: tag('task-id'), toolUseId: tag('tool-use-id'), status: tag('status') || 'completed', summary: tag('summary'), result: tag('result') };
}

export class Normalizer {
  // Subagent runs by their agent id (the Agent result's agentId, a background task's task_id), kept after
  // a run ends so SendMessage can resume it: {toolUseId, taskId, description, subagentType}. Bounded.
  agentRuns = new Map();
  // SendMessage tool_use id -> the Agent tool_use id of the subagent it resumed. A resumed run's
  // <task-notification> (and live task events) carry the SendMessage id; the Oasis keeps one entry per subagent.
  runAliases = new Map();

  /**
   * @param {string} agentId
   * @param {(kind: string, payload?: object) => void} emit
   * @param {{mode: 'live'|'observe'}} opts
   */
  constructor(agentId, emit, { mode = 'live' } = {}) {
    this.agentId = agentId;
    this.emit = emit;
    this.mode = mode;
    this.lastInitKey = '';
    this.turn = this.freshTurn();
    this.agentCalls = new Map(); // toolUseId -> {taskId, background, ended}
    this.taskToTool = new Map(); // taskId -> toolUseId (Agent tasks)
    this.taskTodos = new Map(); // TaskCreate/TaskUpdate todo list (id -> item)
    this.toolNames = new Map(); // toolUseId -> tool name
    this.readPaths = new Map(); // toolUseId -> file_path of a Read (an image Read shows the picture)
    this.model = null;
    this.contextTokens = null;
    this.contextWindow = null;
    this.sessionId = null;
  }

  freshTurn() {
    return { open: false, lastText: '', decisionPending: new Map(), denials: [], notices: [], startedAt: null };
  }

  /** Called by the owner when it sends a user message (live) or sees one (observe). */
  openTurn() {
    if (!this.turn.open) {
      this.turn = this.freshTurn();
      this.turn.open = true;
      this.turn.startedAt = Date.now();
    }
  }

  // ---------------------------------------------------------------- live stream
  handleStream(msg) {
    switch (msg.type) {
      case 'system': return this.onSystem(msg);
      case 'assistant':
        this.noteResumes(msg.message, msg.parent_tool_use_id || null);
        return this.onAssistant(msg.message, msg.parent_tool_use_id || null);
      case 'user': return this.onUser(msg);
      case 'stream_event': return this.onStreamEvent(msg);
      case 'result': return this.onResult(msg);
      case 'rate_limit_event': {
        const r = msg.rate_limit_info || {};
        return this.emit('rate_limit', { status: r.status, utilization: r.utilization, resetsAt: r.resetsAt, window: r.rateLimitType });
      }
      default: return undefined;
    }
  }

  onSystem(msg) {
    switch (msg.subtype) {
      case 'init': {
        this.sessionId = msg.session_id;
        this.model = msg.model;
        const key = JSON.stringify([msg.session_id, msg.model, msg.permissionMode, (msg.tools || []).length, (msg.mcp_servers || []).map((s) => s.status)]);
        if (key === this.lastInitKey) return;
        this.lastInitKey = key;
        return this.emit('init', {
          sessionId: msg.session_id,
          model: msg.model,
          permissionMode: msg.permissionMode,
          cwd: msg.cwd,
          tools: msg.tools || [],
          mcpServers: (msg.mcp_servers || []).map((s) => ({ name: s.name, status: s.status })),
          agents: msg.agents || [],
          claudeCodeVersion: msg.claude_code_version,
          apiKeySource: msg.apiKeySource,
        });
      }
      case 'task_started': {
        if (msg.task_type === 'local_agent' && msg.tool_use_id) {
          const toolUseId = this.runAliases.get(msg.tool_use_id) || msg.tool_use_id; // a resumed run: its subagent
          this.taskToTool.set(msg.task_id, toolUseId);
          const c = this.agentCalls.get(toolUseId) || {};
          this.agentCalls.set(toolUseId, { ...c, taskId: msg.task_id, background: !!msg.is_backgrounded });
          if (!c.started) this.startSubagent(toolUseId, { description: msg.description, subagent_type: msg.subagent_type, prompt: msg.prompt }, msg.task_id);
          this.rememberRun(msg.task_id, toolUseId);
        }
        return undefined;
      }
      case 'task_progress': {
        const toolUseId = this.runAliases.get(msg.tool_use_id) || msg.tool_use_id || this.taskToTool.get(msg.task_id);
        if (!toolUseId || !this.agentCalls.has(toolUseId)) return undefined;
        return this.emit('subagent.progress', { toolUseId, taskId: msg.task_id, description: msg.description, lastToolName: msg.last_tool_name, usage: msg.usage });
      }
      case 'task_notification': {
        const toolUseId = this.runAliases.get(msg.tool_use_id) || msg.tool_use_id || this.taskToTool.get(msg.task_id);
        if (toolUseId && this.agentCalls.has(toolUseId)) this.endSubagent(toolUseId, { status: msg.status, summary: msg.summary, usage: msg.usage });
        return undefined;
      }
      case 'permission_denied':
        this.turn.denials.push({ toolName: msg.tool_name, toolUseId: msg.tool_use_id, message: msg.message });
        return this.emit('permission.denied', { toolName: msg.tool_name, toolUseId: msg.tool_use_id, message: msg.message });
      case 'compact_boundary':
        return this.emit('notice', { subtype: 'compact', text: `Context compacted (${msg.compact_metadata?.trigger || 'auto'})`, preTokens: msg.compact_metadata?.pre_tokens });
      case 'api_retry': case 'api_error':
        return this.emit('error', { message: msg.error?.message || msg.message || msg.subtype, retrying: msg.subtype === 'api_retry' });
      case 'model_fallback': case 'model_refusal_fallback': case 'model_consent_fallback': case 'model_refusal_no_fallback': {
        const n = { subtype: msg.subtype, text: msg.message || msg.subtype, model: msg.model || msg.fallback_model };
        this.turn.notices.push(n);
        return this.emit('notice', n);
      }
      default:
        return undefined;
    }
  }

  onStreamEvent(msg) {
    const e = msg.event;
    if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
      this.emit('text.delta', { messageId: msg.api_message_id || null, index: e.index, text: e.delta.text, parentToolUseId: msg.parent_tool_use_id || null });
    }
  }

  onAssistant(message, parentToolUseId) {
    if (!message) return;
    const blocks = Array.isArray(message.content) ? message.content : [];
    if (!parentToolUseId) {
      if (message.model && message.model !== '<synthetic>') this.model = message.model;
      const ctx = contextFromUsage(message.usage);
      if (ctx) this.contextTokens = ctx;
    }
    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        if (!parentToolUseId) this.turn.lastText = b.text;
        this.emit('text', { messageId: message.id || null, text: b.text, parentToolUseId, model: message.model });
      } else if (b.type === 'tool_use') {
        this.toolNames.set(b.id, b.name);
        if (b.name === 'Read' && typeof b.input?.file_path === 'string') this.readPaths.set(b.id, b.input.file_path);
        this.emit('tool.start', { toolUseId: b.id, name: b.name, input: clipDeep(b.input), summary: summarizeTool(b.name, b.input), parentToolUseId });
        if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
          this.emit('todo', { source: 'TodoWrite', todos: b.input.todos.map((t) => ({ content: t.content, status: t.status, activeForm: t.activeForm })), parentToolUseId });
        } else if (b.name === 'TaskCreate' || b.name === 'TaskUpdate') {
          this.onTaskTool(b);
        } else if (AGENT_TOOLS.has(b.name) && !parentToolUseId) {
          this.startSubagent(b.id, b.input || {});
        } else if (DECISION_TOOLS.has(b.name) && !parentToolUseId) {
          this.turn.decisionPending.set(b.id, b.name);
        }
      }
    }
  }

  onTaskTool(b) {
    if (b.name === 'TaskCreate') {
      this.taskTodos.set(b.id, { content: b.input?.subject || '', status: 'pending', activeForm: b.input?.activeForm });
      // Bounded: drop the oldest completed tasks first, then the oldest of any kind.
      while (this.taskTodos.size > MAX_TODOS) {
        const done = [...this.taskTodos].find(([, t]) => t.status === 'completed');
        this.taskTodos.delete(done ? done[0] : this.taskTodos.keys().next().value);
      }
    } else {
      const t = this.taskTodos.get(b.input?.taskId);
      if (t) {
        if (b.input.status === 'deleted') this.taskTodos.delete(b.input.taskId);
        else Object.assign(t, { status: b.input.status || t.status, content: b.input.subject || t.content });
      }
    }
    this.emit('todo', { source: 'Task', todos: [...this.taskTodos.values()] });
  }

  startSubagent(toolUseId, input, taskId) {
    const c = this.agentCalls.get(toolUseId) || {};
    if (c.started) return;
    const description = input.description || c.description || '';
    const subagentType = input.subagent_type || c.subagentType || 'general-purpose';
    this.agentCalls.set(toolUseId, { ...c, started: true, taskId: taskId || c.taskId, background: c.background ?? input.run_in_background !== false, description, subagentType });
    this.emit('subagent.start', { toolUseId, taskId: taskId || c.taskId || null, description, subagentType, prompt: clip(input.prompt || '', 600), model: input.model || null });
  }

  endSubagent(toolUseId, { status, summary, usage }) {
    const c = this.agentCalls.get(toolUseId);
    if (!c || c.ended) return;
    c.ended = true;
    this.emit('subagent.end', { toolUseId, taskId: c.taskId || null, status: status || 'completed', summary: clip(summary || '', 600), usage: usage || null });
    // Ended: later task_progress / task_notification for it are ignored, so the bookkeeping can go.
    // (agentRuns keeps what a SendMessage needs to resume it.)
    this.agentCalls.delete(toolUseId);
    if (c.taskId) this.taskToTool.delete(c.taskId);
    for (const [alias, target] of this.runAliases) if (target === toolUseId) this.runAliases.delete(alias);
  }

  /** The process is gone (stopped, restarted, moved away): its subagents went with it. */
  endOpenSubagents(status = 'stopped', summary = '') {
    for (const [toolUseId, c] of [...this.agentCalls]) if (c.started && !c.ended) this.endSubagent(toolUseId, { status, summary });
  }

  /** Remember a subagent run by its agent id (= a background task's id), so SendMessage {to: id} can resume it. */
  rememberRun(agentId, toolUseId) {
    if (!agentId || !toolUseId) return;
    const c = this.agentCalls.get(toolUseId) || {};
    const known = this.agentRuns.get(agentId) || {};
    this.agentRuns.delete(agentId); // re-insert: the map's order is recency, for the bound below
    this.agentRuns.set(agentId, {
      toolUseId, taskId: c.taskId || known.taskId || agentId,
      description: c.description || known.description || '', subagentType: c.subagentType || known.subagentType || null,
    });
    while (this.agentRuns.size > MAX_AGENT_RUNS) this.agentRuns.delete(this.agentRuns.keys().next().value);
  }

  /** Agent tool results name the subagent: {agentId, status:"async_launched"|"completed", ...}. */
  noteAgentResults(content, toolUseResult) {
    if (!toolUseResult || typeof toolUseResult !== 'object' || !toolUseResult.agentId) return;
    const block = content.find((b) => b?.type === 'tool_result' && this.agentCalls.has(b.tool_use_id));
    if (block) this.rememberRun(String(toolUseResult.agentId), block.tool_use_id);
  }

  /**
   * SendMessage {to: <agent id>} wakes a subagent up again. A finished one runs again under its old entry
   * (subagent.start with resumed:true); a running one just gets the message. Either way its next
   * notification carries the SendMessage's id, which runAliases maps back to the subagent.
   */
  noteResumes(message, parentToolUseId) {
    if (parentToolUseId || !Array.isArray(message?.content)) return;
    for (const b of message.content) {
      if (b?.type !== 'tool_use' || b.name !== 'SendMessage') continue;
      const run = this.agentRuns.get(String(b.input?.to || ''));
      if (!run) continue;
      this.runAliases.set(b.id, run.toolUseId);
      while (this.runAliases.size > MAX_AGENT_RUNS) this.runAliases.delete(this.runAliases.keys().next().value);
      if (this.agentCalls.get(run.toolUseId)?.started) continue; // still running
      this.agentCalls.set(run.toolUseId, { started: true, taskId: run.taskId, background: true, description: run.description, subagentType: run.subagentType });
      if (run.taskId) this.taskToTool.set(run.taskId, run.toolUseId);
      this.emit('subagent.start', {
        toolUseId: run.toolUseId, taskId: run.taskId || null, description: run.description, subagentType: run.subagentType || 'general-purpose',
        prompt: clip(typeof b.input?.message === 'string' ? b.input.message : '', 600), resumed: true,
      });
    }
  }

  onUser(msg) {
    const content = msg.message?.content;
    const parentToolUseId = msg.parent_tool_use_id || null;
    if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
      if (!parentToolUseId) this.noteAgentResults(content, msg.tool_use_result ?? msg.toolUseResult);
      for (const b of content) if (b?.type === 'tool_result') this.onToolResult(b, msg.tool_use_result ?? msg.toolUseResult, parentToolUseId);
      return;
    }
    if (parentToolUseId) return; // subagent's own prompt; already in subagent.start
    const text = textOfUserContent(content);
    if (!text) return;
    // A background subagent finished (or a resumed one stopped again): the CLI tells the model with a
    // user-role <task-notification>. Not the owner talking: it ends the subagent, and the model takes a turn on it.
    const note = parseTaskNotification(text);
    if (note) {
      const toolUseId = this.runAliases.get(note.toolUseId) || note.toolUseId || this.agentRuns.get(note.taskId)?.toolUseId;
      if (toolUseId && this.agentCalls.has(toolUseId)) this.endSubagent(toolUseId, { status: note.status, summary: note.summary || note.result });
      this.openTurn();
      // Still in the thread: the Oasis folds it into a closed "Subagent finished" pill (village-thread.ts).
      this.emit('user', { text: clip(text, 4000), uuid: msg.uuid || null, replay: !!msg.isReplay });
      return;
    }
    if (/^\[Request interrupted by user/.test(text)) return this.emit('notice', { subtype: 'interrupted', text });
    if (text.startsWith('<local-command-stdout>')) return this.emit('notice', { subtype: 'local-command', text: text.replace(/<\/?local-command-stdout>/g, '') });
    if (msg.isMeta || text.startsWith('<command-') || text.startsWith('<system-reminder>')) return;
    this.openTurn();
    // A wake-up from the agent's schedule (schedule.js): the note is hidden, the thread tags the message instead.
    const scheduled = Array.isArray(content) ? content.map((b) => (b?.type === 'text' ? SCHEDULE_NOTE.exec(b.text || '') : null)).find(Boolean)?.[1] : null;
    this.emit('user', { text: clip(text, 4000), uuid: msg.uuid || null, replay: !!msg.isReplay, ...(scheduled ? { scheduled: scheduled.split(/, (?:due |\d\d:\d\d)/)[0] } : {}) });
  }

  onToolResult(b, toolUseResult, parentToolUseId) {
    const name = this.toolNames.get(b.tool_use_id);
    const output = toolResultText(b.content);
    // SendUserFile: the files the agent showed the owner, each with an id for GET /file/<id> (files.js).
    // Read of a picture: its result is an image block ("[image]" as text), so the file itself is shown.
    const readPath = this.readPaths.get(b.tool_use_id);
    const readImage = name === 'Read' && !b.is_error && readPath && Array.isArray(b.content) && b.content.some((x) => x?.type === 'image');
    const attachments = name === 'SendUserFile' && !b.is_error ? attachmentsFromResult(toolUseResult)
      : readImage ? attachmentForReadImage(readPath) : [];
    this.emit('tool.end', {
      toolUseId: b.tool_use_id, name: name || null, isError: !!b.is_error, output: clip(output, 1500), parentToolUseId,
      ...(attachments.length ? { attachments } : {}),
    });
    if (this.turn.decisionPending.has(b.tool_use_id)) this.turn.decisionPending.delete(b.tool_use_id);
    if (name === 'TaskCreate' && toolUseResult?.task?.id) {
      const t = this.taskTodos.get(b.tool_use_id);
      if (t) { this.taskTodos.delete(b.tool_use_id); this.taskTodos.set(String(toolUseResult.task.id), t); }
    }
    const call = this.agentCalls.get(b.tool_use_id);
    if (call && !call.ended) {
      // Foreground agents end here; backgrounded ones end on task_notification.
      const backgroundAck = toolUseResult && typeof toolUseResult === 'object' && /async|background/i.test(String(toolUseResult.status || ''));
      if (!backgroundAck) this.endSubagent(b.tool_use_id, { status: b.is_error ? 'failed' : (toolUseResult?.status || 'completed'), summary: output, usage: toolUseResult?.usage || null });
    }
    // The name was only needed until the result; long sessions would otherwise keep every id forever.
    this.toolNames.delete(b.tool_use_id);
    this.readPaths.delete(b.tool_use_id);
  }

  /** Derive the turn outcome. `ctx` comes from the owner (pending permission prompts, interrupt). */
  outcome(ctx = {}) {
    const t = this.turn;
    if (ctx.interrupted) return { outcome: 'done-waiting', reason: 'interrupted' };
    if (ctx.isError) return { outcome: 'error', reason: ctx.errorReason || 'error' };
    if (ctx.pendingPermissions > 0) return { outcome: 'needs-decision', reason: 'permission' };
    const pendingTools = [...t.decisionPending.values()];
    if (pendingTools.includes('ExitPlanMode')) return { outcome: 'needs-decision', reason: 'plan' };
    if (pendingTools.includes('AskUserQuestion')) return { outcome: 'needs-decision', reason: 'question' };
    const denials = ctx.denials?.length ? ctx.denials : t.denials;
    if (denials.length) {
      const plan = denials.some((d) => (d.toolName || d.tool_name) === 'ExitPlanMode');
      const ask = denials.some((d) => (d.toolName || d.tool_name) === 'AskUserQuestion');
      return { outcome: 'needs-decision', reason: plan ? 'plan' : ask ? 'question' : 'permission-denied' };
    }
    if (ctx.permissionMode === 'plan' && /plan/i.test(t.lastText)) return { outcome: 'needs-decision', reason: 'plan' };
    if (/\?\s*(\*\*)?\s*$/.test(t.lastText.trim())) return { outcome: 'needs-decision', reason: 'question-text' };
    return { outcome: 'done-waiting', reason: 'end_turn' };
  }

  onResult(r) {
    // Per-turn usage lives in model_usage_since_last_result; total_cost_usd is cumulative per process.
    const since = r.model_usage_since_last_result || {};
    let costUsd = 0;
    for (const m of Object.values(since)) costUsd += m.costUSD || 0;
    const modelUsage = r.modelUsage || {};
    const cw = modelUsage[this.model]?.contextWindow || Object.values(modelUsage)[0]?.contextWindow || null;
    if (cw) this.contextWindow = cw;
    // ownerCtx (set by the live Agent): { interrupted, pendingPermissions, permissionMode, hostDenied: Set }
    const ctx = this.ownerCtx ? this.ownerCtx() : {};
    // The result itself says when a turn was aborted (interrupt during generation or a tool), even if
    // the owner's flag was raised for another turn. An interrupt is not an error.
    const interrupted = !!ctx.interrupted || /^aborted/.test(String(r.terminal_reason || ''));
    const allDenials = (r.permission_denials || []).map((d) => ({ toolName: d.tool_name, toolUseId: d.tool_use_id }));
    // A denial the owner clicked in the Oasis is already decided; only auto-denials still need the owner.
    const openDenials = allDenials.filter((d) => !ctx.hostDenied?.has(d.toolUseId));
    const derived = this.outcome({
      ...ctx,
      interrupted,
      isError: !!r.is_error && !interrupted,
      errorReason: r.subtype,
      denials: openDenials,
    });
    if (!openDenials.length) this.turn.denials = this.turn.denials.filter((d) => !ctx.hostDenied?.has(d.toolUseId));
    const ev = {
      subtype: r.subtype,
      isError: !!r.is_error && !interrupted,
      ...derived,
      result: clip(r.result || '', 2000),
      durationMs: r.duration_ms,
      durationApiMs: r.duration_api_ms,
      numTurns: r.num_turns,
      usage: r.usage ? {
        input: r.usage.input_tokens, output: r.usage.output_tokens,
        cacheRead: r.usage.cache_read_input_tokens, cacheCreation: r.usage.cache_creation_input_tokens,
      } : null,
      costUsd: Number(costUsd.toFixed(6)),
      totalCostUsd: r.total_cost_usd,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      model: this.model,
      permissionDenials: allDenials,
      terminalReason: r.terminal_reason || null,
      stopReason: r.stop_reason || null,
      errors: r.errors || undefined,
      notices: this.turn.notices.length ? this.turn.notices : undefined,
    };
    this.turn.open = false;
    this.emit('turn.end', ev);
    return ev;
  }

  // ---------------------------------------------------------------- transcript (.jsonl) records
  handleRecord(rec) {
    if (!rec || rec.isSidechain) return undefined;
    switch (rec.type) {
      case 'user': {
        if (rec.cwd && !this.cwd) this.cwd = rec.cwd;
        if (rec.sessionId) this.sessionId = rec.sessionId;
        return this.onUser({ message: rec.message, uuid: rec.uuid, isMeta: rec.isMeta, toolUseResult: rec.toolUseResult });
      }
      case 'assistant':
        if (rec.message?.model === '<synthetic>') return undefined;
        this.noteResumes(rec.message, null);
        return this.onAssistant(rec.message, null);
      case 'system':
        if (rec.subtype === 'stop_hook_summary' || rec.subtype === 'turn_duration') return this.recordTurnEnd(rec);
        if (rec.subtype === 'api_error') return this.emit('error', { message: rec.content || rec.error?.message || 'API error' });
        if (rec.subtype === 'compact_boundary') return this.emit('notice', { subtype: 'compact', text: 'Context compacted' });
        return undefined;
      case 'custom-title': case 'agent-name': case 'summary': {
        const title = rec.customTitle || rec.agentName || rec.summary;
        if (!title || title === this.title) return undefined;
        this.title = title;
        return this.emit('meta', { title });
      }
      default: return undefined;
    }
  }

  recordTurnEnd(rec) {
    if (!this.turn.open) return undefined;
    const derived = this.outcome({});
    this.turn.open = false;
    return this.emit('turn.end', {
      subtype: 'observed',
      isError: false,
      ...derived,
      result: clip(this.turn.lastText, 2000),
      durationMs: rec.durationMs ?? null,
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      model: this.model,
      observed: true,
    });
  }
}
