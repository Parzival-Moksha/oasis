// /api/academy/keychain — the Academy's keychain: every key an agent can hold, and which ones are held.
//   GET   ?fresh=1 to look again (otherwise a look from the last 45 s is reused)
//         → { scannedAt, keys: [{ id, name, kind, cost, link, state: have|missing|unknown, found: [where], skills: [...] }], sources }
//   POST  { key, action: 'have' | 'unmark' }                 mark a key (an account, a plan, a machine) as held
//         { key, action: 'store', value, name? }             write a pasted key into the Oasis's local .env
// A value is only ever read from a POST store, and never leaves that request: no response, error or log
// line carries it. Local requests only, like /api/academy.

import { NextRequest, NextResponse } from 'next/server'

import { keychainAction, keychainSnapshot, type KeychainAction } from '@/lib/keychain-server'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    return NextResponse.json(await keychainSnapshot({ fresh: request.nextUrl.searchParams.get('fresh') === '1' }), { headers: NO_STORE })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 200) : 'keychain failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let text: string
  try {
    text = await request.text()
  } catch {
    return NextResponse.json({ error: 'unreadable body' }, { status: 400 })
  }
  if (text.length > 20_000) return NextResponse.json({ error: 'body too large' }, { status: 413 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Not echoed: the body may hold a value.
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.key !== 'string') return NextResponse.json({ error: 'send { key, action }' }, { status: 400 })
  const action = body.action
  if (action !== 'have' && action !== 'unmark' && action !== 'store') return NextResponse.json({ error: 'action must be have, unmark or store' }, { status: 400 })
  const input: KeychainAction = action === 'store'
    ? { key: body.key, action, value: typeof body.value === 'string' ? body.value : '', ...(typeof body.name === 'string' ? { name: body.name } : {}) }
    : { key: body.key, action }
  const result = await keychainAction(input)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE })
  return NextResponse.json({ ok: true, key: result.key, ...(result.warning ? { warning: result.warning } : {}), ...(result.file ? { file: result.file } : {}), ...(result.restart ? { restart: true } : {}) }, { headers: NO_STORE })
}
