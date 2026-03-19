// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VISIBILITY API — Toggle world privacy (local mode, no XP)
// PUT /api/worlds/[id]/visibility
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { setWorldVisibility } from '@/lib/forge/world-server'

const VALID_VISIBILITY = ['private', 'public', 'unlisted', 'public_edit'] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = process.env.ADMIN_USER_ID || 'local-user'
    const { id: worldId } = await params
    const body = await req.json() as { visibility: string }

    if (!body.visibility || !VALID_VISIBILITY.includes(body.visibility as typeof VALID_VISIBILITY[number])) {
      return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 })
    }

    await setWorldVisibility(worldId, userId, body.visibility as 'private' | 'public' | 'unlisted' | 'public_edit')
    return NextResponse.json({ ok: true, visibility: body.visibility })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
