import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/forge/world-server', () => ({
  loadWorld: vi.fn(),
  loadWorldCommandEvent: vi.fn(),
  nextWorldCommandRevision: vi.fn(),
  saveWorld: vi.fn(),
  saveWorldWithCommandEvent: vi.fn(),
}))

import { POST } from '../route'
import {
  loadWorld,
  loadWorldCommandEvent,
  nextWorldCommandRevision,
  saveWorld,
  saveWorldWithCommandEvent,
} from '@/lib/forge/world-server'
import { makeWorldCommand } from '@/lib/world-commands/legacy-map'
import type { WorldState } from '@/lib/forge/world-persistence'

function baseWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    version: 1,
    terrain: null,
    groundPresetId: 'grass',
    groundTiles: {},
    terrainHeights: [],
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    portalGates: [],
    spatialWebObjects: [],
    transforms: {},
    behaviors: {},
    lights: [],
    skyBackgroundId: 'night007',
    customGroundPresets: [],
    agentWindows: [],
    agentAvatars: [],
    paintStrokes: [],
    text3dObjects: [],
    savedAt: '2026-05-25T11:00:00.000Z',
    ...overrides,
  }
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/worlds/world-1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: 'world-1' }) }

describe('/api/worlds/[id]/commands', () => {
  const originalMode = process.env.OASIS_MODE
  const originalRelaySigningKey = process.env.RELAY_SIGNING_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OASIS_MODE = 'local'
    if (originalRelaySigningKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalRelaySigningKey
    vi.mocked(saveWorld).mockResolvedValue({ saved: true, worldId: 'world-1' })
    vi.mocked(saveWorldWithCommandEvent).mockResolvedValue({ saved: true, worldId: 'world-1' })
    vi.mocked(loadWorldCommandEvent).mockResolvedValue(null)
    vi.mocked(nextWorldCommandRevision).mockResolvedValue(1)
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalRelaySigningKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalRelaySigningKey
  })

  it('applies a valid command to the DB snapshot through the reducer', async () => {
    vi.mocked(loadWorld).mockResolvedValue(baseWorld())
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-ground',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.event).toMatchObject({ kind: 'command.accepted', commandId: 'cmd-ground', source: 'http', durable: true })
    expect(saveWorldWithCommandEvent).toHaveBeenCalledWith('world-1', 'local-user', expect.objectContaining({
      groundPresetId: 'sand',
    }), expect.objectContaining({
      commandId: 'cmd-ground',
      actorId: 'local-user',
      kind: 'ground.setPreset',
    }), '2026-05-25T11:00:00.000Z')
  })

  it('returns the logged event without reapplying duplicate command ids', async () => {
    const existingEvent = {
      id: 'evt-dupe',
      kind: 'command.accepted' as const,
      worldId: 'world-1',
      commandId: 'cmd-dupe',
      actorId: 'local-user',
      acceptedAt: '2026-05-25T12:00:01.000Z',
      revision: 7,
      source: 'http' as const,
      durable: true,
    }
    vi.mocked(loadWorldCommandEvent).mockResolvedValue(existingEvent)
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-dupe',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, duplicate: true, changed: false, event: existingEvent })
    expect(loadWorld).not.toHaveBeenCalled()
    expect(saveWorld).not.toHaveBeenCalled()
    expect(saveWorldWithCommandEvent).not.toHaveBeenCalled()
  })

  it('stamps REST command attribution from the authenticated session', async () => {
    vi.mocked(loadWorld).mockResolvedValue(baseWorld())
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'spoofed-user',
      id: 'cmd-spoof',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.event.command.actorId).toBe('local-user')
    expect(body.event.command.actorId).not.toBe('spoofed-user')
  })

  it('returns saver metadata for command persistence', async () => {
    vi.mocked(loadWorld).mockResolvedValue(baseWorld())
    vi.mocked(saveWorldWithCommandEvent).mockResolvedValue({
      saved: true,
      worldId: 'forked-world-1',
      forkedFromWorldId: 'world-1',
    })
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-fork',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.worldId).toBe('forked-world-1')
    expect(body.forkedFromWorldId).toBe('world-1')
    expect(saveWorldWithCommandEvent).toHaveBeenCalledWith(
      'world-1',
      'local-user',
      expect.any(Object),
      expect.objectContaining({ commandId: 'cmd-fork', worldId: 'world-1' }),
      '2026-05-25T11:00:00.000Z',
    )
  })

  it('rejects malformed command payloads before loading or saving', async () => {
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-malformed',
      createdAt: '2026-05-25T12:00:00.000Z',
    }) as unknown as { payload: Record<string, never> }
    command.payload = {}

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.event).toMatchObject({
      kind: 'command.rejected',
      commandId: 'cmd-malformed',
      error: 'ground.setPreset missing groundPresetId',
    })
    expect(loadWorld).not.toHaveBeenCalled()
    expect(saveWorld).not.toHaveBeenCalled()
  })

  it('rejects local-scope commands on the durable command endpoint', async () => {
    const command = makeWorldCommand('media.playback.set', {
      objectId: 'speaker-1',
      playbackScope: 'local',
      state: 'playing',
    }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-local-media',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.event).toMatchObject({ kind: 'command.rejected', error: 'media.playback.set local playback is not room-scoped' })
    expect(loadWorld).not.toHaveBeenCalled()
    expect(saveWorld).not.toHaveBeenCalled()
  })

  it('returns conflict rejection when the DB snapshot changed after command creation', async () => {
    vi.mocked(loadWorld).mockResolvedValue(baseWorld())
    vi.mocked(saveWorldWithCommandEvent).mockResolvedValue({ saved: false, conflict: true, serverUpdatedAt: '2026-05-25T12:01:00.000Z' })
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'local-user',
      id: 'cmd-conflict',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.event).toMatchObject({ kind: 'command.rejected', error: 'world version conflict' })
    expect(body.serverUpdatedAt).toBe('2026-05-25T12:01:00.000Z')
  })

  it('requires a browser session in hosted mode', async () => {
    process.env.OASIS_MODE = 'hosted'
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-1',
      actorId: 'anonymous',
      id: 'cmd-hosted-auth',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toContain('oasis_session')
    expect(loadWorld).not.toHaveBeenCalled()
    expect(saveWorld).not.toHaveBeenCalled()
  })

  it('accepts room-internal commands with a shared secret and stamped actor', async () => {
    process.env.OASIS_MODE = 'hosted'
    process.env.RELAY_SIGNING_KEY = 'unit-test-room-secret'
    vi.mocked(loadWorld).mockResolvedValue(baseWorld())
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'moss' }, {
      worldId: 'world-1',
      actorId: 'spoofed-user',
      actorDisplayName: 'Room Wizard',
      clientId: 'room-session-1',
      id: 'cmd-room-internal',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(new Request('http://localhost/api/worlds/world-1/commands', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-oasis-room-secret': 'unit-test-room-secret',
      },
      body: JSON.stringify({ command, actorUserId: 'bs-room-user' }),
    }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.event).toMatchObject({ kind: 'command.accepted', source: 'http', durable: true })
    expect(body.event.command).toMatchObject({
      actorId: 'bs-room-user',
      actorDisplayName: 'Room Wizard',
      clientId: 'room-session-1',
    })
    expect(saveWorldWithCommandEvent).toHaveBeenCalledWith('world-1', 'bs-room-user', expect.objectContaining({
      groundPresetId: 'moss',
    }), expect.objectContaining({
      commandId: 'cmd-room-internal',
      actorId: 'bs-room-user',
      kind: 'ground.setPreset',
    }), '2026-05-25T11:00:00.000Z')
  })

  it('rejects commands scoped to another world before saving', async () => {
    const command = makeWorldCommand('ground.setPreset', { groundPresetId: 'sand' }, {
      worldId: 'world-2',
      actorId: 'local-user',
      id: 'cmd-ground-mismatch',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const response = await POST(request({ command }), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.event).toMatchObject({ kind: 'command.rejected', error: 'world id mismatch' })
    expect(loadWorld).not.toHaveBeenCalled()
    expect(saveWorld).not.toHaveBeenCalled()
  })
})
