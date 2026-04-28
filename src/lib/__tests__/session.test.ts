import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SESSION_COOKIE_NAME,
  getOasisMode,
  mintSessionCookieValue,
  readBrowserSessionFromCookieHeader,
} from '../session'

describe('getOasisMode', () => {
  let original: string | undefined
  beforeEach(() => { original = process.env.OASIS_MODE })
  afterEach(() => {
    if (original === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = original
  })

  it('returns local when env unset', () => {
    delete process.env.OASIS_MODE
    expect(getOasisMode()).toBe('local')
  })

  it('returns hosted only when explicitly set to "hosted"', () => {
    process.env.OASIS_MODE = 'hosted'
    expect(getOasisMode()).toBe('hosted')
    process.env.OASIS_MODE = 'production'
    expect(getOasisMode()).toBe('local')
    process.env.OASIS_MODE = ''
    expect(getOasisMode()).toBe('local')
  })
})

describe('readBrowserSessionFromCookieHeader', () => {
  it('returns null on missing header', () => {
    expect(readBrowserSessionFromCookieHeader(null)).toBeNull()
    expect(readBrowserSessionFromCookieHeader('')).toBeNull()
    expect(readBrowserSessionFromCookieHeader(undefined)).toBeNull()
  })

  it('returns null when oasis_session is absent from cookie list', () => {
    expect(readBrowserSessionFromCookieHeader('csrf=abc; theme=dark')).toBeNull()
  })

  it('round-trips a freshly minted cookie value', () => {
    const { browserSessionId, cookieValue } = mintSessionCookieValue()
    const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}; theme=dark`
    const verified = readBrowserSessionFromCookieHeader(header)
    expect(verified).not.toBeNull()
    expect(verified?.browserSessionId).toBe(browserSessionId)
  })

  it('handles cookies in any position', () => {
    const { browserSessionId, cookieValue } = mintSessionCookieValue()
    const header = `theme=dark; csrf=abc; ${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`
    const verified = readBrowserSessionFromCookieHeader(header)
    expect(verified?.browserSessionId).toBe(browserSessionId)
  })

  it('returns null on tampered cookie', () => {
    const { cookieValue } = mintSessionCookieValue()
    const [payload] = cookieValue.split('.')
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAA`
    const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent(tampered)}`
    expect(readBrowserSessionFromCookieHeader(header)).toBeNull()
  })

  it('returns null when value is blank', () => {
    expect(readBrowserSessionFromCookieHeader(`${SESSION_COOKIE_NAME}=`)).toBeNull()
  })

  it('honors the LAST oasis_session value when multiple are present', () => {
    // RFC 6265 cookie precedence varies; many browsers send most-specific last.
    // The relay verifies the same way via mirrored logic in scripts/openclaw-relay.mjs.
    const a = mintSessionCookieValue()
    const b = mintSessionCookieValue()
    const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent(a.cookieValue)}; ${SESSION_COOKIE_NAME}=${encodeURIComponent(b.cookieValue)}`
    const verified = readBrowserSessionFromCookieHeader(header)
    expect(verified?.browserSessionId).toBe(b.browserSessionId)
  })
})

describe('mintSessionCookieValue', () => {
  it('produces a verifiable cookie containing the new bs id', () => {
    const minted = mintSessionCookieValue()
    expect(minted.browserSessionId).toMatch(/^bs_/)
    expect(minted.cookieValue).toContain('.')
    const header = `${SESSION_COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}`
    const verified = readBrowserSessionFromCookieHeader(header)
    expect(verified?.browserSessionId).toBe(minted.browserSessionId)
  })

  it('produces unique ids and unique signatures across calls', () => {
    const a = mintSessionCookieValue()
    const b = mintSessionCookieValue()
    expect(a.browserSessionId).not.toBe(b.browserSessionId)
    expect(a.cookieValue).not.toBe(b.cookieValue)
  })
})
