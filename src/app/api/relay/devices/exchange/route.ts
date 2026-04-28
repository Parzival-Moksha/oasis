/**
 * POST /api/relay/devices/exchange
 *
 * The OpenClaw bridge calls this endpoint with the pairing code the user
 * pasted into its command line. We redeem the code (single-use) and issue
 * a signed device token. The bridge then uses that token to authenticate
 * its `agent.hello` envelope to the hosted relay sidecar.
 *
 * Body:
 *   {
 *     pairingCode:  string,             // the OASIS-XXXXXXXX code
 *     agentLabel?:  string,             // human label, e.g. 'openclaw-laptop'
 *     agentVersion?: string,            // informational only
 *   }
 *
 * Response:
 *   200 { ok: true, deviceToken, browserSessionId, worldId, scopes }
 *   400 { ok: false, error: { code, message } }
 *   413 { ok: false, error: { code: 'payload_too_large', ... } }
 *   500 { ok: false, error: { code: 'issue_failed', ... } }
 */

import { NextRequest } from 'next/server'

import { issueDeviceToken, RelayAuthError } from '@/lib/relay/auth'
import { PairingCodeError, redeemPairingCode } from '@/lib/relay/pairing-codes'
import { clientKeyFromRequest, consumeRateLimit } from '@/lib/relay/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 8 * 1024
// 32^8 ≈ 1.1 trillion code space, 5-min lifetime, but we still rate-limit
// per-IP to make online enumeration infeasible and to absorb stuck retry loops.
const RATE_LIMIT_PER_IP = 10
const RATE_LIMIT_WINDOW_MS = 60_000

interface ExchangeBody {
  pairingCode?: unknown
  agentLabel?: unknown
  agentVersion?: unknown
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: 'payload_too_large', message: `body exceeds ${MAX_BODY_BYTES} bytes` },
    }, 413)
  }

  const decision = consumeRateLimit({
    key: `exchange:${clientKeyFromRequest(request.headers)}`,
    limit: RATE_LIMIT_PER_IP,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!decision.allowed) {
    return new Response(JSON.stringify({
      ok: false,
      error: { code: 'rate_limited', message: 'too many exchange attempts; retry later' },
    }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(decision.retryAfterSeconds),
      },
    })
  }

  let body: ExchangeBody
  try {
    body = await request.json() as ExchangeBody
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: 'invalid_body', message: 'JSON body required' },
    }, 400)
  }

  const pairingCode = typeof body.pairingCode === 'string' ? body.pairingCode.trim() : ''
  const agentLabel = typeof body.agentLabel === 'string' && body.agentLabel.trim()
    ? body.agentLabel.trim()
    : 'openclaw-bridge'

  if (!pairingCode) {
    return jsonResponse({
      ok: false,
      error: { code: 'missing_pairing_code', message: 'pairingCode is required' },
    }, 400)
  }

  let redeemed
  try {
    redeemed = redeemPairingCode(pairingCode)
  } catch (err) {
    if (err instanceof PairingCodeError) {
      return jsonResponse({
        ok: false,
        error: { code: err.code, message: err.message },
      }, 400)
    }
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({
      ok: false,
      error: { code: 'pairing_code_invalid', message },
    }, 400)
  }

  let deviceToken: string
  try {
    deviceToken = issueDeviceToken({
      browserSessionId: redeemed.browserSessionId,
      worldId: redeemed.worldId,
      scopes: redeemed.scopes,
      agentLabel,
    })
  } catch (err) {
    if (err instanceof RelayAuthError) {
      console.error('[/api/relay/devices/exchange] issue failed', { code: err.code })
      // Don't echo `missing_signing_key` etc. to the public — it confirms
      // a misconfigured deploy. Map all auth-config errors to a generic shape.
      return jsonResponse({
        ok: false,
        error: { code: 'server_misconfigured', message: 'token issuer is unavailable' },
      }, 500)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/relay/devices/exchange] issue failed', { code: 'issue_failed', snippet: message.slice(0, 160) })
    return jsonResponse({
      ok: false,
      error: { code: 'issue_failed', message: 'failed to issue device token' },
    }, 500)
  }

  return jsonResponse({
    ok: true,
    deviceToken,
    browserSessionId: redeemed.browserSessionId,
    worldId: redeemed.worldId,
    scopes: redeemed.scopes,
  })
}
