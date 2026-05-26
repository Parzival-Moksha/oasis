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
    const target = new URL(`/w/${encodeURIComponent(world.id)}`, origin)
    target.search = request.nextUrl.search
    target.searchParams.set('short', world.shortCode || params.code)
    return NextResponse.redirect(target)
  }

  return NextResponse.json({ ok: false, error: 'unknown route' }, { status: 404 })
}
