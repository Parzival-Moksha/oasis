// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Profile API — Local-first stub
// GET  /api/profile — returns local profile defaults
// PATCH /api/profile — accepts updates (stored in memory only for now)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

const LOCAL_PROFILE = {
  credits: 9999, xp: 0, level: 1, aura: 0,
  wallet_address: null, levelTitle: 'Wanderer', levelBadge: '░',
  levelProgress: 0, xpToNext: 100, needsOnboarding: false,
  displayName: 'Player 1', bio: null, avatar_url: null, avatar_3d_url: null,
}

export async function GET() {
  return NextResponse.json(LOCAL_PROFILE)
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    // Accept updates but don't persist (Prisma migration TBD)
    return NextResponse.json({ ...LOCAL_PROFILE, ...body })
  } catch {
    return NextResponse.json(LOCAL_PROFILE)
  }
}
