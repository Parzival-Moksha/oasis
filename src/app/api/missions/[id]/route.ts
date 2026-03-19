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
    const body = await request.json()

    // Recalculate priority if scoring fields changed
    if (body.urgency !== undefined || body.easiness !== undefined || body.impact !== undefined) {
      const current = await prisma.mission.findUnique({ where: { id: parseInt(id) } })
      if (current) {
        const u = body.urgency ?? current.urgency
        const e = body.easiness ?? current.easiness
        const i = body.impact ?? current.impact
        body.priority = (u * e * i) / 125
      }
    }

    // Handle date fields (accept null or ISO string)
    for (const field of ['startedAt', 'endedAt', 'pausedAt']) {
      if (body[field] === null) continue
      if (body[field]) body[field] = new Date(body[field])
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
