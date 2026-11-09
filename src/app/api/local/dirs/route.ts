// GET /api/local/dirs?path=<folder>&hidden=1 — folders on this machine, for the summon picker's "Browse…".
// Local requests only (the same guard as the agent routes): never on a hosted deploy or from the network.

import { NextRequest, NextResponse } from 'next/server'

import { listDirectory } from '@/lib/local-dirs'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const params = request.nextUrl.searchParams
  const listing = await listDirectory(params.get('path') || '', { showHidden: params.get('hidden') === '1' })
  return NextResponse.json(listing)
}
