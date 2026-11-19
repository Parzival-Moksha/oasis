import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import { buildPlayerProgression, withPassiveMana } from '@/lib/player-progression'
import { recordSpellUse } from '@/lib/player-progression-server'
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

    const body = await request.json().catch(() => ({})) as { worldId?: unknown }
    const worldId = typeof body.worldId === 'string' ? body.worldId : undefined
    // Spend with a compare-and-set on updatedAt: two overlapping casts must not both spend the
    // same mana (the client fires without waiting, so casts overlap). Mana refills on its own
    // since the last write (player-progression.ts passiveManaRegen).
    let updated: Awaited<ReturnType<typeof ensureProfile>> | null = null
    let progression: ReturnType<typeof buildPlayerProgression> | null = null
    let level = 1
    let cost = 1
    void worldId
    for (let attempt = 0; attempt < 4 && !updated; attempt += 1) {
      const raw = await ensureProfile(userId)
      const profile = withPassiveMana(raw)
      level = levelFromXp(profile.totalXp)
      progression = buildPlayerProgression({ ...profile, level })
      cost = progression.stats.fireboltManaCost
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
      const result = await prisma.profile.updateMany({
        where: { userId, updatedAt: raw.updatedAt },
        data: { level, mana: progression.mana - cost },
      })
      if (result.count === 1) updated = await prisma.profile.findUnique({ where: { userId } })
    }
    if (!updated || !progression) return NextResponse.json({ ok: false, error: 'Busy, cast again', progression }, { status: 409 })
    const nextProgression = buildPlayerProgression({ ...withPassiveMana(updated), level })
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
