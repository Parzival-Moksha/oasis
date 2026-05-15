import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import { buildPlayerProgression } from '@/lib/player-progression'
import { hasSpellUnlocked, recordSpellUse } from '@/lib/player-progression-server'
import { levelFromXp } from '@/lib/xp'

async function ensureProfile(userId: string) {
  return prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      displayName: DEFAULT_PROFILE_DISPLAY_NAME,
      avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL,
    },
    update: {},
  })
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const profile = await ensureProfile(userId)
    const level = levelFromXp(profile.totalXp)
    const progression = buildPlayerProgression({ ...profile, level })
    const unlocked = await hasSpellUnlocked(userId, 'firebolt')
    const cost = progression.stats.fireboltManaCost

    if (!unlocked) {
      return NextResponse.json({
        ok: false,
        error: 'Firebolt locked',
        progression,
        spell: {
          id: 'firebolt',
          locked: true,
          cost,
          damage: progression.stats.fireboltDamage,
          speedMetersPerSecond: progression.stats.fireboltSpeedMetersPerSecond,
        },
      }, { status: 423 })
    }

    if (progression.mana < cost) {
      return NextResponse.json({
        ok: false,
        error: 'Not enough mana',
        progression,
        spell: {
          id: 'firebolt',
          cost,
          damage: progression.stats.fireboltDamage,
          speedMetersPerSecond: progression.stats.fireboltSpeedMetersPerSecond,
        },
      }, { status: 409 })
    }

    const updated = await prisma.profile.update({
      where: { userId },
      data: {
        level,
        mana: progression.mana - cost,
      },
    })
    const nextProgression = buildPlayerProgression({ ...updated, level })
    await recordSpellUse(userId, 'firebolt').catch(() => null)

    return NextResponse.json({
      ok: true,
      progression: nextProgression,
      spell: {
        id: 'firebolt',
        cost,
        damage: progression.stats.fireboltDamage,
        speedMetersPerSecond: progression.stats.fireboltSpeedMetersPerSecond,
      },
    })
  } catch (err) {
    console.error('[ProfileFirebolt] POST error:', err)
    return NextResponse.json({ error: 'Firebolt cast failed' }, { status: 500 })
  }
}
