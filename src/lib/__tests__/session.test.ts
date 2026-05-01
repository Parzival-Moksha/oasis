import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SESSION_COOKIE_NAME,
  HOSTED_ANONYMOUS_USER_ID,
  getOasisCapabilities,
  getOasisMode,
  getOasisProfile,
  getOasisUserId,
  getRequiredOasisUserId,
  mintSessionCookieValue,
  readBrowserSessionFromCookieHeader,
} from '../session'
import {
  ADMIN_SESSION_COOKIE_NAME,
  getAdminUserId,
  signAdminSession,
} from '../admin-auth'

function makeRequest(cookieHeader?: string): Request {
  const headers = new Headers()
  if (cookieHeader) headers.set('cookie', cookieHeader)
  return new Request('http://localhost/test', { headers })
}

describe('getOasisMode', () => {
  let original: string | undefined
  let originalProfile: string | undefined
  beforeEach(() => {
    original = process.env.OASIS_MODE
    originalProfile = process.env.OASIS_PROFILE
    delete process.env.OASIS_PROFILE
  })
  afterEach(() => {
    if (original === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = original
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
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

  it('maps the explicit hosted-openclaw profile to hosted mode', () => {
    delete process.env.OASIS_MODE
    process.env.OASIS_PROFILE = 'hosted-openclaw'
    expect(getOasisProfile()).toBe('hosted-openclaw')
    expect(getOasisMode()).toBe('hosted')
  })

  it('lets an explicit local profile override legacy hosted mode', () => {
    process.env.OASIS_MODE = 'hosted'
    process.env.OASIS_PROFILE = 'local'
    expect(getOasisProfile()).toBe('local')
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

describe('getOasisUserId', () => {
  let originalMode: string | undefined
  let originalKey: string | undefined
  let originalAdminToken: string | undefined
  beforeEach(() => {
    originalMode = process.env.OASIS_MODE
    originalKey = process.env.RELAY_SIGNING_KEY
    originalAdminToken = process.env.OASIS_ADMIN_TOKEN
    // Hosted mode requires a signing key — provide one for the duration of these tests.
    process.env.RELAY_SIGNING_KEY = 'unit-test-key-not-secret'
    delete process.env.OASIS_ADMIN_TOKEN
  })
  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalKey
    if (originalAdminToken === undefined) delete process.env.OASIS_ADMIN_TOKEN
    else process.env.OASIS_ADMIN_TOKEN = originalAdminToken
  })

  it('returns "local-user" in local mode regardless of cookie', async () => {
    delete process.env.OASIS_MODE
    const minted = mintSessionCookieValue()
    const req = makeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}`)
    expect(await getOasisUserId(req)).toBe('local-user')
  })

  it('returns the verified browserSessionId in hosted mode', async () => {
    process.env.OASIS_MODE = 'hosted'
    const minted = mintSessionCookieValue()
    const req = makeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}`)
    expect(await getOasisUserId(req)).toBe(minted.browserSessionId)
  })

  it('falls back to a non-owner anonymous id in hosted mode when cookie is missing', async () => {
    process.env.OASIS_MODE = 'hosted'
    const req = makeRequest()
    expect(await getOasisUserId(req)).toBe(HOSTED_ANONYMOUS_USER_ID)
  })

  it('falls back to a non-owner anonymous id in hosted mode when cookie is tampered', async () => {
    process.env.OASIS_MODE = 'hosted'
    const minted = mintSessionCookieValue()
    const [payload] = minted.cookieValue.split('.')
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAA`
    const req = makeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(tampered)}`)
    expect(await getOasisUserId(req)).toBe(HOSTED_ANONYMOUS_USER_ID)
  })

  it('returns null from the required helper in hosted mode without a verified cookie', () => {
    process.env.OASIS_MODE = 'hosted'
    expect(getRequiredOasisUserId(makeRequest())).toBeNull()
  })

  it('returns the verified id from the required helper in hosted mode', () => {
    process.env.OASIS_MODE = 'hosted'
    const minted = mintSessionCookieValue()
    const req = makeRequest(`${SESSION_COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}`)
    expect(getRequiredOasisUserId(req)).toBe(minted.browserSessionId)
  })

  it('returns the hosted admin user id when the admin cookie is valid', async () => {
    process.env.OASIS_MODE = 'hosted'
    process.env.OASIS_ADMIN_TOKEN = 'admin-token-for-tests'
    const adminCookie = signAdminSession(getAdminUserId())
    const req = makeRequest(`${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminCookie)}`)

    expect(await getOasisUserId(req)).toBe(getAdminUserId())
    expect(getRequiredOasisUserId(req)).toBe(getAdminUserId())
    expect(getOasisCapabilities(req)).toMatchObject({
      role: 'hosted-admin',
      admin: true,
      canUseAgentPanels: true,
      canUseFullWizard: true,
    })
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
