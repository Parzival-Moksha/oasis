// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: POST /api/library/delete — prod gating, validation, asset-row
// branch, JSON-extras fallback, file unlink wiring (all fs ops are mocked).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// fs mock — we control existsSync, readFile, writeFile, unlink. Default:
// extras file "doesn't exist" so readExtras returns empty.
vi.mock('fs', () => {
  const existsSync = vi.fn().mockReturnValue(false)
  const unlink = vi.fn().mockResolvedValue(undefined)
  const readFile = vi.fn().mockRejectedValue(new Error('no such file'))
  const writeFile = vi.fn().mockResolvedValue(undefined)
  return {
    default: {
      existsSync,
      promises: { unlink, readFile, writeFile },
    },
    existsSync,
    promises: { unlink, readFile, writeFile },
  }
})

vi.mock('@/lib/forge/library/asset-mirror', () => ({
  deleteMirroredAsset: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/local-auth', () => ({
  getLocalUserId: vi.fn().mockResolvedValue('viewer-alice'),
}))

import { POST } from '../route'
import fs from 'fs'
import { deleteMirroredAsset } from '@/lib/forge/library/asset-mirror'

const mockedDeleteMirrored = vi.mocked(deleteMirroredAsset)
const mockedExists = vi.mocked(fs.existsSync)
const mockedUnlink = vi.mocked(fs.promises.unlink)
const mockedReadFile = vi.mocked(fs.promises.readFile)
const mockedWriteFile = vi.mocked(fs.promises.writeFile)

const ORIG_PROD = process.env.NODE_ENV
const ORIG_OVERRIDE = process.env.OASIS_ALLOW_LIBRARY_DELETE
const ORIG_NEXT_PUBLIC = process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE

beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.OASIS_ALLOW_LIBRARY_DELETE
  delete process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE
  ;(process.env as any).NODE_ENV = 'development'
  mockedExists.mockReturnValue(false)
  mockedReadFile.mockRejectedValue(new Error('no such file'))
  mockedWriteFile.mockResolvedValue(undefined as never)
  mockedUnlink.mockResolvedValue(undefined as never)
  mockedDeleteMirrored.mockResolvedValue(false)
})

afterEach(() => {
  if (ORIG_PROD === undefined) delete (process.env as any).NODE_ENV
  else (process.env as any).NODE_ENV = ORIG_PROD
  if (ORIG_OVERRIDE === undefined) delete process.env.OASIS_ALLOW_LIBRARY_DELETE
  else process.env.OASIS_ALLOW_LIBRARY_DELETE = ORIG_OVERRIDE
  if (ORIG_NEXT_PUBLIC === undefined) delete process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE
  else process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE = ORIG_NEXT_PUBLIC
})

function post(body: unknown): Request {
  return new Request('http://localhost/api/library/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/library/delete — gating', () => {
  it('returns 403 in production when no override env var is set', async () => {
    ;(process.env as any).NODE_ENV = 'production'
    const res = await POST(post({ kind: 'asset', id: 'cat-rock' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/disabled/i)
  })

  it('OASIS_ALLOW_LIBRARY_DELETE=1 bypasses the prod gate', async () => {
    ;(process.env as any).NODE_ENV = 'production'
    process.env.OASIS_ALLOW_LIBRARY_DELETE = '1'
    const res = await POST(post({ kind: 'asset', id: 'cat-rock' }))
    expect(res.status).toBe(200)
  })

  it('NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE=1 also bypasses the prod gate', async () => {
    ;(process.env as any).NODE_ENV = 'production'
    process.env.NEXT_PUBLIC_OASIS_ALLOW_LIBRARY_DELETE = '1'
    const res = await POST(post({ kind: 'asset', id: 'cat-rock' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/library/delete — input validation', () => {
  it('returns 400 when id is missing', async () => {
    const res = await POST(post({ kind: 'asset' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/id/i)
  })

  it('returns 400 when kind is invalid', async () => {
    const res = await POST(post({ kind: 'banana', id: 'x' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/kind/i)
  })

  it('returns 400 when body is non-JSON', async () => {
    const res = await POST(new Request('http://localhost/api/library/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json{{{',
    }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/library/delete — asset row branch', () => {
  it('deletes Asset row + unlinks file when path is inside public/', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(true)
    mockedExists.mockReturnValueOnce(true)
    const res = await POST(post({ kind: 'asset', id: 'conj-1', path: '/conjured/conj-1.glb' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('asset-row-deleted')
    expect(body.removedFile).toBe('/conjured/conj-1.glb')
    expect(mockedUnlink).toHaveBeenCalledTimes(1)
  })

  it('still returns 200 when Asset row deleted but file does not exist on disk', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(true)
    mockedExists.mockReturnValueOnce(false)
    const res = await POST(post({ kind: 'asset', id: 'conj-1', path: '/conjured/conj-1.glb' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('asset-row-deleted')
    expect(body.removedFile).toBeNull()
    expect(mockedUnlink).not.toHaveBeenCalled()
  })

  it('refuses to unlink files that escape public/', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(true)
    mockedExists.mockReturnValueOnce(true)
    const res = await POST(post({ kind: 'asset', id: 'conj-1', path: '../../etc/passwd' }))
    expect(res.status).toBe(200)
    expect(mockedUnlink).not.toHaveBeenCalled()
  })
})

describe('POST /api/library/delete — JSON extras fallback', () => {
  it('falls through to extras JSON when Asset row is not found', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(false)
    // No extras file present; readFile rejects → handler creates a fresh
    // extras and adds the id to deletedIds.
    mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const res = await POST(post({ kind: 'asset', id: 'cat-rock' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(['added-to-deleted', 'removed-from-additions']).toContain(body.mode)
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
  })

  it('removes from additions when id was an addition entry', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(false)
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({
      additions: [{ id: 'my-addition', path: '/models/x.glb' }],
      deletedIds: [],
    }) as never)
    const res = await POST(post({ kind: 'asset', id: 'my-addition', path: '/models/x.glb' }))
    const body = await res.json()
    expect(body.mode).toBe('removed-from-additions')
  })

  it('reports already-deleted when the id is already in deletedIds and not in additions', async () => {
    mockedDeleteMirrored.mockResolvedValueOnce(false)
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({
      additions: [],
      deletedIds: ['cat-rock'],
    }) as never)
    const res = await POST(post({ kind: 'asset', id: 'cat-rock' }))
    const body = await res.json()
    expect(body.mode).toBe('already-deleted')
  })

  it('uses the ground extras file when kind="ground"', async () => {
    mockedReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const res = await POST(post({ kind: 'ground', id: 'grass' }))
    expect(res.status).toBe(200)
    // ground path skips the Asset table altogether — deleteMirroredAsset
    // should not have been called.
    expect(mockedDeleteMirrored).not.toHaveBeenCalled()
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    // The first writeFile call's path should reference ground-presets-extras.json
    const writeFilePath = (mockedWriteFile.mock.calls[0]?.[0] as string)
    expect(writeFilePath).toMatch(/ground-presets-extras\.json$/)
  })
})
