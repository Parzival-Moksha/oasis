/**
 * Relay auth primitives — pure HMAC sign/verify for the four credential
 * shapes the relay deals with. Stateless: the signature IS the proof.
 *
 *   Browser session cookie:  identifies a tab across requests + WS upgrade.
 *   Pairing code:            short human-readable code the user pastes into
 *                            their OpenClaw bridge command. Stateful (Map),
 *                            handled by `pairing-codes.ts`, not here.
 *   Device token:            long-lived bearer the OpenClaw bridge sends in
 *                            `agent.hello`. Encodes browserSessionId, worldId,
 *                            scopes, expiry, label.
 *
 * Why HMAC, not JWT lib: zero deps, smaller wire, exactly the surface we need.
 * Hosted relay validates by recomputing the HMAC with the shared `RELAY_SIGNING_KEY`.
 *
 * Format:  <base64url(json-payload)>.<base64url(hmac-sha256)>
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { Scope } from './protocol'

// ────────────────────────────────────────────────────────────────────────────
// Key resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the signing key. In hosted mode, missing key is a hard error —
 * we refuse to issue or verify anything. In local-dev with no env, we use a
 * deterministic dev key so smoke tests work; we log a one-time warning.
 *
 * The key SHOULD be a long random string (>= 32 bytes of entropy). We don't
 * enforce length here because forcing a regex on key shape locks out perfectly
 * good keys (e.g. base64-decoded raw bytes).
 */
let warnedAboutDevKey = false

export class RelayAuthError extends Error {
  constructor(message: string, public readonly code: string = 'auth_error') {
    super(message)
    this.name = 'RelayAuthError'
  }
}

export function getSigningKey(): string {
  const fromEnv = process.env.RELAY_SIGNING_KEY
  if (fromEnv && fromEnv.length > 0) return fromEnv

  if (process.env.OASIS_MODE === 'hosted') {
    throw new RelayAuthError(
      'RELAY_SIGNING_KEY env var is required when OASIS_MODE=hosted',
      'missing_signing_key',
    )
  }

  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true
    console.warn('[relay/auth] using deterministic dev signing key (RELAY_SIGNING_KEY not set)')
  }
  return 'oasis-relay-dev-key-do-not-use-in-production'
}

// ────────────────────────────────────────────────────────────────────────────
// Encoding helpers
// ────────────────────────────────────────────────────────────────────────────

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function hmac(key: string, message: string): Buffer {
  return createHmac('sha256', key).update(message).digest()
}

function constantTimeStringEq(a: string, b: string): boolean {
  // Buffer comparison rejects unequal lengths; we equalize via padding-then-compare.
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// ────────────────────────────────────────────────────────────────────────────
// Generic envelope: <base64url(payload)>.<base64url(sig)>
// ────────────────────────────────────────────────────────────────────────────

interface SignedEnvelope<P> {
  readonly payload: P
  readonly token: string
}

function signEnvelope<P>(payload: P, key: string): SignedEnvelope<P> {
  const json = JSON.stringify(payload)
  const payloadB64 = base64UrlEncode(json)
  const sig = hmac(key, payloadB64)
  const sigB64 = base64UrlEncode(sig)
  return { payload, token: `${payloadB64}.${sigB64}` }
}

function verifyEnvelope<P>(token: string, key: string): P {
  if (typeof token !== 'string' || token.length === 0) {
    throw new RelayAuthError('empty token', 'invalid_token')
  }
  const parts = token.split('.')
  if (parts.length !== 2) {
    throw new RelayAuthError('malformed token: expected <payload>.<sig>', 'invalid_token')
  }
  const [payloadB64, sigB64] = parts
  if (!payloadB64 || !sigB64) {
    throw new RelayAuthError('malformed token: empty section', 'invalid_token')
  }
  const expected = base64UrlEncode(hmac(key, payloadB64))
  if (!constantTimeStringEq(expected, sigB64)) {
    throw new RelayAuthError('signature mismatch', 'bad_signature')
  }
  let payload: P
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as P
  } catch {
    throw new RelayAuthError('payload is not valid JSON', 'invalid_payload')
  }
  return payload
}

// ────────────────────────────────────────────────────────────────────────────
// Browser session cookie
// ────────────────────────────────────────────────────────────────────────────

export interface SessionCookiePayload {
  /** browserSessionId — opaque random id assigned on first visit. */
  bs: string
  /** issued-at, ms since epoch. */
  iat: number
}

/**
 * Server-side absolute max-age. Independent of the cookie's `Max-Age`
 * attribute (which the browser enforces). Anything older than this is
 * rejected on verify, so a 1-year cookie can't authenticate forever.
 */
export const SESSION_COOKIE_ABSOLUTE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function newBrowserSessionId(): string {
  return `bs_${randomBytes(16).toString('base64url')}`
}

export function signSessionCookie(browserSessionId: string, key = getSigningKey()): string {
  if (!browserSessionId || browserSessionId.length === 0) {
    throw new RelayAuthError('browserSessionId is required', 'invalid_input')
  }
  const payload: SessionCookiePayload = { bs: browserSessionId, iat: Date.now() }
  return signEnvelope(payload, key).token
}

export interface VerifySessionCookieOptions {
  /** Override now() for testing. */
  now?: number
  /** Allow per-call override of the absolute max-age. */
  maxAgeMs?: number
}

export function verifySessionCookie(
  cookie: string,
  options: VerifySessionCookieOptions = {},
  key = getSigningKey(),
): SessionCookiePayload {
  const payload = verifyEnvelope<SessionCookiePayload>(cookie, key)
  if (typeof payload?.bs !== 'string' || payload.bs.length === 0) {
    throw new RelayAuthError('cookie payload missing bs', 'invalid_payload')
  }
  if (typeof payload?.iat !== 'number' || !Number.isFinite(payload.iat)) {
    throw new RelayAuthError('cookie payload missing iat', 'invalid_payload')
  }
  const now = options.now ?? Date.now()
  const maxAge = options.maxAgeMs ?? SESSION_COOKIE_ABSOLUTE_MAX_AGE_MS
  if (now - payload.iat > maxAge) {
    throw new RelayAuthError('session cookie too old', 'session_too_old')
  }
  return payload
}

// ────────────────────────────────────────────────────────────────────────────
// Device token (issued by /api/relay/devices/exchange, verified by relay)
// ────────────────────────────────────────────────────────────────────────────

export interface DeviceTokenPayload {
  /** browserSessionId this device is paired to. */
  bs: string
  /** worldId at pairing time. The relay still routes by bs; w is informational. */
  w: string
  /** Allowed scopes — checked on every tool.call. */
  scopes: Scope[]
  /** expiry, ms since epoch. Beyond this the relay refuses agent.hello. */
  exp: number
  /** Free-form human label, capped at 128 chars. */
  label: string
}

const DEVICE_TOKEN_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const DEVICE_TOKEN_MAX_LABEL_LEN = 128

export interface IssueDeviceTokenInput {
  browserSessionId: string
  worldId: string
  scopes: Scope[]
  agentLabel: string
  ttlMs?: number
  /** Override now() for testing. */
  now?: number
}

export function issueDeviceToken(input: IssueDeviceTokenInput, key = getSigningKey()): string {
  if (!input.browserSessionId) throw new RelayAuthError('browserSessionId required', 'invalid_input')
  if (!input.worldId)          throw new RelayAuthError('worldId required',          'invalid_input')
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new RelayAuthError('at least one scope required', 'invalid_input')
  }
  const label = String(input.agentLabel ?? '').slice(0, DEVICE_TOKEN_MAX_LABEL_LEN)
  if (!label) throw new RelayAuthError('agentLabel required', 'invalid_input')

  const ttl = typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEVICE_TOKEN_DEFAULT_TTL_MS
  const issuedAt = input.now ?? Date.now()
  const payload: DeviceTokenPayload = {
    bs: input.browserSessionId,
    w: input.worldId,
    scopes: [...input.scopes],
    exp: issuedAt + ttl,
    label,
  }
  return signEnvelope(payload, key).token
}

export interface VerifyDeviceTokenOptions {
  /** Override now() for testing. */
  now?: number
}

export function verifyDeviceToken(
  token: string,
  options: VerifyDeviceTokenOptions = {},
  key = getSigningKey(),
): DeviceTokenPayload {
  const payload = verifyEnvelope<DeviceTokenPayload>(token, key)
  if (typeof payload?.bs !== 'string' || !payload.bs)        throw new RelayAuthError('payload missing bs', 'invalid_payload')
  if (typeof payload?.w !== 'string' || !payload.w)          throw new RelayAuthError('payload missing w',  'invalid_payload')
  if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) throw new RelayAuthError('payload missing scopes', 'invalid_payload')
  if (typeof payload?.exp !== 'number' || !Number.isFinite(payload.exp)) throw new RelayAuthError('payload missing exp', 'invalid_payload')
  if (typeof payload?.label !== 'string') throw new RelayAuthError('payload missing label', 'invalid_payload')

  // Drop non-string scope entries so a malformed token can't smuggle objects
  // through downstream `.includes()` checks. The TS type claims `Scope[]` but
  // the runtime shape came from JSON, so don't trust it.
  const cleanScopes: Scope[] = []
  for (const s of payload.scopes as unknown[]) {
    if (typeof s === 'string' && s.length > 0) cleanScopes.push(s as Scope)
  }
  if (cleanScopes.length === 0) throw new RelayAuthError('payload scopes empty after sanitization', 'invalid_payload')

  const now = options.now ?? Date.now()
  if (now >= payload.exp) {
    throw new RelayAuthError(`token expired at ${new Date(payload.exp).toISOString()}`, 'token_expired')
  }
  return { ...payload, scopes: cleanScopes }
}
