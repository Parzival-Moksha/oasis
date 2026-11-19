// /api/village/homes — where each agent lives in each world (lib/village/village-homes.ts).
//   GET  [?since=<version>]  -> the homes file ({ unchanged: true, version } when nothing changed since)
//   POST { action: 'set', world, agent, home: { x, z, yaw, by } } | { action: 'clear', world, agent }
//        { action: 'request', agent, agentId?, kind: 'here' | 'at' | 'clear', x?, z? }   (me.mjs; the open page answers)
//        { action: 'answer', id, ok, note, world?, agent?, home? }                        (the page)
// Local requests only.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { HomesError, applyHomesAction, readHomes } from '@/lib/village/village-homes-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const file = await readHomes()
  const asked = request.nextUrl.searchParams.get('since')
  const since = asked === null || asked === '' ? Number.NaN : Number(asked)
  if (Number.isFinite(since) && since === file.version) return NextResponse.json({ unchanged: true, version: file.version })
  return NextResponse.json(file)
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  try {
    const { file, request: made } = await applyHomesAction(body)
    return NextResponse.json({ ok: true, version: file.version, ...(made ? { request: made } : {}), file })
  } catch (error) {
    if (error instanceof HomesError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[Village:Homes] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
