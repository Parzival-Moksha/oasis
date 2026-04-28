/**
 * GET /api/session/init
 *
 * Idempotent endpoint that ensures the caller has a valid `oasis_session`
 * cookie. If the request already carries one, the existing browserSessionId
 * is echoed back. If not, a new id is minted, the cookie is stamped, and
 * the new id is returned.
 *
 * Why a route instead of middleware:
 *   - Next 14 middleware runs on Edge runtime, which lacks `node:crypto`.
 *     A Node-runtime route lets us share `lib/relay/auth.ts` between Next
 *     and the relay sidecar without a Web-Crypto fork.
 *   - The browser calls this exactly once per session (on app boot),
 *     before any flow that needs identity (pairing, WS upgrade).
 */

import { NextRequest } from 'next/server'

import {
  SESSION_COOKIE_MAX_AGE_S,
  SESSION_COOKIE_NAME,
  getOasisMode,
  mintSessionCookieValue,
  readBrowserSession,
} from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function jsonWithCookie(payload: unknown, cookieValue?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (cookieValue) {
    const attrs = [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
      `Path=/`,
      `Max-Age=${SESSION_COOKIE_MAX_AGE_S}`,
      `SameSite=Lax`,
      `HttpOnly`,
    ]
    if (getOasisMode() === 'hosted') attrs.push('Secure')
    headers.set('set-cookie', attrs.join('; '))
  }
  return new Response(JSON.stringify(payload), { status: 200, headers })
}

export async function GET(request: NextRequest) {
  const existing = readBrowserSession(request)
  if (existing) {
    return jsonWithCookie({
      ok: true,
      browserSessionId: existing.browserSessionId,
      minted: false,
    })
  }
  const minted = mintSessionCookieValue()
  return jsonWithCookie(
    {
      ok: true,
      browserSessionId: minted.browserSessionId,
      minted: true,
    },
    minted.cookieValue,
  )
}
