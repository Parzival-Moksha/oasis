// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: listAssets() merge logic over core constants + Asset table rows.
// Constants modules are mocked so we can reason about exactly which assets
// flow through. Prisma stub mirrors the oasis-tools test pattern.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('../../../db', () => ({
  prisma: {
    asset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    world: {
      findUnique: vi.fn(),
    },
  },
}))

// Replace the constants with tiny deterministic fixtures so we can check that
// listAssets merges them with DB rows without pulling in 565 real catalog entries.
vi.mock('../../../../components/scene-lib/constants', () => ({
  ASSET_CATALOG: [
    {
      id: 'cat-rock',
      name: 'Rock',
      path: '/models/rock.glb',
      category: 'nature',
      shortLabel: 'Rock',
      description: 'A simple rock',
      defaultScale: 1,
      thumbnail: '/thumbs/cat-rock.jpg',
    },
    {
      id: 'cat-tree',
      name: 'Tree',
      path: '/models/tree.glb',
      category: 'nature',
      shortLabel: 'Tree',
      description: 'A simple tree',
      defaultScale: 2,
    },
  ],
  SKY_BACKGROUNDS: [
    { id: 'sky-stars', name: 'Stars', path: null },
    { id: 'sky-dawn', name: 'Dawn', path: '/hdri/dawn.hdr' },
  ],
}))

vi.mock('../../ground-textures', () => ({
  GROUND_PRESETS: [
    {
      id: 'grass',
      name: 'Grass',
      icon: '🟩',
      color: '#0a0',
      assetName: 'grass',
      tileRepeat: 1,
      shortLabel: 'Grass',
      description: 'Green grass',
    },
  ],
}))

import { listAssets } from '../library-service'
import { prisma } from '../../../db'

const mockedFindMany = vi.mocked(prisma.asset.findMany)
const mockedWorldFindUnique = vi.mocked(prisma.world.findUnique)

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    kind: 'conjured',
    path: '/conjured/row-1.glb',
    category: 'conjured',
    name: 'Row One',
    shortLabel: null,
    description: null,
    defaultScale: 1,
    bbox: null,
    thumbnailUrl: null,
    bytes: null,
    scope: 'user',
    ownerId: 'viewer-alice',
    source: null,
    license: null,
    tags: null,
    data: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedFindMany.mockResolvedValue([])
  mockedWorldFindUnique.mockResolvedValue(null)
})

describe('listAssets — merge of core + DB rows', () => {
  it('returns core assets (catalog + ground + sky) plus DB rows for the viewer', async () => {
    mockedFindMany.mockResolvedValueOnce([row({ id: 'conj-1', ownerId: 'viewer-alice' })])
    const all = await listAssets({ viewerUserId: 'viewer-alice' })
    const ids = all.map(a => a.id)
    // Core entries from each tier
    expect(ids).toContain('cat-rock')
    expect(ids).toContain('cat-tree')
    expect(ids).toContain('ground_grass')
    expect(ids).toContain('sky_sky-dawn') // sky-stars has path=null and is skipped
    // DB row
    expect(ids).toContain('conj-1')
  })

  it('omits sky entries with path=null (drei presets)', async () => {
    const all = await listAssets({ viewerUserId: 'viewer-alice' })
    expect(all.map(a => a.id)).not.toContain('sky_sky-stars')
  })
})

describe('listAssets — scope filter', () => {
  it('scope:"core" returns no DB rows', async () => {
    mockedFindMany.mockResolvedValueOnce([row({ id: 'conj-only-in-db' })])
    const result = await listAssets({ viewerUserId: 'viewer-alice', scope: 'core' })
    expect(result.find(a => a.id === 'conj-only-in-db')).toBeUndefined()
    expect(result.every(a => a.scope === 'core')).toBe(true)
  })

  it('scope:"user" returns no core rows', async () => {
    mockedFindMany.mockResolvedValueOnce([row({ id: 'conj-1', scope: 'user', ownerId: 'viewer-alice' })])
    const result = await listAssets({ viewerUserId: 'viewer-alice', scope: 'user' })
    expect(result.find(a => a.id === 'cat-rock')).toBeUndefined()
    expect(result.find(a => a.id === 'conj-1')).toBeDefined()
  })
})

describe('listAssets — kind filter', () => {
  it('passes kind into the prisma.asset.findMany where clause', async () => {
    await listAssets({ viewerUserId: 'viewer-alice', kind: 'conjured' })
    const call = mockedFindMany.mock.calls[0]?.[0] as any
    expect(call.where.kind).toBe('conjured')
  })

  it('post-filters merged results by kind (core entries respect it too)', async () => {
    mockedFindMany.mockResolvedValueOnce([])
    const result = await listAssets({ viewerUserId: 'viewer-alice', kind: 'ground' })
    expect(result.every(a => a.kind === 'ground')).toBe(true)
    expect(result.find(a => a.id === 'ground_grass')).toBeDefined()
    expect(result.find(a => a.id === 'cat-rock')).toBeUndefined()
  })
})

describe('listAssets — free-text query', () => {
  it('matches against id (case-insensitive)', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'CAT-ROCK' })
    expect(result.find(a => a.id === 'cat-rock')).toBeDefined()
  })

  it('matches against name', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'tree' })
    expect(result.find(a => a.id === 'cat-tree')).toBeDefined()
  })

  it('matches against shortLabel', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'rock' })
    expect(result.find(a => a.id === 'cat-rock')).toBeDefined()
  })

  it('matches against description', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'a simple tree' })
    expect(result.find(a => a.id === 'cat-tree')).toBeDefined()
  })

  it('matches against category', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'nature' })
    expect(result.find(a => a.id === 'cat-rock')).toBeDefined()
    expect(result.find(a => a.id === 'cat-tree')).toBeDefined()
  })

  it('drops assets that match nothing', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'zzz-no-such-thing' })
    expect(result).toHaveLength(0)
  })
})

describe('listAssets — limit', () => {
  it('caps merged results at the limit value', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', limit: 2 })
    expect(result).toHaveLength(2)
  })
})

describe('listAssets — worldId / public-world visibility', () => {
  it('looks up world.assetVisibility and userId when worldId is passed', async () => {
    mockedWorldFindUnique.mockResolvedValueOnce({ userId: 'viewer-bob', assetVisibility: 'public' } as any)
    await listAssets({ viewerUserId: 'viewer-alice', worldId: 'world-99' })
    expect(mockedWorldFindUnique).toHaveBeenCalledWith({
      where: { id: 'world-99' },
      select: { userId: true, assetVisibility: true },
    })
  })

  it('public-visibility world reveals the world owner’s user-scope assets to other viewers', async () => {
    mockedWorldFindUnique.mockResolvedValueOnce({ userId: 'viewer-bob', assetVisibility: 'public' } as any)
    mockedFindMany.mockResolvedValueOnce([
      row({ id: 'bob-conjure', ownerId: 'viewer-bob', scope: 'user' }),
    ])
    const result = await listAssets({ viewerUserId: 'viewer-alice', worldId: 'world-99' })
    expect(result.find(a => a.id === 'bob-conjure')).toBeDefined()
  })

  it('private-visibility world hides the world owner’s user-scope assets from other viewers', async () => {
    mockedWorldFindUnique.mockResolvedValueOnce({ userId: 'viewer-bob', assetVisibility: 'private' } as any)
    mockedFindMany.mockResolvedValueOnce([
      row({ id: 'bob-conjure', ownerId: 'viewer-bob', scope: 'user' }),
    ])
    const result = await listAssets({ viewerUserId: 'viewer-alice', worldId: 'world-99' })
    expect(result.find(a => a.id === 'bob-conjure')).toBeUndefined()
  })

  it('still serves core assets when the world lookup fails (degraded mode)', async () => {
    mockedWorldFindUnique.mockRejectedValueOnce(new Error('db hiccup'))
    const result = await listAssets({ viewerUserId: 'viewer-alice', worldId: 'world-99' })
    expect(result.find(a => a.id === 'cat-rock')).toBeDefined()
  })

  it('still serves core assets when the world is not found', async () => {
    mockedWorldFindUnique.mockResolvedValueOnce(null)
    const result = await listAssets({ viewerUserId: 'viewer-alice', worldId: 'no-such-world' })
    expect(result.find(a => a.id === 'cat-rock')).toBeDefined()
  })

  it('filters out user-scope rows the viewer can’t see (no world context)', async () => {
    mockedFindMany.mockResolvedValueOnce([
      row({ id: 'mine', ownerId: 'viewer-alice' }),
      row({ id: 'others', ownerId: 'viewer-bob' }),
      row({ id: 'orphan', ownerId: null }),
    ])
    const result = await listAssets({ viewerUserId: 'viewer-alice' })
    expect(result.find(a => a.id === 'mine')).toBeDefined()
    expect(result.find(a => a.id === 'others')).toBeUndefined()
    expect(result.find(a => a.id === 'orphan')).toBeUndefined()
  })
})
