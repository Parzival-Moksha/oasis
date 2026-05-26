import { NextResponse } from 'next/server'

import { isAdminUserId } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'
import { getRequiredOasisUserId } from '@/lib/session'
import {
  canEditWorldSettings,
  canReadWorld,
  PUBLICLY_READABLE_VISIBILITIES,
  type WorldAccessContext,
} from '@/lib/forge/world-access'
import { getOasisMode } from '@/lib/oasis-profile'
import { ensureWorldShortCode } from '@/lib/world-short-codes'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request, context: RouteContext) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const { id } = await context.params
    const world = await prisma.world.findUnique({
      where: { id },
      select: { id: true, userId: true, visibility: true, shortCode: true },
    })
    if (!world) return NextResponse.json({ error: 'World not found' }, { status: 404 })

    const ctx: WorldAccessContext = {
      userId,
      mode: getOasisMode(),
      admin: isAdminUserId(userId),
    }
    const shareable = PUBLICLY_READABLE_VISIBILITIES.some(visibility => visibility === world.visibility)
    if (!canEditWorldSettings(ctx, world) && !(shareable && canReadWorld(ctx, world))) {
      return NextResponse.json({ error: 'This session cannot change that world' }, { status: 403 })
    }

    const shortCode = world.shortCode || await ensureWorldShortCode(id)
    if (!shortCode) {
      return NextResponse.json({ error: 'Could not allocate a world short code' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, worldId: id, shortCode })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Worlds] short-code error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
