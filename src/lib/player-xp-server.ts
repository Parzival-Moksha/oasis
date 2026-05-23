import 'server-only'

import { prisma } from '@/lib/db'
import { DEFAULT_XP_AWARDS, levelFromXp, type XpAction } from '@/lib/xp'

export interface ServerXpResult {
  success: true
  awarded: string
  xp: number
  xpGained: number
  totalXp: number
  level: number
  oldLevel: number
  leveledUp: boolean
  levelUp: boolean
}

export async function awardXpToUser(userId: string, xpGained: number, awarded = 'custom'): Promise<ServerXpResult> {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xpGained) ? xpGained : 0))
  const profile = await prisma.profile.upsert({
    where: { userId },
    create: { userId, totalXp: safeXp },
    update: { totalXp: { increment: safeXp } },
  })

  const newLevel = levelFromXp(profile.totalXp)
  const oldLevel = Math.max(1, profile.level || 1)
  const updates: Record<string, unknown> = {}
  if (newLevel !== profile.level) {
    updates.level = newLevel
    if (newLevel > oldLevel) {
      updates.unspentSkillPoints = { increment: newLevel - oldLevel }
    }
  }
  if (awarded === 'DAILY_LOGIN') {
    updates.lastLoginDate = new Date().toISOString().split('T')[0]
  }

  if (Object.keys(updates).length > 0) {
    await prisma.profile.update({ where: { userId }, data: updates })
  }

  return {
    success: true,
    awarded,
    xp: safeXp,
    xpGained: safeXp,
    totalXp: profile.totalXp,
    level: newLevel,
    oldLevel,
    leveledUp: newLevel > oldLevel,
    levelUp: newLevel > oldLevel,
  }
}

export async function awardXpActionToUser(userId: string, action: XpAction | string | undefined): Promise<ServerXpResult> {
  const awarded = action || 'unknown'
  const xpGained = action ? (DEFAULT_XP_AWARDS[action as XpAction] ?? 10) : 10
  return awardXpToUser(userId, xpGained, awarded)
}
