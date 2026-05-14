/**
 * POST /api/relay/pairings
 *
 * Create a short, single-use pairing code bound to the caller's signed
 * browser session, target world, and scope set. The user displays the code
 * in their browser and pastes it into the OpenClaw bridge command.
 *
 * Body:
 *   {
 *     worldId?: string,                 // local defaults to '__active__'; hosted requires explicit id
 *     scopes?: Scope[],                 // defaults to a safe baseline set
 *   }
 *
 * Response:
 *   200 { ok: true, code, expiresAt, worldId, scopes }
 *   401 { ok: false, error: { code: 'no_session', ... } }   // cookie missing/invalid
 *   400 { ok: false, error: { code, message } }
 */

import { NextRequest } from 'next/server'

import {
  createPairingCode,
  latestActivePairingCodeForSession,
  listActivePairingCodesForSession,
  normalizeAgentLabel,
  normalizeAgentSlot,
  normalizeAgentType,
  PairingCodeError,
} from '@/lib/relay/pairing-codes'
import { resolvePairingWorldId } from '@/lib/relay/pairing-world'
import type { Scope } from '@/lib/relay/protocol'
import { clientKeyFromRequest, consumeRateLimit } from '@/lib/relay/rate-limit'
import { recordOasisAnalyticsEvent } from '@/lib/oasis-analytics'
import { getOasisMode, readBrowserSession } from '@/lib/session'

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
  agentType?: unknown
  agentSlot?: unknown
  agentLabel?: unknown
  reuseActive?: unknown
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest) {
  const session = readBrowserSession(request)
  if (!session) {
    return jsonResponse({
      ok: false,
      error: { code: 'no_session', message: 'oasis_session cookie missing or invalid' },
    }, 401)
  }

  const url = new URL(request.url)
  const agentType = normalizeAgentType(url.searchParams.get('agentType') || undefined)
  const agentSlot = normalizeAgentSlot(url.searchParams.get('agentSlot') || undefined, agentType)
  const worldId = url.searchParams.get('worldId') || undefined
  const active = listActivePairingCodesForSession({
    browserSessionId: session.browserSessionId,
    agentSlot,
    worldId,
  })

  return jsonResponse({ ok: true, pairings: active })
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

  const resolvedWorld = resolvePairingWorldId(body.worldId, getOasisMode())
  if (!resolvedWorld.ok) {
    return jsonResponse({
      ok: false,
      error: { code: resolvedWorld.code, message: resolvedWorld.message },
    }, 400)
  }
  const worldId = resolvedWorld.worldId

  const requestedScopes: Scope[] = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is Scope => typeof s === 'string' && SCOPE_ALLOWLIST.includes(s as Scope))
    : DEFAULT_SCOPES
  const scopes = requestedScopes.length > 0 ? requestedScopes : DEFAULT_SCOPES
  const agentType = normalizeAgentType(body.agentType)
  const agentSlot = normalizeAgentSlot(body.agentSlot, agentType)
  const agentLabel = normalizeAgentLabel(body.agentLabel, `${agentType}-bridge`)
  const reuseActive = body.reuseActive !== false

  if (reuseActive) {
    const active = latestActivePairingCodeForSession({
      browserSessionId: session.browserSessionId,
      worldId,
      agentSlot,
    })
    if (active) {
      await recordOasisAnalyticsEvent({
        request,
        eventType: 'agent_pairing_reused',
        sessionId: session.browserSessionId,
        userId: session.browserSessionId,
        worldId,
        agentType,
        source: 'relay-pairings',
        metadata: {
          agentSlot,
          scopes: active.scopes,
        },
      })
      return jsonResponse({
        ok: true,
        reused: true,
        code: active.code,
        expiresAt: active.expiresAt,
        worldId: active.worldId,
        scopes: active.scopes,
        agentType: active.agentType,
        agentSlot: active.agentSlot,
        agentLabel: active.agentLabel,
      })
    }
  }

  try {
    const created = createPairingCode({
      browserSessionId: session.browserSessionId,
      worldId,
      scopes,
      agentType,
      agentSlot,
      agentLabel,
    })
    await recordOasisAnalyticsEvent({
      request,
      eventType: 'agent_pairing_created',
      sessionId: session.browserSessionId,
      userId: session.browserSessionId,
      worldId,
      agentType,
      source: 'relay-pairings',
      metadata: {
        agentSlot,
        agentLabel,
        scopes,
      },
    })
    return jsonResponse({
      ok: true,
      code: created.code,
      expiresAt: created.expiresAt,
      worldId,
      scopes,
      agentType: created.agentType,
      agentSlot: created.agentSlot,
      agentLabel: created.agentLabel,
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
