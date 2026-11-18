// ░▒▓ AGENT ENGINE CLIENT — one WebSocket to packages/oasis-agent-engine ▓▒░
//
// ws://127.0.0.1:4530/ws (override with NEXT_PUBLIC_AGENT_ENGINE_URL). Server messages are
// dispatched into the agentEngine store slice; commands are `{id, cmd, ...args}` and resolve
// on the matching `{type:"reply", id}`. When the engine is not running the client keeps
// retrying with exponential backoff and the slice reports `offline`; nothing else in the
// Oasis depends on it.

import { withLocalToken } from './local-token'
import type {
  EngineScheduleEvery,
  EngineScheduleSettings,
  EnginePresence,
  EngineAgentSnapshot,
  EngineCommandMap,
  EngineCommandName,
  EngineEvent,
  EngineSendPicture,
  EngineServerMessage,
  EngineSessionMeta,
  SpawnAgentArgs,
} from './agent-engine-types'
import type { AgentEngineAction } from '../store/slices/agentEngineSlice'
import { useOasisStore } from '../store/oasisStore'

type EngineEventTap = (event: { kind: string; agentId: string; ts: number } & Record<string, unknown>) => void
const engineEventTaps = new Set<EngineEventTap>()

/** Hear every engine event (not the text deltas) as it arrives. Returns the unsubscribe function. */
export function onEngineEvent(tap: EngineEventTap): () => void {
  engineEventTaps.add(tap)
  return () => { engineEventTaps.delete(tap) }
}

export const DEFAULT_AGENT_ENGINE_URL = 'ws://127.0.0.1:4530/ws'

/**
 * What the owner reads when the page asks the engine for a command it doesn't know: the page was updated (hot
 * reload) and the engine still runs older code. Said instead of "unknown command X", for every command, and
 * announced once as the 'oasis:engine-outdated' event (ConnectionWarning shows it until the engine reconnects).
 */
export const ENGINE_OLDER_THAN_PAGE = 'The agent engine is older than this page: restart it (close the ENGINE window, double-click the OASIS shortcut).'
export const ENGINE_OUTDATED_EVENT = 'oasis:engine-outdated'

/** An engine error that means "this engine doesn't have that command yet". */
export function isUnknownCommandError(text: string | null | undefined): boolean {
  return /^unknown command\b/i.test(String(text || '').trim())
}

export function resolveAgentEngineUrl(value: string | undefined = process.env.NEXT_PUBLIC_AGENT_ENGINE_URL): string {
  const url = typeof value === 'string' ? value.trim() : ''
  return /^wss?:\/\//i.test(url) ? url : DEFAULT_AGENT_ENGINE_URL
}

/** HTTP link to a file an agent sent with SendUserFile (the engine's GET /file/<id>). */
export function agentEngineFileUrl(id: string, engineUrl: string = resolveAgentEngineUrl()): string {
  const base = new URL(engineUrl)
  base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:'
  base.pathname = `/file/${encodeURIComponent(id)}`
  base.search = ''
  return withLocalToken(base.toString())
}

export interface BackoffOptions {
  initialMs: number
  maxMs: number
  factor: number
  /** ±fraction of random spread so several tabs don't retry in lockstep. */
  jitter: number
}

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1000, maxMs: 15000, factor: 2, jitter: 0.2 }

/** Delay before reconnect attempt `attempt` (1-based): 1s, 2s, 4s, 8s, then 15s, with jitter. */
export function computeBackoffDelay(attempt: number, options: Partial<BackoffOptions> = {}, random: () => number = Math.random): number {
  const o = { ...DEFAULT_BACKOFF, ...options }
  const n = Math.max(1, Math.floor(attempt))
  const base = Math.min(o.maxMs, o.initialMs * Math.pow(o.factor, n - 1))
  const spread = base * o.jitter * (random() * 2 - 1)
  return Math.max(0, Math.round(Math.min(o.maxMs, base + spread)))
}

export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: { code?: number; reason?: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}

const WS_OPEN = 1

export interface AgentEngineClientOptions {
  url?: string
  dispatch: (action: AgentEngineAction) => void
  createSocket?: (url: string) => WebSocketLike
  backoff?: Partial<BackoffOptions>
  now?: () => number
  random?: () => number
  commandTimeoutMs?: number
  /** Text deltas are coalesced per message and flushed at most this often (ms). */
  deltaFlushMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface PendingCommand {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timer: unknown
  cmd: string
}

type TextDeltaEvent = Extract<EngineEvent, { kind: 'text.delta' }>

/** A picture from an agent's avatar: base64 without the data: prefix. */
export interface EyesPicture {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}
/** A picture taken on request, with what it shows ("ahead", "front"). */
export interface ViewPicture extends EyesPicture {
  label: string
}
/** Takes the pictures for one agent (its own avatar, or its surroundings); none when this page has no view of it. */
export type ViewCapturer = (agentId: string, view: 'look' | 'around') => ViewPicture[]

/** Takes the picture for one agent, or null when this page has no view of it. Must not throw for long: it is synchronous work. */
export type EyesCapturer = (agentId: string) => EyesPicture | null
/** Does one step of the Council's scene and resolves with what to tell the moderator (rejects with why not). */
export type StageHandler = (request: { action: string } & Record<string, unknown>) => Promise<unknown>

const LONG_COMMANDS: Partial<Record<EngineCommandName, number>> = { listSessions: 60000, spawnAgent: 45000, observe: 45000 }

export class AgentEngineClient {
  readonly url: string
  private readonly dispatch: (action: AgentEngineAction) => void
  private readonly createSocket: (url: string) => WebSocketLike
  private readonly backoff: Partial<BackoffOptions>
  private readonly now: () => number
  private readonly random: () => number
  private readonly commandTimeoutMs: number
  private readonly deltaFlushMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  private socket: WebSocketLike | null = null
  private running = false
  private attempts = 0
  private retryTimer: unknown = null
  private seq = 0
  private readonly pending = new Map<number, PendingCommand>()
  private readonly deltas = new Map<string, TextDeltaEvent>()
  private deltaTimer: unknown = null
  private eyesCapturer: EyesCapturer | null = null
  private viewCapturer: ViewCapturer | null = null
  private stageHandler: StageHandler | null = null
  private showListeners = new Set<(agentId: string) => void>()

  constructor(options: AgentEngineClientOptions) {
    this.url = options.url || resolveAgentEngineUrl()
    this.dispatch = options.dispatch
    this.createSocket = options.createSocket || ((url) => new WebSocket(url) as unknown as WebSocketLike)
    this.backoff = options.backoff || {}
    this.now = options.now || Date.now
    this.random = options.random || Math.random
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30000
    this.deltaFlushMs = options.deltaFlushMs ?? 50
    this.setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer || ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  get isRunning(): boolean {
    return this.running
  }

  get isOpen(): boolean {
    return Boolean(this.socket && this.socket.readyState === WS_OPEN)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.attempts = 0
    this.dispatch({ type: 'connection', status: 'connecting', at: this.now() })
    this.open()
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.cancelRetry()
    this.flushDeltas()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null
      try { socket.close(1000, 'client stopped') } catch { /* already closed */ }
    }
    this.rejectPending('agent engine client stopped')
    this.dispatch({ type: 'connection', status: 'disabled', error: null, attempts: 0, nextRetryAt: null, at: this.now() })
  }

  /** Skip the backoff wait (e.g. a "retry now" button). */
  retryNow(): void {
    if (!this.running || this.socket) return
    this.cancelRetry()
    this.dispatch({ type: 'connection', status: 'connecting', at: this.now() })
    this.open()
  }

  cmd<K extends EngineCommandName>(
    name: K,
    args: EngineCommandMap[K]['args'],
    options: { timeoutMs?: number } = {},
  ): Promise<EngineCommandMap[K]['result']> {
    const socket = this.socket
    if (!socket || socket.readyState !== WS_OPEN) {
      return Promise.reject(new Error('Agent engine is offline. Start it with `pnpm dev:engine`.'))
    }
    const id = ++this.seq
    const timeoutMs = options.timeoutMs ?? LONG_COMMANDS[name] ?? this.commandTimeoutMs
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`Agent engine did not answer ${name} within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer, cmd: name })
      try {
        socket.send(JSON.stringify({ ...args, id, cmd: name }))
      } catch (error) {
        this.clearTimer(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  // ─── typed command helpers ────────────────────────────────────────────────

  listAgents(): Promise<EngineAgentSnapshot[]> {
    return this.cmd('listAgents', {})
  }

  /** Metadata only (title, cwd, size, live badge); the engine never sends transcripts here. */
  listSessions(limit = 300): Promise<EngineSessionMeta[]> {
    return this.cmd('listSessions', { limit })
  }

  /** Sessions open right now in the desktop app or a terminal (~/.claude/sessions). */
  listLive() {
    return this.cmd('listLive', {})
  }

  /** Wakes the dictation model (Moonshine) so the first words come fast; ElevenLabs voice typing needs no warming. */
  warmEars(engine?: 'elevenlabs' | 'local') {
    return this.cmd('warmEars', engine ? { engine } : {})
  }

  spawnAgent(args: SpawnAgentArgs): Promise<EngineAgentSnapshot> {
    return this.cmd('spawnAgent', args)
  }

  /** images: pictures pasted or dropped into the chat; they go out with the text as image blocks. */
  send(agentId: string, text: string, priority?: 'now' | 'later', images?: EngineSendPicture[]) {
    return this.cmd('send', { agentId, text, ...(priority ? { priority } : {}), ...(images?.length ? { images } : {}) }, images?.length ? { timeoutMs: 60_000 } : {})
  }

  interrupt(agentId: string, cancelQueued = false) {
    return this.cmd('interrupt', { agentId, cancelQueued })
  }

  setModel(agentId: string, model: string) {
    return this.cmd('setModel', { agentId, model })
  }

  setPermissionMode(agentId: string, mode: string) {
    return this.cmd('setPermissionMode', { agentId, mode })
  }

  /** Eyes on or off: with it on, each message you send carries a picture from the agent's avatar. */
  /** A recorded voice message: the engine keeps it, Scribe transcribes it, the agent gets the transcript. Can take a while. */
  voiceMessage(agentId: string, audio: string, mime: string, durationMs?: number, priority?: 'now' | 'later') {
    // Long recordings take longer to transcribe: 2.5 minutes, plus a tenth of the recording's length.
    const timeoutMs = 150_000 + Math.round((durationMs || 0) / 10)
    return this.cmd('voiceMessage', { agentId, audio, mime, ...(durationMs ? { durationMs } : {}), ...(priority ? { priority } : {}) }, { timeoutMs })
  }

  /** The md reader: a text file an agent sent (the engine allows only those, .md / .markdown / .txt). */
  readFile(fileId: string) {
    return this.cmd('readFile', { fileId })
  }

  /** Save it back to its own path. Refused (the message says "changed on disk") when the file changed since it was read, unless forced. */
  writeFile(fileId: string, text: string, expectedMtimeMs: number | null, force = false) {
    return this.cmd('writeFile', { fileId, text, expectedMtimeMs, force })
  }

  /** Claude in Chrome for an agent: restarts its process with the same session. */
  setChrome(agentId: string, chrome: boolean) {
    return this.cmd('setChrome', { agentId, chrome })
  }

  setEyes(agentId: string, on: boolean) {
    return this.cmd('setEyes', { agentId, on })
  }

  /** Voice on or off: with it on, each reply ends with a short line the agent's avatar says out loud. */
  setSpeak(agentId: string, on: boolean) {
    return this.cmd('setSpeak', { agentId, on })
  }

  /**
   * The village scene registers how to take an eyes picture (VillageEyes.tsx); the engine then asks this page
   * for one with each message to an agent whose eyes are on. Returns the unregister function.
   */
  /** The engine asks to show an agent (someone typed /oasis in its session). Returns the unsubscribe function. */
  onShow(listener: (agentId: string) => void): () => void {
    this.showListeners.add(listener)
    return () => { this.showListeners.delete(listener) }
  }

  private emitShow(agentId: string): void {
    for (const listener of this.showListeners) {
      try { listener(agentId) } catch { /* a listener's problem is not the socket's */ }
    }
  }

  setEyesCapturer(capturer: EyesCapturer): () => void {
    this.eyesCapturer = capturer
    this.announceEyes()
    return () => {
      if (this.eyesCapturer !== capturer) return
      this.eyesCapturer = null
      this.announceEyes()
    }
  }

  /**
   * The village registers how to do a step of the Council's scene (village-council.ts); the engine then sends
   * this page the moderator's requests. Returns the unregister function.
   */
  setStageHandler(handler: StageHandler): () => void {
    this.stageHandler = handler
    this.announceStage()
    return () => {
      if (this.stageHandler !== handler) return
      this.stageHandler = null
      this.announceStage()
    }
  }

  private announceStage(): void {
    if (!this.isOpen) return
    // An engine older than the Council answers "unknown command": nothing to do then.
    this.cmd('canStage', { on: Boolean(this.stageHandler) }).catch(() => {})
  }

  private answerStage(requestId: string, request: { action: string } & Record<string, unknown>): void {
    const handler = this.stageHandler
    const done = (ok: boolean, data?: unknown, error?: string) => { this.cmd('stageResult', { requestId, ok, ...(ok ? { data } : { error }) }).catch(() => {}) }
    if (!handler) {
      done(false, undefined, 'this page has no stage')
      return
    }
    Promise.resolve()
      .then(() => handler(request))
      .then(data => done(true, data), error => done(false, undefined, error instanceof Error ? error.message : String(error)))
  }

  private announceEyes(): void {
    if (!this.isOpen) return
    // An engine older than eyes answers "unknown command": nothing to do then.
    this.cmd('canSee', { on: Boolean(this.eyesCapturer) }).catch(() => {})
  }

  /**
   * The village scene registers how to take pictures on request (VillageEyes.tsx): an agent's own avatar from the
   * front, or what is around it. Returns the unregister function.
   */
  setViewCapturer(capturer: ViewCapturer): () => void {
    this.viewCapturer = capturer
    return () => { if (this.viewCapturer === capturer) this.viewCapturer = null }
  }

  private answerView(requestId: string, agentId: string, view: 'look' | 'around'): void {
    let pictures: ViewPicture[] = []
    try {
      pictures = this.viewCapturer ? this.viewCapturer(agentId, view) : []
    } catch {
      pictures = []
    }
    // Always answer, also with nothing: the engine then stops waiting.
    this.cmd('viewFrames', pictures.length ? { requestId, pictures } : { requestId }).catch(() => {})
  }

  /** What this page knows about agents, for their cards. */
  reportPresence(agents: EnginePresence[]) {
    return this.cmd('presence', { agents })
  }

  getCharacter(agentId: string) {
    return this.cmd('getCharacter', { agentId })
  }

  setCharacter(agentId: string, own: { role?: string; who?: string }) {
    return this.cmd('setCharacter', { agentId, ...own })
  }

  /** An agent's recurring wake-up and its standing prompt (engine schedule.js). Fields left out keep their value. */
  setSchedule(agentId: string, schedule: { every?: EngineScheduleEvery; at?: string; day?: number; prompt?: string }) {
    return this.cmd('setSchedule', { agentId, ...schedule })
  }

  addAppointment(agentId: string, appointment: { at: string | number; repeat?: 'daily' | 'weekly'; note?: string; prompt?: string }) {
    return this.cmd('addAppointment', { agentId, by: 'the owner', ...appointment })
  }

  removeAppointment(agentId: string, id: string) {
    return this.cmd('removeAppointment', { agentId, id })
  }

  wakeNow(agentId: string) {
    return this.cmd('wakeNow', { agentId, by: 'the owner' })
  }

  /** Quiet hours and the daily cap, for all agents. With no argument: read them. */
  scheduleSettings(patch: { quiet?: EngineScheduleSettings['quiet']; dailyCap?: number } = {}) {
    return this.cmd('scheduleSettings', patch)
  }

  private answerEyes(requestId: string, agentId: string): void {
    let picture: EyesPicture | null = null
    try {
      picture = this.eyesCapturer ? this.eyesCapturer(agentId) : null
    } catch {
      picture = null
    }
    // Always answer, also with nothing: the engine then stops waiting and sends the text alone.
    this.cmd('eyesFrame', picture ? { requestId, data: picture.data, mediaType: picture.mediaType } : { requestId }).catch(() => {})
  }

  /** Thinking effort (low … max), or null for the CLI default. Applies live; a stopped agent gets it on its next start. */
  setEffort(agentId: string, effort: string | null) {
    return this.cmd('setEffort', { agentId, effort })
  }

  /** Owned agents: stop the process and drop it from the roster. Observers: stop tailing. */
  kill(agentId: string) {
    return this.cmd('kill', { agentId })
  }

  observe(sessionPath: string, name?: string): Promise<EngineAgentSnapshot> {
    return this.cmd('observe', name ? { sessionPath, name } : { sessionPath })
  }

  unobserve(agentId: string) {
    return this.cmd('unobserve', { agentId })
  }

  contextUsage(agentId: string) {
    return this.cmd('contextUsage', { agentId })
  }

  history(agentId: string): Promise<EngineEvent[]> {
    return this.cmd('history', { agentId })
  }

  respondPermission(agentId: string, requestId: string, decision: { allow: boolean; always?: boolean; message?: string }) {
    return this.respond({
      agentId,
      requestId,
      behavior: decision.allow ? 'allow' : 'deny',
      ...(decision.allow && decision.always ? { always: true } : {}),
      ...(!decision.allow && decision.message ? { message: decision.message } : {}),
    })
  }

  /** AskUserQuestion: `answers` maps each question's text to the chosen label(s). */
  answerQuestion(agentId: string, requestId: string, answers: Record<string, string>) {
    return this.respond({ agentId, requestId, behavior: 'allow', answers })
  }

  dismissQuestion(agentId: string, requestId: string, message = 'The owner dismissed the question.') {
    return this.respond({ agentId, requestId, behavior: 'deny', message })
  }

  /** ExitPlanMode: approve (optionally applying the CLI's suggested mode), or send it back to planning. */
  respondPlan(agentId: string, requestId: string, decision: { approve: boolean; always?: boolean; message?: string }) {
    return this.respond({
      agentId,
      requestId,
      behavior: decision.approve ? 'allow' : 'deny',
      ...(decision.approve && decision.always ? { always: true } : {}),
      ...(!decision.approve ? { message: decision.message || 'Keep planning. The owner did not approve this plan yet.' } : {}),
    })
  }

  /**
   * One answer per request: the slice marks it in flight (every card for it disables) until the
   * engine's permission.resolved arrives, or until sending fails.
   */
  private respond(args: EngineCommandMap['respond']['args']) {
    this.dispatch({ type: 'decision/pending', requestId: args.requestId, pending: true, at: this.now() })
    return this.cmd('respond', args).catch((error: unknown) => {
      this.dispatch({ type: 'decision/pending', requestId: args.requestId, pending: false, at: this.now() })
      throw error
    })
  }

  // ─── socket lifecycle ─────────────────────────────────────────────────────

  private open(): void {
    let socket: WebSocketLike
    try {
      socket = this.createSocket(withLocalToken(this.url))
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : String(error))
      return
    }
    this.socket = socket
    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      this.handleMessage(event.data)
    }
    socket.onerror = () => { /* onclose follows with the details we have */ }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.flushDeltas()
      this.rejectPending('agent engine connection closed')
      if (!this.running) return
      const code = event?.code ? ` (code ${event.code})` : ''
      this.scheduleReconnect(`Engine offline at ${this.url}${code}`)
    }
  }

  private scheduleReconnect(reason: string): void {
    this.attempts += 1
    const delay = computeBackoffDelay(this.attempts, this.backoff, this.random)
    this.dispatch({ type: 'connection', status: 'offline', error: reason, attempts: this.attempts, nextRetryAt: this.now() + delay, at: this.now() })
    this.cancelRetry()
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null
      if (!this.running || this.socket) return
      this.dispatch({ type: 'connection', status: 'connecting', at: this.now() })
      this.open()
    }, delay)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer)
    this.retryTimer = null
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      this.clearTimer(pending.timer)
      pending.reject(new Error(`${reason} before ${pending.cmd} finished`))
      this.pending.delete(id)
    }
  }

  private handleMessage(raw: unknown): void {
    let message: EngineServerMessage
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as EngineServerMessage
    } catch {
      return
    }
    switch (message?.type) {
      case 'hello':
        this.attempts = 0
        this.flushDeltas()
        this.dispatch({ type: 'hello', agents: message.agents || [], backlog: message.backlog || {}, server: message.server, at: this.now() })
        if (this.eyesCapturer) this.announceEyes()
        if (this.stageHandler) this.announceStage()
        if (typeof message.show === 'string') this.emitShow(message.show)
        return
      case 'show':
        if (typeof message.agentId === 'string') this.emitShow(message.agentId)
        return
      case 'stage.request':
        if (typeof message.requestId === 'string' && message.request && typeof message.request.action === 'string') this.answerStage(message.requestId, message.request)
        return
      case 'view.request':
        if (typeof message.requestId === 'string' && typeof message.agentId === 'string') this.answerView(message.requestId, message.agentId, message.view === 'around' ? 'around' : 'look')
        return
      case 'eyes.request':
        if (typeof message.requestId === 'string' && typeof message.agentId === 'string') this.answerEyes(message.requestId, message.agentId)
        return
      case 'agents':
        this.flushDeltas()
        this.dispatch({ type: 'agents', agents: message.agents || [], at: this.now() })
        return
      case 'event': {
        const event = message.event
        if (!event || typeof event !== 'object') return
        if (event.kind === 'text.delta') {
          this.bufferDelta(event as TextDeltaEvent)
          return
        }
        this.flushDeltas()
        this.dispatch({ type: 'event', event })
        // Listeners outside the store (the Mindcraft work counter books agent hours from turn and helper ends).
        for (const tap of engineEventTaps) tap(event as { kind: string; agentId: string; ts: number } & Record<string, unknown>)
        return
      }
      case 'reply': {
        const id = typeof message.id === 'number' ? message.id : Number(message.id)
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        this.clearTimer(pending.timer)
        // Control requests (setModel, setPermissionMode, interrupt) resolve to {ok:false, error}
        // inside a successful reply on older engines: treat those as failures too.
        const data = message.data as { ok?: unknown; error?: unknown } | null | undefined
        const failedInside = Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.ok === false)
        if (message.ok && !failedInside) pending.resolve(message.data)
        else {
          const text = message.error || (failedInside && data?.error ? String(data.error) : `${pending.cmd} failed`)
          if (isUnknownCommandError(text)) {
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ENGINE_OUTDATED_EVENT, { detail: { cmd: pending.cmd } }))
            pending.reject(new Error(ENGINE_OLDER_THAN_PAGE))
          } else pending.reject(new Error(text))
        }
        return
      }
      default:
        return
    }
  }

  /** Streaming text arrives as many small deltas; merge them so the store updates ~20x/s at most. */
  private bufferDelta(event: TextDeltaEvent): void {
    const key = `${event.agentId}\u0000${event.messageId ?? ''}\u0000${event.parentToolUseId ?? ''}`
    const existing = this.deltas.get(key)
    if (existing) this.deltas.set(key, { ...existing, text: existing.text + (event.text || '') })
    else this.deltas.set(key, event)
    if (this.deltaTimer === null) {
      this.deltaTimer = this.setTimer(() => {
        this.deltaTimer = null
        this.flushDeltas()
      }, this.deltaFlushMs)
    }
  }

  private flushDeltas(): void {
    if (this.deltaTimer !== null) {
      this.clearTimer(this.deltaTimer)
      this.deltaTimer = null
    }
    if (!this.deltas.size) return
    const batch = [...this.deltas.values()]
    this.deltas.clear()
    for (const event of batch) this.dispatch({ type: 'event', event })
  }
}

// ─── the Oasis singleton, bound to the store ────────────────────────────────

let singleton: AgentEngineClient | null = null

export function getAgentEngineClient(): AgentEngineClient {
  if (!singleton) {
    singleton = new AgentEngineClient({
      dispatch: (action) => useOasisStore.getState().agentEngineDispatch(action),
    })
  }
  return singleton
}
