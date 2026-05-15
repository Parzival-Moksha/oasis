import { NextRequest, NextResponse } from 'next/server'

import { getRequiredOasisUserId } from '@/lib/session'
import {
  completeQuestStep,
  getPlayerProgressionState,
  recordAchievement,
  recordFireGuardianJudgement,
  recordFireboltTargetHit,
  recordSpellUse,
  startQuest,
  unlockSpellForUser,
} from '@/lib/player-progression-server'
import { QUEST_ZERO_ID, isAchievementId, isQuestZeroStepId, isSpellId } from '@/lib/spellbook'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const userId = getRequiredOasisUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
  }
  return NextResponse.json(await getPlayerProgressionState(userId))
}

export async function POST(request: NextRequest) {
  const userId = getRequiredOasisUserId(request)
  if (!userId) {
    return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const action = asString(body.action)

  if (action === 'start_quest') {
    const questId = asString(body.questId) || QUEST_ZERO_ID
    return NextResponse.json({
      ok: true,
      result: await startQuest(userId, questId),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'complete_step') {
    if (!isQuestZeroStepId(body.stepId)) {
      return NextResponse.json({ error: 'Unknown quest step' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      result: await completeQuestStep({
        userId,
        questId: asString(body.questId) || QUEST_ZERO_ID,
        stepId: body.stepId,
        metadata: asRecord(body.metadata),
      }),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'unlock_spell') {
    if (!isSpellId(body.spellId)) {
      return NextResponse.json({ error: 'Unknown spell' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      result: await unlockSpellForUser({
        userId,
        spellId: body.spellId,
        sourceQuestId: asString(body.sourceQuestId) || undefined,
        metadata: asRecord(body.metadata),
      }),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'record_spell_use') {
    if (!isSpellId(body.spellId)) {
      return NextResponse.json({ error: 'Unknown spell' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      result: await recordSpellUse(userId, body.spellId),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'record_achievement') {
    if (!isAchievementId(body.achievementId)) {
      return NextResponse.json({ error: 'Unknown achievement' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      result: await recordAchievement({
        userId,
        achievementId: body.achievementId,
        source: asString(body.source) || undefined,
        quote: asString(body.quote) || undefined,
        metadata: asRecord(body.metadata),
      }),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'npc_judgement') {
    return NextResponse.json({
      ok: true,
      result: await recordFireGuardianJudgement({
        userId,
        npcId: asString(body.npcId),
        questId: asString(body.questId) || QUEST_ZERO_ID,
        gateId: asString(body.gateId),
        passed: body.passed === true,
        reason: asString(body.reason) || undefined,
        memoryNote: asString(body.memoryNote) || undefined,
      }),
      progression: await getPlayerProgressionState(userId),
    })
  }

  if (action === 'record_firebolt_target_hit') {
    const targetId = asString(body.targetId)
    if (!targetId) {
      return NextResponse.json({ error: 'targetId is required' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      result: await recordFireboltTargetHit({
        userId,
        targetId,
        worldId: asString(body.worldId) || undefined,
        position: body.position,
      }),
      progression: await getPlayerProgressionState(userId),
    })
  }

  return NextResponse.json({ error: 'Unknown progression action' }, { status: 400 })
}
