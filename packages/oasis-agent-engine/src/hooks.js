// Optional third observation path: Claude Code hooks with `type: "http"` POST their event JSON
// to /hook. We map them onto the same event schema. Answering `{}` means "no decision", so the
// hooked session behaves exactly as without the hook. Demo config:
// packages/oasis-agent-engine/sandbox/agent-b/.claude/settings.json (project-level, never the owner's global settings).
import { STATUS, clip, clipDeep, summarizeTool, toolResultText } from './normalize.js';

/** @returns {{events: Array<[string, object]>, status?: [string, string]}} */
export function mapHook(h) {
  const ev = [];
  let status;
  const name = h.hook_event_name;
  switch (name) {
    case 'SessionStart':
      ev.push(['init', { sessionId: h.session_id, cwd: h.cwd, model: h.model || null, source: h.source, viaHook: true }]);
      status = [STATUS.IDLE, `session ${h.source || 'start'}`];
      break;
    case 'UserPromptSubmit':
      ev.push(['user', { text: clip(String(h.prompt || ''), 4000) }]);
      status = [STATUS.WORKING, 'prompt'];
      break;
    case 'PreToolUse': {
      ev.push(['tool.start', { toolUseId: h.tool_use_id || null, name: h.tool_name, input: clipDeep(h.tool_input), summary: summarizeTool(h.tool_name, h.tool_input) }]);
      if (h.tool_name === 'TodoWrite' && Array.isArray(h.tool_input?.todos)) ev.push(['todo', { source: 'TodoWrite', todos: h.tool_input.todos }]);
      if (h.tool_name === 'Agent' || h.tool_name === 'Task') ev.push(['subagent.start', { toolUseId: h.tool_use_id || null, description: h.tool_input?.description, subagentType: h.tool_input?.subagent_type }]);
      status = [STATUS.WORKING, h.tool_name];
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const out = typeof h.tool_response === 'string' ? h.tool_response : toolResultText(h.tool_response?.content ?? h.tool_response);
      ev.push(['tool.end', { toolUseId: h.tool_use_id || null, name: h.tool_name, isError: name === 'PostToolUseFailure', output: clip(out || '', 1500) }]);
      break;
    }
    case 'PermissionRequest':
      ev.push(['permission.request', { requestId: null, requestKind: h.tool_name === 'AskUserQuestion' ? 'question' : h.tool_name === 'ExitPlanMode' ? 'plan' : 'permission', toolName: h.tool_name, input: clipDeep(h.tool_input), summary: summarizeTool(h.tool_name, h.tool_input), readOnly: true }]);
      status = [STATUS.DECISION, 'permission'];
      break;
    case 'Notification': {
      const t = h.notification_type || '';
      ev.push(['notice', { subtype: t || 'notification', text: h.message || t }]);
      if (/permission|needs_input|elicitation/.test(t)) status = [STATUS.DECISION, t];
      else if (/idle/.test(t)) status = [STATUS.WAITING, t];
      break;
    }
    case 'Stop': {
      const text = String(h.last_assistant_message || '');
      const question = /\?\s*$/.test(text.trim());
      ev.push(['turn.end', { subtype: 'hook', outcome: question ? 'needs-decision' : 'done-waiting', reason: question ? 'question-text' : 'end_turn', result: clip(text, 2000), viaHook: true }]);
      status = question ? [STATUS.DECISION, 'question-text'] : [STATUS.WAITING, 'end_turn'];
      break;
    }
    case 'SubagentStart':
      ev.push(['subagent.start', { taskId: h.agent_id || null, subagentType: h.agent_type || null, description: h.agent_type || 'subagent' }]);
      break;
    case 'SubagentStop':
      ev.push(['subagent.end', { taskId: h.agent_id || null, status: 'completed', summary: clip(String(h.last_assistant_message || ''), 600) }]);
      break;
    case 'SessionEnd':
      status = [STATUS.IDLE, `session ended (${h.reason || 'exit'})`];
      break;
    default:
      ev.push(['notice', { subtype: `hook:${name}`, text: name }]);
  }
  return { events: ev, status };
}

export class HookObserver {
  constructor({ id, sessionId, cwd, transcriptPath }, hub) {
    this.kind = 'hook';
    this.id = id;
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.transcriptPath = transcriptPath;
    this.name = `hook ${sessionId.slice(0, 8)}`;
    this.hub = hub;
    this.status = STATUS.IDLE;
    this.statusReason = 'seen via hook';
    this.lastEvent = null;
  }
  snapshot() {
    return { id: this.id, kind: this.kind, name: this.name, cwd: this.cwd, sessionId: this.sessionId, sessionPath: this.transcriptPath, status: this.status, statusReason: this.statusReason, alive: true, readOnly: true, lastEvent: this.lastEvent };
  }
  apply(h) {
    this.lastEvent = h.hook_event_name;
    const { events, status } = mapHook(h);
    for (const [kind, payload] of events) this.hub.emit(this.id, kind, payload);
    if (status && (status[0] !== this.status || status[1] !== this.statusReason)) {
      [this.status, this.statusReason] = status;
      this.hub.emit(this.id, 'status', { status: this.status, reason: this.statusReason });
    }
  }
}
