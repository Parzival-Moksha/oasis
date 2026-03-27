// ░▒▓█ D3VCR4F7 API — Mission [id] Update + Delete █▓▒░
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// PUT /api/missions/[id] — Update mission fields
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const raw = await request.json()

    // Whitelist — only allow known mutable fields
    const ALLOWED = [
      'name', 'status', 'urgency', 'easiness', 'impact', 'priority',
      'valor', 'score', 'startedAt', 'endedAt', 'pausedAt',
      'isPaused', 'totalPausedMs', 'actualSeconds', 'notes',
      'horizon', 'targetSeconds', 'queuePosition', 'isIRL',
      'description', 'assignedTo', 'history', 'maturityLevel',
      'carbonDescription', 'siliconDescription', 'acceptanceCriteria',
      'dharmaPath', 'flawlessPercent', 'curatorQueuePosition',
      'reviewerScore', 'testerScore', 'executionPhase', 'executionRound',
    ] as const
    const body: Record<string, unknown> = {}
    for (const key of ALLOWED) {
      if (raw[key] !== undefined) body[key] = raw[key]
    }

    // Coerce numeric fields
    for (const field of ['urgency', 'easiness', 'impact', 'valor', 'score', 'actualSeconds', 'targetSeconds', 'totalPausedMs', 'queuePosition']) {
      if (body[field] !== undefined && body[field] !== null) {
        const n = Number(body[field])
        if (!Number.isFinite(n)) { delete body[field] } else { body[field] = n }
      }
    }

    // Recalculate priority if scoring fields changed
    if (body.urgency !== undefined || body.easiness !== undefined || body.impact !== undefined) {
      const current = await prisma.mission.findUnique({ where: { id: parseInt(id) } })
      if (current) {
        const u = (body.urgency as number) ?? current.urgency
        const e = (body.easiness as number) ?? current.easiness
        const i = (body.impact as number) ?? current.impact
        body.priority = (u * e * i) / 125
      }
    }

    // Handle date fields (accept null or ISO string)
    for (const field of ['startedAt', 'endedAt', 'pausedAt']) {
      if (body[field] === null) continue
      if (body[field]) body[field] = new Date(body[field] as string)
    }

    const mission = await prisma.mission.update({
      where: { id: parseInt(id) },
      data: body,
    })

    return NextResponse.json(mission)
  } catch (error) {
    console.error('[D3VCR4F7] Mission PUT error:', error)
    return NextResponse.json({ error: 'Failed to update mission' }, { status: 500 })
  }
}

// DELETE /api/missions/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await prisma.mission.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[D3VCR4F7] Mission DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 })
  }
}
