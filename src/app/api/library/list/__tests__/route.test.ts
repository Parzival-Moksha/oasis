// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: GET /api/library/list — verifies HTTP -> listAssets() wiring.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/forge/library/library-service', () => ({
  listAssets: vi.fn(),
}))

vi.mock('@/lib/local-auth', () => ({
  getLocalUserId: vi.fn(async () => 'viewer-alice'),
}))

import { GET } from '../route'
import { listAssets } from '@/lib/forge/library/library-service'
import { getLocalUserId } from '@/lib/local-auth'

const mockedListAssets = vi.mocked(listAssets)
const mockedGetLocalUserId = vi.mocked(getLocalUserId)

beforeEach(() => {
  vi.resetAllMocks()
  mockedListAssets.mockResolvedValue([])
  mockedGetLocalUserId.mockResolvedValue('viewer-alice')
})

function get(qs = ''): Request {
  return new Request(`http://localhost/api/library/list${qs}`)
}

describe('GET /api/library/list — response shape', () => {
  it('returns { assets, viewerUserId, count }', async () => {
    mockedListAssets.mockResolvedValueOnce([
      { id: 'a', kind: 'glb', path: '/x.glb', name: 'A', scope: 'core' } as any,
      { id: 'b', kind: 'glb', path: '/y.glb', name: 'B', scope: 'core' } as any,
    ])
    const res = await GET(get())
    const json = await res.json()
    expect(json).toHaveProperty('assets')
    expect(json).toHaveProperty('viewerUserId', 'viewer-alice')
    expect(json).toHaveProperty('count', 2)
    expect(Array.isArray(json.assets)).toBe(true)
    expect(json.assets).toHaveLength(2)
  })
})

describe('GET /api/library/list — query params', () => {
  it('passes query through to listAssets', async () => {
    await GET(get('?query=rock'))
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ query: 'rock' }))
  })

  it('passes a valid kind through', async () => {
    await GET(get('?kind=conjured'))
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conjured' }))
  })

  it('drops invalid kind silently (passes undefined)', async () => {
    await GET(get('?kind=bogus-kind'))
    const call = mockedListAssets.mock.calls[0]?.[0]
    expect(call?.kind).toBeUndefined()
  })

  it('passes a valid scope through', async () => {
    await GET(get('?scope=user'))
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user' }))
  })

  it('drops invalid scope silently', async () => {
    await GET(get('?scope=admin'))
    const call = mockedListAssets.mock.calls[0]?.[0]
    expect(call?.scope).toBeUndefined()
  })

  it('parses numeric limit', async () => {
    await GET(get('?limit=42'))
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ limit: 42 }))
  })

  it('caps limit at 5000', async () => {
    await GET(get('?limit=99999'))
    const call = mockedListAssets.mock.calls[0]?.[0]
    expect(call?.limit).toBe(5000)
  })

  it('passes worldId through', async () => {
    await GET(get('?worldId=world-99'))
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ worldId: 'world-99' }))
  })

  it('threads viewerUserId from getLocalUserId() into the call', async () => {
    mockedGetLocalUserId.mockResolvedValueOnce('viewer-bob')
    await GET(get())
    expect(mockedListAssets).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: 'viewer-bob' }))
  })

  it('combines multiple params correctly', async () => {
    await GET(get('?query=foo&kind=glb&scope=core&limit=10&worldId=w1'))
    expect(mockedListAssets).toHaveBeenCalledWith({
      viewerUserId: 'viewer-alice',
      query: 'foo',
      kind: 'glb',
      scope: 'core',
      limit: 10,
      worldId: 'w1',
    })
  })
})
