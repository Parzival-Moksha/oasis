import { NextResponse } from 'next/server'

import { setWorldVisibility } from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'
import { getRequiredOasisUserId } from '@/lib/session'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[Worlds] PATCH visibility error:', msg)
  if (err instanceof WorldAccessError) {
    return NextResponse.json({ error: msg, code: err.code }, { status: err.status })
  }
  return NextResponse.json({ error: msg }, { status: 500 })
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }
    const { id } = await context.params
    const body = await request.json() as { visibility?: string }
    if (!body.visibility) {
      return NextResponse.json({ error: 'visibility required' }, { status: 400 })
    }

    await setWorldVisibility(id, userId, body.visibility)
    return NextResponse.json({ ok: true, visibility: body.visibility })
  } catch (err) {
    return errorResponse(err)
  }
}
