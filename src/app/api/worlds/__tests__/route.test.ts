import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/forge/world-server', () => ({
  getRegistry: vi.fn(),
  createWorld: vi.fn(),
  saveWorld: vi.fn(),
}))

import { GET, POST } from '../route'
import { getRegistry, createWorld } from '@/lib/forge/world-server'
import {
  ADMIN_SESSION_COOKIE_NAME,
  getAdminUserId,
  signAdminSession,
} from '@/lib/admin-auth'

function request(method = 'GET', body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {}
  if (body) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return new Request('http://localhost/api/worlds', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/worlds hosted identity boundary', () => {
  const originalMode = process.env.OASIS_MODE
  const originalProfile = process.env.OASIS_PROFILE
  const originalAdminToken = process.env.OASIS_ADMIN_TOKEN
  const originalKey = process.env.RELAY_SIGNING_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OASIS_MODE = 'hosted'
    process.env.RELAY_SIGNING_KEY = 'unit-test-key-not-secret'
    delete process.env.OASIS_ADMIN_TOKEN
    delete process.env.OASIS_PROFILE
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
    if (originalAdminToken === undefined) delete process.env.OASIS_ADMIN_TOKEN
    else process.env.OASIS_ADMIN_TOKEN = originalAdminToken
    if (originalKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalKey
  })

  it('does not list worlds as local-user in hosted mode without a session', async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toContain('oasis_session')
    expect(getRegistry).not.toHaveBeenCalled()
  })

  it('does not create worlds as local-user in hosted mode without a session', async () => {
    const response = await POST(request('POST', { name: 'No Cookie World' }))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toContain('oasis_session')
    expect(createWorld).not.toHaveBeenCalled()
  })

  it('lets hosted admin list worlds without a normal browser session', async () => {
    process.env.OASIS_ADMIN_TOKEN = 'admin-token-for-tests'
    vi.mocked(getRegistry).mockResolvedValue([])
    const adminCookie = signAdminSession(getAdminUserId())

    const response = await GET(request('GET', undefined, `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminCookie)}`))

    expect(response.status).toBe(200)
    expect(getRegistry).toHaveBeenCalledWith(getAdminUserId())
  })
})
