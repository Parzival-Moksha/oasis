// ░▒▓ AGENT ENGINE SLICE — Claude Code agents from packages/oasis-agent-engine ▓▒░
//
// One pure reducer folds the engine's WebSocket messages (hello / agents / event, schema v1)
// into per-agent state: status, todos, subagents, pending decisions, usage, context and a
// bounded log of UI-ready entries. Side effects (socket, input manager, camera) live outside:
// src/lib/agent-engine-client.ts and src/components/village/.

import type {
  EngineAppointment,
  EngineSchedule,
  EngineAgentKind,
  EngineAgentSnapshot,
  EngineAttachment,
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
/** Once the owner scrolled back for older history, the log may grow this far before the oldest goes again. */
export const AGENT_LOG_HISTORY_LIMIT = 6000
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
  /** Byte offset of the transcript line it came from, when known: older history loads from before the oldest. */
  at?: number
}

export type AgentLogEntry =
  | (LogBase & { type: 'session'; model: string | null; permissionMode: string | null; observed: boolean })
  | (LogBase & {
      type: 'user'
      text: string
      state: 'sent' | 'queued' | 'folded' | 'taken' | 'seen'
      midTurn?: boolean
      priority?: string
      /** A voice message: its recording (play widget); `text` is the transcript. */
      voice?: { fileId: string; mime?: string; durationMs?: number }
      /** Pictures pasted or dropped with the message. */
      images?: Array<{ fileId: string; name?: string; mediaType?: string }>
      /** A wake-up from the agent's schedule, not the owner: what woke it ("hourly wake-up"). */
      scheduled?: string
    })
  | (LogBase & { type: 'text'; text: string; parentToolUseId: string | null })
  | (LogBase & {
      type: 'tool'
      toolUseId: string | null
      name: string
      summary: string
      status: 'running' | 'done' | 'error'
      /** The tool's input, clipped by the engine (shown when the card is expanded). */
      input?: Record<string, unknown>
      output?: string
      /** SendUserFile: the files it delivered (shown as a picture card). */
      attachments?: EngineAttachment[]
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
  /** Watched, but its session runs the Oasis plugin's mod: you can talk to it (send goes through the bridge). */
  bridged: boolean
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
  /** The effort the process runs with (the CLI default when `effort` is null). */
  resolvedEffort: string | null
  /** Eyes: each message you send carries a picture from this agent's avatar. null = the engine is older than eyes. */
  eyes: boolean | null
  /** Claude in Chrome on (engine chrome.js). null = the engine is older than the switch. */
  chrome: boolean | null
  /** Voice: its avatar says the <spoken> line of each reply out loud. null = the engine is older than the switch. */
  speak: boolean | null
  /** The voice it picked for itself (engine roster); the owner's pick in its settings menu wins over it. */
  voiceChoice: string | null
  /** When its last turn ended (engine snapshot): after a reload, unseen if after your last look (village-seen.ts). */
  lastOutcomeAt: number | null
  /** The engine restarted mid-turn and told it to carry on: set while that turn runs (its sign says "resumed"). */
  resumedAt: number | null
  /** When it wakes up on its own (engine schedule.js). undefined fields stay null on engines older than schedules. */
  schedule: EngineSchedule | null
  appointments: EngineAppointment[]
  nextWake: { at: number; label: string } | null
  wakesToday: number
  /** The running turn was started by its schedule. */
  scheduledRun: boolean
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
  /** Transcript offset the loaded older history starts at (null: none loaded yet). */
  historyFrom: number | null
  /** The thread reaches back to the session's first line. */
  historyStart: boolean
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
  /** A subagent whose work the open panel shows alone (its mini avatar was clicked); `key` is its key in `subagents`. */
  focusedSubagent: { agentId: string; key: string } | null
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
  /** After a reload: these agents finished while you weren't looking (village-seen.ts). */
  | { type: 'unseen/restore'; agentIds: string[]; at: number }
  | { type: 'nearby'; agentId: string | null }
  | { type: 'picker'; open: boolean }
  | { type: 'sessions/loading' }
  | { type: 'sessions/loaded'; items: EngineSessionMeta[]; at: number }
  | { type: 'sessions/error'; error: string }
  | { type: 'decision/pending'; requestId: string; pending: boolean; at?: number }
  /** Show one subagent's work in its parent's panel (agentId and key set), or the whole thread again (null). */
  | { type: 'subagent/focus'; agentId: string | null; key?: string | null }
  /** Older history the owner scrolled back for (olderHistory): prepended to the agent's log. */
  | { type: 'history/older'; agentId: string; events: EngineEvent[]; from: number; done: boolean; anchor?: string | null }
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
    focusedSubagent: null,
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
    bridged: false,
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
    resolvedEffort: null,
    eyes: null,
    chrome: null,
    speak: null,
    voiceChoice: null,
    lastOutcomeAt: null,
    resumedAt: null,
    schedule: null,
    appointments: [],
    nextWake: null,
    wakesToday: 0,
    scheduledRun: false,
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
    historyFrom: null,
    historyStart: false,
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
    // Every snapshot says whether the bridge is alive right now; a quiet one makes it read-only again.
    bridged: kind !== 'owned' && snap.bridged === true,
    readOnly: kind !== 'owned' ? snap.bridged !== true : Boolean(snap.readOnly),
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
    // null is a real value ("back to the default"); only a missing field keeps the old one.
    effort: snap.effort !== undefined ? snap.effort : agent.effort,
    resolvedEffort: snap.resolvedEffort !== undefined ? snap.resolvedEffort : agent.resolvedEffort,
    eyes: typeof snap.eyes === 'boolean' ? snap.eyes : agent.eyes,
    chrome: typeof snap.chrome === 'boolean' ? snap.chrome : agent.chrome,
    speak: typeof snap.speak === 'boolean' ? snap.speak : agent.speak,
    voiceChoice: snap.voiceChoice !== undefined ? snap.voiceChoice || null : agent.voiceChoice,
    lastOutcomeAt: typeof snap.lastOutcome?.at === 'number' ? snap.lastOutcome.at : agent.lastOutcomeAt,
    resumedAt: snap.resumedAt !== undefined ? snap.resumedAt ?? null : agent.resumedAt,
    schedule: snap.schedule !== undefined ? snap.schedule ?? null : agent.schedule,
    appointments: Array.isArray(snap.appointments) ? snap.appointments : agent.appointments,
    nextWake: snap.nextWake !== undefined ? snap.nextWake ?? null : agent.nextWake,
    wakesToday: typeof snap.wakesToday === 'number' ? snap.wakesToday : agent.wakesToday,
    scheduledRun: typeof snap.scheduledRun === 'boolean' ? snap.scheduledRun : agent.scheduledRun,
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
/** A subagent with no end counts as running for this long at most, so a lost notification can't hold an agent forever. */
export const SUBAGENT_STALE_MS = 12 * 3600 * 1000

/** Subagents (helpers) still working, judged at `now` (default: the agent's last event, which keeps reducers pure). */
export function runningSubagentCount(agent: { subagents?: EngineSubagentState[]; lastEventAt?: number }, now = agent.lastEventAt ?? 0): number {
  let count = 0
  for (const sub of agent.subagents || []) if (sub.status === 'running' && !(now - sub.startedAt > SUBAGENT_STALE_MS)) count += 1
  return count
}

export function attentionRank(agent: Pick<EngineAgentState, 'status' | 'unseen' | 'decisions'> & { subagents?: EngineSubagentState[]; lastEventAt?: number }): number | null {
  if (agent.status === 'needs-decision' || agent.decisions.length > 0) return 0
  if (agent.status === 'error') return 1
  // idle too: a restarted engine resumes a finished agent as a fresh, idle process. Not while its helpers
  // still work: there is nothing to do yet, and their reports start its next turn by themselves.
  if (agent.unseen && (agent.status === 'waiting' || agent.status === 'idle')) return runningSubagentCount(agent) > 0 ? null : 2
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
  // History the owner scrolled back for stays; the plain cap only bounds what came in live.
  const limit = agent.historyFrom === null ? AGENT_LOG_LIMIT : AGENT_LOG_HISTORY_LIMIT
  if (agent.log.length < limit) return { ...agent, log: [...agent.log, entry] }
  const log = [...agent.log.slice(agent.log.length - limit + 1), entry]
  // The oldest entries went: the loaded range no longer reaches `historyFrom`.
  return agent.historyFrom === null ? { ...agent, log } : { ...agent, log, historyFrom: null, historyStart: false }
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
  'permission.denied', 'turn.end', 'context', 'notice', 'error', 'exit', 'model', 'mode', 'effort',
])

/** Fold one engine event into one agent. Pure; returns the same object for kinds it ignores. */
export function foldAgentEvent(agent: EngineAgentState, event: EngineEvent, ctx: FoldContext): EngineAgentState {
  const next = foldAgentEventInner(agent, event, ctx)
  // An entry made from a transcript record remembers where that record is (`at`).
  const at = (event as { at?: unknown }).at
  if (typeof at !== 'number' || next === agent || !next.log.length) return next
  const last = next.log[next.log.length - 1]
  if (last === agent.log[agent.log.length - 1] || last.at !== undefined) return next
  return { ...next, log: [...next.log.slice(0, -1), { ...last, at }] }
}

function foldAgentEventInner(agent: EngineAgentState, event: EngineEvent, ctx: FoldContext): EngineAgentState {
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
        resolvedEffort: e.resolvedEffort !== undefined ? e.resolvedEffort : a.resolvedEffort,
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
        ...(e.voice?.fileId ? { voice: e.voice } : {}),
        ...(e.images?.length ? { images: e.images } : {}),
        ...(e.auto === 'schedule' ? { scheduled: e.scheduled || 'scheduled' } : {}),
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
      return pushLog(a, { type: 'user', key, ts, text: e.text || '', state: 'seen', history, ...(e.scheduled ? { scheduled: e.scheduled } : {}) })
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
        input: e.input && typeof e.input === 'object' && !Array.isArray(e.input) ? e.input as Record<string, unknown> : undefined,
        status: history ? 'done' : 'running',
        parentToolUseId: e.parentToolUseId || null,
        history,
      })
    }

    case 'tool.end': {
      if (!e.toolUseId) return a
      return updateLog(a, `t:${e.toolUseId}`, entry => (entry.type === 'tool'
        ? {
            ...entry,
            status: e.isError ? 'error' : 'done',
            output: e.output || entry.output,
            ...(Array.isArray(e.attachments) && e.attachments.length ? { attachments: e.attachments } : {}),
          }
        : entry))
    }

    case 'todo':
      if (history) return a
      return { ...a, todos: Array.isArray(e.todos) ? e.todos : [], todoSource: e.source || null }

    case 'subagent.start': {
      const id = subagentId(e.toolUseId, e.taskId)
      if (!id || history) return a
      const known = a.subagents.find(s => s.key === id || (e.taskId && s.taskId === e.taskId))
      if (known && known.status !== 'running') {
        // Resumed (SendMessage): the same subagent works again, so it shows as running from now on.
        a = upsertSubagent(a, known.key, { status: 'running', startedAt: ts, endedAt: undefined, summary: undefined, lastToolName: undefined })
        a = updateLog(a, `s:${known.key}`, entry => (entry.type === 'subagent' ? { ...entry, status: 'running', summary: undefined } : entry))
        return withAttention(a, ts)
      }
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
      // Helpers working change what the agent's own waiting means (attentionRank).
      if (hasLog(a, key)) return withAttention(a, ts)
      return withAttention(pushLog(a, {
        type: 'subagent',
        key,
        ts,
        toolUseId: e.toolUseId || null,
        description: e.description || 'subagent',
        subagentType: e.subagentType || null,
        status: 'running',
      }), ts)
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
      return withAttention(updateLog(a, `s:${id}`, entry => (entry.type === 'subagent' ? { ...entry, status, summary: e.summary } : entry)), ts)
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
        // A turn its schedule started is not news for the owner: no "finished" sign, no walk up to him. It still
        // counts when it ended needing him (its status says so) or erred.
        if (ctx.live && !ctx.focused && !replayBurst && !e.scheduled) a = { ...a, unseen: true }
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
      a = {
        ...a,
        model: e.model || a.model,
        resolvedModel: e.resolved || a.resolvedModel,
        resolvedEffort: e.resolvedEffort !== undefined ? e.resolvedEffort : a.resolvedEffort,
      }
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

    case 'effort': {
      a = { ...a, effort: e.effort ?? null, resolvedEffort: e.resolvedEffort !== undefined ? e.resolvedEffort : a.resolvedEffort }
      ;[key, a] = nextKey(a, 'f')
      const shown = e.effort || `default${e.resolvedEffort ? ` (${e.resolvedEffort})` : ''}`
      return pushLog(a, {
        type: 'notice',
        key,
        ts,
        level: 'info',
        text: `Thinking effort -> ${shown}${e.applied ? ` (${e.applied})` : ''}`,
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

    case 'subagent/focus': {
      const next = action.agentId && action.key ? { agentId: action.agentId, key: action.key } : null
      const prev = state.focusedSubagent
      if (prev === next || (prev && next && prev.agentId === next.agentId && prev.key === next.key)) return state
      return { ...state, focusedSubagent: next }
    }

    case 'history/older': {
      const agent = state.agents[action.agentId]
      if (!agent) return state
      const next = prependHistory(agent, action.events, action.from, action.done, action.anchor ?? null)
      return { ...state, agents: { ...state.agents, [agent.id]: next } }
    }

    case 'focus': {
      const id = action.agentId && state.agents[action.agentId] ? action.agentId : null
      if (id === state.focusedAgentId && (!id || !state.agents[id].unseen)) return state
      // A subagent view belongs to its parent's panel: it ends when that panel closes or another agent opens.
      const focusedSubagent = state.focusedSubagent && state.focusedSubagent.agentId === id ? state.focusedSubagent : null
      if (!id) return { ...state, focusedAgentId: null, focusedSubagent }
      const agent = state.agents[id]
      const seen = withAttention({ ...agent, unseen: false }, agent.lastEventAt)
      return { ...state, focusedAgentId: id, focusedSubagent, agents: { ...state.agents, [id]: seen } }
    }

    case 'unseen/restore': {
      let agents = state.agents
      for (const id of action.agentIds) {
        const agent = agents[id]
        if (!agent || agent.unseen || id === state.focusedAgentId) continue
        agents = { ...agents, [id]: withAttention({ ...agent, unseen: true }, action.at) }
      }
      return agents === state.agents ? state : { ...state, agents }
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

// ─── older history (scrolling up in the thread) ──────────────────────────────

/** Where the next piece of older history ends: a transcript offset, or the line of a tool call. null: nothing older. */
export interface HistoryCursor {
  /** Transcript byte offset (null: the end of the file, for an empty thread). */
  before: number | null
  /** Tool use id of the oldest tool call, when the oldest entries have no offset (an owned agent's live turns). */
  anchor?: string
}

export function selectHistoryCursor(agent: Pick<EngineAgentState, 'log' | 'historyFrom' | 'historyStart'>): HistoryCursor | null {
  if (agent.historyStart) return null
  if (agent.historyFrom !== null) return { before: agent.historyFrom }
  const body = agent.log.filter(entry => entry.type !== 'session')
  if (!body.length) return { before: null }
  if (typeof body[0].at === 'number') {
    let min = body[0].at
    for (const entry of body) if (typeof entry.at === 'number' && entry.at < min) min = entry.at
    return { before: min }
  }
  for (const entry of body) {
    if ((entry.type === 'tool' || entry.type === 'subagent') && entry.toolUseId) return { before: null, anchor: entry.toolUseId }
  }
  return null
}

/**
 * Put an older piece of history above the agent's log. The piece is folded on its own (tool calls find their results
 * inside it); tool cards keep their `t:<id>` keys so one already shown is not shown twice, other keys get the piece's
 * offset as a prefix. With an anchor, the entries above the anchor's tool card are dropped first: the piece re-reads
 * them from the transcript. The session line stays on top.
 */
export function prependHistory(
  agent: EngineAgentState,
  events: EngineEvent[],
  from: number,
  done: boolean,
  anchor: string | null = null,
): EngineAgentState {
  let piece = createAgentState(agent.id, agent.firstSeenAt)
  // historyFrom set: the piece folds under the history cap, not the live one.
  piece = { ...piece, kind: agent.kind, owned: agent.owned, historyFrom: from }
  for (const event of events) piece = foldAgentEvent(piece, { ...event, history: true } as EngineEvent, { focused: false, live: false })
  let log = agent.log
  if (anchor) {
    const index = log.findIndex(entry => (entry.type === 'tool' || entry.type === 'subagent') && entry.toolUseId === anchor)
    if (index > 0) log = [...log.slice(0, index).filter(entry => entry.type === 'session'), ...log.slice(index)]
  }
  let head = 0
  while (head < log.length && log[head].type === 'session') head++
  const shown = new Set(log.map(entry => entry.key))
  const older: AgentLogEntry[] = []
  for (const entry of piece.log) {
    if (entry.type === 'session') continue
    const key = entry.key.startsWith('t:') ? entry.key : `h${from}:${entry.key}`
    if (shown.has(key)) continue
    shown.add(key)
    // The past is finished: a call whose result lies in a newer piece is done, not running.
    const settled = entry.type === 'tool' && entry.status === 'running' ? { ...entry, status: 'done' as const } : entry
    older.push({ ...settled, key, history: true })
  }
  return {
    ...agent,
    log: [...log.slice(0, head), ...older, ...log.slice(head)],
    historyFrom: from,
    historyStart: done,
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
