// ░▒▓ AGENT ENGINE SLICE — Claude Code agents from packages/oasis-agent-engine ▓▒░
//
// One pure reducer folds the engine's WebSocket messages (hello / agents / event, schema v1)
// into per-agent state: status, todos, subagents, pending decisions, usage, context and a
// bounded log of UI-ready entries. Side effects (socket, input manager, camera) live outside:
// src/lib/agent-engine-client.ts and src/components/village/.

import type {
  EngineAgentKind,
  EngineAgentSnapshot,
  EngineAgentStatus,
  EngineContextUsage,
  EngineEvent,
  EngineModelInfo,
  EnginePermissionRequest,
  EngineRateLimit,
  EngineServerInfo,
  EngineSessionMeta,
  EngineTodo,
  EngineTurnUsage,
  KnownEngineEvent,
} from '../../lib/agent-engine-types'

export const AGENT_LOG_LIMIT = 300
export const AGENT_SUBAGENT_LIMIT = 24
/** An observer replays the transcript tail when it attaches; turns ending in that burst are old news. */
export const OBSERVER_REPLAY_GRACE_MS = 4000

/** Tools shown as todo / subagent panels instead of tool cards. */
const TODO_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

// ─── state ──────────────────────────────────────────────────────────────────

export type EngineConnectionStatus = 'disabled' | 'connecting' | 'open' | 'offline'

export interface EngineConnectionState {
  status: EngineConnectionStatus
  error: string | null
  /** Consecutive failed connection attempts (0 once connected). */
  attempts: number
  nextRetryAt: number | null
  connectedAt: number | null
  server: EngineServerInfo | null
}

interface LogBase {
  key: string
  ts: number
  history?: boolean
}

export type AgentLogEntry =
  | (LogBase & { type: 'session'; model: string | null; permissionMode: string | null; observed: boolean })
  | (LogBase & {
      type: 'user'
      text: string
      state: 'sent' | 'queued' | 'folded' | 'taken' | 'seen'
      midTurn?: boolean
      priority?: string
    })
  | (LogBase & { type: 'text'; text: string; parentToolUseId: string | null })
  | (LogBase & {
      type: 'tool'
      toolUseId: string | null
      name: string
      summary: string
      status: 'running' | 'done' | 'error'
      output?: string
      parentToolUseId: string | null
    })
  | (LogBase & {
      type: 'subagent'
      toolUseId: string | null
      description: string
      subagentType: string | null
      status: string
      summary?: string
      lastToolName?: string
    })
  | (LogBase & EnginePermissionRequest & { type: 'decision'; resolved: string | null })
  | (LogBase & {
      type: 'turn'
      outcome: string
      reason: string | null
      isError: boolean
      costUsd: number | null
      durationMs: number | null
      numTurns: number | null
      contextTokens: number | null
      contextWindow: number | null
      model: string | null
      result?: string
      observed?: boolean
    })
  | (LogBase & { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string })

export type AgentLogEntryType = AgentLogEntry['type']

export interface EngineSubagentState {
  key: string
  toolUseId: string | null
  taskId: string | null
  description: string
  subagentType: string | null
  status: string
  lastToolName?: string
  summary?: string
  startedAt: number
  endedAt?: number
}

export interface EngineDecisionState extends EnginePermissionRequest {
  requestId: string
  receivedAt: number
}

export interface EngineTurnSummary {
  ts: number
  outcome: string
  reason: string | null
  isError: boolean
  costUsd: number | null
  totalCostUsd: number | null
  durationMs: number | null
  numTurns: number | null
  usage: EngineTurnUsage | null
  contextTokens: number | null
  contextWindow: number | null
  model: string | null
  result?: string
}

export interface EngineAgentUsage {
  /** Sum of per-turn `costUsd` seen live in this browser session. */
  sessionCostUsd: number
  /** Process total reported by the CLI (`total_cost_usd`). */
  totalCostUsd: number | null
  turns: number
  lastTurn: EngineTurnUsage | null
}

export interface EngineLiveText {
  messageId: string | null
  text: string
}

export interface EngineAgentState {
  id: string
  kind: EngineAgentKind
  /** Owned = the Oasis drives this Claude Code process. Everything else is read-only. */
  owned: boolean
  readOnly: boolean
  name: string
  title: string | null
  cwd: string | null
  sessionId: string | null
  sessionPath: string | null
  model: string | null
  resolvedModel: string | null
  permissionMode: string | null
  effectivePermissionMode: string | null
  effort: string | null
  status: EngineAgentStatus
  statusReason: string | null
  statusSince: number
  alive: boolean
  pendingUser: number
  models: EngineModelInfo[] | null
  todos: EngineTodo[]
  todoSource: string | null
  subagents: EngineSubagentState[]
  /** Open can_use_tool requests (permission / question / plan), oldest first. */
  decisions: EngineDecisionState[]
  pendingDecision: EngineDecisionState | null
  usage: EngineAgentUsage
  context: EngineContextUsage | null
  lastTurn: EngineTurnSummary | null
  log: AgentLogEntry[]
  live: EngineLiveText | null
  /** Finished (or failed) while the owner was not looking at it. */
  unseen: boolean
  attentionSince: number | null
  firstSeenAt: number
  lastEventAt: number
  /** Per-agent counter for unique log keys (keeps the reducer deterministic). */
  seq: number
  /** Metadata came from an engine snapshot (not only from events). */
  hydrated: boolean
}

export interface EngineSessionsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: EngineSessionMeta[]
  error: string | null
  loadedAt: number | null
}

export interface AgentEngineState {
  connection: EngineConnectionState
  agents: Record<string, EngineAgentState>
  /** Stable order of appearance; drives desk slots. */
  order: string[]
  /** Agents removed by the engine (late events for them are dropped). */
  removed: Record<string, number>
  focusedAgentId: string | null
  nearbyAgentId: string | null
  pickerOpen: boolean
  rateLimit: EngineRateLimit | null
  sessions: EngineSessionsState
  /** Decisions answered from this page and not yet resolved by the engine (requestId -> sent at). */
  inflightDecisions: Record<string, number>
}

export type AgentEngineAction =
  | {
      type: 'connection'
      status: EngineConnectionStatus
      error?: string | null
      attempts?: number
      nextRetryAt?: number | null
      at?: number
    }
  | {
      type: 'hello'
      agents: EngineAgentSnapshot[]
      backlog?: Record<string, EngineEvent[]>
      server?: EngineServerInfo
      at: number
    }
  | { type: 'agents'; agents: EngineAgentSnapshot[]; at: number }
  | { type: 'event'; event: EngineEvent }
  | { type: 'focus'; agentId: string | null }
  | { type: 'nearby'; agentId: string | null }
  | { type: 'picker'; open: boolean }
  | { type: 'sessions/loading' }
  | { type: 'sessions/loaded'; items: EngineSessionMeta[]; at: number }
  | { type: 'sessions/error'; error: string }
  | { type: 'decision/pending'; requestId: string; pending: boolean; at?: number }
  | { type: 'reset' }

export function createInitialAgentEngineState(): AgentEngineState {
  return {
    connection: { status: 'disabled', error: null, attempts: 0, nextRetryAt: null, connectedAt: null, server: null },
    agents: {},
    order: [],
    removed: {},
    focusedAgentId: null,
    nearbyAgentId: null,
    pickerOpen: false,
    rateLimit: null,
    sessions: { status: 'idle', items: [], error: null, loadedAt: null },
    inflightDecisions: {},
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function kindFromAgentId(agentId: string): EngineAgentKind {
  if (agentId.startsWith('obs-')) return 'observer'
  if (agentId.startsWith('hook-')) return 'hook'
  return 'owned'
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toDecision(request: EnginePermissionRequest, receivedAt: number): EngineDecisionState | null {
  if (!request.requestId || request.readOnly) return null
  return { ...request, requestId: request.requestId, receivedAt }
}

export function createAgentState(
  id: string,
  at: number,
  snapshot?: EngineAgentSnapshot | null,
): EngineAgentState {
  const kind = snapshot?.kind || kindFromAgentId(id)
  const base: EngineAgentState = {
    id,
    kind,
    owned: kind === 'owned',
    readOnly: kind !== 'owned',
    name: id,
    title: null,
    cwd: null,
    sessionId: null,
    sessionPath: null,
    model: null,
    resolvedModel: null,
    permissionMode: null,
    effectivePermissionMode: null,
    effort: null,
    status: 'idle',
    statusReason: null,
    statusSince: at,
    alive: kind !== 'owned',
    pendingUser: 0,
    models: null,
    todos: [],
    todoSource: null,
    subagents: [],
    decisions: [],
    pendingDecision: null,
    usage: { sessionCostUsd: 0, totalCostUsd: null, turns: 0, lastTurn: null },
    context: null,
    lastTurn: null,
    log: [],
    live: null,
    unseen: false,
    attentionSince: null,
    firstSeenAt: at,
    lastEventAt: at,
    seq: 0,
    hydrated: false,
  }
  return snapshot ? applySnapshot(base, snapshot, at) : base
}

/** Merge engine snapshot metadata into an agent. The snapshot is authoritative for status and decisions. */
export function applySnapshot(agent: EngineAgentState, snap: EngineAgentSnapshot, at: number): EngineAgentState {
  const kind = snap.kind || agent.kind
  const status = snap.status || agent.status
  const decisions = kind === 'owned' && Array.isArray(snap.permissions)
    ? snap.permissions
        .map(request => {
          const existing = agent.decisions.find(d => d.requestId === request.requestId)
          return existing ? { ...existing, ...request, requestId: existing.requestId } : toDecision(request, at)
        })
        .filter((d): d is EngineDecisionState => Boolean(d))
    : agent.decisions
  const next: EngineAgentState = {
    ...agent,
    kind,
    owned: kind === 'owned',
    readOnly: kind !== 'owned' || Boolean(snap.readOnly),
    name: snap.name || agent.name,
    title: snap.title ?? agent.title,
    cwd: snap.cwd ?? agent.cwd,
    sessionId: snap.sessionId ?? agent.sessionId,
    sessionPath: snap.sessionPath ?? agent.sessionPath,
    model: snap.model !== undefined ? snap.model : agent.model,
    // Events (init each turn, model on a switch) are fresher than the snapshot's last-turn model.
    resolvedModel: agent.resolvedModel ?? snap.resolvedModel ?? null,
    permissionMode: snap.permissionMode !== undefined ? snap.permissionMode : agent.permissionMode,
    effectivePermissionMode: snap.effectivePermissionMode ?? agent.effectivePermissionMode,
    effort: snap.effort ?? agent.effort,
    status,
    statusReason: snap.statusReason ?? (status === agent.status ? agent.statusReason : null),
    statusSince: status === agent.status ? agent.statusSince : at,
    alive: typeof snap.alive === 'boolean' ? snap.alive : agent.alive,
    pendingUser: typeof snap.pendingUser === 'number' ? snap.pendingUser : agent.pendingUser,
    models: snap.models && snap.models.length ? snap.models : agent.models,
    context: snap.context ? normalizeContext(snap.context) : agent.context,
    decisions,
    pendingDecision: decisions[0] || null,
    hydrated: true,
  }
  return withAttention(next, at)
}

function normalizeContext(ctx: Partial<EngineContextUsage>): EngineContextUsage {
  const usedTokens = num(ctx.usedTokens)
  const maxTokens = num(ctx.maxTokens)
  const percent = num(ctx.percent) ?? (usedTokens !== null && maxTokens ? Math.round((100 * usedTokens) / maxTokens) : null)
  return { usedTokens, maxTokens, percent, model: str(ctx.model) }
}

/**
 * 0 = needs a decision, 1 = errored, 2 = finished while unseen. null = no attention needed.
 * An open permission / question / plan wins over the status: a mid-turn message makes the
 * engine report `working`, but the CLI is still blocked on the owner.
 */
export function attentionRank(agent: Pick<EngineAgentState, 'status' | 'unseen' | 'decisions'>): number | null {
  if (agent.status === 'needs-decision' || agent.decisions.length > 0) return 0
  if (agent.status === 'error') return 1
  // idle too: a restarted engine resumes a finished agent as a fresh, idle process.
  if (agent.unseen && (agent.status === 'waiting' || agent.status === 'idle')) return 2
  return null
}

/**
 * The status to show (ring, label, chips): an open decision always reads as needs-decision, and
 * a finished agent the owner hasn't seen reads as waiting even after an engine restart (idle).
 */
export function effectiveStatus(agent: Pick<EngineAgentState, 'status' | 'decisions' | 'unseen'>): EngineAgentStatus {
  if (agent.decisions.length > 0) return 'needs-decision'
  if (agent.status === 'idle' && agent.unseen) return 'waiting'
  return agent.status
}

/** Keep `attentionSince` consistent with the agent's attention rank. */
function withAttention(agent: EngineAgentState, at: number): EngineAgentState {
  const rank = attentionRank(agent)
  if (rank === null) return agent.attentionSince === null ? agent : { ...agent, attentionSince: null }
  return agent.attentionSince === null ? { ...agent, attentionSince: at } : agent
}

function pushLog(agent: EngineAgentState, entry: AgentLogEntry): EngineAgentState {
  const log = agent.log.length >= AGENT_LOG_LIMIT
    ? [...agent.log.slice(agent.log.length - AGENT_LOG_LIMIT + 1), entry]
    : [...agent.log, entry]
  return { ...agent, log }
}

function updateLog(
  agent: EngineAgentState,
  key: string,
  patch: (entry: AgentLogEntry) => AgentLogEntry,
): EngineAgentState {
  for (let i = agent.log.length - 1; i >= 0; i -= 1) {
    if (agent.log[i].key !== key) continue
    const log = agent.log.slice()
    log[i] = patch(log[i])
    return { ...agent, log }
  }
  return agent
}

function hasLog(agent: EngineAgentState, key: string): boolean {
  for (let i = agent.log.length - 1; i >= 0; i -= 1) if (agent.log[i].key === key) return true
  return false
}

function nextKey(agent: EngineAgentState, prefix: string): [string, EngineAgentState] {
  const seq = agent.seq + 1
  return [`${prefix}:${seq}`, { ...agent, seq }]
}

function subagentId(toolUseId: string | null | undefined, taskId: string | null | undefined): string | null {
  return toolUseId || taskId || null
}

function upsertSubagent(
  agent: EngineAgentState,
  id: string,
  patch: Partial<EngineSubagentState>,
  create?: () => EngineSubagentState,
): EngineAgentState {
  const index = agent.subagents.findIndex(s => s.key === id || (patch.taskId && s.taskId === patch.taskId))
  if (index >= 0) {
    const subagents = agent.subagents.slice()
    subagents[index] = { ...subagents[index], ...patch }
    return { ...agent, subagents }
  }
  if (!create) return agent
  const subagents = [...agent.subagents, { ...create(), ...patch }]
  return { ...agent, subagents: subagents.slice(-AGENT_SUBAGENT_LIMIT) }
}

interface FoldContext {
  /** The owner is looking at this agent right now. */
  focused: boolean
  /** Event arrives live (false while folding a backlog on connect). */
  live: boolean
}

// ─── the fold ───────────────────────────────────────────────────────────────

const FOLDED_KINDS = new Set<string>([
  'init', 'meta', 'status', 'user.sent', 'user.consumed', 'user', 'text.delta', 'text', 'tool.start', 'tool.end',
  'todo', 'subagent.start', 'subagent.progress', 'subagent.end', 'permission.request', 'permission.resolved',
  'permission.denied', 'turn.end', 'context', 'notice', 'error', 'exit', 'model', 'mode',
])

/** Fold one engine event into one agent. Pure; returns the same object for kinds it ignores. */
export function foldAgentEvent(agent: EngineAgentState, event: EngineEvent, ctx: FoldContext): EngineAgentState {
  if (!FOLDED_KINDS.has(event.kind)) return agent
  const e = event as KnownEngineEvent
  const ts = typeof e.ts === 'number' ? e.ts : agent.lastEventAt
  const history = Boolean(e.history)
  let a: EngineAgentState = { ...agent, lastEventAt: Math.max(agent.lastEventAt, ts) }
  let key: string

  switch (e.kind) {
    case 'init': {
      a = {
        ...a,
        sessionId: e.sessionId || a.sessionId,
        resolvedModel: e.model || a.resolvedModel,
        effectivePermissionMode: e.permissionMode || a.effectivePermissionMode,
        cwd: a.cwd || e.cwd || null,
        sessionPath: a.sessionPath || e.sessionPath || null,
      }
      if (!a.log.some(entry => entry.type === 'session')) {
        ;[key, a] = nextKey(a, 'i')
        a = pushLog(a, {
          type: 'session',
          key,
          ts,
          model: e.model || null,
          permissionMode: e.permissionMode || null,
          observed: Boolean(e.observed) || a.kind !== 'owned',
        })
      }
      return a
    }

    case 'meta':
      return {
        ...a,
        models: e.models && e.models.length ? e.models : a.models,
        title: e.title || a.title,
        effectivePermissionMode: a.effectivePermissionMode || e.permissionMode || null,
      }

    case 'status': {
      if (history) return a
      const changed = e.status !== a.status
      a = {
        ...a,
        status: e.status,
        statusReason: e.reason ?? null,
        statusSince: changed ? ts : a.statusSince,
        live: e.status === 'working' ? a.live : null,
      }
      if (e.status === 'working' || e.status === 'idle') a = { ...a, unseen: false }
      if (e.status === 'error' && ctx.live && !ctx.focused) a = { ...a, unseen: true }
      return withAttention(a, ts)
    }

    case 'user.sent': {
      a = { ...a, pendingUser: a.pendingUser + 1 }
      return pushLog(a, {
        type: 'user',
        key: `u:${e.uuid}`,
        ts,
        text: e.text,
        state: e.midTurn ? 'queued' : 'sent',
        midTurn: Boolean(e.midTurn),
        priority: e.priority,
      })
    }

    case 'user.consumed': {
      a = { ...a, pendingUser: Math.max(0, a.pendingUser - 1) }
      return updateLog(a, `u:${e.uuid}`, entry => (entry.type === 'user' ? { ...entry, state: e.folded ? 'folded' : 'taken' } : entry))
    }

    case 'user': {
      if (e.uuid && hasLog(a, `u:${e.uuid}`)) return a // our own message, echoed back
      if (e.uuid) key = `u:${e.uuid}`
      else [key, a] = nextKey(a, 'u')
      return pushLog(a, { type: 'user', key, ts, text: e.text || '', state: 'seen', history })
    }

    case 'text.delta': {
      if (history || e.parentToolUseId) return a
      const messageId = e.messageId ?? null
      const live = a.live && a.live.messageId === messageId
        ? { messageId, text: a.live.text + (e.text || '') }
        : { messageId, text: e.text || '' }
      return { ...a, live }
    }

    case 'text': {
      if (!history && a.live && (a.live.messageId === (e.messageId ?? null) || !e.parentToolUseId)) a = { ...a, live: null }
      ;[key, a] = nextKey(a, 'x')
      return pushLog(a, { type: 'text', key, ts, text: e.text || '', parentToolUseId: e.parentToolUseId || null, history })
    }

    case 'tool.start': {
      if (TODO_TOOLS.has(e.name) || SUBAGENT_TOOLS.has(e.name)) return a
      if (e.toolUseId) key = `t:${e.toolUseId}`
      else [key, a] = nextKey(a, 't')
      if (hasLog(a, key)) return a
      return pushLog(a, {
        type: 'tool',
        key,
        ts,
        toolUseId: e.toolUseId || null,
        name: e.name,
        summary: e.summary || e.name,
        status: history ? 'done' : 'running',
        parentToolUseId: e.parentToolUseId || null,
        history,
      })
    }

    case 'tool.end': {
      if (!e.toolUseId) return a
      return updateLog(a, `t:${e.toolUseId}`, entry => (entry.type === 'tool'
        ? { ...entry, status: e.isError ? 'error' : 'done', output: e.output || entry.output }
        : entry))
    }

    case 'todo':
      if (history) return a
      return { ...a, todos: Array.isArray(e.todos) ? e.todos : [], todoSource: e.source || null }

    case 'subagent.start': {
      const id = subagentId(e.toolUseId, e.taskId)
      if (!id || history) return a
      a = upsertSubagent(a, id, { taskId: e.taskId ?? null }, () => ({
        key: id,
        toolUseId: e.toolUseId || null,
        taskId: e.taskId || null,
        description: e.description || 'subagent',
        subagentType: e.subagentType || null,
        status: 'running',
        startedAt: ts,
      }))
      key = `s:${id}`
      if (hasLog(a, key)) return a
      return pushLog(a, {
        type: 'subagent',
        key,
        ts,
        toolUseId: e.toolUseId || null,
        description: e.description || 'subagent',
        subagentType: e.subagentType || null,
        status: 'running',
      })
    }

    case 'subagent.progress': {
      const id = subagentId(e.toolUseId, e.taskId)
      if (!id || history) return a
      const lastToolName = e.lastToolName || e.description
      a = upsertSubagent(a, id, { lastToolName })
      return updateLog(a, `s:${id}`, entry => (entry.type === 'subagent' ? { ...entry, lastToolName } : entry))
    }

    case 'subagent.end': {
      if (history) return a
      const byTask = e.taskId ? a.subagents.find(s => s.taskId === e.taskId) : undefined
      const id = e.toolUseId || byTask?.key || e.taskId || null
      if (!id) return a
      const status = e.status || 'completed'
      a = upsertSubagent(a, id, { status, summary: e.summary, endedAt: ts })
      return updateLog(a, `s:${id}`, entry => (entry.type === 'subagent' ? { ...entry, status, summary: e.summary } : entry))
    }

    case 'permission.request': {
      if (history) return a
      const decision = toDecision(e, ts)
      if (decision && !a.decisions.some(d => d.requestId === decision.requestId)) {
        const decisions = [...a.decisions, decision]
        a = withAttention({ ...a, decisions, pendingDecision: decisions[0] }, ts)
      }
      if (e.requestId) key = `p:${e.requestId}`
      else [key, a] = nextKey(a, 'p')
      if (hasLog(a, key)) return a
      const { v: _v, agentId: _agentId, ts: _ts, kind: _kind, history: _history, ...request } = e
      return pushLog(a, { ...request, type: 'decision', key, ts, resolved: null })
    }

    case 'permission.resolved': {
      if (!e.requestId) return a
      const decisions = a.decisions.filter(d => d.requestId !== e.requestId)
      a = withAttention({ ...a, decisions, pendingDecision: decisions[0] || null }, ts)
      return updateLog(a, `p:${e.requestId}`, entry => (entry.type === 'decision' ? { ...entry, resolved: e.behavior || 'resolved' } : entry))
    }

    case 'permission.denied': {
      ;[key, a] = nextKey(a, 'd')
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: 'warn',
        text: `Denied: ${e.toolName || 'tool'}${e.message ? ` (${e.message})` : ''}`,
        history,
      })
    }

    case 'turn.end': {
      const costUsd = num(e.costUsd)
      const summary: EngineTurnSummary = {
        ts,
        outcome: e.outcome || 'done-waiting',
        reason: e.reason ?? null,
        isError: Boolean(e.isError),
        costUsd,
        totalCostUsd: num(e.totalCostUsd),
        durationMs: num(e.durationMs),
        numTurns: num(e.numTurns),
        usage: e.usage || null,
        contextTokens: num(e.contextTokens),
        contextWindow: num(e.contextWindow),
        model: e.model || null,
        result: e.result,
      }
      if (!history) {
        a = {
          ...a,
          live: null,
          lastTurn: summary,
          usage: {
            sessionCostUsd: a.usage.sessionCostUsd + (ctx.live && costUsd ? costUsd : 0),
            totalCostUsd: summary.totalCostUsd ?? a.usage.totalCostUsd,
            turns: a.usage.turns + 1,
            lastTurn: summary.usage,
          },
        }
        if (summary.contextTokens !== null && (!a.context || a.context.usedTokens === null)) {
          a = { ...a, context: normalizeContext({ usedTokens: summary.contextTokens, maxTokens: summary.contextWindow, model: summary.model }) }
        }
        const replayBurst = a.kind !== 'owned' && ts - a.firstSeenAt < OBSERVER_REPLAY_GRACE_MS
        if (ctx.live && !ctx.focused && !replayBurst) a = { ...a, unseen: true }
      }
      ;[key, a] = nextKey(a, 'e')
      a = pushLog(a, {
        type: 'turn',
        key,
        ts,
        outcome: summary.outcome,
        reason: summary.reason,
        isError: summary.isError,
        costUsd,
        durationMs: summary.durationMs,
        numTurns: summary.numTurns,
        contextTokens: summary.contextTokens,
        contextWindow: summary.contextWindow,
        model: summary.model,
        result: summary.result,
        observed: Boolean(e.observed),
        history,
      })
      return withAttention(a, ts)
    }

    case 'context':
      if (history) return a
      return { ...a, context: normalizeContext(e) }

    case 'notice': {
      ;[key, a] = nextKey(a, 'n')
      return pushLog(a, { type: 'notice', key, ts, level: 'info', text: e.text || e.subtype || 'notice', history })
    }

    case 'error': {
      ;[key, a] = nextKey(a, 'r')
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: e.retrying ? 'warn' : 'error',
        text: `${e.retrying ? 'Retrying: ' : ''}${e.message || 'error'}`,
        history,
      })
    }

    case 'exit': {
      ;[key, a] = nextKey(a, 'q')
      const stderr = Array.isArray(e.stderr) && e.stderr.length ? `: ${e.stderr.join(' | ')}` : ''
      a = { ...a, alive: false, live: null, pendingUser: 0 }
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: e.code ? 'error' : 'info',
        text: `Process exited (code ${e.code ?? 'none'})${stderr}`,
      })
    }

    case 'model': {
      a = { ...a, model: e.model || a.model, resolvedModel: e.resolved || a.resolvedModel }
      ;[key, a] = nextKey(a, 'm')
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: 'info',
        text: `Model -> ${e.resolved || e.model}${e.applied ? ` (${e.applied})` : ''}`,
      })
    }

    case 'mode': {
      if (!e.permissionMode) return a
      a = { ...a, permissionMode: e.permissionMode, effectivePermissionMode: e.permissionMode }
      ;[key, a] = nextKey(a, 'o')
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: 'info',
        text: `Permission mode -> ${e.permissionMode}${e.applied ? ` (${e.applied})` : ''}`,
      })
    }

    default:
      return a
  }
}

// ─── the reducer ────────────────────────────────────────────────────────────

function removeAgent(state: AgentEngineState, agentId: string, at: number): AgentEngineState {
  if (!state.agents[agentId]) return { ...state, removed: { ...state.removed, [agentId]: at } }
  const agents = { ...state.agents }
  delete agents[agentId]
  return {
    ...state,
    agents,
    order: state.order.filter(id => id !== agentId),
    removed: { ...state.removed, [agentId]: at },
    focusedAgentId: state.focusedAgentId === agentId ? null : state.focusedAgentId,
    nearbyAgentId: state.nearbyAgentId === agentId ? null : state.nearbyAgentId,
  }
}

function applyEvent(state: AgentEngineState, event: EngineEvent, live: boolean): AgentEngineState {
  if (!event || typeof event.agentId !== 'string' || typeof event.kind !== 'string') return state
  const at = typeof event.ts === 'number' ? event.ts : 0
  if (event.kind === 'removed') return removeAgent(state, event.agentId, at)
  if (state.removed[event.agentId]) return state // e.g. the `exit` of an agent that was just removed

  let next = state
  if (event.kind === 'permission.resolved') {
    const requestId = (event as KnownEngineEvent & { requestId?: string | null }).requestId
    if (requestId && next.inflightDecisions[requestId]) {
      const inflightDecisions = { ...next.inflightDecisions }
      delete inflightDecisions[requestId]
      next = { ...next, inflightDecisions }
    }
  }
  if (event.kind === 'rate_limit') {
    const { v: _v, agentId: _agentId, ts: _ts, kind: _kind, ...rate } = event as KnownEngineEvent & EngineRateLimit
    next = { ...state, rateLimit: rate as EngineRateLimit }
  }
  const existing = next.agents[event.agentId]
  if (!existing && !FOLDED_KINDS.has(event.kind)) return next
  const agent = existing || createAgentState(event.agentId, at)
  const folded = foldAgentEvent(agent, event, { focused: next.focusedAgentId === event.agentId, live })
  if (folded === agent && existing) return next
  return {
    ...next,
    agents: { ...next.agents, [event.agentId]: folded },
    order: existing ? next.order : [...next.order, event.agentId],
  }
}

export function agentEngineReducer(state: AgentEngineState, action: AgentEngineAction): AgentEngineState {
  switch (action.type) {
    case 'connection': {
      const at = action.at ?? Date.now()
      const prev = state.connection
      return {
        ...state,
        connection: {
          ...prev,
          status: action.status,
          error: action.error !== undefined ? action.error : action.status === 'open' ? null : prev.error,
          attempts: action.attempts ?? (action.status === 'open' ? 0 : prev.attempts),
          nextRetryAt: action.nextRetryAt !== undefined ? action.nextRetryAt : action.status === 'offline' ? prev.nextRetryAt : null,
          connectedAt: action.status === 'open' ? at : prev.connectedAt,
        },
      }
    }

    case 'hello': {
      const agents: Record<string, EngineAgentState> = {}
      const order: string[] = []
      for (const snap of action.agents || []) {
        if (!snap?.id) continue
        const prev = state.agents[snap.id]
        // Keep the first-seen time across reconnects so slots and attention order stay stable.
        let agent = createAgentState(snap.id, prev?.firstSeenAt ?? action.at)
        let newestTurnEnd = 0
        for (const event of action.backlog?.[snap.id] || []) {
          agent = foldAgentEvent(agent, event, { focused: false, live: false })
          if (event.kind === 'turn.end' && !event.history && typeof event.ts === 'number') newestTurnEnd = Math.max(newestTurnEnd, event.ts)
        }
        agent = applySnapshot(agent, snap, action.at)
        // A reconnect (sleep, engine restart, HMR) keeps "finished while unseen", and a turn that
        // ended while we were disconnected counts as unseen too. A fresh page load starts clean.
        const focused = state.focusedAgentId === snap.id
        const unseen = Boolean(prev) && !focused && (prev.unseen || newestTurnEnd > prev.lastEventAt)
        agent = { ...agent, unseen, attentionSince: prev && unseen ? prev.attentionSince : agent.attentionSince }
        agents[snap.id] = withAttention(agent, action.at)
        order.push(snap.id)
      }
      // Keep the previous slot order for agents that survived a reconnect.
      const kept = state.order.filter(id => agents[id])
      const fresh = order.filter(id => !kept.includes(id))
      return {
        ...state,
        connection: {
          ...state.connection,
          status: 'open',
          error: null,
          attempts: 0,
          nextRetryAt: null,
          connectedAt: action.at,
          server: action.server || state.connection.server,
        },
        agents,
        order: [...kept, ...fresh],
        removed: {},
        inflightDecisions: {},
        focusedAgentId: state.focusedAgentId && agents[state.focusedAgentId] ? state.focusedAgentId : null,
        nearbyAgentId: state.nearbyAgentId && agents[state.nearbyAgentId] ? state.nearbyAgentId : null,
      }
    }

    case 'agents': {
      const agents: Record<string, EngineAgentState> = {}
      const seen = new Set<string>()
      let removed = state.removed
      for (const snap of action.agents || []) {
        if (!snap?.id) continue
        if (removed[snap.id]) {
          // Snapshots go out after the `removed` event, so one listing the id again means the
          // engine re-created it (a hook agent whose session fired again): stop ignoring it.
          removed = { ...removed }
          delete removed[snap.id]
        }
        seen.add(snap.id)
        const prev = state.agents[snap.id]
        agents[snap.id] = prev ? applySnapshot(prev, snap, action.at) : createAgentState(snap.id, action.at, snap)
      }
      const order = [...state.order.filter(id => seen.has(id)), ...[...seen].filter(id => !state.order.includes(id))]
      return {
        ...state,
        agents,
        order,
        removed,
        focusedAgentId: state.focusedAgentId && agents[state.focusedAgentId] ? state.focusedAgentId : null,
        nearbyAgentId: state.nearbyAgentId && agents[state.nearbyAgentId] ? state.nearbyAgentId : null,
      }
    }

    case 'event':
      return applyEvent(state, action.event, true)

    case 'focus': {
      const id = action.agentId && state.agents[action.agentId] ? action.agentId : null
      if (id === state.focusedAgentId && (!id || !state.agents[id].unseen)) return state
      if (!id) return { ...state, focusedAgentId: null }
      const agent = state.agents[id]
      const seen = withAttention({ ...agent, unseen: false }, agent.lastEventAt)
      return { ...state, focusedAgentId: id, agents: { ...state.agents, [id]: seen } }
    }

    case 'nearby': {
      const id = action.agentId && state.agents[action.agentId] ? action.agentId : null
      return id === state.nearbyAgentId ? state : { ...state, nearbyAgentId: id }
    }

    case 'picker':
      return action.open === state.pickerOpen ? state : { ...state, pickerOpen: action.open }

    case 'sessions/loading':
      return { ...state, sessions: { ...state.sessions, status: 'loading', error: null } }

    case 'sessions/loaded':
      return { ...state, sessions: { status: 'ready', items: action.items, error: null, loadedAt: action.at } }

    case 'sessions/error':
      return { ...state, sessions: { ...state.sessions, status: 'error', error: action.error } }

    case 'decision/pending': {
      const has = Boolean(state.inflightDecisions[action.requestId])
      if (action.pending === has) return state
      const inflightDecisions = { ...state.inflightDecisions }
      if (action.pending) inflightDecisions[action.requestId] = action.at ?? Date.now()
      else delete inflightDecisions[action.requestId]
      return { ...state, inflightDecisions }
    }

    case 'reset':
      return { ...createInitialAgentEngineState(), connection: state.connection }

    default:
      return state
  }
}

// ─── selectors ──────────────────────────────────────────────────────────────

/** Agents that need the owner: decisions first, then errors, then finished-and-unseen. Oldest first within a group. */
export function selectAttentionQueue(state: Pick<AgentEngineState, 'agents' | 'order'>): string[] {
  const ranked: Array<{ id: string; rank: number; since: number; index: number }> = []
  state.order.forEach((id, index) => {
    const agent = state.agents[id]
    if (!agent) return
    const rank = attentionRank(agent)
    if (rank === null) return
    ranked.push({ id, rank, since: agent.attentionSince ?? agent.statusSince, index })
  })
  ranked.sort((x, y) => x.rank - y.rank || x.since - y.since || x.index - y.index)
  return ranked.map(entry => entry.id)
}

/**
 * Target for the N key: the first agent in the attention queue that is not the focused one.
 * Falls back to cycling through every agent in slot order when nobody needs attention.
 */
export function selectNextAgentForN(state: Pick<AgentEngineState, 'agents' | 'order' | 'focusedAgentId'>): string | null {
  const queue = selectAttentionQueue(state)
  const current = state.focusedAgentId
  const candidate = queue.find(id => id !== current)
  if (candidate) return candidate
  if (queue.length) return null // only the focused agent needs attention
  const ids = state.order.filter(id => state.agents[id])
  if (!ids.length) return null
  if (!current) return ids[0]
  const index = ids.indexOf(current)
  const next = ids[(index + 1) % ids.length]
  return next === current ? null : next
}

export function isDecisionInFlight(state: Pick<AgentEngineState, 'inflightDecisions'>, requestId: string | null | undefined): boolean {
  return Boolean(requestId && state.inflightDecisions[requestId])
}

export function selectAgentList(state: Pick<AgentEngineState, 'agents' | 'order'>): EngineAgentState[] {
  return state.order.map(id => state.agents[id]).filter((agent): agent is EngineAgentState => Boolean(agent))
}

// ─── slice ──────────────────────────────────────────────────────────────────

export interface AgentEngineSlice {
  agentEngine: AgentEngineState
  agentEngineDispatch: (action: AgentEngineAction) => void
}

interface AgentEngineSliceState {
  agentEngine: AgentEngineState
}

type AgentEngineSet<TState extends AgentEngineSliceState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>),
) => void

interface CreateAgentEngineSliceDeps<TState extends AgentEngineSliceState> {
  set: AgentEngineSet<TState>
  get: () => TState
}

export function createAgentEngineSlice<TState extends AgentEngineSliceState>({
  set,
  get,
}: CreateAgentEngineSliceDeps<TState>): AgentEngineSlice {
  return {
    agentEngine: createInitialAgentEngineState(),
    agentEngineDispatch: (action) => {
      const prev = get().agentEngine
      const next = agentEngineReducer(prev, action)
      if (next !== prev) set({ agentEngine: next } as Partial<TState>)
    },
  }
}
