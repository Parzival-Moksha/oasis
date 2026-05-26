import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/forge/world-server', () => ({
  loadWorld: vi.fn(),
  saveWorld: vi.fn(),
  latestWorldCommandRevision: vi.fn(),
  saveWorldCheckpointWithCommandEvents: vi.fn(),
  deleteWorld: vi.fn(),
  getRegistry: vi.fn(),
  updateWorldMetadata: vi.fn(),
}))

import { PUT } from '../route'
import { saveWorld, saveWorldCheckpointWithCommandEvents } from '@/lib/forge/world-server'

const context = { params: Promise.resolve({ id: 'world-1' }) }

function request(body: unknown, clientLoadedAt?: string, extraHeaders: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (clientLoadedAt) headers['x-oasis-client-loaded-at'] = clientLoadedAt
  Object.assign(headers, extraHeaders)
  return new Request('http://localhost/api/worlds/world-1', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
}

describe('/api/worlds/[id] PUT', () => {
  const originalMode = process.env.OASIS_MODE
  const originalRelaySigningKey = process.env.RELAY_SIGNING_KEY
  const originalRoomInternalSecret = process.env.OASIS_ROOM_INTERNAL_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OASIS_MODE = 'local'
    if (originalRelaySigningKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalRelaySigningKey
    if (originalRoomInternalSecret === undefined) delete process.env.OASIS_ROOM_INTERNAL_SECRET
    else process.env.OASIS_ROOM_INTERNAL_SECRET = originalRoomInternalSecret
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalRelaySigningKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalRelaySigningKey
    if (originalRoomInternalSecret === undefined) delete process.env.OASIS_ROOM_INTERNAL_SECRET
    else process.env.OASIS_ROOM_INTERNAL_SECRET = originalRoomInternalSecret
  })

  it('passes the client loaded timestamp into the full-snapshot save guard', async () => {
    vi.mocked(saveWorld).mockResolvedValue({
      saved: false,
      conflict: true,
      serverUpdatedAt: '2026-05-26T10:00:30.000Z',
    })

    const response = await PUT(request({
      terrain: null,
      craftedScenes: [],
      conjuredAssetIds: [],
      transforms: {},
    }, '2026-05-26T10:00:00.000Z'), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.conflict).toBe(true)
    expect(body.serverUpdatedAt).toBe('2026-05-26T10:00:30.000Z')
    expect(saveWorld).toHaveBeenCalledWith(
      'world-1',
      'local-user',
      expect.objectContaining({ terrain: null }),
      '2026-05-26T10:00:00.000Z',
    )
  })

  it('routes room checkpoints through the checkpoint saver with events and precondition', async () => {
    process.env.OASIS_ROOM_INTERNAL_SECRET = 'unit-test-room-secret'
    vi.mocked(saveWorldCheckpointWithCommandEvents).mockResolvedValue({
      saved: true,
      worldId: 'world-1',
      savedAt: '2026-05-26T10:00:05.000Z',
      eventsSaved: 2,
      eventsSkipped: 0,
    })
    const event = {
      id: 'evt-1',
      kind: 'command.accepted',
      worldId: 'world-1',
      commandId: 'cmd-1',
      acceptedAt: '2026-05-26T10:00:01.000Z',
      revision: 1,
    }

    const response = await PUT(request({
      state: { terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} },
      events: [event],
      baseSavedAt: '2026-05-26T10:00:00.000Z',
    }, undefined, {
      'x-oasis-room-secret': 'unit-test-room-secret',
      'x-oasis-actor-user-id': 'room-user',
      'x-oasis-room-checkpoint': 'timer',
    }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, eventsSaved: 2, savedAt: '2026-05-26T10:00:05.000Z' })
    expect(saveWorldCheckpointWithCommandEvents).toHaveBeenCalledWith(
      'world-1',
      'room-user',
      expect.objectContaining({ terrain: null }),
      [event],
      '2026-05-26T10:00:00.000Z',
    )
    expect(saveWorld).not.toHaveBeenCalled()
  })
})
