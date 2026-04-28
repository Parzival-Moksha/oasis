/**
 * POST /api/relay/pairings
 *
 * Create a short, single-use pairing code bound to the caller's signed
 * browser session, target world, and scope set. The user displays the code
 * in their browser and pastes it into the OpenClaw bridge command.
 *
 * Body (all optional):
 *   {
 *     worldId?: string,                 // defaults to '__active__'
 *     scopes?: Scope[],                 // defaults to a safe baseline set
 *   }
 *
 * Response:
 *   200 { ok: true, code, expiresAt, worldId, scopes }
 *   401 { ok: false, error: { code: 'no_session', ... } }   // cookie missing/invalid
 *   400 { ok: false, error: { code, message } }
 */

import { NextRequest } from 'next/server'

import { createPairingCode, PairingCodeError } from '@/lib/relay/pairing-codes'
import type { Scope } from '@/lib/relay/protocol'
import { clientKeyFromRequest, consumeRateLimit } from '@/lib/relay/rate-limit'
import { readBrowserSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RATE_LIMIT_PER_IP = 12
const RATE_LIMIT_WINDOW_MS = 60_000

// Bound the v1 attack surface. Hosted-mode plan-aware tightening lands later.
const SCOPE_ALLOWLIST: Scope[] = [
  'world.read',
  'world.write.safe',
  'screenshot.request',
  'chat.stream',
]

const DEFAULT_SCOPES: Scope[] = [
  'world.read',
  'world.write.safe',
  'screenshot.request',
  'chat.stream',
]

interface CreatePairingBody {
  worldId?: unknown
  scopes?: unknown
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest) {
  const session = readBrowserSession(request)
  if (!session) {
    return jsonResponse({
      ok: false,
      error: { code: 'no_session', message: 'oasis_session cookie missing or invalid' },
    }, 401)
  }

  const decision = consumeRateLimit({
    key: `pairings:${clientKeyFromRequest(request.headers)}`,
    limit: RATE_LIMIT_PER_IP,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!decision.allowed) {
    return new Response(JSON.stringify({
      ok: false,
      error: { code: 'rate_limited', message: 'too many pairing attempts; retry later' },
    }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(decision.retryAfterSeconds),
      },
    })
  }

  let body: CreatePairingBody
  try { body = await request.json() as CreatePairingBody } catch { body = {} }

  const worldId = typeof body.worldId === 'string' && body.worldId.trim()
    ? body.worldId.trim()
    : '__active__'

  const requestedScopes: Scope[] = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is Scope => typeof s === 'string' && SCOPE_ALLOWLIST.includes(s as Scope))
    : DEFAULT_SCOPES
  const scopes = requestedScopes.length > 0 ? requestedScopes : DEFAULT_SCOPES

  try {
    const created = createPairingCode({
      browserSessionId: session.browserSessionId,
      worldId,
      scopes,
    })
    return jsonResponse({
      ok: true,
      code: created.code,
      expiresAt: created.expiresAt,
      worldId,
      scopes,
    })
  } catch (err) {
    if (err instanceof PairingCodeError) {
      const status = err.code === 'too_many_active' ? 429 : 400
      return jsonResponse({
        ok: false,
        error: { code: err.code, message: err.message },
      }, status)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/relay/pairings] failed', { code: 'create_failed' })
    return jsonResponse({
      ok: false,
      error: { code: 'create_failed', message },
    }, 500)
  }
}
