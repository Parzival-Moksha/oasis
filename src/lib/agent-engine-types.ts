// Types for the Oasis agent engine (packages/oasis-agent-engine), event schema v1.
// The engine is the source of truth: see packages/oasis-agent-engine/README.md and src/index.js
// for the exact WebSocket messages. These types describe what the browser receives and sends.

export type EngineAgentStatus = 'working' | 'waiting' | 'needs-decision' | 'error' | 'idle'
export type EngineAgentKind = 'owned' | 'observer' | 'hook'
export type EngineRequestKind = 'permission' | 'question' | 'plan'

export const ENGINE_AGENT_STATUSES: readonly EngineAgentStatus[] = ['working', 'waiting', 'needs-decision', 'error', 'idle']

export interface EngineModelInfo {
  value: string
  resolvedModel?: string | null
  displayName?: string | null
}

export interface EngineContextUsage {
  usedTokens: number | null
  maxTokens: number | null
  percent: number | null
  model?: string | null
}

export interface EngineQuestionOption {
  label: string
  description?: string
}

export interface EngineQuestion {
  question: string
  header?: string
  options?: EngineQuestionOption[]
  multiSelect?: boolean
}

/** A can_use_tool request the CLI routed to the host (or one seen read-only via a hook). */
export interface EnginePermissionRequest {
  requestId: string | null
  requestKind: EngineRequestKind
  toolName: string
  toolUseId?: string | null
  input?: unknown
  summary?: string
  description?: string | null
  suggestions?: unknown[]
  blockedPath?: string | null
  decisionReason?: unknown
  readOnly?: boolean
}

/** Agent snapshot as broadcast in `hello` and `agents` messages (Agent / Observer / HookObserver.snapshot()). */
export interface EngineAgentSnapshot {
  id: string
  kind: EngineAgentKind
  name: string
  title?: string | null
  cwd?: string | null
  sessionId?: string | null
  sessionPath?: string | null
  model?: string | null
  resolvedModel?: string | null
  permissionMode?: string | null
  effectivePermissionMode?: string | null
  effort?: string | null
  status: EngineAgentStatus
  statusReason?: string | null
  alive?: boolean
  pid?: number | null
  pendingUser?: number
  permissions?: EnginePermissionRequest[]
  context?: EngineContextUsage | null
  models?: EngineModelInfo[] | null
  readOnly?: boolean
  lastWriteAt?: number
}

export interface EngineTodo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | string
  activeForm?: string
}

export interface EngineTurnUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheCreation?: number
}

export interface EngineRateLimit {
  status?: string
  utilization?: number
  resetsAt?: number | string
  window?: string
}

interface EngineEventEnvelope<K extends string> {
  v: 1
  agentId: string
  ts: number
  kind: K
  /** Replayed from a resumed transcript (owned agents) rather than seen live. */
  history?: boolean
}

export type EngineInitEvent = EngineEventEnvelope<'init'> & {
  sessionId?: string
  model?: string
  permissionMode?: string
  cwd?: string
  tools?: string[]
  observed?: boolean
  sessionPath?: string
  viaHook?: boolean
}
export type EngineMetaEvent = EngineEventEnvelope<'meta'> & {
  models?: EngineModelInfo[]
  subscription?: string | null
  claudeCodeVersion?: string
  permissionMode?: string
  title?: string
}
export type EngineStatusEvent = EngineEventEnvelope<'status'> & { status: EngineAgentStatus; reason?: string | null }
export type EngineUserSentEvent = EngineEventEnvelope<'user.sent'> & { uuid: string; text: string; midTurn?: boolean; priority?: string }
export type EngineUserConsumedEvent = EngineEventEnvelope<'user.consumed'> & { uuid: string; folded?: boolean; waitedMs?: number }
export type EngineUserEvent = EngineEventEnvelope<'user'> & { text: string; uuid?: string | null; replay?: boolean }
export type EngineTextDeltaEvent = EngineEventEnvelope<'text.delta'> & {
  messageId?: string | null
  index?: number
  text: string
  parentToolUseId?: string | null
}
export type EngineTextEvent = EngineEventEnvelope<'text'> & {
  messageId?: string | null
  text: string
  parentToolUseId?: string | null
  model?: string
}
export type EngineToolStartEvent = EngineEventEnvelope<'tool.start'> & {
  toolUseId?: string | null
  name: string
  input?: unknown
  summary?: string
  parentToolUseId?: string | null
}
export type EngineToolEndEvent = EngineEventEnvelope<'tool.end'> & {
  toolUseId?: string | null
  name?: string | null
  isError?: boolean
  output?: string
  parentToolUseId?: string | null
}
export type EngineTodoEvent = EngineEventEnvelope<'todo'> & { source?: 'TodoWrite' | 'Task' | string; todos: EngineTodo[] }
export type EngineSubagentStartEvent = EngineEventEnvelope<'subagent.start'> & {
  toolUseId?: string | null
  taskId?: string | null
  description?: string
  subagentType?: string | null
  prompt?: string
}
export type EngineSubagentProgressEvent = EngineEventEnvelope<'subagent.progress'> & {
  toolUseId?: string | null
  taskId?: string | null
  description?: string
  lastToolName?: string
}
export type EngineSubagentEndEvent = EngineEventEnvelope<'subagent.end'> & {
  toolUseId?: string | null
  taskId?: string | null
  status?: string
  summary?: string
}
export type EnginePermissionRequestEvent = EngineEventEnvelope<'permission.request'> & EnginePermissionRequest
export type EnginePermissionResolvedEvent = EngineEventEnvelope<'permission.resolved'> & {
  requestId: string | null
  behavior: 'allow' | 'deny' | 'cancelled' | string
  toolName?: string
}
export type EnginePermissionDeniedEvent = EngineEventEnvelope<'permission.denied'> & {
  toolName?: string
  toolUseId?: string | null
  message?: string
}
export type EngineTurnEndEvent = EngineEventEnvelope<'turn.end'> & {
  subtype?: string
  isError?: boolean
  outcome: 'done-waiting' | 'needs-decision' | 'error' | string
  reason?: string
  result?: string
  durationMs?: number | null
  durationApiMs?: number | null
  numTurns?: number | null
  usage?: EngineTurnUsage | null
  costUsd?: number | null
  totalCostUsd?: number | null
  contextTokens?: number | null
  contextWindow?: number | null
  model?: string | null
  permissionDenials?: Array<{ toolName?: string; toolUseId?: string | null }>
  terminalReason?: string | null
  observed?: boolean
}
export type EngineContextEvent = EngineEventEnvelope<'context'> & EngineContextUsage
export type EngineRateLimitEvent = EngineEventEnvelope<'rate_limit'> & EngineRateLimit
export type EngineNoticeEvent = EngineEventEnvelope<'notice'> & { subtype?: string; text?: string; model?: string }
export type EngineErrorEvent = EngineEventEnvelope<'error'> & { message?: string; retrying?: boolean }
export type EngineExitEvent = EngineEventEnvelope<'exit'> & { code?: number | null; signal?: string | null; stderr?: string[] }
export type EngineModelEvent = EngineEventEnvelope<'model'> & { model?: string; resolved?: string; applied?: string }
export type EngineHookEvent = EngineEventEnvelope<'hook'> & { event?: string; toolName?: string | null }
export type EngineRemovedEvent = EngineEventEnvelope<'removed'>

export type KnownEngineEvent =
  | EngineInitEvent
  | EngineMetaEvent
  | EngineStatusEvent
  | EngineUserSentEvent
  | EngineUserConsumedEvent
  | EngineUserEvent
  | EngineTextDeltaEvent
  | EngineTextEvent
  | EngineToolStartEvent
  | EngineToolEndEvent
  | EngineTodoEvent
  | EngineSubagentStartEvent
  | EngineSubagentProgressEvent
  | EngineSubagentEndEvent
  | EnginePermissionRequestEvent
  | EnginePermissionResolvedEvent
  | EnginePermissionDeniedEvent
  | EngineTurnEndEvent
  | EngineContextEvent
  | EngineRateLimitEvent
  | EngineNoticeEvent
  | EngineErrorEvent
  | EngineExitEvent
  | EngineModelEvent
  | EngineHookEvent
  | EngineRemovedEvent

export type EngineEventKind = KnownEngineEvent['kind']

/** Anything the engine emits. Unknown kinds are tolerated and ignored by the reducer. */
export type EngineEvent = KnownEngineEvent | (EngineEventEnvelope<string> & Record<string, unknown>)

export interface EngineLiveRegistryEntry {
  pid: number
  status?: string
  kind?: string
  entrypoint?: string
  name?: string
  cwd?: string
  statusUpdatedAt?: number
}

/** One row of `listSessions` (metadata only, read from a transcript's head and tail). */
export interface EngineSessionMeta {
  sessionId: string
  path: string
  projectDir?: string
  cwd: string | null
  title: string
  titleSource?: string | null
  firstPrompt?: string | null
  lastPrompt?: string | null
  entrypoint?: string | null
  version?: string | null
  gitBranch?: string | null
  size: number
  mtime: number
  recentlyActive?: boolean
  live: EngineLiveRegistryEntry | null
  ownedBy: string | null
  observedBy: string | null
}

export interface EngineServerInfo {
  port?: number
  claude?: string
}

export type EngineServerMessage =
  | { type: 'hello'; agents: EngineAgentSnapshot[]; backlog?: Record<string, EngineEvent[]>; server?: EngineServerInfo }
  | { type: 'agents'; agents: EngineAgentSnapshot[] }
  | { type: 'event'; event: EngineEvent }
  | { type: 'reply'; id: number | string | null; cmd?: string; ok: boolean; data?: unknown; error?: string }

// ─── commands (browser → engine) ────────────────────────────────────────────

export interface SpawnAgentArgs {
  name?: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode?: string
  effort?: string
  /** Resume as a copy (`--fork-session`). Required when the session is open in another process. */
  fork?: boolean
}

export type RespondBehavior = 'allow' | 'deny'

export interface RespondArgs {
  agentId: string
  requestId: string
  behavior: RespondBehavior
  message?: string
  answers?: Record<string, string>
  always?: boolean
  updatedInput?: unknown
}

export interface EngineCommandMap {
  listAgents: { args: Record<string, never>; result: EngineAgentSnapshot[] }
  listSessions: { args: { limit?: number }; result: EngineSessionMeta[] }
  listLive: { args: Record<string, never>; result: Array<EngineLiveRegistryEntry & { sessionId: string }> }
  spawnAgent: { args: SpawnAgentArgs; result: EngineAgentSnapshot }
  send: { args: { agentId: string; text: string; priority?: 'now' | 'later' }; result: { uuid: string; midTurn: boolean } }
  interrupt: { args: { agentId: string; cancelQueued?: boolean }; result: { ok: boolean; data?: unknown; error?: string } }
  setModel: { args: { agentId: string; model: string }; result: { ok: boolean; data?: { model?: string }; error?: string } }
  setPermissionMode: { args: { agentId: string; mode: string }; result: { ok: boolean; error?: string } }
  respond: { args: RespondArgs; result: { ok: boolean } }
  contextUsage: { args: { agentId: string }; result: unknown }
  kill: { args: { agentId: string; keep?: boolean }; result: { ok: boolean } }
  restart: { args: { agentId: string }; result: EngineAgentSnapshot }
  observe: { args: { sessionPath: string; name?: string }; result: EngineAgentSnapshot }
  unobserve: { args: { agentId: string }; result: { ok: boolean } }
  history: { args: { agentId: string }; result: EngineEvent[] }
}

export type EngineCommandName = keyof EngineCommandMap
