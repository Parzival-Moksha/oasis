// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Profile API — Local-first, Prisma-backed
// GET  /api/profile — returns profile with XP/level computed
// PATCH /api/profile — updates display_name, bio
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { levelFromXp, levelProgress, xpToNextLevel, getLevelTitle } from '@/lib/xp'
import { FREE_CREDITS } from '@/lib/conjure/types'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import { buildPlayerProgression } from '@/lib/player-progression'
import { getPlayerProgressionState } from '@/lib/player-progression-server'

/** Ensure a Profile row exists for the user, return it */
async function ensureProfile(userId: string) {
  const profile = await prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      displayName: DEFAULT_PROFILE_DISPLAY_NAME,
      avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL,
    },
    update: {},
  })
  return profile.avatar3dUrl ? profile : { ...profile, avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL }
}

async function serializeProfile(p: Awaited<ReturnType<typeof ensureProfile>>) {
  const level = levelFromXp(p.totalXp)
  const progress = levelProgress(p.totalXp)
  const toNext = xpToNextLevel(level)
  const lt = getLevelTitle(level)
  const player = buildPlayerProgression({ ...p, level })
  const progression = await getPlayerProgressionState(p.userId)

  return {
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
    hp: player.hp,
    maxHp: player.maxHp,
    mana: player.mana,
    maxMana: player.maxMana,
    unspentSkillPoints: player.unspentSkillPoints,
    skills: player.skills,
    playerStats: player.stats,
    unlockedSpells: progression.spells,
    questProgress: progression.quests,
    achievements: progression.achievements,
    npcMemories: progression.npcMemories,
  }
}

export async function GET(request: Request) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }
    const p = await ensureProfile(userId)

    return NextResponse.json(await serializeProfile(p))
  } catch (err) {
    console.error('[Profile] GET error:', err)
    // Fallback so the UI never breaks
    return NextResponse.json({
      credits: FREE_CREDITS, xp: 0, level: 1, aura: 0,
      wallet_address: null, levelTitle: 'Apprentice', levelBadge: '░',
      levelProgress: 0, xpToNext: 100, needsOnboarding: true,
      displayName: DEFAULT_PROFILE_DISPLAY_NAME,
      bio: null,
      avatar_url: null,
      avatar_3d_url: DEFAULT_PROFILE_AVATAR_3D_URL,
      lastLoginDate: null,
      hp: 100,
      maxHp: 100,
      mana: 20,
      maxMana: 20,
      unspentSkillPoints: 0,
      skills: {
        fire: 0,
        ice: 0,
        lightning: 0,
        vitality: 0,
        focus: 0,
        conjuration: 0,
        mobility: 0,
      },
      playerStats: {
        maxHp: 100,
        maxMana: 20,
        fireboltDamage: 14,
        fireboltManaCost: 1,
        fireboltSpeedMetersPerSecond: 24,
        manaRegenMultiplier: 1,
        conjureManaCost: 20,
        moveSpeedMultiplier: 1,
      },
      unlockedSpells: [],
      questProgress: [],
      achievements: [],
      npcMemories: [],
    })
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }
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

    return NextResponse.json(await serializeProfile(updated))
  } catch (err) {
    console.error('[Profile] PATCH error:', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
