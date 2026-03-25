// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO — Feedback Route
// Carbondev responds to a curator's maturation: bump or refine.
// Appends to mission.history, reassigns to anorak's curator queue.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(request: NextRequest) {
  let body: {
    missionId: number
    mature: boolean        // true=bump maturity, false=refine (re-curate)
    verdict: string        // 'accept' | 'modify' | 'rewrite'
    rating: number         // 0-10 silicondev accuracy
    carbondevMsg?: string  // what carbondev actually says (null if accepted)
    carbonSeconds?: number // time spent reviewing
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { missionId, mature, verdict, rating, carbondevMsg, carbonSeconds } = body
  if (!missionId || typeof mature !== 'boolean' || !verdict) {
    return NextResponse.json({ error: 'missionId, mature, verdict required' }, { status: 400 })
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } })
  if (!mission) {
    return NextResponse.json({ error: `Mission ${missionId} not found` }, { status: 404 })
  }

  // Parse existing history
  let history: Record<string, unknown>[] = []
  try { history = JSON.parse(mission.history || '[]') } catch { history = [] }

  // Append carbondev feedback entry
  history.push({
    timestamp: new Date().toISOString(),
    actor: 'carbondev',
    action: 'feedback',
    verdict,
    rating,
    carbondevMsg: carbondevMsg || undefined,
    mature,
    carbonSeconds: carbonSeconds || undefined,
  })

  // Calculate new maturity level
  const newLevel = mature ? Math.min(mission.maturityLevel + 1, 3) : mission.maturityLevel

  // Determine assignment
  // After feedback, mission goes back to anorak (curator queue) regardless
  // of bump or refine. Even at vaikhari, it's assigned to anorak for execution.
  const newAssignedTo = 'anorak'

  // Get next curator queue position (append to end)
  const lastInQueue = await prisma.mission.findFirst({
    where: { curatorQueuePosition: { not: null } },
    orderBy: { curatorQueuePosition: 'desc' },
    select: { curatorQueuePosition: true },
  })
  const nextQueuePos = (lastInQueue?.curatorQueuePosition ?? 0) + 1

  await prisma.mission.update({
    where: { id: missionId },
    data: {
      history: JSON.stringify(history),
      maturityLevel: newLevel,
      assignedTo: newAssignedTo,
      curatorQueuePosition: newLevel < 3 ? nextQueuePos : null, // vaikhari exits curator queue
    },
  })

  return NextResponse.json({
    success: true,
    missionId,
    mature,
    newLevel,
    assignedTo: newAssignedTo,
    message: mature
      ? newLevel >= 3
        ? `Mission #${missionId} reached vaikhari 🌕 — ready for execution`
        : `Mission #${missionId} bumped to level ${newLevel} — back in curator queue`
      : `Mission #${missionId} refined — back in curator queue for re-enrichment`,
  })
}
