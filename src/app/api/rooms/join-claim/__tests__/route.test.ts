import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    world: {
      findFirst: vi.fn(),
    },
  },
}))

import { GET } from '../route'
import { prisma } from '@/lib/db'
import { verifyRoomJoinClaim } from '@/lib/room-join-claim'
import { mintSessionCookieValue, SESSION_COOKIE_NAME } from '@/lib/session'

function request(worldId: string, cookie?: string): Request {
  return new Request(`http://localhost/api/rooms/join-claim?worldId=${encodeURIComponent(worldId)}`, {
    headers: cookie ? { cookie } : {},
  })
}

describe('/api/rooms/join-claim', () => {
  const originalMode = process.env.OASIS_MODE
  const originalKey = process.env.RELAY_SIGNING_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OASIS_MODE = 'hosted'
    process.env.RELAY_SIGNING_KEY = 'unit-test-room-claim-key'
  })

  afterEach(() => {
    if (originalMode === undefined) delete process.env.OASIS_MODE
    else process.env.OASIS_MODE = originalMode
    if (originalKey === undefined) delete process.env.RELAY_SIGNING_KEY
    else process.env.RELAY_SIGNING_KEY = originalKey
  })

  it('issues a signed claim with write rights for an FFA world', async () => {
    const minted = mintSessionCookieValue()
    vi.mocked(prisma.world.findFirst).mockResolvedValue({
      id: 'world-ffa',
      userId: 'other-user',
      visibility: 'ffa',
      pvpEnabled: true,
    } as any)

    const response = await GET(request('world-ffa', `${SESSION_COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.canWrite).toBe(true)
    expect(body.pvpEnabled).toBe(true)
    const claim = verifyRoomJoinClaim(body.claim)
    expect(claim).toMatchObject({
      type: 'oasis-room-join-v1',
      worldId: 'world-ffa',
      userId: minted.browserSessionId,
      canRead: true,
      canWrite: true,
      pvpEnabled: true,
    })
  })

  it('refuses to mint a hosted claim without an oasis_session cookie', async () => {
    vi.mocked(prisma.world.findFirst).mockResolvedValue({
      id: 'world-ffa',
      userId: 'other-user',
      visibility: 'ffa',
      pvpEnabled: false,
    } as any)

    const response = await GET(request('world-ffa'))

    expect(response.status).toBe(401)
  })
})
