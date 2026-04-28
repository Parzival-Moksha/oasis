import 'server-only'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS → OPENCLAW GATEWAY WS CLIENT
// ─═̷─═̷─ॐ─═̷─═̷─
//
// Custom framing (bundle-verified at dist/protocol-*.js:1277-1296):
//   req:   {type:"req",   id:<uuid>, method, params?}
//   res:   {type:"res",   id,        ok:bool, payload|error}
//   event: {type:"event", event,     payload, seq?, stateVersion?}
//
// Handshake (bundle-verified):
//   1. Open WS → server sends event:"connect.challenge" {nonce, ts}
//   2. Client sends connect req with Ed25519-signed v3 payload
//   3. Server returns {ok:true, payload:{type:"hello-ok", auth:{deviceToken}, ...}}
//   4. Store deviceToken for fast reconnect (no shared token needed)
//
// Methods (bundle-verified):
//   chat.send {sessionKey, message, idempotencyKey} → {runId, status:"started"}
//   Then listen for "chat" events with {runId, state:"delta"|"final"|...}
//
// Lives as a module-level singleton pinned to globalThis (survives HMR),
// reconnects on drop, queues requests during connect.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { randomUUID } from 'crypto'

import {
  readStoredOpenclawConfig,
  writeStoredOpenclawConfig,
  DEFAULT_OPENCLAW_GATEWAY_URL,
} from './openclaw-config'
import {
  generateDeviceIdentity,
  loadPrivateKey,
  signV3,
  type DeviceIdentity,
} from './openclaw-device-identity'
import { readOpenclawRuntimeConfig } from './openclaw-runtime-config'

async function readGatewaySharedToken(): Promise<string> {
  try {
    const runtime = await readOpenclawRuntimeConfig()
    const gateway = runtime.gateway
    if (!gateway || typeof gateway !== 'object') return ''
    const auth = (gateway as Record<string, unknown>).auth
    if (!auth || typeof auth !== 'object') return ''
    const token = (auth as Record<string, unknown>).token
    return typeof token === 'string' ? token.trim() : ''
  } catch {
    return ''
  }
}

// Bundle-discovered enums (control-ui dist, ft = CLIENT_ID_ENUM, mt = CLIENT_MODE_ENUM):
//   ids:   webchat-ui, openclaw-control-ui, openclaw-tui, webchat, cli,
//          gateway-client, openclaw-macos, openclaw-ios, openclaw-android,
//          node-host, test, fingerprint, openclaw-probe
//   modes: webchat, cli, ui, backend, node, probe, test
// "gateway-client"+"node" is the right slot for Oasis: a Node process that
// consumes the Gateway's RPC surface from outside the CLI.
const CLIENT_ID = 'gateway-client'
const CLIENT_MODE = 'node'
const DEFAULT_ROLE = 'operator'
// operator.write implies operator.read per Gateway's scope hierarchy (admin > write > read).
// chat.send and sessions.send require operator.write.
const DEFAULT_SCOPES: readonly string[] = ['operator.write']
const DEVICE_FAMILY = 'server'
const PROTOCOL_VERSION = 3
const HANDSHAKE_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 30000
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000

type Frame =
  | { type: 'req'; id: string; method: string; params?: unknown }
  | { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: GatewayError }
  | { type: 'event'; event: string; payload?: unknown; seq?: number; stateVersion?: unknown }

export interface GatewayError {
  code?: string
  message: string
  details?: unknown
  retryable?: boolean
  retryAfterMs?: number
}

export type GatewayEventHandler = (payload: unknown, meta: { event: string; seq?: number }) => void

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type GatewayConnectionState = 'idle' | 'connecting' | 'pairing-required' | 'ready' | 'closed' | 'error'

export interface GatewayStatusSnapshot {
  state: GatewayConnectionState
  detail?: string
  gatewayUrl: string
  hasDeviceToken: boolean
  deviceId?: string
  lastError?: string
  connectedAt?: number
}

class OasisGatewayClient {
  private ws: WebSocket | null = null
  private state: GatewayConnectionState = 'idle'
  private stateDetail = ''
  private lastError = ''
  private gatewayUrl = DEFAULT_OPENCLAW_GATEWAY_URL
  private identity: DeviceIdentity | null = null
  private deviceToken = ''
  private sharedToken = '' // optional, for initial pair on guarded gateways
  private connectedAt = 0
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<GatewayEventHandler>>()
  private connectPromise: Promise<void> | null = null

  getStatus(): GatewayStatusSnapshot {
    return {
      state: this.state,
      detail: this.stateDetail || undefined,
      gatewayUrl: this.gatewayUrl,
      hasDeviceToken: Boolean(this.deviceToken),
      deviceId: this.identity?.id,
      lastError: this.lastError || undefined,
      connectedAt: this.connectedAt || undefined,
    }
  }

  async ensureReady(): Promise<void> {
    if (this.state === 'ready' && this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  async callMethod<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureReady()
    return this.sendRequest<T>(method, params)
  }

  subscribeEvent(eventName: string, handler: GatewayEventHandler): () => void {
    if (!this.eventHandlers.has(eventName)) this.eventHandlers.set(eventName, new Set())
    this.eventHandlers.get(eventName)!.add(handler)
    return () => {
      this.eventHandlers.get(eventName)?.delete(handler)
    }
  }

  close(): void {
    this.setState('closed', 'Client closed by caller.')
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Gateway client closed'))
    }
    this.pending.clear()
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private setState(state: GatewayConnectionState, detail = ''): void {
    this.state = state
    this.stateDetail = detail
    if (state === 'error' && detail) this.lastError = detail
  }

  private async loadIdentityAndConfig(): Promise<void> {
    const config = await readStoredOpenclawConfig()
    this.gatewayUrl = config?.gatewayUrl || DEFAULT_OPENCLAW_GATEWAY_URL
    this.deviceToken = config?.deviceToken || ''
    // On the same machine as OpenClaw, pull the gateway shared token from
    // ~/.openclaw/openclaw.json. Used to bootstrap first-pair only; after the
    // Gateway issues a deviceToken we use that exclusively.
    this.sharedToken = await readGatewaySharedToken()

    if (config?.deviceIdentity) {
      this.identity = { ...config.deviceIdentity }
    } else {
      this.identity = generateDeviceIdentity()
      await writeStoredOpenclawConfig({ deviceIdentity: this.identity })
    }
  }

  private async connect(): Promise<void> {
    await this.loadIdentityAndConfig()
    this.setState('connecting', `Dialing ${this.gatewayUrl}`)

    return new Promise<void>((resolve, reject) => {
      let handshakeTimer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        if (handshakeTimer) clearTimeout(handshakeTimer)
        if (err) reject(err)
        else resolve()
      }

      let ws: WebSocket
      try {
        ws = new WebSocket(this.gatewayUrl)
      } catch (err) {
        this.setState('error', `WebSocket construction failed: ${(err as Error).message}`)
        settle(err as Error)
        return
      }
      this.ws = ws

      ws.addEventListener('open', () => {
        handshakeTimer = setTimeout(() => {
          this.setState('error', 'Handshake timed out')
          try { ws.close(1008, 'connect challenge timeout') } catch { /* ignore */ }
          settle(new Error('Handshake timed out'))
        }, HANDSHAKE_TIMEOUT_MS)
      })

      ws.addEventListener('message', (event: MessageEvent) => {
        let frame: Frame | null = null
        try {
          const data = event.data
          const raw = typeof data === 'string'
            ? data
            : data instanceof ArrayBuffer
              ? Buffer.from(data).toString('utf8')
              : ArrayBuffer.isView(data)
                ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
                : String(data)
          frame = JSON.parse(raw) as Frame
        } catch {
          return
        }
        if (!frame || typeof frame !== 'object') return

        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          void this.handleChallenge(frame.payload, settle)
          return
        }

        if (frame.type === 'res') {
          this.handleResponse(frame)
          return
        }

        if (frame.type === 'event') {
          this.handleEvent(frame)
          return
        }
      })

      ws.addEventListener('close', (event: CloseEvent) => {
        this.ws = null
        const wasReady = this.state === 'ready'
        const code = event.code
        const reasonText = event.reason || ''
        if (this.state !== 'closed') {
          this.setState(wasReady ? 'error' : this.state, reasonText || 'Socket closed')
        }
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(new Error(reasonText || 'Gateway socket closed'))
        }
        this.pending.clear()
        settle(new Error(reasonText || `Closed before handshake (${code})`))
        if (this.state !== 'closed') {
          this.scheduleReconnect()
        }
      })

      ws.addEventListener('error', () => {
        const msg = 'WebSocket error'
        this.setState('error', msg)
        settle(new Error(msg))
      })
    })
  }

  private async handleChallenge(payload: unknown, settle: (err?: Error) => void): Promise<void> {
    try {
      if (!this.identity) throw new Error('device identity missing')
      const rec = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {}
      const nonce = typeof rec.nonce === 'string' ? rec.nonce : ''
      if (!nonce) throw new Error('connect.challenge missing nonce')

      const privateKey = loadPrivateKey(this.identity)
      const signedAtMs = Date.now()
      // Server signatureToken precedence (bundle-verified):
      //   token ?? deviceToken ?? bootstrapToken ?? null
      // We must mirror that order so the signed content matches server-side.
      const signatureToken = this.sharedToken || this.deviceToken || ''
      const signature = signV3(privateKey, {
        deviceId: this.identity.id,
        clientId: CLIENT_ID,
        clientMode: CLIENT_MODE,
        role: DEFAULT_ROLE,
        scopes: DEFAULT_SCOPES,
        signedAtMs,
        token: signatureToken,
        nonce,
        platform: process.platform,
        deviceFamily: DEVICE_FAMILY,
      })

      const result = await this.sendRequest<Record<string, unknown>>('connect', {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: CLIENT_ID,
          mode: CLIENT_MODE,
          version: 'oasis-0.1',
          platform: process.platform,
          deviceFamily: DEVICE_FAMILY,
        },
        role: DEFAULT_ROLE,
        scopes: DEFAULT_SCOPES,
        auth: {
          ...(this.deviceToken ? { deviceToken: this.deviceToken } : {}),
          ...(this.sharedToken ? { token: this.sharedToken } : {}),
        },
        device: {
          id: this.identity.id,
          publicKey: this.identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
      })

      const auth = (result && typeof result === 'object' && 'auth' in result)
        ? (result as { auth?: Record<string, unknown> }).auth
        : undefined
      const newDeviceToken = auth && typeof auth.deviceToken === 'string' ? auth.deviceToken : ''
      if (newDeviceToken && newDeviceToken !== this.deviceToken) {
        this.deviceToken = newDeviceToken
        await writeStoredOpenclawConfig({ deviceToken: newDeviceToken })
      }

      this.connectedAt = Date.now()
      this.reconnectDelay = RECONNECT_MIN_MS
      this.setState('ready', 'Gateway ready')
      settle()
    } catch (err) {
      const message = (err as Error).message || String(err)
      if (/pairing required/i.test(message) || /pending/i.test(message)) {
        this.setState('pairing-required', message)
      } else {
        this.setState('error', message)
      }
      settle(err as Error)
    }
  }

  private handleResponse(frame: { id: string; ok: boolean; payload?: unknown; error?: GatewayError }): void {
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if (frame.ok) {
      pending.resolve(frame.payload)
    } else {
      const err = frame.error
      pending.reject(new Error(err?.message || 'Gateway error'))
    }
  }

  private handleEvent(frame: { event: string; payload?: unknown; seq?: number }): void {
    const handlers = this.eventHandlers.get(frame.event)
    if (!handlers || handlers.size === 0) return
    for (const handler of handlers) {
      try { handler(frame.payload, { event: frame.event, seq: frame.seq }) }
      catch (err) { console.warn('[OasisGatewayClient] event handler threw:', err) }
    }
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Gateway socket not open'))
    }
    const id = randomUUID()
    const frame: Frame = { type: 'req', id, method, ...(params !== undefined ? { params } : {}) }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Gateway request '${method}' timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (payload) => resolve(payload as T),
        reject,
        timer,
      })
      try {
        this.ws!.send(JSON.stringify(frame))
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err as Error)
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureReady().catch(() => { this.scheduleReconnect() })
    }, delay)
  }
}

// Pinned to globalThis so HMR doesn't orphan the WS connection.
// Bump CLIENT_BUILD when the client code changes in a way that requires a fresh
// singleton (e.g. new connect params). HMR notices the mismatch and reinstantiates.
const CLIENT_BUILD = 'v9-native-websocket'
const GATEWAY_CLIENT_KEY = Symbol.for('oasis.openclawGatewayClient')
interface GlobalEntry { build: string; instance: OasisGatewayClient }
const globalClient = globalThis as unknown as { [key: symbol]: GlobalEntry | undefined }
function ensureClientEntry(): GlobalEntry {
  const currentEntry = globalClient[GATEWAY_CLIENT_KEY]
  if (!currentEntry || currentEntry.build !== CLIENT_BUILD) {
    try { currentEntry?.instance.close() } catch { /* ignore */ }
    const nextEntry = {
      build: CLIENT_BUILD,
      instance: new OasisGatewayClient(),
    }
    globalClient[GATEWAY_CLIENT_KEY] = nextEntry
    return nextEntry
  }
  return currentEntry
}

export function getOasisGatewayClient(): OasisGatewayClient {
  return ensureClientEntry().instance
}

export function resetOasisGatewayClient(): OasisGatewayClient {
  const currentEntry = globalClient[GATEWAY_CLIENT_KEY]
  try { currentEntry?.instance.close() } catch { /* ignore */ }
  const nextEntry = {
    build: CLIENT_BUILD,
    instance: new OasisGatewayClient(),
  }
  globalClient[GATEWAY_CLIENT_KEY] = nextEntry
  return nextEntry.instance
}
