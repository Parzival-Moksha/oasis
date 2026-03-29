// ░▒▓█ D3VCR4F7 API — Missions CRUD █▓▒░
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/missions — List all missions (optionally filter by status, assignedTo)
export async function GET(request: NextRequest) {
  try {
    // ░▒▓ GHOST MISSION CLEANUP — reset stale execution phases ▓▒░
    // If a mission has executionPhase set but hasn't been updated in >10 minutes,
    // it was likely left by a killed agent. Reset to prevent ghost activity.
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000)
    await prisma.mission.updateMany({
      where: {
        executionPhase: { not: null },
        updatedAt: { lt: staleThreshold },
      },
      data: {
        executionPhase: null,
        executionRound: 0,
      },
    })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assignedTo')
    const limit = parseInt(searchParams.get('limit') || '100')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (assignedTo) where.assignedTo = assignedTo

    const missions = await prisma.mission.findMany({
      where,
      orderBy: [{ queuePosition: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    })
    return NextResponse.json(missions)
  } catch (error) {
    console.error('[D3VCR4F7] Missions GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch missions' }, { status: 500 })
  }
}

// POST /api/missions — Create a new mission
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, urgency = 5, easiness = 5, impact = 5, ...rest } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const priority = (urgency * easiness * impact) / 125

    // If agent provides enrichment (carbonDescription/siliconDescription), auto-start as pashyanti
    const hasAgentEnrichment = !!(rest.carbonDescription || rest.siliconDescription)

    const mission = await prisma.mission.create({
      data: {
        name,
        urgency,
        easiness,
        impact,
        priority,
        horizon: rest.horizon || null,
        targetSeconds: rest.targetSeconds || null,
        isIRL: rest.isIRL || false,
        notes: rest.notes || null,
        assignedTo: rest.assignedTo || 'carbondev',
        description: rest.description || null,
        carbonDescription: rest.carbonDescription || null,
        siliconDescription: rest.siliconDescription || null,
        acceptanceCriteria: rest.acceptanceCriteria || null,
        dharmaPath: rest.dharmaPath || null,
        questName: rest.questName || null,
        ...(hasAgentEnrichment && { maturityLevel: 1 }),
      },
    })

    return NextResponse.json(mission)
  } catch (error) {
    console.error('[D3VCR4F7] Missions POST error:', error)
    return NextResponse.json({ error: 'Failed to create mission' }, { status: 500 })
  }
}

// DELETE /api/missions?id=X — Delete a mission
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
    if (isNaN(parseInt(id))) return NextResponse.json({ error: 'Invalid mission ID' }, { status: 400 })

    await prisma.mission.delete({ where: { id: parseInt(id) } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[D3VCR4F7] Missions DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 })
  }
}
