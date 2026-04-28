import { NextRequest, NextResponse } from 'next/server'

import { publishBrowserActiveWorld } from '@/lib/browser-active-world'
import { publishBrowserAgentAvatarContext } from '@/lib/browser-agent-avatar-context'
import { publishBrowserPlayerContext } from '@/lib/browser-player-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const worldId = sanitizeString(body?.worldId)

  if (!worldId) {
    return NextResponse.json({ ok: false, error: 'worldId is required.' }, { status: 400 })
  }

  await publishBrowserActiveWorld(worldId)

  const player = body?.player && typeof body.player === 'object' ? body.player as Record<string, unknown> : null
  if (player) {
    publishBrowserPlayerContext(worldId, player.avatar, player.camera)
  }

  publishBrowserAgentAvatarContext(worldId, body?.agentAvatars)

  return NextResponse.json({ ok: true, worldId })
}
