import { NextRequest, NextResponse } from 'next/server'

import { demoEntryPath, resolveDemoShortCode } from '@/lib/demo-short-codes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } },
) {
  const entry = resolveDemoShortCode(params.code)
  if (!entry) {
    return NextResponse.json({ ok: false, error: 'unknown route' }, { status: 404 })
  }
  return NextResponse.redirect(new URL(demoEntryPath(entry), request.url))
}
