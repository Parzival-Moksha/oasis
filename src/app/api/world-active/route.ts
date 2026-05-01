import { NextRequest, NextResponse } from 'next/server'

import { publishBrowserActiveWorld } from '@/lib/browser-active-world'
import { publishBrowserAgentAvatarContext } from '@/lib/browser-agent-avatar-context'
import { publishBrowserPlayerContext } from '@/lib/browser-player-context'
import { resolveActiveWorldForUser } from '@/lib/forge/world-active'
import { getOasisMode, getRequiredOasisUserId } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  const userId = getRequiredOasisUserId(request)
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'oasis_session cookie required' }, { status: 401 })
  }
  const active = await resolveActiveWorldForUser(userId)
  if (!active) {
    return NextResponse.json({ ok: false, error: 'no active world available' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    mode: getOasisMode(),
    ...active,
  })
}

export async function POST(request: NextRequest) {
  const userId = getRequiredOasisUserId(request)
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'oasis_session cookie required' }, { status: 401 })
  }
  const body = await request.json().catch(() => ({}))
  const worldId = sanitizeString(body?.worldId)

  if (!worldId) {
    return NextResponse.json({ ok: false, error: 'worldId is required.' }, { status: 400 })
  }

  await publishBrowserActiveWorld(worldId, userId)

  const player = body?.player && typeof body.player === 'object' ? body.player as Record<string, unknown> : null
  if (player) {
    publishBrowserPlayerContext(worldId, player.avatar, player.camera)
  }

  publishBrowserAgentAvatarContext(worldId, body?.agentAvatars)

  return NextResponse.json({ ok: true, worldId })
}
