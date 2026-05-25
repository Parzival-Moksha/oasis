// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// XP API — Local-first, Prisma-backed
// POST /api/xp { action, worldId? }
// Awards XP and updates profile level
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { getRequiredOasisUserId } from '@/lib/session'
import type { XpAction } from '@/lib/xp'
import { awardXpActionToUser, awardXpToUser } from '@/lib/player-xp-server'

export async function POST(request: NextRequest) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ success: false, error: 'oasis_session cookie required' }, { status: 401 })
    }
    const body = await request.json()
    const action = body.action as XpAction | undefined
    const amount = Number(body.amount ?? body.xpGained ?? body.xp)

    if (Number.isFinite(amount) && amount > 0) {
      return NextResponse.json(await awardXpToUser(userId, amount, action || 'custom'))
    }

    return NextResponse.json(await awardXpActionToUser(userId, action))
  } catch (err) {
    console.error('[XP] Error:', err)
    return NextResponse.json({ success: false, error: 'XP award failed' }, { status: 500 })
  }
}
