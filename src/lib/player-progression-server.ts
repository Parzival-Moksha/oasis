import 'server-only'

import { prisma } from '@/lib/db'
import { awardXpActionToUser, awardXpToUser } from '@/lib/player-xp-server'
import {
  ACHIEVEMENT_DEFS,
  QUEST_ZERO_ID,
  QUEST_ZERO_TARGET_STEP_IDS,
  SPELL_DEFS,
  isAchievementId,
  isQuestZeroStepId,
  isSpellId,
  type AchievementId,
  type QuestZeroStepId,
  type SpellId,
} from '@/lib/spellbook'

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function mergeMetadata(current: string | null | undefined, patch: Record<string, unknown> | undefined): string {
  return JSON.stringify({
    ...parseJsonObject(current),
    ...(patch || {}),
  })
}

export async function getPlayerProgressionState(userId: string) {
  const [spells, quests, achievements, npcMemories] = await Promise.all([
    prisma.playerSpellUnlock.findMany({ where: { userId }, orderBy: { unlockedAt: 'asc' } }),
    prisma.playerQuestProgress.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
    prisma.playerAchievement.findMany({ where: { userId }, orderBy: { unlockedAt: 'desc' } }),
    prisma.npcMemory.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
  ])

  return {
    spells: spells.map(spell => ({
      spellId: spell.spellId,
      level: spell.level,
      uses: spell.uses,
      sourceQuestId: spell.sourceQuestId,
      unlockedAt: spell.unlockedAt.toISOString(),
      lastUsedAt: spell.lastUsedAt?.toISOString() || null,
      metadata: parseJsonObject(spell.metadata),
      definition: isSpellId(spell.spellId) ? SPELL_DEFS[spell.spellId] : null,
    })),
    quests: quests.map(quest => ({
      questId: quest.questId,
      status: quest.status,
      currentStepId: quest.currentStepId,
      completedSteps: parseJsonArray(quest.completedSteps),
      metadata: parseJsonObject(quest.metadata),
      startedAt: quest.startedAt.toISOString(),
      completedAt: quest.completedAt?.toISOString() || null,
      updatedAt: quest.updatedAt.toISOString(),
    })),
    achievements: achievements.map(achievement => ({
      achievementId: achievement.achievementId,
      source: achievement.source,
      quote: achievement.quote,
      metadata: parseJsonObject(achievement.metadata),
      unlockedAt: achievement.unlockedAt.toISOString(),
    })),
    npcMemories: npcMemories.map(memory => ({
      npcId: memory.npcId,
      summary: memory.summary,
      metadata: parseJsonObject(memory.metadata),
      updatedAt: memory.updatedAt.toISOString(),
    })),
  }
}

export async function hasSpellUnlocked(userId: string, spellId: SpellId): Promise<boolean> {
  const row = await prisma.playerSpellUnlock.findUnique({
    where: { userId_spellId: { userId, spellId } },
    select: { id: true },
  })
  return Boolean(row)
}

export async function recordAchievement(args: {
  userId: string
  achievementId: AchievementId
  source?: string
  quote?: string
  metadata?: Record<string, unknown>
}) {
  const existing = await prisma.playerAchievement.findUnique({
    where: { userId_achievementId: { userId: args.userId, achievementId: args.achievementId } },
  })
  if (existing) return { achievement: existing, newlyUnlocked: false, xp: null }

  const achievement = await prisma.playerAchievement.create({
    data: {
      userId: args.userId,
      achievementId: args.achievementId,
      source: args.source,
      quote: args.quote,
      metadata: JSON.stringify(args.metadata || {}),
    },
  })
  const def = ACHIEVEMENT_DEFS[args.achievementId]
  const xp = def?.xp ? await awardXpToUser(args.userId, def.xp, `ACHIEVEMENT:${args.achievementId}`) : null
  return { achievement, newlyUnlocked: true, xp }
}

export async function unlockSpellForUser(args: {
  userId: string
  spellId: SpellId
  sourceQuestId?: string
  metadata?: Record<string, unknown>
}) {
  const existing = await prisma.playerSpellUnlock.findUnique({
    where: { userId_spellId: { userId: args.userId, spellId: args.spellId } },
  })
  if (existing) {
    return { spell: existing, newlyUnlocked: false, xp: null, achievements: [] }
  }

  const spell = await prisma.playerSpellUnlock.create({
    data: {
      userId: args.userId,
      spellId: args.spellId,
      sourceQuestId: args.sourceQuestId,
      metadata: JSON.stringify(args.metadata || {}),
    },
  })
  const xp = await awardXpActionToUser(args.userId, args.spellId === 'firebolt' ? 'QUEST_ZERO_FIREBOLT_UNLOCKED' : 'SPELL_UNLOCK')
  const achievementResults = []
  const firstSpellCount = await prisma.playerSpellUnlock.count({ where: { userId: args.userId } })
  if (firstSpellCount === 1) {
    achievementResults.push(await recordAchievement({
      userId: args.userId,
      achievementId: 'learn-first-spell',
      source: args.sourceQuestId || args.spellId,
    }))
  }
  const spellAchievement = SPELL_DEFS[args.spellId].achievementId
  if (isAchievementId(spellAchievement)) {
    achievementResults.push(await recordAchievement({
      userId: args.userId,
      achievementId: spellAchievement,
      source: args.sourceQuestId || args.spellId,
    }))
  }
  return { spell, newlyUnlocked: true, xp, achievements: achievementResults }
}

export async function recordSpellUse(userId: string, spellId: SpellId) {
  return prisma.playerSpellUnlock.update({
    where: { userId_spellId: { userId, spellId } },
    data: {
      uses: { increment: 1 },
      lastUsedAt: new Date(),
    },
  })
}

export async function startQuest(userId: string, questId = QUEST_ZERO_ID) {
  const existing = await prisma.playerQuestProgress.findUnique({
    where: { userId_questId: { userId, questId } },
  })
  if (existing) return { progress: existing, wasNew: false, xp: null }

  const progress = await prisma.playerQuestProgress.create({
    data: {
      userId,
      questId,
      status: 'active',
      currentStepId: questId === QUEST_ZERO_ID ? 'meet-merlin' : null,
    },
  })
  return { progress, wasNew: true, xp: await awardXpActionToUser(userId, 'QUEST_ZERO_STARTED') }
}

export async function completeQuestStep(args: {
  userId: string
  questId?: string
  stepId: QuestZeroStepId
  metadata?: Record<string, unknown>
}) {
  const questId = args.questId || QUEST_ZERO_ID
  const current = await prisma.playerQuestProgress.upsert({
    where: { userId_questId: { userId: args.userId, questId } },
    create: {
      userId: args.userId,
      questId,
      status: 'active',
      currentStepId: args.stepId,
      completedSteps: '[]',
      metadata: '{}',
    },
    update: {},
  })
  const completedSteps = parseJsonArray(current.completedSteps)
  const alreadyComplete = completedSteps.includes(args.stepId)
  const nextSteps = alreadyComplete ? completedSteps : [...completedSteps, args.stepId]
  const allTargetStepsDone = QUEST_ZERO_TARGET_STEP_IDS.every(step => nextSteps.includes(step))
  const questComplete = questId === QUEST_ZERO_ID
    && nextSteps.includes('unlock-firebolt')
    && allTargetStepsDone
  const nextStatus = questComplete ? 'complete' : current.status
  const nextCurrentStep = questComplete
    ? 'complete'
    : QUEST_ZERO_TARGET_STEP_IDS.find(step => !nextSteps.includes(step)) || args.stepId

  const updated = await prisma.playerQuestProgress.update({
    where: { userId_questId: { userId: args.userId, questId } },
    data: {
      completedSteps: JSON.stringify(nextSteps),
      currentStepId: nextCurrentStep,
      status: nextStatus,
      metadata: mergeMetadata(current.metadata, args.metadata),
      ...(questComplete && current.status !== 'complete' ? { completedAt: new Date() } : {}),
    },
  })

  const xp = alreadyComplete
    ? null
    : await awardXpActionToUser(
        args.userId,
        args.stepId.startsWith('hit-firebolt-target')
          ? 'QUEST_ZERO_TARGET_HIT'
          : args.stepId === 'answer-fire-guardian'
            ? 'QUEST_ZERO_FIRE_GUARDIAN_PASSED'
            : 'QUEST_STEP_COMPLETE',
      )
  const completionXp = questComplete && current.status !== 'complete'
    ? await awardXpActionToUser(args.userId, 'QUEST_ZERO_COMPLETE')
    : null
  const completionAchievement = questComplete && current.status !== 'complete'
    ? await recordAchievement({ userId: args.userId, achievementId: 'quest-zero-complete', source: questId })
    : null

  return {
    progress: updated,
    newlyCompletedStep: !alreadyComplete,
    xp,
    completionXp,
    completionAchievement,
  }
}

export async function recordFireGuardianJudgement(args: {
  userId: string
  npcId: string
  questId?: string
  gateId?: string
  passed: boolean
  reason?: string
  memoryNote?: string
}) {
  if (args.memoryNote?.trim()) {
    await prisma.npcMemory.upsert({
      where: { userId_npcId: { userId: args.userId, npcId: args.npcId } },
      create: {
        userId: args.userId,
        npcId: args.npcId,
        summary: args.memoryNote.trim().slice(0, 2000),
        metadata: JSON.stringify({ gateId: args.gateId || null }),
      },
      update: {
        summary: args.memoryNote.trim().slice(0, 2000),
        metadata: mergeMetadata('{}', { gateId: args.gateId || null }),
      },
    })
  }

  if (!args.passed || args.npcId !== 'quest-zero-fire-guardian' || args.gateId !== 'firebolt-prometheus') {
    return {
      ok: true,
      passed: args.passed,
      unlockedSpell: null,
      questStep: null,
    }
  }

  const questStart = await startQuest(args.userId, args.questId || QUEST_ZERO_ID)
  const guardianStep = await completeQuestStep({
    userId: args.userId,
    questId: args.questId || QUEST_ZERO_ID,
    stepId: 'answer-fire-guardian',
    metadata: { npcId: args.npcId, gateId: args.gateId, reason: args.reason || '' },
  })
  const unlockedSpell = await unlockSpellForUser({
    userId: args.userId,
    spellId: 'firebolt',
    sourceQuestId: args.questId || QUEST_ZERO_ID,
    metadata: { npcId: args.npcId, gateId: args.gateId },
  })
  const unlockStep = await completeQuestStep({
    userId: args.userId,
    questId: args.questId || QUEST_ZERO_ID,
    stepId: 'unlock-firebolt',
  })

  return {
    ok: true,
    passed: true,
    questStart,
    guardianStep,
    unlockedSpell,
    unlockStep,
  }
}

export async function recordFireboltTargetHit(args: {
  userId: string
  targetId: string
  worldId?: string
  position?: unknown
}) {
  await startQuest(args.userId, QUEST_ZERO_ID)
  const current = await prisma.playerQuestProgress.findUnique({
    where: { userId_questId: { userId: args.userId, questId: QUEST_ZERO_ID } },
  })
  const metadata = parseJsonObject(current?.metadata)
  const hits = Array.isArray(metadata.fireboltTargetHits)
    ? metadata.fireboltTargetHits.filter(item => typeof item === 'string')
    : []
  if (!hits.includes(args.targetId)) hits.push(args.targetId)
  const stepId = QUEST_ZERO_TARGET_STEP_IDS[Math.min(hits.length - 1, QUEST_ZERO_TARGET_STEP_IDS.length - 1)]
  const hitStep = isQuestZeroStepId(stepId)
    ? await completeQuestStep({
        userId: args.userId,
        questId: QUEST_ZERO_ID,
        stepId,
        metadata: {
          ...metadata,
          fireboltTargetHits: hits,
          lastFireboltTargetHit: args.targetId,
          lastWorldId: args.worldId || null,
        },
      })
    : null
  const achievement = await recordAchievement({
    userId: args.userId,
    achievementId: 'first-firebolt-hit',
    source: QUEST_ZERO_ID,
    metadata: { targetId: args.targetId, worldId: args.worldId || null },
  })

  return {
    ok: true,
    hitCount: hits.length,
    targetId: args.targetId,
    hitStep,
    achievement,
  }
}
