// Normalize Claude Code output into the Oasis event schema (v1).
//
// Two inputs share one normalizer:
//   - live stream-json stdout messages (owned agents)      -> handleStream(msg)
//   - transcript .jsonl records (observe mode, read-only)  -> handleRecord(rec)
//
// Every event: { v: 1, agentId, ts, kind, ...payload }. Schema: packages/oasis-agent-engine/README.md.

export const STATUS = Object.freeze({
  WORKING: 'working',
  WAITING: 'waiting',
  DECISION: 'needs-decision',
  ERROR: 'error',
  IDLE: 'idle',
});

const DECISION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const MAX_STR = 2000;

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

function textOfUserContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  return '';
}

function contextFromUsage(u) {
  if (!u) return null;
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

export class Normalizer {
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
      case 'assistant': return this.onAssistant(msg.message, msg.parent_tool_use_id || null);
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
          this.taskToTool.set(msg.task_id, msg.tool_use_id);
          const c = this.agentCalls.get(msg.tool_use_id) || {};
          this.agentCalls.set(msg.tool_use_id, { ...c, taskId: msg.task_id, background: !!msg.is_backgrounded });
          if (!c.started) this.startSubagent(msg.tool_use_id, { description: msg.description, subagent_type: msg.subagent_type, prompt: msg.prompt }, msg.task_id);
        }
        return undefined;
      }
      case 'task_progress': {
        const toolUseId = msg.tool_use_id || this.taskToTool.get(msg.task_id);
        if (!toolUseId || !this.agentCalls.has(toolUseId)) return undefined;
        return this.emit('subagent.progress', { toolUseId, taskId: msg.task_id, description: msg.description, lastToolName: msg.last_tool_name, usage: msg.usage });
      }
      case 'task_notification': {
        const toolUseId = msg.tool_use_id || this.taskToTool.get(msg.task_id);
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
    this.agentCalls.set(toolUseId, { ...c, started: true, taskId: taskId || c.taskId, background: c.background ?? input.run_in_background !== false });
    this.emit('subagent.start', { toolUseId, taskId: taskId || c.taskId || null, description: input.description || '', subagentType: input.subagent_type || 'general-purpose', prompt: clip(input.prompt || '', 600), model: input.model || null });
  }

  endSubagent(toolUseId, { status, summary, usage }) {
    const c = this.agentCalls.get(toolUseId);
    if (!c || c.ended) return;
    c.ended = true;
    this.emit('subagent.end', { toolUseId, taskId: c.taskId || null, status: status || 'completed', summary: clip(summary || '', 600), usage: usage || null });
  }

  onUser(msg) {
    const content = msg.message?.content;
    const parentToolUseId = msg.parent_tool_use_id || null;
    if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
      for (const b of content) if (b?.type === 'tool_result') this.onToolResult(b, msg.tool_use_result ?? msg.toolUseResult, parentToolUseId);
      return;
    }
    if (parentToolUseId) return; // subagent's own prompt; already in subagent.start
    const text = textOfUserContent(content);
    if (!text) return;
    if (/^\[Request interrupted by user/.test(text)) return this.emit('notice', { subtype: 'interrupted', text });
    if (text.startsWith('<local-command-stdout>')) return this.emit('notice', { subtype: 'local-command', text: text.replace(/<\/?local-command-stdout>/g, '') });
    if (msg.isMeta || text.startsWith('<command-') || text.startsWith('<system-reminder>')) return;
    this.openTurn();
    this.emit('user', { text: clip(text, 4000), uuid: msg.uuid || null, replay: !!msg.isReplay });
  }

  onToolResult(b, toolUseResult, parentToolUseId) {
    const name = this.toolNames.get(b.tool_use_id);
    const output = toolResultText(b.content);
    this.emit('tool.end', { toolUseId: b.tool_use_id, name: name || null, isError: !!b.is_error, output: clip(output, 1500), parentToolUseId });
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
    const allDenials = (r.permission_denials || []).map((d) => ({ toolName: d.tool_name, toolUseId: d.tool_use_id }));
    // A denial the owner clicked in the Oasis is already decided; only auto-denials still need the owner.
    const openDenials = allDenials.filter((d) => !ctx.hostDenied?.has(d.toolUseId));
    const derived = this.outcome({
      ...ctx,
      isError: !!r.is_error && !ctx.interrupted,
      errorReason: r.subtype,
      denials: openDenials,
    });
    if (!openDenials.length) this.turn.denials = this.turn.denials.filter((d) => !ctx.hostDenied?.has(d.toolUseId));
    const ev = {
      subtype: r.subtype,
      isError: !!r.is_error,
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
