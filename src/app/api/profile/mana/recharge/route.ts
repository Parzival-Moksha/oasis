import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import { buildPlayerProgression, computeManaRechargeTicks, MANA_REGEN_BASE_INTERVAL_MS_EXPORT } from '@/lib/player-progression'
import { levelFromXp } from '@/lib/xp'

const lastRechargeTickByUser = new Map<string, number>()

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
    const nowMs = Date.now()
    const firstServerElapsedMs = Math.min(elapsedMs, 1000)
    const lastServerTickAt = lastRechargeTickByUser.get(userId) ?? nowMs - firstServerElapsedMs
    const serverElapsedMs = Math.max(0, nowMs - lastServerTickAt)
    const trustedElapsedMs = Math.min(elapsedMs, serverElapsedMs)
    const rechargeTicks = computeManaRechargeTicks(trustedElapsedMs, progression.stats.manaRegenMultiplier)
    const nextMana = Math.min(progression.maxMana, progression.mana + rechargeTicks)
    // Keep in sync with computeManaRechargeTicks's tick math — base is 100ms
    // for the 10/sec testing-friendly default, multiplier scales above.
    const tickIntervalMs = MANA_REGEN_BASE_INTERVAL_MS_EXPORT / Math.max(0.1, Math.min(10, progression.stats.manaRegenMultiplier))

    if (rechargeTicks <= 0 || nextMana === progression.mana) {
      if (nextMana === progression.maxMana || !lastRechargeTickByUser.has(userId)) {
        lastRechargeTickByUser.set(userId, nowMs)
      }
      return NextResponse.json({
        ok: true,
        recharged: 0,
        progression,
      })
    }

    lastRechargeTickByUser.set(userId, Math.min(nowMs, lastServerTickAt + rechargeTicks * tickIntervalMs))

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
