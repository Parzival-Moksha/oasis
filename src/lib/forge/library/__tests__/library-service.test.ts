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
//
// NOTE: `cat-door` has `tags: ['village','door','wood']` and `cat-tagged` has
// `tags: ['x','y']` — both used by the tag-aware-search + carry-through tests
// further down. Names + ids deliberately avoid 'wood' so tag-only matches can
// be exercised without name/id false positives.
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
    {
      id: 'cat-door',
      name: 'Village Gate',
      path: '/models/door.glb',
      category: 'village',
      shortLabel: 'Gate',
      description: 'A gate',
      defaultScale: 1,
      tags: ['village', 'door', 'wood'],
    },
    {
      // Empty tags array — should still match by other fields, never crash.
      id: 'cat-empty-tags',
      name: 'EmptyTagsThing',
      path: '/models/empty-tags.glb',
      category: 'misc',
      shortLabel: 'Empty',
      description: 'has empty tags',
      defaultScale: 1,
      tags: [],
    },
    {
      // Used by the "tags carry through to LibraryAsset" test.
      id: 'cat-tagged',
      name: 'Tagged',
      path: '/models/tagged.glb',
      category: 'misc',
      shortLabel: 'Tagged',
      description: 'tagged thing',
      defaultScale: 1,
      tags: ['x', 'y'],
    },
    {
      // No `tags` field at all (the default for legacy TS-array entries).
      // Used by the "undefined tags becomes null" carry-through test.
      id: 'cat-untagged',
      name: 'Untagged',
      path: '/models/untagged.glb',
      category: 'misc',
      shortLabel: 'Untagged',
      description: 'plain old entry',
      defaultScale: 1,
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

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TAG-AWARE SEARCH — `a.tags.some(t => t.toLowerCase().includes(q))`
// (the recent addition to the free-text query filter)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

describe('listAssets — tag-aware free-text query', () => {
  it('matches a core asset by one of its tags ("wood" → cat-door tagged village/door/wood)', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'wood' })
    expect(result.find(a => a.id === 'cat-door')).toBeDefined()
  })

  it('matches case-insensitively (query "WOOD" finds tag "wood")', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'WOOD' })
    expect(result.find(a => a.id === 'cat-door')).toBeDefined()
  })

  it('matches even when the tag value is only a substring of the query target', async () => {
    // 'doo' is a substring of the tag 'door' on cat-door. Tag includes() not equals().
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'doo' })
    expect(result.find(a => a.id === 'cat-door')).toBeDefined()
  })

  it('does not crash on assets whose tags is an empty array; they still match by name/etc.', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'EmptyTagsThing' })
    expect(result.find(a => a.id === 'cat-empty-tags')).toBeDefined()
  })

  it('does not crash on assets with null tags (DB rows); they still match by other fields', async () => {
    // Asset table rows default to tags=null in the row() helper. Verify a row
    // whose only match is on name still surfaces — proves tag-filter logic
    // doesn't throw on `null.some()`.
    mockedFindMany.mockResolvedValueOnce([row({ id: 'db-named', name: 'WoodFromName', ownerId: 'viewer-alice', tags: null })])
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'WoodFromName' })
    expect(result.find(a => a.id === 'db-named')).toBeDefined()
  })

  it('matches a DB row only by its tag content (name+id+desc do not contain the query)', async () => {
    // tags column in the DB is a JSON-encoded string; rowToLibraryAsset parses it.
    mockedFindMany.mockResolvedValueOnce([row({
      id: 'db-tagged',
      name: 'Plain Thing',                       // no 'wood'
      shortLabel: 'Plain',                       // no 'wood'
      description: 'just a thing',               // no 'wood'
      category: 'misc',                          // no 'wood'
      tags: JSON.stringify(['lumber', 'wood']),  // tag-only match for 'wood'
      ownerId: 'viewer-alice',
    })])
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'wood' })
    expect(result.find(a => a.id === 'db-tagged')).toBeDefined()
  })

  it('still drops assets whose tags do not match anything either', async () => {
    // cat-rock has no tags; query for one of cat-door's tags should not find cat-rock.
    const result = await listAssets({ viewerUserId: 'viewer-alice', query: 'village' })
    expect(result.find(a => a.id === 'cat-rock')).toBeUndefined()
    // cat-door's tag includes 'village' AND category is 'village' (so it matches anyway).
    expect(result.find(a => a.id === 'cat-door')).toBeDefined()
  })
})

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TAGS CARRY-THROUGH from AssetDefinition into LibraryAsset.
// `coreAssets()` does `tags: a.tags ?? null`. Verify both branches:
//   - defined array → carried through as an array
//   - undefined → coerced to null (NOT undefined)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

describe('listAssets — AssetDefinition.tags is carried through to LibraryAsset', () => {
  it('preserves the tags array on the returned LibraryAsset', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice' })
    const tagged = result.find(a => a.id === 'cat-tagged')
    expect(tagged).toBeDefined()
    expect(tagged!.tags).toEqual(['x', 'y'])
  })

  it('coerces missing tags (undefined on the source) to null, not undefined', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice' })
    const untagged = result.find(a => a.id === 'cat-untagged')
    expect(untagged).toBeDefined()
    // The ?? null branch should produce a literal null, not leave it undefined.
    expect(untagged!.tags).toBeNull()
  })

  it('coerces empty tags array as-is (does not collapse to null)', async () => {
    const result = await listAssets({ viewerUserId: 'viewer-alice' })
    const empty = result.find(a => a.id === 'cat-empty-tags')
    expect(empty).toBeDefined()
    // `[] ?? null` → []; coercion should keep the array, not collapse it.
    expect(empty!.tags).toEqual([])
  })
})
