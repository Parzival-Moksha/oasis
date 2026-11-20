// /api/village/identity — who each agent is, one copy on this PC (lib/village/village-identity.ts).
//   GET   [?since=<version>]   -> the file ({ unchanged: true, version } when nothing changed since)
//   PATCH or POST { ops: [{ agent, set?, ifAbsent?, remove? }], settings? }
//                 or the short form { agent, <field>: value, … } (sets those fields; null clears one),
//                 e.g. { agent: '<session id>', homeWorld: '<world id>' | null }
//                 -> { ok, version, file }
// Local requests only.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { parseIdentityPatch } from '@/lib/village/village-identity'
import { patchIdentity, readIdentity } from '@/lib/village/village-identity-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    const file = await readIdentity()
    const asked = request.nextUrl.searchParams.get('since')
    const since = asked === null || asked === '' ? Number.NaN : Number(asked)
    if (Number.isFinite(since) && since === file.version) return NextResponse.json({ unchanged: true, version: file.version })
    return NextResponse.json(file)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'unreadable' }, { status: 500 })
  }
}

async function change(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const patch = parseIdentityPatch(body)
  if (!patch) return NextResponse.json({ error: 'nothing to change: send { ops: [...] } or { agent, <field>: value }' }, { status: 400 })
  try {
    const file = await patchIdentity(patch)
    return NextResponse.json({ ok: true, version: file.version, file })
  } catch (error) {
    console.error('[Village:Identity] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal error' }, { status: 500 })
  }
}

export const PATCH = change
export const POST = change
