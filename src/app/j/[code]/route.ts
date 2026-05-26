import { NextRequest, NextResponse } from 'next/server'

import { demoEntryPath, resolveDemoShortCode } from '@/lib/demo-short-codes'
import { publicOriginFromRequest } from '@/lib/public-origin'
import { findReadableWorldByShortCode } from '@/lib/world-short-codes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  const entry = resolveDemoShortCode(params.code)
  const origin = publicOriginFromRequest(request)
  if (entry) {
    return NextResponse.redirect(new URL(demoEntryPath(entry), origin))
  }

  const world = await findReadableWorldByShortCode(params.code)
  if (world) {
    return NextResponse.redirect(new URL(`/w/${encodeURIComponent(world.id)}`, origin))
  }

  return NextResponse.json({ ok: false, error: 'unknown demo code' }, { status: 404 })
}
