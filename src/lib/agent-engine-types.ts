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
  /** From the CLI's initialize: whether this model takes a thinking effort, and which levels. */
  supportsEffort?: boolean
  supportedEffortLevels?: EngineEffortLevel[]
}

/** `claude --effort` levels (Claude Code 2.1.318). A model may take only some (initialize models[].supportedEffortLevels). */
export const ENGINE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EngineEffortLevel = (typeof ENGINE_EFFORT_LEVELS)[number]

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
/** What runs an owned agent: a Claude Code session (agent.js) or a Hermes agent over ACP (hermes.js). */
export type EngineRuntime = 'claude' | 'hermes'

export interface EngineAgentSnapshot {
  id: string
  kind: EngineAgentKind
  /** Missing on engines older than runtimes: Claude Code. */
  runtime?: EngineRuntime
  /** A Hermes on another machine (ssh). */
  remote?: { host: string } | null
  /** The Hermes Agent version (hermes agents). */
  hermesVersion?: string | null
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
  /** The effort the process runs with (the CLI default when `effort` is null); from get_settings. */
  resolvedEffort?: string | null
  /** Eyes: each message the owner sends carries a picture from this agent's avatar. Missing on older engines. */
  eyes?: boolean
  /** Claude in Chrome: the owner's real browser, under the session's permission mode (engine chrome.js). */
  chrome?: boolean
  /** Voice: its replies end with a <spoken> line that its avatar says out loud (engine agent.js VOICE_NOTE). Missing on older engines. */
  speak?: boolean
  /** The voice the agent picked for itself (a key of village-voices.json); the owner's pick on the page wins. */
  voiceChoice?: string | null
  /** What the last turn came to, kept across engine restarts (engine outcome.js). */
  lastOutcome?: { outcome: string; reason?: string | null; at?: number | null } | null
  /** Told to carry on after an engine restart cut its turn; set until that turn ends. */
  resumedAt?: number | null
  /** The Claude account its process runs on (engine accounts.js), its pin (null: the village's choice), and whether it
   *  waits because every account is out of usage (until the first comes back). Missing on older engines. */
  account?: { id: string; label: string } | null
  accountPin?: string | null
  parked?: { until: number | null } | null
  /** When it wakes up on its own (engine schedule.js); null: off. Missing on engines older than schedules. */
  schedule?: EngineSchedule | null
  appointments?: EngineAppointment[]
  /** What wakes it next: its next recurring slot or appointment. */
  nextWake?: { at: number; label: string } | null
  /** Scheduled turns today (recurring and appointments). */
  wakesToday?: number
  /** The running turn was started by its schedule. */
  scheduledRun?: boolean
  status: EngineAgentStatus
  statusReason?: string | null
  alive?: boolean
  pid?: number | null
  pendingUser?: number
  permissions?: EnginePermissionRequest[]
  context?: EngineContextUsage | null
  models?: EngineModelInfo[] | null
  readOnly?: boolean
  /** A watched session running the Oasis plugin's mod (plugins/oasis): `send` reaches it through the bridge. */
  bridged?: boolean
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
  /** Byte offset of the transcript line this came from (observers, replayed or older history). */
  at?: number
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
  resolvedEffort?: string | null
}
export type EngineStatusEvent = EngineEventEnvelope<'status'> & { status: EngineAgentStatus; reason?: string | null }
/** A voice message's recording: the engine serves it at GET /file/<fileId>; the message text is its Scribe transcript. */
export interface EngineVoiceClip { fileId: string; mime?: string; durationMs?: number }
/** A picture pasted or dropped into an agent chat, on its way to the engine (base64, no data: prefix). */
export interface EngineSendPicture { data: string; mediaType: string; name?: string }
/** A picture the owner sent, as the thread shows it (GET /file/<fileId>). */
export interface EngineUserPicture { fileId: string; name?: string; mediaType?: string }
export type EngineUserSentEvent = EngineEventEnvelope<'user.sent'> & { uuid: string; text: string; midTurn?: boolean; priority?: string; voice?: EngineVoiceClip; images?: EngineUserPicture[]; auto?: 'resume' | 'schedule'; scheduled?: string }
export type EngineUserConsumedEvent = EngineEventEnvelope<'user.consumed'> & { uuid: string; folded?: boolean; waitedMs?: number }
export type EngineUserEvent = EngineEventEnvelope<'user'> & { text: string; uuid?: string | null; replay?: boolean; scheduled?: string }
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
/** A file an agent sent with SendUserFile; the engine serves it at GET /file/<id>. */
export interface EngineAttachment {
  id: string
  name: string
  size: number | null
  isImage: boolean
  mediaType: string | null
}
export type EngineToolEndEvent = EngineEventEnvelope<'tool.end'> & {
  toolUseId?: string | null
  name?: string | null
  isError?: boolean
  output?: string
  /** SendUserFile only: the files the agent showed you. */
  attachments?: EngineAttachment[]
  parentToolUseId?: string | null
}
export type EngineTodoEvent = EngineEventEnvelope<'todo'> & { source?: 'TodoWrite' | 'Task' | string; todos: EngineTodo[] }
export type EngineSubagentStartEvent = EngineEventEnvelope<'subagent.start'> & {
  toolUseId?: string | null
  taskId?: string | null
  description?: string
  subagentType?: string | null
  prompt?: string
  /** SendMessage woke a finished subagent up: the same subagent runs again. */
  resumed?: boolean
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
  /** A turn its schedule started (nobody else joined it): not "finished, unseen", no walk to the owner. */
  scheduled?: boolean
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
export type EngineExitEvent = EngineEventEnvelope<'exit'> & { code?: number | null; signal?: string | null; stderr?: string[]; /** A planned stop to move to another Claude account: the session starts again at once. */ switching?: boolean }
export type EngineModelEvent = EngineEventEnvelope<'model'> & { model?: string; resolved?: string; applied?: string; resolvedEffort?: string | null }
/** Thinking effort switched for an owned agent (setEffort): live, or `applied: 'on next start'` when its process is down. */
export type EngineEffortEvent = EngineEventEnvelope<'effort'> & { effort: string | null; resolvedEffort?: string | null; applied?: string }
/** Permission mode switched for an owned agent (setPermissionMode). */
export type EngineModeEvent = EngineEventEnvelope<'mode'> & { permissionMode: string; applied?: string }
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
  | EngineModeEvent
  | EngineEffortEvent
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

/** An agent's recurring wake-up (engine schedule.js). */
export const ENGINE_SCHEDULE_EVERY = ['off', 'hourly', '3h', '6h', 'daily', 'weekly'] as const
export type EngineScheduleEvery = (typeof ENGINE_SCHEDULE_EVERY)[number]
export interface EngineSchedule {
  every: EngineScheduleEvery
  /** "HH:MM": daily and weekly; for the intervals the first slot of the day. */
  at?: string
  /** Weekly: 0 = Sunday. */
  day?: number
  /** Its own standing prompt; null: the default. */
  prompt?: string | null
  since?: number
}
export interface EngineAppointment {
  id: string
  at: number
  repeat: 'daily' | 'weekly' | null
  note: string
  prompt: string | null
  by: string | null
  label?: string
}
export interface EngineScheduleSettings {
  /** No recurring wake-ups between these times; null: none. */
  quiet: { from: string; to: string } | null
  /** Recurring wake-ups per agent per day at most (appointments always fire). */
  dailyCap: number
}
export interface EngineScheduleView {
  agentId: string
  name: string
  schedule: EngineSchedule | null
  label: string
  appointments: EngineAppointment[]
  nextWake: { at: number; label: string } | null
  wakesToday: number
}

/** One agent as the page sees it, reported to the engine for its card. */
export interface EnginePresence {
  agentId: string
  /** The avatar file it wears, its gallery name and thumbnail path. */
  avatar?: string
  avatarName?: string
  thumb?: string
  /** "Brian (brian): deep, calm"; '' when it has no voice. */
  voice?: string
  /** The world the page is in. */
  world?: string
  /** Where its desk is and what is around it (village-place.ts). */
  place?: string
}

/** An agent's card (engine character.js): the engine's facts and the owner's or agent's own words. */
export interface EngineCharacter {
  agentId: string
  file: string | null
  name?: string
  role?: string
  who: string
  voice?: string
  look?: string
  avatar?: string
  world?: string
  home?: string
  place?: string
  /** The note the agent reads. */
  note: string
}

/** How the engine's current run began (engine resume.js): the HUD's engine pill shows `line` for a while. */
export interface EngineRestartInfo {
  startedAt: number
  /** How the run before ended; null on a first start. planned: the shutdown command, Ctrl+C or the window closing. */
  stop: { at: number; planned: boolean; reason?: string | null } | null
  /** Agents that were mid-turn and were told to carry on. */
  resumed: Array<{ id: string; name: string }>
  /** Messages that were on their way to an agent and went out again. */
  redelivered: number
  /** "restarted at 18:02, 1 agent resumed"; null on a first start. */
  line: string | null
}

/** The Claude accounts the agents run on (engine accounts.js). Never a token. */
export interface EngineAccount {
  id: string
  label: string
  email: string | null
  plan: string | null
  priority: number
  /** The CLI's own login (no token). */
  cli: boolean
  /** The CLI login is the same account as this token account (one quota). */
  sameAs: string | null
  /** Out of usage until then (ms), with why ("five_hour limit"). */
  exhaustedUntil: number | null
  why: string | null
  /** From its own rate_limit_events: five_hour, seven_day, … */
  /** Each window as the CLI last reported it. utilization null: no figure was sent (unknown, never guessed). */
  windows: Record<string, { utilization: number | null; resetsAt: number | null; status: string | null; at: number; source?: 'unified' | 'status-only' }>
}
export interface EngineAccountsView {
  /** "auto" (the account whose week ends first) or an account id. */
  villageDefault: string
  firstReset: number | null
  allExhausted: boolean
  accounts: EngineAccount[]
}

export interface EngineServerInfo {
  port?: number
  claude?: string
  restart?: EngineRestartInfo
  accounts?: EngineAccountsView
}

export type EngineServerMessage =
  | { type: 'hello'; agents: EngineAgentSnapshot[]; backlog?: Record<string, EngineEvent[]>; server?: EngineServerInfo; show?: string }
  /** /oasis was typed in that agent's Claude Code session: walk the camera to it (VillageShow.tsx). */
  | { type: 'show'; agentId: string }
  | { type: 'agents'; agents: EngineAgentSnapshot[] }
  | { type: 'event'; event: EngineEvent }
  /** The Claude accounts changed: usage learnt, one ran out or came back, the village default moved. */
  | ({ type: 'accounts' } & EngineAccountsView)
  /** The engine wants a picture from this agent's avatar for a message being sent (answer with the eyesFrame command). */
  | { type: 'eyes.request'; requestId: string; agentId: string }
  /** An agent asked for pictures (scripts/me.mjs): its own avatar from the front, or what is around it (answer with viewFrames). */
  | { type: 'view.request'; requestId: string; agentId: string; view: 'look' | 'around' }
  /** A step of the Council's scene for this page to do (engine stage.js); answer with the stageResult command. */
  | { type: 'stage.request'; requestId: string; request: { action: string } & Record<string, unknown> }
  | { type: 'reply'; id: number | string | null; cmd?: string; ok: boolean; data?: unknown; error?: string }

// ─── commands (browser → engine) ────────────────────────────────────────────

export interface SpawnAgentArgs {
  name?: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode?: string
  effort?: string
  /** Resume as a copy (`--fork-session`), leaving the original where it is open. */
  fork?: boolean
  /** Same session, moved here: the engine stops the other (idle) process that has it open, then resumes it.
   *  When it is opened there again, the engine lets go and watches it instead. */
  move?: boolean
  /** New agents only: create the working folder if it does not exist yet. */
  createCwd?: boolean
  /** Start with Claude in Chrome (off by default). */
  chrome?: boolean
  /** 'hermes': a Hermes agent (engine hermes.js) instead of a Claude Code session. */
  runtime?: EngineRuntime
  /** Hermes here: its home folder (a profile), HERMES_HOME. Without it, Hermes's own default profile. */
  hermesHome?: string
  /** Hermes on another machine over ssh: host (an ssh alias like `og`), and optionally its hermes binary, HERMES_HOME and folder there. */
  remote?: { host: string; address?: string; hermes?: string; home?: string; cwd?: string; worldPort?: number }
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
  /** Load the dictation model ahead of the first mic press (never installs or downloads). */
  warmEars: { args: { engine?: 'elevenlabs' | 'local' }; result: { warming: boolean; ready?: boolean; model?: string } }
  listLive: { args: Record<string, never>; result: Array<EngineLiveRegistryEntry & { sessionId: string }> }
  spawnAgent: { args: SpawnAgentArgs; result: EngineAgentSnapshot }
  send: { args: { agentId: string; text: string; priority?: 'now' | 'later'; images?: EngineSendPicture[] }; result: { uuid: string; midTurn: boolean } }
  interrupt: { args: { agentId: string; cancelQueued?: boolean }; result: { ok: boolean; data?: unknown; error?: string } }
  setModel: { args: { agentId: string; model: string }; result: { ok: boolean; data?: { model?: string }; error?: string } }
  setPermissionMode: { args: { agentId: string; mode: string }; result: { ok: boolean; error?: string } }
  /** effort: a level, or null / 'default' for the CLI default. Live, no restart and no turn. */
  setEffort: { args: { agentId: string; effort: string | null }; result: { ok: boolean; data?: { effort: string | null; resolvedEffort?: string | null }; error?: string } }
  /** Eyes on or off for an owned agent; kept in the roster. */
  setEyes: { args: { agentId: string; on: boolean }; result: { ok: boolean; data?: { eyes: boolean } } }
  /** Claude in Chrome on or off: the agent's process restarts with the same session (now, after the turn, or at its next start). */
  setChrome: { args: { agentId: string; chrome: boolean }; result: { ok: boolean; data?: { chrome: boolean; applied: string } } }
  /** Voice on or off for an owned agent (a spoken line at the end of each reply); kept in the roster, applies to the next message. */
  setSpeak: { args: { agentId: string; on: boolean }; result: { ok: boolean; data?: { speak: boolean } } }
  /** This page can stage the Council (walk and speak the agents on request); the last page to say so does it. */
  canStage: { args: { on: boolean }; result: { ok: boolean } }
  /** The answer to a stage.request. */
  stageResult: { args: { requestId: string; ok: boolean; data?: unknown; error?: string }; result: { ok: boolean } }
  /** A recorded voice message (base64 audio): kept, transcribed by ElevenLabs Scribe, the transcript sent to the agent. */
  rename: { args: { agentId: string; name: string }; result: EngineAgentSnapshot }
  readFile: { args: { fileId: string }; result: { name: string; text: string; mtimeMs: number; size: number } }
  writeFile: { args: { fileId: string; text: string; expectedMtimeMs: number | null; force?: boolean }; result: { name: string; mtimeMs: number; size: number } }
  voiceMessage: { args: { agentId: string; audio: string; mime: string; durationMs?: number; priority?: 'now' | 'later' }; result: { ok: boolean; data?: { transcript: string; fileId: string; uuid?: string }; error?: string } }
  /** This page can take eyes pictures (once per connection). */
  canSee: { args: { on: boolean }; result: { ok: boolean } }
  /** The answer to a view.request: the pictures, or none when this page has no view of that agent. */
  viewFrames: { args: { requestId: string; pictures?: Array<{ data: string; mediaType: string; label?: string }> }; result: { ok: boolean } }
  /** What this page knows about agents (their body, voice, world and place), for their cards (engine character.js). */
  presence: { args: { agents: EnginePresence[] }; result: { ok: boolean; data?: { agents: number } } }
  /** An agent's card: who it is. */
  getCharacter: { args: { agentId: string }; result: { ok: boolean; data: EngineCharacter } }
  /** The owner's (or the agent's) own words on the card. */
  setCharacter: { args: { agentId: string; role?: string; who?: string }; result: { ok: boolean; data: EngineCharacter } }
  /** Claude accounts (engine accounts.js). */
  listAccounts: { args: Record<string, never>; result: { ok: boolean; data: EngineAccountsView } }
  setDefaultAccount: { args: { account: string }; result: { ok: boolean; data: EngineAccountsView } }
  setAccount: { args: { agentId: string; account: string | null }; result: { ok: boolean; data: { agentId: string; accountPin: string | null } } }
  /** Schedules (engine schedule.js). */
  setSchedule: { args: { agentId: string; every?: EngineScheduleEvery; at?: string; day?: number; prompt?: string }; result: { ok: boolean; data: EngineScheduleView } }
  addAppointment: { args: { agentId: string; at: string | number; repeat?: 'daily' | 'weekly'; note?: string; prompt?: string; by?: string }; result: { ok: boolean; data: EngineScheduleView & { appointment: EngineAppointment } } }
  removeAppointment: { args: { agentId: string; id: string }; result: { ok: boolean; data: EngineScheduleView } }
  wakeNow: { args: { agentId: string; by?: string }; result: { ok: boolean; data: EngineScheduleView & { result: string } } }
  listSchedules: { args: Record<string, never>; result: { ok: boolean; data: { settings: EngineScheduleSettings; defaultPrompt: string; now: number; agents: EngineScheduleView[] } } }
  scheduleSettings: { args: { quiet?: EngineScheduleSettings['quiet']; dailyCap?: number }; result: { ok: boolean; data: { settings: EngineScheduleSettings; defaultPrompt: string } } }
  /** The answer to an eyes.request: the picture, or no data when this page has no view of that agent. */
  eyesFrame: { args: { requestId: string; data?: string; mediaType?: string }; result: { ok: boolean } }
  respond: { args: RespondArgs; result: { ok: boolean } }
  contextUsage: { args: { agentId: string }; result: unknown }
  kill: { args: { agentId: string; keep?: boolean }; result: { ok: boolean } }
  restart: { args: { agentId: string }; result: EngineAgentSnapshot }
  observe: { args: { sessionPath: string; name?: string }; result: EngineAgentSnapshot }
  unobserve: { args: { agentId: string }; result: { ok: boolean } }
  history: { args: { agentId: string }; result: EngineEvent[] }
  /** The session's past before a transcript offset (or before tool use `anchor`), read from its transcript. */
  olderHistory: {
    args: { agentId: string; before?: number | null; anchor?: string | null; minEvents?: number; maxBytes?: number }
    result: { events: EngineEvent[]; from: number; done: boolean }
  }
}

export type EngineCommandName = keyof EngineCommandMap
