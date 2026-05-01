import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db', () => ({
  prisma: {
    world: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
  },
}))

vi.mock('../agent-avatar-world-state', () => ({
  normalizeWorldStateAgentAvatarTransforms: vi.fn((state) => state),
}))

import {
  createManualSnapshot,
  deleteWorld,
  getRegistry,
  loadWorld,
  saveWorld,
  type WorldState,
} from '../forge/world-server'
import { WorldAccessError } from '../forge/world-access'
import { prisma } from '../db'

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

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OASIS_MODE
    process.env.OASIS_PROFILE = 'hosted-openclaw'
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalProfile === undefined) delete process.env.OASIS_PROFILE
    else process.env.OASIS_PROFILE = originalProfile
  })

  it('filters hosted registry to owned and discoverable worlds', async () => {
    vi.mocked(prisma.world.findMany).mockResolvedValue([
      worldRow({ id: 'owned-private', userId: 'user-a', visibility: 'private' }),
      worldRow({ id: 'other-private', userId: 'user-b', visibility: 'private' }),
      worldRow({ id: 'welcome-core', userId: 'system', visibility: 'core' }),
      worldRow({ id: 'public-world', userId: 'user-b', visibility: 'public' }),
      worldRow({ id: 'link-only', userId: 'user-b', visibility: 'unlisted' }),
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
  })

  it('forks templates on first save instead of mutating the template row', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue(worldRow({ id: 'template-1', userId: 'system', visibility: 'template', name: 'Starter' }))
    vi.mocked(prisma.world.create).mockImplementation((async (args: any) => ({
      id: args.data.id,
      name: args.data.name,
      icon: args.data.icon,
      visibility: args.data.visibility,
      createdAt: args.data.createdAt,
      updatedAt: args.data.updatedAt,
    })) as any)

    const result = await saveWorld('template-1', 'user-a', state({ conjuredAssetIds: ['asset-1'] }))

    expect(result.saved).toBe(true)
    expect(result.forkedFromWorldId).toBe('template-1')
    expect(result.worldId).toMatch(/^world-/)
    expect(vi.mocked(prisma.world.update)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.world.create).mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'user-a',
      name: 'Starter',
      visibility: 'private',
      objectCount: 1,
    })
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
