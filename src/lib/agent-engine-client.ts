// ░▒▓ AGENT ENGINE CLIENT — one WebSocket to packages/oasis-agent-engine ▓▒░
//
// ws://127.0.0.1:4530/ws (override with NEXT_PUBLIC_AGENT_ENGINE_URL). Server messages are
// dispatched into the agentEngine store slice; commands are `{id, cmd, ...args}` and resolve
// on the matching `{type:"reply", id}`. When the engine is not running the client keeps
// retrying with exponential backoff and the slice reports `offline`; nothing else in the
// Oasis depends on it.

import type {
  EngineAgentSnapshot,
  EngineCommandMap,
  EngineCommandName,
  EngineEvent,
  EngineServerMessage,
  EngineSessionMeta,
  SpawnAgentArgs,
} from './agent-engine-types'
import type { AgentEngineAction } from '../store/slices/agentEngineSlice'
import { useOasisStore } from '../store/oasisStore'

export const DEFAULT_AGENT_ENGINE_URL = 'ws://127.0.0.1:4530/ws'

export function resolveAgentEngineUrl(value: string | undefined = process.env.NEXT_PUBLIC_AGENT_ENGINE_URL): string {
  const url = typeof value === 'string' ? value.trim() : ''
  return /^wss?:\/\//i.test(url) ? url : DEFAULT_AGENT_ENGINE_URL
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

  spawnAgent(args: SpawnAgentArgs): Promise<EngineAgentSnapshot> {
    return this.cmd('spawnAgent', args)
  }

  send(agentId: string, text: string, priority?: 'now' | 'later') {
    return this.cmd('send', priority ? { agentId, text, priority } : { agentId, text })
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
    return this.cmd('respond', {
      agentId,
      requestId,
      behavior: decision.allow ? 'allow' : 'deny',
      ...(decision.allow && decision.always ? { always: true } : {}),
      ...(!decision.allow && decision.message ? { message: decision.message } : {}),
    })
  }

  /** AskUserQuestion: `answers` maps each question's text to the chosen label(s). */
  answerQuestion(agentId: string, requestId: string, answers: Record<string, string>) {
    return this.cmd('respond', { agentId, requestId, behavior: 'allow', answers })
  }

  dismissQuestion(agentId: string, requestId: string, message = 'The owner dismissed the question.') {
    return this.cmd('respond', { agentId, requestId, behavior: 'deny', message })
  }

  /** ExitPlanMode: approve (optionally applying the CLI's suggested mode), or send it back to planning. */
  respondPlan(agentId: string, requestId: string, decision: { approve: boolean; always?: boolean; message?: string }) {
    return this.cmd('respond', {
      agentId,
      requestId,
      behavior: decision.approve ? 'allow' : 'deny',
      ...(decision.approve && decision.always ? { always: true } : {}),
      ...(!decision.approve ? { message: decision.message || 'Keep planning. The owner did not approve this plan yet.' } : {}),
    })
  }

  // ─── socket lifecycle ─────────────────────────────────────────────────────

  private open(): void {
    let socket: WebSocketLike
    try {
      socket = this.createSocket(this.url)
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
        return
      }
      case 'reply': {
        const id = typeof message.id === 'number' ? message.id : Number(message.id)
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        this.clearTimer(pending.timer)
        if (message.ok) pending.resolve(message.data)
        else pending.reject(new Error(message.error || `${pending.cmd} failed`))
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
