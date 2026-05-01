import { NextResponse } from 'next/server'

import { loadPublicWorld, recordVisit } from '@/lib/forge/world-server'

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const result = await loadPublicWorld(id)
    if (!result) {
      return NextResponse.json({ error: 'World not found' }, { status: 404 })
    }

    recordVisit(id).catch(() => {})
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Worlds] GET public error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
