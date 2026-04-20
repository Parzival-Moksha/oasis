import { NextRequest, NextResponse } from 'next/server'

import { publishBrowserActiveWorld } from '@/lib/browser-active-world'

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
  return NextResponse.json({ ok: true, worldId })
}
