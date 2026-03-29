// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Profile API — Local-first, Prisma-backed
// GET  /api/profile — returns profile with XP/level computed
// PATCH /api/profile — updates display_name, bio
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getLocalUserId } from '@/lib/local-auth'
import { levelFromXp, levelProgress, xpToNextLevel, getLevelTitle } from '@/lib/xp'
import { FREE_CREDITS } from '@/lib/conjure/types'

/** Ensure a Profile row exists for the local user, return it */
async function ensureProfile(userId: string) {
  return prisma.profile.upsert({
    where: { userId },
    create: { userId, displayName: 'Player 1' },
    update: {},
  })
}

export async function GET() {
  try {
    const userId = await getLocalUserId()
    const p = await ensureProfile(userId)

    const level = levelFromXp(p.totalXp)
    const progress = levelProgress(p.totalXp)
    const toNext = xpToNextLevel(level)
    const lt = getLevelTitle(level)

    return NextResponse.json({
      credits: FREE_CREDITS,
      xp: p.totalXp,
      level,
      aura: p.aura,
      wallet_address: null,
      levelTitle: lt.title,
      levelBadge: lt.badge,
      levelProgress: progress,
      xpToNext: toNext,
      needsOnboarding: p.totalXp === 0,
      displayName: p.displayName,
      bio: p.bio,
      avatar_url: p.avatarUrl,
      avatar_3d_url: p.avatar3dUrl,
      lastLoginDate: p.lastLoginDate,
    })
  } catch (err) {
    console.error('[Profile] GET error:', err)
    // Fallback so the UI never breaks
    return NextResponse.json({
      credits: FREE_CREDITS, xp: 0, level: 1, aura: 0,
      wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░',
      levelProgress: 0, xpToNext: 100, needsOnboarding: true,
      displayName: 'Player 1', bio: null, avatar_url: null, avatar_3d_url: null,
      lastLoginDate: null,
    })
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await getLocalUserId()
    const body = await request.json()

    // Ensure profile exists first
    await ensureProfile(userId)

    // Build update payload — only allow safe fields
    const stripTags = (s: string) => s.replace(/[<>]/g, '')
    const update: Record<string, unknown> = {}
    if (typeof body.display_name === 'string') {
      const name = stripTags(body.display_name.trim()).slice(0, 30)
      if (name.length >= 2) update.displayName = name
    }
    if (typeof body.bio === 'string') {
      update.bio = stripTags(body.bio.trim()).slice(0, 200) || null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const updated = await prisma.profile.update({
      where: { userId },
      data: update,
    })

    // Return full profile shape
    const level = levelFromXp(updated.totalXp)
    const progress = levelProgress(updated.totalXp)
    const toNext = xpToNextLevel(level)
    const lt = getLevelTitle(level)

    return NextResponse.json({
      credits: FREE_CREDITS,
      xp: updated.totalXp,
      level,
      aura: updated.aura,
      wallet_address: null,
      levelTitle: lt.title,
      levelBadge: lt.badge,
      levelProgress: progress,
      xpToNext: toNext,
      needsOnboarding: updated.totalXp === 0,
      displayName: updated.displayName,
      bio: updated.bio,
      avatar_url: updated.avatarUrl,
      avatar_3d_url: updated.avatar3dUrl,
      lastLoginDate: updated.lastLoginDate,
    })
  } catch (err) {
    console.error('[Profile] PATCH error:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
