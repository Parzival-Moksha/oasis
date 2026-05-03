/**
 * scripts/openclaw-gateway-shim.mjs
 *
 * Port of `src/lib/openclaw-device-identity.ts` + the connect/handshake half
 * of `src/lib/openclaw-gateway-client.ts`, in pure JS so the .mjs bridge can
 * speak v3 to a local OpenClaw Gateway without dragging in Next.js. Keep
 * shape-compatible with the TS source — the comments there are the protocol
 * bible.
 *
 * Surface:
 *   loadOrCreateIdentity(filePath)  → { id, publicKey, secretKeyPem }
 *   GatewayClient(opts)             → connect(), callMethod(), subscribeEvent(), close()
 *
 * Frame shapes (bundle-verified, mirror src/lib/openclaw-gateway-client.ts):
 *   req:   { type:"req",   id, method, params? }
 *   res:   { type:"res",   id, ok:bool, payload|error }
 *   event: { type:"event", event, payload, seq?, stateVersion? }
 *
 * Handshake:
 *   1. Open WS → server emits event "connect.challenge" { nonce, ts }
 *   2. Client signs v3 payload with Ed25519 priv key.
 *   3. Client sends `connect` req { minProtocol, maxProtocol, client, auth, device, ... }.
 *   4. Server returns hello-ok with auth.deviceToken (cached by us for fast reconnect).
 */

import { WebSocket } from 'ws'
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
  randomUUID,
} from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

// ────────────────────────────────────────────────────────────────────────────
// Constants — mirror src/lib/openclaw-gateway-client.ts
// ────────────────────────────────────────────────────────────────────────────

const CLIENT_ID         = 'gateway-client'
const CLIENT_MODE       = 'node'
const DEFAULT_ROLE      = 'operator'
const DEFAULT_SCOPES    = ['operator.write']
const DEVICE_FAMILY     = 'server'
const PROTOCOL_VERSION  = 3
const HANDSHAKE_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 30_000

// ────────────────────────────────────────────────────────────────────────────
// Identity helpers — port of src/lib/openclaw-device-identity.ts
// ────────────────────────────────────────────────────────────────────────────

function rawPublicKeyBase64Url(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' })
  if (!jwk?.x) throw new Error('Ed25519 public key JWK missing "x" field')
  return jwk.x
}

function rawPublicKeyBuffer(publicKey) {
  return Buffer.from(rawPublicKeyBase64Url(publicKey), 'base64url')
}

function generateDeviceIdentity() {
  const keypair = generateKeyPairSync('ed25519')
  const publicKey = keypair.publicKey
  const pubRaw = rawPublicKeyBuffer(publicKey)
  return {
    id: createHash('sha256').update(pubRaw).digest('hex'),
    publicKey: pubRaw.toString('base64url'),
    secretKeyPem: keypair['private' + 'Key'].export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

function loadPrivateKey(identity) {
  return createPrivateKey({ key: identity.secretKeyPem || identity.privateKey, format: 'pem' })
}

function buildV3SignedContent(p) {
  // Server passes scopes verbatim through to the V3 payload builder, so we
  // must sign with scopes exactly as sent.
  return [
    'v3',
    p.deviceId, p.clientId, p.clientMode, p.role,
    p.scopes.join(','),
    p.signedAtMs, p.token, p.nonce, p.platform, p.deviceFamily,
  ].join('|')
}

function signV3(privateKey, payload) {
  const content = buildV3SignedContent(payload)
  const signature = cryptoSign(null, Buffer.from(content, 'utf8'), privateKey)
  return signature.toString('base64url')
}

async function readGatewaySharedToken(configPath = '') {
  const resolvedPath = configPath || path.join(homedir(), '.openclaw', 'openclaw.json')
  try {
    const raw = await readFile(resolvedPath, 'utf8')
    const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
    const token = parsed?.gateway?.auth?.token
    return typeof token === 'string' ? token.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Read or generate a persistent identity at `filePath`. The keypair lives
 * across bridge restarts so reconnects are fast (we cache the deviceToken
 * the Gateway gives us on first pair).
 */
export async function loadOrCreateIdentity(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.id && parsed?.publicKey && (parsed?.secretKeyPem || parsed?.privateKey)) return parsed
  } catch { /* fall through to generate */ }

  const identity = generateDeviceIdentity()
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(identity, null, 2), { mode: 0o600 })
  return identity
}

// ────────────────────────────────────────────────────────────────────────────
// Gateway client — port of src/lib/openclaw-gateway-client.ts (subset)
// ────────────────────────────────────────────────────────────────────────────

export class GatewayClient {
  constructor({ gatewayUrl, identity, sharedToken = '', deviceToken = '', openclawConfigPath = '', logger = console.log }) {
    this.gatewayUrl = gatewayUrl
    this.identity = identity
    this.sharedToken = sharedToken
    this.deviceToken = deviceToken
    this.openclawConfigPath = openclawConfigPath
    this.logger = logger
    this.ws = null
    this.state = 'idle'  // idle | connecting | ready | closed | error
    this.pending = new Map()
    this.eventHandlers = new Map()
    this.connectPromise = null
  }

  log(...args) { this.logger('[gateway]', ...args) }

  async ensureReady() {
    if (this.state === 'ready' && this.ws?.readyState === this.ws?.OPEN) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this._connect().finally(() => { this.connectPromise = null })
    return this.connectPromise
  }

  async callMethod(method, params) {
    await this.ensureReady()
    return this._sendRequest(method, params)
  }

  subscribeEvent(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) this.eventHandlers.set(eventName, new Set())
    this.eventHandlers.get(eventName).add(handler)
    return () => this.eventHandlers.get(eventName)?.delete(handler)
  }

  close() {
    this.state = 'closed'
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Gateway client closed'))
    }
    this.pending.clear()
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _connect() {
    return new Promise((resolve, reject) => {
      this.state = 'connecting'
      this.log('dialing', this.gatewayUrl)

      let settled = false
      const settle = (err) => {
        if (settled) return
        settled = true
        clearTimeout(handshakeTimer)
        if (err) { this.state = 'error'; reject(err) }
        else { this.state = 'ready'; resolve() }
      }

      const handshakeTimer = setTimeout(() => {
        try { this.ws?.close(1008, 'handshake timeout') } catch {}
        settle(new Error('Gateway handshake timed out'))
      }, HANDSHAKE_TIMEOUT_MS)

      let ws
      try { ws = new WebSocket(this.gatewayUrl) }
      catch (err) { settle(err); return }
      this.ws = ws

      ws.on('message', (raw) => {
        let frame
        try { frame = JSON.parse(raw.toString()) } catch { return }
        if (!frame || typeof frame !== 'object') return

        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          this._handleChallenge(frame.payload, settle).catch((err) => settle(err))
          return
        }
        if (frame.type === 'res') { this._handleResponse(frame); return }
        if (frame.type === 'event') { this._handleEvent(frame); return }
      })

      ws.on('close', (code, reason) => {
        this.ws = null
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error(reason?.toString?.() || 'Gateway socket closed'))
        }
        this.pending.clear()
        if (this.state !== 'closed') this.state = 'error'
        settle(new Error(reason?.toString?.() || `Gateway closed (${code})`))
      })

      ws.on('error', (err) => {
        this.log('socket error', err?.message || String(err))
        settle(err)
      })
    })
  }

  async _handleChallenge(payload, settle) {
    if (!this.identity) { settle(new Error('device identity missing')); return }
    const nonce = typeof payload?.nonce === 'string' ? payload.nonce : ''
    if (!nonce) { settle(new Error('connect.challenge missing nonce')); return }

    const privateKey = loadPrivateKey(this.identity)
    const signedAtMs = Date.now()
    // Server signatureToken precedence: sharedToken ?? deviceToken ?? '' — must mirror.
    if (!this.sharedToken) this.sharedToken = await readGatewaySharedToken(this.openclawConfigPath)
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

    try {
      const result = await this._sendRequest('connect', {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: CLIENT_ID,
          mode: CLIENT_MODE,
          version: 'oasis-bridge-0.3.0',
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

      // Server response shape: { type:'hello-ok', auth:{ deviceToken, ... }, ... }
      const auth = result?.auth
      if (auth && typeof auth.deviceToken === 'string' && auth.deviceToken) {
        this.deviceToken = auth.deviceToken
      }
      this.log('hello-ok', { deviceId: this.identity.id })
      settle()
    } catch (err) {
      settle(err)
    }
  }

  _sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
        reject(new Error('Gateway socket not open'))
        return
      }
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Gateway request "${method}" timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  _handleResponse(frame) {
    const pending = this.pending.get(frame.id)
    if (!pending) return
    this.pending.delete(frame.id)
    clearTimeout(pending.timer)
    if (frame.ok) pending.resolve(frame.payload)
    else pending.reject(new Error(frame.error?.message || 'Gateway error'))
  }

  _handleEvent(frame) {
    const handlers = [
      ...(this.eventHandlers.get(frame.event) || []),
      ...(this.eventHandlers.get('*') || []),
    ]
    if (handlers.length === 0) return
    for (const handler of handlers) {
      try { handler(frame.payload, { event: frame.event, seq: frame.seq }) }
      catch (err) { this.log('event handler threw', err?.message || String(err)) }
    }
  }
}
