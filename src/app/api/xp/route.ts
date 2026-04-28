// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// XP API — Local-first, Prisma-backed
// POST /api/xp { action, worldId? }
// Awards XP and updates profile level
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOasisUserId } from '@/lib/session'
import { DEFAULT_XP_AWARDS, levelFromXp } from '@/lib/xp'
import type { XpAction } from '@/lib/xp'

export async function POST(request: NextRequest) {
  try {
    const userId = await getOasisUserId(request)
    const body = await request.json()
    const action = body.action as XpAction | undefined

    const xpGained = action ? (DEFAULT_XP_AWARDS[action] ?? 10) : 10

    // Upsert profile and increment XP
    const profile = await prisma.profile.upsert({
      where: { userId },
      create: { userId, totalXp: xpGained },
      update: { totalXp: { increment: xpGained } },
    })

    const newLevel = levelFromXp(profile.totalXp)
    const oldLevel = profile.level

    // Update level + lastLoginDate if daily login
    const updates: Record<string, unknown> = {}
    if (newLevel !== oldLevel) updates.level = newLevel
    if (action === 'DAILY_LOGIN') updates.lastLoginDate = new Date().toISOString().split('T')[0]

    if (Object.keys(updates).length > 0) {
      await prisma.profile.update({ where: { userId }, data: updates })
    }

    return NextResponse.json({
      success: true,
      awarded: action || 'unknown',
      xp: xpGained,
      xpGained,
      totalXp: profile.totalXp,
      level: newLevel,
      leveledUp: newLevel > oldLevel,
      levelUp: newLevel > oldLevel,
    })
  } catch (err) {
    console.error('[XP] Error:', err)
    return NextResponse.json({ success: false, error: 'XP award failed' }, { status: 500 })
  }
}
