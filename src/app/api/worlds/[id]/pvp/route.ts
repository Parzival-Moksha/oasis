import { NextResponse } from 'next/server'

import { setWorldPvpEnabled } from '@/lib/forge/world-server'
import { WorldAccessError } from '@/lib/forge/world-access'
import { getRequiredOasisUserId } from '@/lib/session'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[Worlds] PATCH pvp error:', msg)
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
    const body = await request.json() as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 })
    }

    const pvpEnabled = await setWorldPvpEnabled(id, userId, body.enabled)
    return NextResponse.json({ ok: true, pvpEnabled })
  } catch (err) {
    return errorResponse(err)
  }
}
