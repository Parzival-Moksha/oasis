import { beforeEach, describe, expect, it, vi } from 'vitest'

const profileUpsert = vi.hoisted(() => vi.fn())
const getRequiredOasisUserId = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      upsert: profileUpsert,
    },
  },
}))

vi.mock('@/lib/session', () => ({
  getRequiredOasisUserId,
}))

import { GET } from '../route'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'

describe('/api/profile defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRequiredOasisUserId.mockReturnValue('random-user')
    profileUpsert.mockImplementation(async ({ create }) => ({
      id: 1,
      userId: create.userId,
      displayName: create.displayName,
      bio: null,
      avatarUrl: null,
      avatar3dUrl: create.avatar3dUrl,
      totalXp: 0,
      level: 1,
      aura: 0,
      lastLoginDate: null,
      createdAt: new Date('2026-05-09T00:00:00Z'),
      updatedAt: new Date('2026-05-09T00:00:00Z'),
    }))
  })

  it('creates new random-user profiles with VIPE Hero 2902 selected', async () => {
    const response = await GET(new Request('http://localhost/api/profile'))
    const body = await response.json()

    expect(profileUpsert).toHaveBeenCalledWith({
      where: { userId: 'random-user' },
      create: {
        userId: 'random-user',
        displayName: DEFAULT_PROFILE_DISPLAY_NAME,
        avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL,
      },
      update: {},
    })
    expect(body.avatar_3d_url).toBe(DEFAULT_PROFILE_AVATAR_3D_URL)
    expect(body.hp).toBe(100)
    expect(body.mana).toBe(20)
    expect(body.skills.fire).toBe(0)
  })
})
