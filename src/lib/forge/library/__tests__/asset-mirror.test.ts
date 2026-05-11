// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: mirrorConjuredAsset / mirrorCraftedScene / deleteMirroredAsset
// All Prisma calls are stubbed; we assert on the upsert/find/delete args.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('../../../db', () => ({
  prisma: {
    asset: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { mirrorConjuredAsset, mirrorCraftedScene, deleteMirroredAsset } from '../asset-mirror'
import { prisma } from '../../../db'
import type { ConjuredAsset, CraftedScene } from '../../../conjure/types'

const mockedUpsert = vi.mocked(prisma.asset.upsert)
const mockedFindUnique = vi.mocked(prisma.asset.findUnique)
const mockedDelete = vi.mocked(prisma.asset.delete)

function makeConjured(overrides: Partial<ConjuredAsset> = {}): ConjuredAsset {
  return {
    id: 'conj-test-1',
    prompt: 'a small wooden chair',
    provider: 'meshy',
    tier: 'preview',
    providerTaskId: 'task-1',
    status: 'ready',
    progress: 100,
    glbPath: '/conjured/conj-test-1.glb',
    thumbnailUrl: '/conjured/conj-test-1_thumb.jpg',
    position: [0, 0, 0],
    scale: 1,
    rotation: [0, 0, 0],
    createdAt: '2026-05-11T00:00:00.000Z',
    metadata: { fileSizeBytes: 12345 },
    ...overrides,
  }
}

function makeScene(overrides: Partial<CraftedScene> = {}): CraftedScene {
  return {
    id: 'scene-test-1',
    name: 'My Crafted Scene',
    prompt: 'a glowing crystal',
    objects: [],
    position: [0, 0, 0],
    createdAt: '2026-05-11T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('mirrorConjuredAsset', () => {
  it('upserts with scope=user, kind=conjured, ownerId from arg when status=ready + glbPath set', async () => {
    mockedUpsert.mockResolvedValueOnce({} as any)
    await mirrorConjuredAsset(makeConjured(), 'viewer-alice')
    expect(mockedUpsert).toHaveBeenCalledTimes(1)
    const args = mockedUpsert.mock.calls[0]?.[0] as any
    expect(args.where).toEqual({ id: 'conj-test-1' })
    expect(args.create.scope).toBe('user')
    expect(args.create.kind).toBe('conjured')
    expect(args.create.ownerId).toBe('viewer-alice')
    expect(args.create.path).toBe('/conjured/conj-test-1.glb')
  })

  it('no-ops when status !== "ready"', async () => {
    await mirrorConjuredAsset(makeConjured({ status: 'generating' }), 'viewer-alice')
    expect(mockedUpsert).not.toHaveBeenCalled()
  })

  it('no-ops when status="ready" but glbPath is missing', async () => {
    await mirrorConjuredAsset(makeConjured({ glbPath: undefined }), 'viewer-alice')
    expect(mockedUpsert).not.toHaveBeenCalled()
  })

  it('upsert update branch re-stamps ownerId, path, name, thumbnailUrl, defaultScale', async () => {
    mockedUpsert.mockResolvedValueOnce({} as any)
    await mirrorConjuredAsset(makeConjured(), 'viewer-alice')
    const args = mockedUpsert.mock.calls[0]?.[0] as any
    expect(args.update).toMatchObject({
      path: '/conjured/conj-test-1.glb',
      ownerId: 'viewer-alice',
      defaultScale: 1,
    })
  })

  it('is idempotent: calling twice issues two upserts on the same id', async () => {
    mockedUpsert.mockResolvedValue({} as any)
    await mirrorConjuredAsset(makeConjured(), 'viewer-alice')
    await mirrorConjuredAsset(makeConjured(), 'viewer-alice')
    expect(mockedUpsert).toHaveBeenCalledTimes(2)
    expect((mockedUpsert.mock.calls[0]?.[0] as any).where.id).toBe('conj-test-1')
    expect((mockedUpsert.mock.calls[1]?.[0] as any).where.id).toBe('conj-test-1')
  })

  it('swallows DB errors (logs but does not throw)', async () => {
    mockedUpsert.mockRejectedValueOnce(new Error('db blew up'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(mirrorConjuredAsset(makeConjured(), 'viewer-alice')).resolves.toBeUndefined()
    warn.mockRestore()
  })

  it('falls back name to prompt slice when displayName is missing', async () => {
    mockedUpsert.mockResolvedValueOnce({} as any)
    await mirrorConjuredAsset(makeConjured({ displayName: undefined, prompt: 'wooden chair with intricate carvings on the back panel that goes way beyond sixty chars' }), 'viewer-alice')
    const args = mockedUpsert.mock.calls[0]?.[0] as any
    expect(args.create.name.length).toBeLessThanOrEqual(60)
  })
})

describe('mirrorCraftedScene', () => {
  it('upserts with kind=crafted, path=crafted://<id>, scope=user, data=stringified scene', async () => {
    mockedUpsert.mockResolvedValueOnce({} as any)
    const scene = makeScene()
    await mirrorCraftedScene(scene, 'viewer-alice')
    const args = mockedUpsert.mock.calls[0]?.[0] as any
    expect(args.create.kind).toBe('crafted')
    expect(args.create.path).toBe('crafted://scene-test-1')
    expect(args.create.scope).toBe('user')
    expect(args.create.ownerId).toBe('viewer-alice')
    expect(args.create.data).toBe(JSON.stringify(scene))
  })

  it('update branch re-serializes the scene into data', async () => {
    mockedUpsert.mockResolvedValueOnce({} as any)
    const scene = makeScene({ name: 'Edited Name' })
    await mirrorCraftedScene(scene, 'viewer-alice')
    const args = mockedUpsert.mock.calls[0]?.[0] as any
    expect(args.update.data).toBe(JSON.stringify(scene))
    expect(args.update.ownerId).toBe('viewer-alice')
  })

  it('no-ops when scene has no id', async () => {
    await mirrorCraftedScene(makeScene({ id: '' }), 'viewer-alice')
    expect(mockedUpsert).not.toHaveBeenCalled()
  })
})

describe('deleteMirroredAsset', () => {
  it('rejects (returns false) when row is missing', async () => {
    mockedFindUnique.mockResolvedValueOnce(null)
    const result = await deleteMirroredAsset('no-such-id', 'viewer-alice')
    expect(result).toBe(false)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('rejects when scope is not "user" (core/shared rows are admin-only)', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'a-1', scope: 'core', ownerId: null } as any)
    const result = await deleteMirroredAsset('a-1', 'viewer-alice')
    expect(result).toBe(false)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('rejects when ownerId is null (orphan rows need admin cleanup)', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'a-1', scope: 'user', ownerId: null } as any)
    const result = await deleteMirroredAsset('a-1', 'viewer-alice')
    expect(result).toBe(false)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('rejects when ownerId does not match the requester', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'a-1', scope: 'user', ownerId: 'viewer-bob' } as any)
    const result = await deleteMirroredAsset('a-1', 'viewer-alice')
    expect(result).toBe(false)
    expect(mockedDelete).not.toHaveBeenCalled()
  })

  it('succeeds (returns true) when scope=user AND ownerId matches', async () => {
    mockedFindUnique.mockResolvedValueOnce({ id: 'a-1', scope: 'user', ownerId: 'viewer-alice' } as any)
    mockedDelete.mockResolvedValueOnce({} as any)
    const result = await deleteMirroredAsset('a-1', 'viewer-alice')
    expect(result).toBe(true)
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: 'a-1' } })
  })

  it('returns false on unexpected DB error (does not throw)', async () => {
    mockedFindUnique.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await deleteMirroredAsset('a-1', 'viewer-alice')
    expect(result).toBe(false)
    warn.mockRestore()
  })
})
