import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import { buildPlayerProgression, computeManaRechargeTicks } from '@/lib/player-progression'
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

    const body = await request.json().catch(() => ({}))
    const elapsedMs = typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs)
      ? body.elapsedMs
      : 1000

    const profile = await ensureProfile(userId)
    const level = levelFromXp(profile.totalXp)
    const progression = buildPlayerProgression({ ...profile, level })
    const rechargeTicks = computeManaRechargeTicks(elapsedMs, progression.stats.manaRegenMultiplier)
    const nextMana = Math.min(progression.maxMana, progression.mana + rechargeTicks)

    if (rechargeTicks <= 0 || nextMana === progression.mana) {
      return NextResponse.json({
        ok: true,
        recharged: 0,
        progression,
      })
    }

    const updated = await prisma.profile.update({
      where: { userId },
      data: {
        level,
        mana: nextMana,
      },
    })

    return NextResponse.json({
      ok: true,
      recharged: nextMana - progression.mana,
      progression: buildPlayerProgression({ ...updated, level }),
    })
  } catch (err) {
    console.error('[ProfileManaRecharge] POST error:', err)
    return NextResponse.json({ error: 'Mana recharge failed' }, { status: 500 })
  }
}
