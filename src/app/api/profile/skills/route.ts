import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import { levelFromXp } from '@/lib/xp'
import { DEFAULT_PROFILE_AVATAR_3D_URL, DEFAULT_PROFILE_DISPLAY_NAME } from '@/lib/profile-defaults'
import {
  PLAYER_SKILL_CAP,
  PLAYER_SKILL_KEYS,
  buildPlayerProgression,
  computePlayerStats,
  profileSkillField,
  type PlayerSkillKey,
} from '@/lib/player-progression'

function isPlayerSkillKey(value: unknown): value is PlayerSkillKey {
  return typeof value === 'string' && (PLAYER_SKILL_KEYS as readonly string[]).includes(value)
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    if (!isPlayerSkillKey(body.skill)) {
      return NextResponse.json({ error: 'Unknown skill' }, { status: 400 })
    }
    const skill: PlayerSkillKey = body.skill

    const profile = await prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        displayName: DEFAULT_PROFILE_DISPLAY_NAME,
        avatar3dUrl: DEFAULT_PROFILE_AVATAR_3D_URL,
      },
      update: {},
    })

    const level = levelFromXp(profile.totalXp)
    const progression = buildPlayerProgression({ ...profile, level })
    const currentRank = progression.skills[skill]
    if (currentRank >= PLAYER_SKILL_CAP) {
      return NextResponse.json({ error: 'Skill is already max rank' }, { status: 400 })
    }
    if (progression.unspentSkillPoints <= 0) {
      return NextResponse.json({ error: 'No unspent skill points' }, { status: 400 })
    }

    const field = profileSkillField(skill)
    const nextSkills = {
      ...progression.skills,
      [skill]: currentRank + 1,
    }
    const nextStats = computePlayerStats(nextSkills)

    const updated = await prisma.profile.update({
      where: { userId },
      data: {
        [field]: currentRank + 1,
        unspentSkillPoints: progression.unspentSkillPoints - 1,
        hp: Math.min(nextStats.maxHp, skill === 'vitality' ? profile.hp + 25 : profile.hp),
        mana: Math.min(nextStats.maxMana, skill === 'focus' ? profile.mana + 10 : profile.mana),
        level,
      },
    })

    return NextResponse.json({
      success: true,
      skill,
      rank: currentRank + 1,
      progression: buildPlayerProgression({ ...updated, level }),
    })
  } catch (err) {
    console.error('[ProfileSkills] POST error:', err)
    return NextResponse.json({ error: 'Skill allocation failed' }, { status: 500 })
  }
}
