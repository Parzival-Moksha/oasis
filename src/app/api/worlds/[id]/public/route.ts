// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PUBLIC WORLD — Read-only access to public/unlisted worlds
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET /api/worlds/[id]/public — Load world state (no auth required)
//   Increments visit counter on each load.
//
// ░▒▓█ PUBLIC WORLD ROUTE █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { loadPublicWorld, recordVisit } from '@/lib/forge/world-server'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const result = await loadPublicWorld(id)

    if (!result) {
      return NextResponse.json({ error: 'World not found or not public' }, { status: 404 })
    }

    // Fire-and-forget visit counter
    recordVisit(id).catch(() => {})

    return NextResponse.json({
      state: result.state,
      meta: result.meta,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Worlds] GET [id]/public error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
