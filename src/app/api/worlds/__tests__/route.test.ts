import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/forge/world-server', () => ({
  getRegistry: vi.fn(),
  createWorld: vi.fn(),
  saveWorld: vi.fn(),
}))

vi.mock('@/lib/oasis-analytics', () => ({
  recordOasisAnalyticsEvent: vi.fn(),
}))

import { GET, POST } from '../route'
import { getRegistry, createWorld, saveWorld } from '@/lib/forge/world-server'
import { recordOasisAnalyticsEvent } from '@/lib/oasis-analytics'
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

  it('records world creation as an activation event', async () => {
    process.env.OASIS_ADMIN_TOKEN = 'admin-token-for-tests'
    const adminCookie = signAdminSession(getAdminUserId())
    vi.mocked(createWorld).mockResolvedValue({
      id: 'world-created-1',
      name: 'Signal World',
      icon: 'O',
      visibility: 'private',
      createdAt: '',
      lastSavedAt: '',
      objectCount: 0,
      visitCount: 0,
      canWrite: true,
      writeDecision: 'write',
      assetVisibility: 'public',
    } as never)

    const response = await POST(request('POST', { name: 'Signal World' }, `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminCookie)}`))

    expect(response.status).toBe(201)
    expect(recordOasisAnalyticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'world_created',
      worldId: 'world-created-1',
      source: 'worlds-route',
    }))
  })

  it('preserves full world state fields when importing world JSON', async () => {
    process.env.OASIS_ADMIN_TOKEN = 'admin-token-for-tests'
    const adminCookie = signAdminSession(getAdminUserId())
    vi.mocked(createWorld).mockResolvedValue({
      id: 'world-imported-1',
      name: 'Imported Full World',
      icon: 'I',
      visibility: 'private',
      createdAt: '',
      lastSavedAt: '',
      objectCount: 0,
      visitCount: 0,
      canWrite: true,
      writeDecision: 'write',
      assetVisibility: 'public',
    } as never)

    const state = {
      version: 1,
      terrain: null,
      terrainHeights: [0, 0.5, 1],
      craftedScenes: [{ id: 'craft-1' }],
      conjuredAssetIds: ['conj-1'],
      catalogPlacements: [{ id: 'catalog-1' }],
      portalGates: [{ id: 'portal-1' }],
      spatialWebObjects: [{ id: 'spatial-1' }],
      transforms: { 'catalog-1': { position: [1, 2, 3] } },
      behaviors: { 'catalog-1': { visible: true } },
      groundPresetId: 'grass',
      groundTiles: { '0,0': 'sand' },
      lights: [{ id: 'light-1' }],
      skyBackgroundId: 'warehouse',
      customGroundPresets: [{ id: 'custom-ground-1' }],
      agentWindows: [{ id: 'agent-window-1' }],
      agentAvatars: [{ id: 'agent-avatar-1' }],
      paintStrokes: [{ id: 'stroke-1' }],
      text3dObjects: [{ id: 'text-1' }],
      savedAt: '2026-05-27T00:00:00.000Z',
    }

    const response = await POST(request(
      'POST',
      { import: true, meta: { name: 'Imported Full World', icon: 'I' }, state },
      `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(adminCookie)}`,
    ))

    expect(response.status).toBe(201)
    expect(saveWorld).toHaveBeenCalledWith('world-imported-1', getAdminUserId(), expect.objectContaining({
      portalGates: state.portalGates,
      spatialWebObjects: state.spatialWebObjects,
      customGroundPresets: state.customGroundPresets,
      paintStrokes: state.paintStrokes,
      text3dObjects: state.text3dObjects,
      agentWindows: state.agentWindows,
      agentAvatars: state.agentAvatars,
    }))
  })
})
