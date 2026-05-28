import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => {
  const prisma = {
    world: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    worldSnapshot: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    worldLike: {
      findMany: vi.fn(),
    },
    worldEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    profile: {
      findMany: vi.fn(),
    },
  }
  return { prisma }
})

vi.mock('../agent-avatar-world-state', () => ({
  normalizeWorldStateAgentAvatarTransforms: vi.fn((state) => state),
}))

vi.mock('../default-world-seed-writer', () => ({
  mirrorDefaultWorldSeed: vi.fn(async () => ({ updated: false })),
}))

import {
  createWorld,
  createManualSnapshot,
  deleteWorld,
  getRegistry,
  loadWorld,
  saveWorld,
  saveWorldCheckpointWithCommandEvents,
  setWorldVisibility,
  type WorldState,
} from '../forge/world-server'
import { WorldAccessError } from '../forge/world-access'
import { prisma } from '../db'
import { WELCOME_HUB_WORLD_ID } from '../portal-gates'
import { mirrorDefaultWorldSeed } from '../default-world-seed-writer'

const now = new Date('2026-04-30T12:00:00.000Z')

function state(overrides: Partial<WorldState> = {}): WorldState {
  return {
    version: 1,
    terrain: null,
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    transforms: {},
    savedAt: now.toISOString(),
    ...overrides,
  }
}

function worldRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'world-a',
    userId: 'owner-a',
    name: 'World A',
    icon: 'W',
    shortCode: null,
    visibility: 'private',
    data: JSON.stringify(state()),
    thumbnailUrl: null,
    creatorName: null,
    creatorAvatar: null,
    visitCount: 0,
    objectCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('world-server access enforcement', () => {
  const originalMode = process.env.OASIS_MODE
  const originalProfile = process.env.OASIS_PROFILE
  const originalCheckpointEvents = process.env.OASIS_ROOM_CHECKPOINT_EVENTS
  const originalCheckpointSnapshots = process.env.OASIS_ROOM_CHECKPOINT_SNAPSHOTS

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mirrorDefaultWorldSeed).mockResolvedValue({ updated: false })
    vi.mocked(prisma.profile.findMany).mockResolvedValue([])
    vi.mocked(prisma.worldLike.findMany).mockResolvedValue([])
    delete process.env.OASIS_MODE
    delete process.env.OASIS_ROOM_CHECKPOINT_EVENTS
    delete process.env.OASIS_ROOM_CHECKPOINT_SNAPSHOTS
    process.env.OASIS_PROFILE = 'hosted-openclaw'
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
    if (originalCheckpointEvents === undefined) delete process.env.OASIS_ROOM_CHECKPOINT_EVENTS
    else process.env.OASIS_ROOM_CHECKPOINT_EVENTS = originalCheckpointEvents
    if (originalCheckpointSnapshots === undefined) delete process.env.OASIS_ROOM_CHECKPOINT_SNAPSHOTS
    else process.env.OASIS_ROOM_CHECKPOINT_SNAPSHOTS = originalCheckpointSnapshots
  })

  it('filters hosted registry to owned and discoverable worlds', async () => {
    vi.mocked(prisma.world.findMany).mockResolvedValue([
      worldRow({ id: 'owned-private', userId: 'user-a', visibility: 'private' }),
      worldRow({ id: 'other-private', userId: 'user-b', visibility: 'private' }),
      worldRow({ id: 'welcome-core', userId: 'system', visibility: 'core' }),
      worldRow({ id: 'public-world', userId: 'user-b', visibility: 'public' }),
      worldRow({ id: 'link-only', userId: 'user-b', visibility: 'unlisted' }),
      worldRow({ id: 'link-build', userId: 'user-b', visibility: 'unlisted_edit' }),
    ])

    const registry = await getRegistry('user-a')
    expect(registry.map(w => w.id)).toEqual(['owned-private', 'welcome-core', 'public-world'])
    expect(vi.mocked(prisma.world.findMany).mock.calls[0]?.[0]?.where).toEqual({
      OR: [
        { userId: 'user-a' },
        { visibility: { in: ['core', 'template', 'ffa', 'public_edit', 'public'] } },
      ],
    })
  })

  it('seeds new worlds with a one-way crystal portal back to Portal Zero', async () => {
    vi.mocked(prisma.world.create).mockImplementation((async (args: any) => ({
      id: args.data.id,
      userId: args.data.userId,
      name: args.data.name,
      icon: args.data.icon,
      visibility: 'private',
      data: args.data.data,
      thumbnailUrl: null,
      creatorName: null,
      creatorAvatar: null,
      visitCount: 0,
      objectCount: 0,
      createdAt: args.data.createdAt,
      updatedAt: args.data.updatedAt,
    })) as any)

    await createWorld('Private Lab', 'P', 'user-a')
    const createArgs = vi.mocked(prisma.world.create).mock.calls[0]?.[0] as any
    const worldData = JSON.parse(createArgs.data.data) as WorldState

    expect(createArgs.data).toMatchObject({ visibility: 'private', pvpEnabled: false })
    expect(worldData.portalGates).toEqual([
      expect.objectContaining({
        id: 'portal-return-to-portal-zero',
        variant: 'crystal-cavern',
        direction: 'one-way',
        targetWorldId: WELCOME_HUB_WORLD_ID,
        targetWorldName: 'Portal Zero',
      }),
    ])
  })

  it('creates FFA worlds as PvP-enabled public-edit sandboxes immediately', async () => {
    vi.mocked(prisma.world.create).mockImplementation((async (args: any) => ({
      id: args.data.id,
      userId: args.data.userId,
      name: args.data.name,
      icon: args.data.icon,
      visibility: args.data.visibility,
      pvpEnabled: args.data.pvpEnabled,
      data: args.data.data,
      thumbnailUrl: null,
      creatorName: null,
      creatorAvatar: null,
      visitCount: 0,
      objectCount: 0,
      createdAt: args.data.createdAt,
      updatedAt: args.data.updatedAt,
    })) as any)

    const meta = await createWorld('Arena', 'F', 'user-a', { visibility: 'ffa' })
    const createArgs = vi.mocked(prisma.world.create).mock.calls[0]?.[0] as any

    expect(createArgs.data).toMatchObject({ visibility: 'public_edit', pvpEnabled: true })
    expect(meta.visibility).toBe('public_edit')
    expect(meta.pvpEnabled).toBe(true)
  })

  it('lets local mode create core seed-backed worlds', async () => {
    process.env.OASIS_PROFILE = 'local'
    vi.mocked(mirrorDefaultWorldSeed).mockResolvedValue({ updated: true, slug: 'core-lab', file: 'core-lab.world.json' })
    vi.mocked(prisma.world.create).mockImplementation((async (args: any) => ({
      id: args.data.id,
      userId: args.data.userId,
      name: args.data.name,
      icon: args.data.icon,
      visibility: args.data.visibility,
      pvpEnabled: args.data.pvpEnabled,
      data: args.data.data,
      thumbnailUrl: null,
      creatorName: null,
      creatorAvatar: null,
      visitCount: 0,
      objectCount: 0,
      createdAt: args.data.createdAt,
      updatedAt: args.data.updatedAt,
    })) as any)

    const meta = await createWorld('Core Lab', 'C', 'local-user', { visibility: 'core' })
    const createArgs = vi.mocked(prisma.world.create).mock.calls[0]?.[0] as any

    expect(createArgs.data.visibility).toBe('core')
    expect(meta.visibility).toBe('core')
    expect(mirrorDefaultWorldSeed).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Core Lab',
      visibility: 'core',
      data: expect.any(String),
    }))
  })

  it('keeps core creation unavailable to normal hosted users', async () => {
    vi.mocked(prisma.world.create).mockImplementation((async (args: any) => ({
      id: args.data.id,
      userId: args.data.userId,
      name: args.data.name,
      icon: args.data.icon,
      visibility: args.data.visibility,
      pvpEnabled: args.data.pvpEnabled,
      data: args.data.data,
      thumbnailUrl: null,
      creatorName: null,
      creatorAvatar: null,
      visitCount: 0,
      objectCount: 0,
      createdAt: args.data.createdAt,
      updatedAt: args.data.updatedAt,
    })) as any)

    const meta = await createWorld('Hosted Core Try', 'C', 'user-a', { visibility: 'core' })
    const createArgs = vi.mocked(prisma.world.create).mock.calls[0]?.[0] as any

    expect(createArgs.data.visibility).toBe('private')
    expect(meta.visibility).toBe('private')
    expect(mirrorDefaultWorldSeed).not.toHaveBeenCalled()
  })

  it('lets hosted admin list every world', async () => {
    vi.mocked(prisma.world.findMany).mockResolvedValue([
      worldRow({ id: 'owned-private', userId: 'user-a', visibility: 'private' }),
      worldRow({ id: 'other-private', userId: 'user-b', visibility: 'private' }),
      worldRow({ id: 'welcome-core', userId: 'system', visibility: 'core' }),
    ])

    const registry = await getRegistry('hosted-admin')

    expect(registry.map(w => w.id)).toEqual(['owned-private', 'other-private', 'welcome-core'])
    expect(vi.mocked(prisma.world.findMany).mock.calls[0]?.[0]?.where).toBeUndefined()
  })

  it('does not load another hosted user private world', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ userId: 'user-b', visibility: 'private' }))

    await expect(loadWorld('world-a', 'user-a')).resolves.toBeNull()
  })

  it('rejects writes to core worlds', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ id: 'welcome', userId: 'system', visibility: 'core' }))

    await expect(saveWorld('welcome', 'user-a', state())).rejects.toBeInstanceOf(WorldAccessError)
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
  })

  it('allows hosted admin writes to core worlds', async () => {
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'welcome', userId: 'system', visibility: 'core' }))
      .mockResolvedValueOnce({ data: JSON.stringify(state()) } as any)
    vi.mocked(prisma.worldSnapshot.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.world.update).mockResolvedValue(worldRow({ id: 'welcome', visibility: 'core' }))

    const result = await saveWorld('welcome', 'hosted-admin', current)

    expect(result).toMatchObject({ saved: true, worldId: 'welcome' })
    expect(vi.mocked(prisma.world.update)).toHaveBeenCalled()
    expect(mirrorDefaultWorldSeed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'welcome',
      visibility: 'core',
      data: expect.any(String),
    }))
  })

  it('blocks portal-only overwrites of worlds that already have real content', async () => {
    const contentfulPortalZero = state({
      catalogPlacements: [{ id: 'cat-1' }, { id: 'cat-2' }, { id: 'cat-3' }] as any,
      portalGates: [{ id: 'portal-existing' } as any],
    })
    const portalOnlySave = state({
      catalogPlacements: [],
      craftedScenes: [],
      conjuredAssetIds: [],
      agentAvatars: [],
      agentWindows: [],
      spatialWebObjects: [],
      portalGates: [{ id: 'portal-only' } as any],
    })
    vi.mocked(prisma.world.findFirst).mockResolvedValue(
      worldRow({
        id: 'welcome',
        userId: 'system',
        visibility: 'core',
        data: JSON.stringify(contentfulPortalZero),
      }),
    )

    await expect(saveWorld('welcome', 'hosted-admin', portalOnlySave)).rejects.toMatchObject({
      code: 'world_content_drop_blocked',
    })
    expect(vi.mocked(prisma.worldSnapshot.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
  })

  it('lets local mode mark a world core and mirrors the seed artifact', async () => {
    process.env.OASIS_PROFILE = 'local'
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'world-lab', userId: 'local-user', visibility: 'private' }))
      .mockResolvedValueOnce(worldRow({ id: 'world-lab', userId: 'local-user', visibility: 'core' }))
    vi.mocked(prisma.world.updateMany).mockResolvedValue({ count: 1 } as any)

    await setWorldVisibility('world-lab', 'local-user', 'core')

    expect(vi.mocked(prisma.world.updateMany)).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'world-lab' },
      data: expect.objectContaining({ visibility: 'core' }),
    }))
    expect(mirrorDefaultWorldSeed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'world-lab',
      visibility: 'core',
    }))
  })

  it('rejects normal hosted users marking worlds core', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ id: 'world-lab', userId: 'user-a', visibility: 'private' }))

    await expect(setWorldVisibility('world-lab', 'user-a', 'core')).rejects.toMatchObject({
      code: 'system_visibility_forbidden',
    })
    expect(vi.mocked(prisma.world.updateMany)).not.toHaveBeenCalled()
    expect(mirrorDefaultWorldSeed).not.toHaveBeenCalled()
  })

  it('rejects normal hosted saves to template worlds', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ id: 'template-1', userId: 'system', visibility: 'template', name: 'Starter' }))

    await expect(saveWorld('template-1', 'user-a', state({ conjuredAssetIds: ['asset-1'] }))).rejects.toMatchObject({
      code: 'world_write_forbidden',
    })
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.world.create)).not.toHaveBeenCalled()
  })

  it('allows hosted FFA writes by non-owners', async () => {
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit' }))
      .mockResolvedValueOnce({ data: JSON.stringify(current) } as any)
    vi.mocked(prisma.worldSnapshot.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.world.update).mockResolvedValue(worldRow({ id: 'ffa-1', visibility: 'public_edit' }))

    const result = await saveWorld('ffa-1', 'user-a', current)

    expect(result).toMatchObject({ saved: true, worldId: 'ffa-1' })
    expect(vi.mocked(prisma.world.update).mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'ffa-1' },
      data: { objectCount: 1 },
    })
  })

  it('uses an atomic timestamp guard for full-snapshot saves', async () => {
    const loadedAt = new Date('2026-04-30T12:00:00.000Z')
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit', updatedAt: loadedAt }))
      .mockResolvedValueOnce({ data: JSON.stringify(current) } as any)
    vi.mocked(prisma.worldSnapshot.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.world.updateMany).mockResolvedValue({ count: 0 } as any)

    const result = await saveWorld('ffa-1', 'user-a', current, loadedAt.toISOString())

    expect(result).toMatchObject({ saved: false, conflict: true })
    expect(vi.mocked(prisma.world.updateMany)).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'ffa-1',
        updatedAt: { lte: loadedAt },
      },
    }))
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
  })

  it('saves room checkpoints with their command events in one transaction', async () => {
    const loadedAt = new Date('2026-04-30T12:00:00.000Z')
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit', updatedAt: loadedAt }))
      .mockResolvedValueOnce({ data: JSON.stringify(current) } as any)
    vi.mocked(prisma.worldSnapshot.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.world.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.worldEvent.findMany).mockResolvedValue([])

    const result = await saveWorldCheckpointWithCommandEvents('ffa-1', 'user-a', current, [{
      id: 'evt-1',
      kind: 'command.accepted',
      worldId: 'ffa-1',
      commandId: 'cmd-1',
      actorId: 'user-a',
      acceptedAt: '2026-04-30T12:00:01.000Z',
      revision: 7,
      source: 'room',
      durable: true,
      command: {
        id: 'cmd-1',
        kind: 'object.add',
        worldId: 'ffa-1',
        actorId: 'user-a',
        clientId: 'session-1',
        createdAt: '2026-04-30T12:00:01.000Z',
        payload: { object: { id: 'cat-1' } },
      } as any,
    }], loadedAt.toISOString())

    expect(result).toMatchObject({ saved: true, worldId: 'ffa-1', eventsSaved: 1, eventsSkipped: 0 })
    expect(vi.mocked(prisma.world.updateMany)).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'ffa-1',
        updatedAt: { lte: loadedAt },
      },
    }))
    expect(vi.mocked(prisma.worldEvent.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'evt-1',
        worldId: 'ffa-1',
        commandId: 'cmd-1',
        actorId: 'user-a',
        sessionId: 'session-1',
        kind: 'object.add',
        worldVersion: 7,
      }),
    })
  })

  it('can skip room checkpoint command-event persistence for hosted stress paths', async () => {
    process.env.OASIS_ROOM_CHECKPOINT_EVENTS = '0'
    process.env.OASIS_ROOM_CHECKPOINT_SNAPSHOTS = '0'
    const loadedAt = new Date('2026-04-30T12:00:00.000Z')
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst).mockResolvedValueOnce(
      worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit', updatedAt: loadedAt }),
    )
    vi.mocked(prisma.world.updateMany).mockResolvedValue({ count: 1 } as any)

    const result = await saveWorldCheckpointWithCommandEvents('ffa-1', 'user-a', current, [{
      id: 'evt-1',
      kind: 'command.accepted',
      worldId: 'ffa-1',
      commandId: 'cmd-1',
      actorId: 'user-a',
      acceptedAt: '2026-04-30T12:00:01.000Z',
      revision: 7,
      source: 'room',
      durable: true,
      command: {
        id: 'cmd-1',
        kind: 'object.add',
        worldId: 'ffa-1',
        actorId: 'user-a',
        clientId: 'session-1',
        createdAt: '2026-04-30T12:00:01.000Z',
        payload: { object: { id: 'cat-1' } },
      } as any,
    }], loadedAt.toISOString())

    expect(result).toMatchObject({ saved: true, worldId: 'ffa-1', eventsSaved: 0, eventsSkipped: 1 })
    expect(vi.mocked(prisma.worldSnapshot.findFirst)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.worldEvent.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.worldEvent.create)).not.toHaveBeenCalled()
  })

  it('refuses room checkpoints that are based on stale world data', async () => {
    const loadedAt = new Date('2026-04-30T12:00:00.000Z')
    const serverUpdatedAt = new Date('2026-04-30T12:00:05.000Z')
    vi.mocked(prisma.world.findFirst).mockResolvedValueOnce(
      worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit', updatedAt: serverUpdatedAt }),
    )

    const result = await saveWorldCheckpointWithCommandEvents('ffa-1', 'user-a', state(), [], loadedAt.toISOString())

    expect(result).toMatchObject({
      saved: false,
      conflict: true,
      serverUpdatedAt: serverUpdatedAt.toISOString(),
    })
    expect(vi.mocked(prisma.world.updateMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.worldEvent.create)).not.toHaveBeenCalled()
  })

  it('allows hosted link-build writes by non-owners without making them discoverable', async () => {
    const current = state({ catalogPlacements: [{ id: 'cat-1' } as any] })
    vi.mocked(prisma.world.findFirst)
      .mockResolvedValueOnce(worldRow({ id: 'link-build-1', userId: 'user-b', visibility: 'unlisted_edit' }))
      .mockResolvedValueOnce({ data: JSON.stringify(current) } as any)
    vi.mocked(prisma.worldSnapshot.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.world.update).mockResolvedValue(worldRow({ id: 'link-build-1', visibility: 'unlisted_edit' }))

    const result = await saveWorld('link-build-1', 'user-a', current)

    expect(result).toMatchObject({ saved: true, worldId: 'link-build-1' })
    expect(vi.mocked(prisma.world.update).mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'link-build-1' },
      data: { objectCount: 1 },
    })
  })

  it('rejects deleting another hosted user private world', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ userId: 'user-b', visibility: 'private' }))

    await expect(deleteWorld('world-a', 'user-a')).rejects.toBeInstanceOf(WorldAccessError)
    expect(vi.mocked(prisma.world.deleteMany)).not.toHaveBeenCalled()
  })

  it('keeps snapshots as owner power even on FFA worlds', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ id: 'ffa-1', userId: 'user-b', visibility: 'public_edit' }))

    await expect(createManualSnapshot('ffa-1', 'user-a')).rejects.toBeInstanceOf(WorldAccessError)
    expect(vi.mocked(prisma.worldSnapshot.create)).not.toHaveBeenCalled()
  })
})
