import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  RelayAuthError,
  issueDeviceToken,
  newBrowserSessionId,
  signSessionCookie,
  verifyDeviceToken,
  verifySessionCookie,
} from '../auth'

// Pure auth primitives. No network, no DB. Test the contract carefully — these
// run inside the hosted relay sidecar and inside Next routes; any drift means
// silent auth failures across two processes.

const FIXED_NOW = 1_700_000_000_000  // 2023-11-14T22:13:20Z, deterministic for issue/verify pairs.
const TEST_KEY = 'unit-test-signing-key-not-secret'

describe('newBrowserSessionId', () => {
  it('produces a bs_-prefixed opaque id', () => {
    const id = newBrowserSessionId()
    expect(id).toMatch(/^bs_[A-Za-z0-9_-]{16,}$/)
  })

  it('produces unique ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(newBrowserSessionId())
    expect(ids.size).toBe(100)
  })
})

describe('session cookie sign/verify', () => {
  it('round-trips a browserSessionId', () => {
    const id = newBrowserSessionId()
    const cookie = signSessionCookie(id, TEST_KEY)
    const verified = verifySessionCookie(cookie, {}, TEST_KEY)
    expect(verified.bs).toBe(id)
    expect(typeof verified.iat).toBe('number')
  })

  it('rejects a tampered payload', () => {
    const id = newBrowserSessionId()
    const cookie = signSessionCookie(id, TEST_KEY)
    const [_payload, sig] = cookie.split('.')
    const tampered = `eyJicyI6ImJzX2hhY2tlciIsImlhdCI6MTAwMH0.${sig}`
    expect(() => verifySessionCookie(tampered, {}, TEST_KEY)).toThrowError(RelayAuthError)
  })

  it('rejects a tampered signature', () => {
    const id = newBrowserSessionId()
    const cookie = signSessionCookie(id, TEST_KEY)
    const [payload] = cookie.split('.')
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAA`
    expect(() => verifySessionCookie(tampered, {}, TEST_KEY)).toThrowError(RelayAuthError)
  })

  it('rejects a cookie signed with a different key', () => {
    const cookie = signSessionCookie('bs_x', 'key-A')
    expect(() => verifySessionCookie(cookie, {}, 'key-B')).toThrowError(/signature mismatch/)
  })

  it('rejects malformed input', () => {
    expect(() => verifySessionCookie('', {}, TEST_KEY)).toThrowError(/empty token/)
    expect(() => verifySessionCookie('no-dot', {}, TEST_KEY)).toThrowError(/malformed/)
    expect(() => verifySessionCookie('a.b.c', {}, TEST_KEY)).toThrowError(/malformed/)
  })

  it('refuses to sign an empty browserSessionId', () => {
    expect(() => signSessionCookie('', TEST_KEY)).toThrowError(RelayAuthError)
  })

  it('rejects a cookie older than the absolute max-age', () => {
    const cookie = signSessionCookie('bs_a', TEST_KEY)
    // Default max-age is 30 days. Verify with a `now` 31 days later.
    const farFuture = Date.now() + 31 * 24 * 60 * 60 * 1000
    expect(() => verifySessionCookie(cookie, { now: farFuture }, TEST_KEY))
      .toThrowError(/too old/)
  })

  it('respects a custom max-age override', () => {
    const cookie = signSessionCookie('bs_a', TEST_KEY)
    const tenSecondsLater = Date.now() + 10_000
    expect(() => verifySessionCookie(cookie, { now: tenSecondsLater, maxAgeMs: 1_000 }, TEST_KEY))
      .toThrowError(/too old/)
  })
})

describe('device token issue/verify', () => {
  it('round-trips with all fields preserved', () => {
    const token = issueDeviceToken({
      browserSessionId: 'bs_abc',
      worldId: 'world-1',
      scopes: ['world.read', 'world.write.safe'],
      agentLabel: 'openclaw-bridge',
      now: FIXED_NOW,
    }, TEST_KEY)

    const payload = verifyDeviceToken(token, { now: FIXED_NOW + 1000 }, TEST_KEY)
    expect(payload.bs).toBe('bs_abc')
    expect(payload.w).toBe('world-1')
    expect(payload.scopes).toEqual(['world.read', 'world.write.safe'])
    expect(payload.label).toBe('openclaw-bridge')
    expect(payload.exp).toBeGreaterThan(FIXED_NOW)
  })

  it('uses default 24h TTL when ttlMs not provided', () => {
    const token = issueDeviceToken({
      browserSessionId: 'bs_a',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
      now: FIXED_NOW,
    }, TEST_KEY)
    const payload = verifyDeviceToken(token, { now: FIXED_NOW }, TEST_KEY)
    expect(payload.exp).toBe(FIXED_NOW + 24 * 60 * 60 * 1000)
  })

  it('respects a custom ttlMs', () => {
    const token = issueDeviceToken({
      browserSessionId: 'bs_a',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
      ttlMs: 5_000,
      now: FIXED_NOW,
    }, TEST_KEY)
    const payload = verifyDeviceToken(token, { now: FIXED_NOW + 1_000 }, TEST_KEY)
    expect(payload.exp).toBe(FIXED_NOW + 5_000)
  })

  it('rejects an expired token', () => {
    const token = issueDeviceToken({
      browserSessionId: 'bs_a',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
      ttlMs: 1_000,
      now: FIXED_NOW,
    }, TEST_KEY)
    expect(() => verifyDeviceToken(token, { now: FIXED_NOW + 5_000 }, TEST_KEY))
      .toThrowError(/token expired/)
  })

  it('rejects a token signed with a different key', () => {
    const token = issueDeviceToken({
      browserSessionId: 'bs_a',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
      now: FIXED_NOW,
    }, 'key-A')
    expect(() => verifyDeviceToken(token, { now: FIXED_NOW + 1_000 }, 'key-B'))
      .toThrowError(/signature mismatch/)
  })

  it('refuses to issue without scopes', () => {
    expect(() => issueDeviceToken({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: [],
      agentLabel: 'b',
    }, TEST_KEY)).toThrowError(/scope required/)
  })

  it('refuses to issue without agentLabel', () => {
    expect(() => issueDeviceToken({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: '',
    }, TEST_KEY)).toThrowError(/agentLabel required/)
  })

  it('truncates over-long agent labels', () => {
    const longLabel = 'x'.repeat(500)
    const token = issueDeviceToken({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: longLabel,
      now: FIXED_NOW,
    }, TEST_KEY)
    const payload = verifyDeviceToken(token, { now: FIXED_NOW }, TEST_KEY)
    expect(payload.label.length).toBe(128)
  })
})

describe('signing-key resolution', () => {
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalEnv = {
      RELAY_SIGNING_KEY: process.env.RELAY_SIGNING_KEY,
      OASIS_MODE: process.env.OASIS_MODE,
      OASIS_PROFILE: process.env.OASIS_PROFILE,
    }
    delete process.env.RELAY_SIGNING_KEY
    delete process.env.OASIS_MODE
    delete process.env.OASIS_PROFILE
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('falls back to dev key in local mode', async () => {
    // signSessionCookie via default key path should not throw in local-dev.
    const cookie = signSessionCookie('bs_local')
    const verified = verifySessionCookie(cookie)
    expect(verified.bs).toBe('bs_local')
  })

  it('refuses to issue tokens in hosted mode without RELAY_SIGNING_KEY', () => {
    process.env.OASIS_MODE = 'hosted'
    expect(() => issueDeviceToken({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
    })).toThrowError(/RELAY_SIGNING_KEY/)
  })

  it('refuses to issue tokens in hosted-openclaw profile without RELAY_SIGNING_KEY', () => {
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    expect(() => issueDeviceToken({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      agentLabel: 'b',
    })).toThrowError(/RELAY_SIGNING_KEY/)
  })
})
