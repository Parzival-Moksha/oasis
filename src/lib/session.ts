/**
 * Browser session helpers — the Next-side counterpart to `lib/relay/auth.ts`.
 *
 * In hosted mode (`OASIS_MODE=hosted`), every browser tab carries a signed
 * `oasis_session` cookie minted by the middleware on first visit. Relay
 * routes verify it to know which tab is making a request.
 *
 * In local mode, cookies are still minted (cheap, useful for the dev relay
 * smoke test) but world ownership and `getLocalUserId()` continue to return
 * `'local-user'` — we are not multi-tenanting world storage in v1.
 */

import type { NextRequest } from 'next/server'

import {
  newBrowserSessionId,
  signSessionCookie,
  verifySessionCookie,
} from './relay/auth'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = 'oasis_session'
export const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365 // one year

export type OasisMode = 'local' | 'hosted'

export function getOasisMode(): OasisMode {
  return process.env.OASIS_MODE === 'hosted' ? 'hosted' : 'local'
}

// ────────────────────────────────────────────────────────────────────────────
// Verified session
// ────────────────────────────────────────────────────────────────────────────

export interface VerifiedBrowserSession {
  browserSessionId: string
}

/**
 * Parse a Cookie header (RFC 6265 shape: "a=1; b=2") and verify the embedded
 * `oasis_session` value. Returns null on absence or invalid signature.
 *
 * If the header contains MULTIPLE `oasis_session` cookies (a sign of injection
 * or a misconfigured proxy), we honor the LAST one — that mirrors what most
 * browsers do when they re-issue a cookie at a more specific path. Returning
 * null on duplicates would also be defensible; last-match keeps things working
 * during a cookie rotation.
 */
export function readBrowserSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): VerifiedBrowserSession | null {
  if (!cookieHeader) return null
  let lastValue: string | null = null
  for (const piece of cookieHeader.split(';')) {
    const trimmed = piece.trim()
    if (!trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) continue
    const rawValue = trimmed.slice(SESSION_COOKIE_NAME.length + 1)
    if (!rawValue) continue
    lastValue = rawValue
  }
  if (!lastValue) return null
  let value: string
  try { value = decodeURIComponent(lastValue) } catch { return null }
  try {
    const payload = verifySessionCookie(value)
    return { browserSessionId: payload.bs }
  } catch {
    return null
  }
}

/** Convenience wrapper for Next request objects. */
export function readBrowserSession(
  request: Request | NextRequest,
): VerifiedBrowserSession | null {
  return readBrowserSessionFromCookieHeader(request.headers.get('cookie'))
}

// ────────────────────────────────────────────────────────────────────────────
// Mode-aware user id — the canonical identity helper for routes
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the user id to scope DB queries against.
 *
 *   - `OASIS_MODE !== 'hosted'`:   always `'local-user'` (preserves local behavior).
 *   - `OASIS_MODE === 'hosted'`:   the verified browserSessionId from the cookie.
 *                                   Falls back to `'local-user'` only if the cookie
 *                                   is missing or invalid — middleware-equivalent
 *                                   `/api/session/init` is supposed to mint one
 *                                   on first visit, so the fallback is a defense
 *                                   in depth, not a normal path.
 *
 * Use this in every API route that reads/writes per-user data (worlds,
 * profile, XP, conjured assets, etc.). For lib helpers that already accept
 * an explicit `userId` parameter, prefer threading the result of this
 * function through, rather than letting the lib fall back internally.
 */
export async function getOasisUserId(request: Request | NextRequest): Promise<string> {
  if (getOasisMode() !== 'hosted') return 'local-user'
  const session = readBrowserSession(request)
  return session?.browserSessionId ?? 'local-user'
}

// ────────────────────────────────────────────────────────────────────────────
// Cookie minting
// ────────────────────────────────────────────────────────────────────────────

export interface MintedSessionCookie {
  browserSessionId: string
  cookieValue: string
}

/** Generate a fresh browserSessionId and sign it. The caller stamps the cookie. */
export function mintSessionCookieValue(): MintedSessionCookie {
  const browserSessionId = newBrowserSessionId()
  const cookieValue = signSessionCookie(browserSessionId)
  return { browserSessionId, cookieValue }
}
