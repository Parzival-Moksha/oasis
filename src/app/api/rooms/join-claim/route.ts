import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { isOasisAdmin, getOasisMode, getRequiredOasisUserId } from '@/lib/session'
import {
  canReadWorld,
  getWorldWriteDecision,
  type WorldAccessContext,
} from '@/lib/forge/world-access'
import {
  ROOM_JOIN_CLAIM_TTL_MS,
  signRoomJoinClaim,
  type RoomJoinClaimPayload,
} from '@/lib/room-join-claim'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function cleanWorldId(value: string | null): string {
  return (value || '').trim().replace(/[^a-zA-Z0-9_:.-]/g, '').slice(0, 96)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const worldId = cleanWorldId(url.searchParams.get('worldId'))
  if (!worldId) return NextResponse.json({ error: 'worldId required' }, { status: 400 })

  const userId = getRequiredOasisUserId(request)
  if (!userId) return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })

  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, visibility: true, pvpEnabled: true },
  })
  if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 })

  const admin = isOasisAdmin(request)
  const ctx: WorldAccessContext = {
    userId,
    mode: getOasisMode(),
    admin,
  }
  const subject = {
    id: world.id,
    userId: world.userId,
    visibility: world.visibility,
  }
  if (!canReadWorld(ctx, subject)) {
    return NextResponse.json({ error: 'World not found' }, { status: 404 })
  }

  const now = Date.now()
  const claim: RoomJoinClaimPayload = {
    type: 'oasis-room-join-v1',
    worldId,
    userId,
    canRead: true,
    canWrite: getWorldWriteDecision(ctx, subject) === 'write',
    pvpEnabled: world.pvpEnabled === true,
    ...(admin ? { admin: true } : {}),
    iat: now,
    exp: now + ROOM_JOIN_CLAIM_TTL_MS,
  }

  return NextResponse.json({
    ok: true,
    claim: signRoomJoinClaim(claim),
    userId,
    canWrite: claim.canWrite,
    pvpEnabled: claim.pvpEnabled,
    expiresAt: new Date(claim.exp).toISOString(),
  })
}
