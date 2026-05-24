import { NextResponse } from 'next/server'

import { setWorldLiked } from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'
import { getRequiredOasisUserId } from '@/lib/session'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[Worlds] POST like error:', msg)
  if (err instanceof WorldAccessError) {
    return NextResponse.json({ error: msg, code: err.code }, { status: err.status })
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({})) as { liked?: unknown }
    if (typeof body.liked !== 'boolean') {
      return NextResponse.json({ error: 'liked (boolean) required' }, { status: 400 })
    }

    const result = await setWorldLiked(id, userId, body.liked)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return errorResponse(err)
  }
}
