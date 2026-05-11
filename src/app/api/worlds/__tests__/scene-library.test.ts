// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: GET /api/worlds/scene-library — reconstitution path, legacy
// fallback, hosted-mode gating.
//
// IMPORTANT MOCK TIMING: The route uses `await import(...)` at runtime, so
// vi.mock() on '@/lib/db' + '@/lib/local-auth' works (no hoisting required
// since the route never statically imports these).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/db', () => ({
  prisma: {
    asset: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/local-auth', () => ({
  getLocalUserId: vi.fn().mockResolvedValue('viewer-alice'),
}))

vi.mock('fs', () => {
  const existsSync = vi.fn().mockReturnValue(false)
  const readFileSync = vi.fn().mockReturnValue('[]')
  const writeFileSync = vi.fn()
  const mkdirSync = vi.fn()
  return {
    default: { existsSync, readFileSync, writeFileSync, mkdirSync },
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
  }
})

import { GET } from '../scene-library/route'
import { prisma } from '@/lib/db'
import { getLocalUserId } from '@/lib/local-auth'
import * as fs from 'fs'

const mockedFindMany = vi.mocked(prisma.asset.findMany)
const mockedGetLocalUserId = vi.mocked(getLocalUserId)
const mockedExists = vi.mocked(fs.existsSync)
const mockedReadFile = vi.mocked(fs.readFileSync)

const ORIG_MODE = process.env.OASIS_MODE

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.OASIS_MODE
  mockedExists.mockReturnValue(false)
  mockedReadFile.mockReturnValue('[]')
  mockedFindMany.mockResolvedValue([])
  mockedGetLocalUserId.mockResolvedValue('viewer-alice')
})

afterEach(() => {
  if (ORIG_MODE === undefined) delete process.env.OASIS_MODE
  else process.env.OASIS_MODE = ORIG_MODE
})

const SAMPLE_SCENE = {
  id: 'scene-1',
  name: 'Lantern Scene',
  prompt: 'A glowing lantern',
  objects: [{ type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: '#ffaa00' }],
  position: [0, 0, 0],
  createdAt: '2026-05-11T00:00:00.000Z',
}

describe('GET /api/worlds/scene-library — Asset table read', () => {
  it('reads from the Asset table when rows exist and reconstitutes scenes from data', async () => {
    mockedFindMany.mockResolvedValueOnce([
      {
        id: 'scene-1',
        kind: 'crafted',
        scope: 'user',
        ownerId: 'viewer-alice',
        data: JSON.stringify(SAMPLE_SCENE),
      } as any,
    ])
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('scene-1')
    expect(body[0].name).toBe('Lantern Scene')
    expect(body[0].objects).toHaveLength(1)
  })

  it('filters by current viewer (ownerId argument)', async () => {
    await GET()
    expect(mockedFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ kind: 'crafted', scope: 'user', ownerId: 'viewer-alice' }),
    }))
  })

  it('falls back to legacy JSON for rows missing the data blob', async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: 'scene-1', kind: 'crafted', scope: 'user', ownerId: 'viewer-alice', data: null } as any,
    ])
    mockedExists.mockReturnValue(true)
    mockedReadFile.mockReturnValue(JSON.stringify([SAMPLE_SCENE]) as never)
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('scene-1')
  })

  it('skips rows when data is malformed AND legacy JSON has no matching id', async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: 'scene-mystery', kind: 'crafted', scope: 'user', ownerId: 'viewer-alice', data: 'NOT-JSON' } as any,
    ])
    mockedExists.mockReturnValue(true)
    mockedReadFile.mockReturnValue(JSON.stringify([]) as never)
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(0)
  })

  it('skips rows when parsed data is missing the id field', async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: 'scene-1', kind: 'crafted', scope: 'user', ownerId: 'viewer-alice', data: JSON.stringify({ name: 'no id here' }) } as any,
    ])
    mockedExists.mockReturnValue(false)
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(0)
  })
})

describe('GET /api/worlds/scene-library — local-mode legacy fallback', () => {
  it('falls back to the on-disk JSON file when Asset table is empty (no hosted env)', async () => {
    mockedFindMany.mockResolvedValueOnce([])
    mockedExists.mockReturnValue(true)
    mockedReadFile.mockReturnValue(JSON.stringify([SAMPLE_SCENE]) as never)
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('scene-1')
  })

  it('returns [] when Asset table empty and on-disk JSON file is missing', async () => {
    mockedFindMany.mockResolvedValueOnce([])
    mockedExists.mockReturnValue(false)
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual([])
  })
})

describe('GET /api/worlds/scene-library — hosted-mode gating', () => {
  it('returns [] in hosted mode when Asset table is empty (does NOT read JSON)', async () => {
    process.env.OASIS_MODE = 'hosted'
    mockedFindMany.mockResolvedValueOnce([])
    mockedExists.mockReturnValue(true)
    // If the route honors the hosted gate, readFileSync should never run for
    // the legacy fallback in this path.
    mockedReadFile.mockReturnValue(JSON.stringify([SAMPLE_SCENE]) as never)
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns [] on prisma error in hosted mode', async () => {
    process.env.OASIS_MODE = 'hosted'
    mockedFindMany.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual([])
    warn.mockRestore()
  })

  it('falls back to legacy JSON on prisma error in local mode', async () => {
    mockedFindMany.mockRejectedValueOnce(new Error('db down'))
    mockedExists.mockReturnValue(true)
    mockedReadFile.mockReturnValue(JSON.stringify([SAMPLE_SCENE]) as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('scene-1')
    warn.mockRestore()
  })
})
