#!/usr/bin/env node
/**
 * scripts/openclaw-relay.mjs
 *
 * Hosted relay for openclaw.04515.xyz. Replaces the dev sidecar's naive
 * pair-the-first-two-sockets behavior with real authentication and routing:
 *
 *   - Browser side  : Origin must be in RELAY_ALLOWED_ORIGINS.
 *                     `oasis_session` cookie verified via HMAC.
 *                     Connection pinned to the cookie's browserSessionId.
 *   - Agent side    : `Authorization: Bearer <deviceToken>` validated via HMAC.
 *                     Token's `bs` field pins the connection to a browser.
 *   - Routing       : Forwards JSON envelopes between browser+agent paired by
 *                     browserSessionId. tool.call frames are scope-checked
 *                     against the agent's device-token scopes.
 *
 * HMAC verify here is mirrored from src/lib/relay/auth.ts. Keep them in sync.
 *
 * Env:
 *   RELAY_PORT              local port to bind, default 4517
 *   RELAY_SIGNING_KEY       REQUIRED — same value the Next process uses
 *   RELAY_ALLOWED_ORIGINS   comma-separated, e.g. "https://openclaw.04515.xyz,http://localhost:4516"
 *   RELAY_LOG_FRAMES        "1" to log every envelope type at info level (off by default)
 */

import { WebSocketServer } from 'ws'
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.RELAY_PORT || 4517)
const SIGNING_KEY = process.env.RELAY_SIGNING_KEY || ''
const ALLOWED_ORIGINS = (process.env.RELAY_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const LOG_FRAMES = process.env.RELAY_LOG_FRAMES === '1'
const FRAME_MAX_BYTES = 256 * 1024

if (!SIGNING_KEY) {
  console.error('[relay] RELAY_SIGNING_KEY env var is required')
  process.exit(1)
}
if (ALLOWED_ORIGINS.length === 0) {
  console.error('[relay] RELAY_ALLOWED_ORIGINS env var is required (comma-separated origin list)')
  process.exit(1)
}

const log = (...args) => console.log('[relay]', new Date().toISOString(), ...args)

// ────────────────────────────────────────────────────────────────────────────
// HMAC verify — MIRROR of src/lib/relay/auth.ts. Update both together.
// ────────────────────────────────────────────────────────────────────────────

function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64url')
}
function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url')
}
function hmac(key, message) {
  return createHmac('sha256', key).update(message).digest()
}
function constantTimeStringEq(a, b) {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
function verifyHmacEnvelope(token, key) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('empty token')
  const parts = token.split('.')
  if (parts.length !== 2) throw new Error('malformed token')
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) throw new Error('malformed token: empty section')
  const expected = base64UrlEncode(hmac(key, payloadB64))
  if (!constantTimeStringEq(expected, sigB64)) throw new Error('signature mismatch')
  try {
    return JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
  } catch {
    throw new Error('payload not JSON')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Cookie + token extraction
// ────────────────────────────────────────────────────────────────────────────

// Server-side absolute max-age for browser session cookies — mirror of
// SESSION_COOKIE_ABSOLUTE_MAX_AGE_MS in src/lib/relay/auth.ts.
const SESSION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null
  // Take the LAST oasis_session value if multiple are present — matches the
  // TS-side parser, which mirrors browser cookie precedence.
  let lastRaw = null
  for (const piece of cookieHeader.split(';')) {
    const trimmed = piece.trim()
    if (!trimmed.startsWith('oasis_session=')) continue
    const raw = trimmed.slice('oasis_session='.length)
    if (!raw) continue
    lastRaw = raw
  }
  if (!lastRaw) return null
  try {
    const value = decodeURIComponent(lastRaw)
    const payload = verifyHmacEnvelope(value, SIGNING_KEY)
    if (typeof payload?.bs !== 'string' || !payload.bs) return null
    if (typeof payload?.iat !== 'number') return null
    if (Date.now() - payload.iat > SESSION_COOKIE_MAX_AGE_MS) return null
    return { browserSessionId: payload.bs, iat: payload.iat }
  } catch {
    return null
  }
}

function readBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return null
  try {
    const payload = verifyHmacEnvelope(token, SIGNING_KEY)
    if (typeof payload?.bs !== 'string' || !payload.bs)        return null
    if (typeof payload?.w  !== 'string' || !payload.w)         return null
    if (!Array.isArray(payload?.scopes) || payload.scopes.length === 0) return null
    if (typeof payload?.exp !== 'number')                       return null
    if (Date.now() >= payload.exp)                              return null
    // Sanitize scopes — drop anything non-string so subsequent .includes
    // checks operate on a clean string[].
    const cleanScopes = payload.scopes.filter(s => typeof s === 'string' && s.length > 0)
    if (cleanScopes.length === 0) return null
    return {
      browserSessionId: payload.bs,
      worldId:          payload.w,
      scopes:           cleanScopes,
      label:            typeof payload.label === 'string' ? payload.label.slice(0, 128) : 'unknown',
      exp:              payload.exp,
    }
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Connection registry
// ────────────────────────────────────────────────────────────────────────────

const browsersBySession = new Map() // browserSessionId -> ws
const agentsBySession   = new Map() // browserSessionId -> { ws, scopes, label }
const peers             = new Map() // ws -> peer ws

function unpair(ws, { closePeer = false } = {}) {
  const peer = peers.get(ws)
  if (peer) {
    peers.delete(ws)
    peers.delete(peer)
    if (closePeer && peer.readyState === peer.OPEN) {
      try { peer.close(1001, 'peer disconnected') } catch { /* ignore */ }
    }
  }
}

function tryPair(browserSessionId) {
  const browser = browsersBySession.get(browserSessionId)
  const agent = agentsBySession.get(browserSessionId)
  if (!browser || !agent) return
  if (peers.has(browser) || peers.has(agent.ws)) return

  peers.set(browser, agent.ws)
  peers.set(agent.ws, browser)

  const relaySessionId = randomUUID()
  log('paired', { browserSessionId, relaySessionId, agentLabel: agent.label })

  const courtesy = (role) => JSON.stringify({
    type: 'relay.paired',
    role,
    relaySessionId,
    sentAt: Date.now(),
    messageId: randomUUID(),
  })
  try { browser.send(courtesy('browser')) } catch { /* ignore */ }
  try { agent.ws.send(courtesy('agent'))  } catch { /* ignore */ }
}

// ────────────────────────────────────────────────────────────────────────────
// Server
// ────────────────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: FRAME_MAX_BYTES,
  // We do auth in `verifyClient`; if it returns false, the upgrade is rejected.
  verifyClient: (info, callback) => {
    const url = new URL(info.req.url || '/', 'http://localhost')
    const role = url.searchParams.get('role')
    const origin = info.req.headers.origin

    if (role === 'browser') {
      if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
        log('reject browser: bad origin', { origin })
        return callback(false, 403, 'forbidden origin')
      }
      const session = readSessionCookie(info.req.headers.cookie)
      if (!session) {
        log('reject browser: missing/invalid cookie')
        return callback(false, 401, 'invalid session')
      }
      info.req.__relayMeta = { role: 'browser', browserSessionId: session.browserSessionId }
      return callback(true)
    }

    if (role === 'agent') {
      const auth = readBearerToken(info.req.headers.authorization)
      if (!auth) {
        log('reject agent: missing/invalid token')
        return callback(false, 401, 'invalid token')
      }
      info.req.__relayMeta = {
        role: 'agent',
        browserSessionId: auth.browserSessionId,
        scopes: auth.scopes,
        label: auth.label,
        worldId: auth.worldId,
      }
      return callback(true)
    }

    log('reject: unknown role', { role })
    return callback(false, 400, 'role query param required (browser|agent)')
  },
})

wss.on('connection', (ws, req) => {
  const meta = req.__relayMeta
  if (!meta) { ws.close(1011, 'meta missing'); return }
  const { role, browserSessionId } = meta

  log('connection', { role, browserSessionId, agentLabel: meta.label })

  if (role === 'browser') {
    const existing = browsersBySession.get(browserSessionId)
    if (existing && existing !== ws) {
      // Same browser session reconnecting — kick the old one.
      try { existing.close(1001, 'replaced by newer browser') } catch { /* ignore */ }
      unpair(existing)
    }
    browsersBySession.set(browserSessionId, ws)
  } else {
    const existing = agentsBySession.get(browserSessionId)
    if (existing && existing.ws !== ws) {
      try { existing.ws.close(1001, 'replaced by newer agent') } catch { /* ignore */ }
      unpair(existing.ws)
    }
    agentsBySession.set(browserSessionId, {
      ws,
      scopes: meta.scopes,
      label:  meta.label,
      worldId: meta.worldId,
    })
  }

  tryPair(browserSessionId)

  ws.on('message', (raw, isBinary) => {
    if (isBinary) { ws.close(1003, 'binary frames not supported'); return }
    if (raw.length > FRAME_MAX_BYTES) { ws.close(1009, 'frame too large'); return }

    const peer = peers.get(ws)
    if (!peer || peer.readyState !== peer.OPEN) return

    // Light schema check: parse JSON, require a string `type`. Full zod
    // validation lives at the bridges; the relay's job here is routing
    // and scope enforcement, not parser-of-record. Drift caught by the
    // bridges' validators on receive.
    let parsed
    try { parsed = JSON.parse(raw.toString()) }
    catch { return }
    if (!parsed || typeof parsed.type !== 'string') return

    if (LOG_FRAMES) log('frame', { browserSessionId, role, type: parsed.type })

    if (parsed.type === 'tool.call' && role === 'agent') {
      const agent = agentsBySession.get(browserSessionId)
      const requestedScope = typeof parsed.scope === 'string' ? parsed.scope : ''
      if (!agent || !agent.scopes.includes(requestedScope)) {
        log('reject tool.call: scope not granted', { browserSessionId, requestedScope, granted: agent?.scopes })
        try {
          ws.send(JSON.stringify({
            type: 'tool.result',
            messageId: randomUUID(),
            sentAt: Date.now(),
            callId: parsed.callId || 'unknown',
            ok: false,
            error: { code: 'scope_denied', message: `scope "${requestedScope}" not granted to this device` },
          }))
        } catch { /* ignore */ }
        return
      }
    }

    try { peer.send(raw.toString()) } catch (err) {
      log('forward failed', { role, err: err?.message })
    }
  })

  ws.on('close', (code, reason) => {
    log('disconnect', { role, browserSessionId, code, reason: reason?.toString?.() })
    unpair(ws)
    if (role === 'browser') {
      if (browsersBySession.get(browserSessionId) === ws) {
        browsersBySession.delete(browserSessionId)
      }
    } else {
      const a = agentsBySession.get(browserSessionId)
      if (a && a.ws === ws) agentsBySession.delete(browserSessionId)
    }
  })

  ws.on('error', (err) => {
    log('socket error', { role, browserSessionId, err: err?.message || String(err) })
  })
})

wss.on('listening', () => {
  log(`listening on :${PORT}`)
  log(`allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})

const shutdown = (signal) => {
  log('shutting down', { signal })
  wss.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 2000).unref()
}
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
