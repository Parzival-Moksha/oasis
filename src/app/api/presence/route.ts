import { NextRequest, NextResponse } from 'next/server'
import {
  listMultiplayerPresence,
  removeMultiplayerPresence,
  upsertMultiplayerPresence,
} from '@/lib/multiplayer-presence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, error: 'Invalid presence payload.' }, { status: 400 })

  const playerId = typeof body.playerId === 'string' ? body.playerId : ''
  const worldId = typeof body.worldId === 'string' ? body.worldId : ''
  if (body.leave === true) {
    removeMultiplayerPresence(playerId)
    return NextResponse.json({ ok: true, players: [] })
  }

  const player = upsertMultiplayerPresence({
    playerId,
    worldId,
    name: optionalString(body.name),
    avatarUrl: optionalString(body.avatarUrl),
    color: optionalString(body.color),
    position: body.position,
    yaw: body.yaw,
  })

  if (!player) return NextResponse.json({ ok: false, error: 'playerId and worldId are required.' }, { status: 400 })

  return NextResponse.json({
    ok: true,
    playerId: player.playerId,
    players: listMultiplayerPresence(player.worldId, player.playerId),
  })
}

export async function GET(request: NextRequest) {
  const worldId = request.nextUrl.searchParams.get('worldId') || ''
  const playerId = request.nextUrl.searchParams.get('playerId') || undefined
  if (!worldId) return NextResponse.json({ ok: false, error: 'worldId is required.' }, { status: 400 })
  return NextResponse.json({
    ok: true,
    players: listMultiplayerPresence(worldId, playerId),
  })
}
