/**
 * Browser session helpers, the Next-side counterpart to `lib/relay/auth.ts`.
 *
 * Hosted OpenClaw mode gives every browser tab a signed `oasis_session`
 * cookie. Local mode still mints cookies for relay smoke tests, but route
 * ownership stays on the single local user.
 */

import type { NextRequest } from 'next/server'

import {
  newBrowserSessionId,
  signSessionCookie,
  verifySessionCookie,
} from './relay/auth'
import {
  getAdminUserId,
  isAdminAuthConfigured,
  readAdminSession,
} from './admin-auth'
import {
  getOasisMode,
  getOasisProfile,
  isHostedOasis,
  type OasisMode,
  type OasisProfile,
} from './oasis-profile'

export const SESSION_COOKIE_NAME = 'oasis_session'
export const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365 // one year
export const HOSTED_ANONYMOUS_USER_ID = 'hosted-anonymous'

export { getOasisMode, getOasisProfile, isHostedOasis }
export type { OasisMode, OasisProfile }

export interface VerifiedBrowserSession {
  browserSessionId: string
}

export type OasisRole = 'local' | 'hosted-user' | 'hosted-admin'

export interface OasisCapabilities {
  mode: OasisMode
  profile: OasisProfile
  role: OasisRole
  admin: boolean
  adminConfigured: boolean
  canSeeSettings: boolean
  canUseAdminPanels: boolean
  canUseAgentPanels: boolean
  canUseLocalPanels: boolean
  canUseFullWizard: boolean
}

/**
 * Parse a Cookie header (RFC 6265 shape: "a=1; b=2") and verify the embedded
 * `oasis_session` value. Returns null on absence or invalid signature.
 *
 * If the header contains multiple `oasis_session` cookies, honor the last one.
 * That mirrors how browsers re-issue a cookie at a more specific path and keeps
 * cookie rotation forgiving.
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
  try {
    value = decodeURIComponent(lastValue)
  } catch {
    return null
  }
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

export function isOasisAdmin(request: Request | NextRequest): boolean {
  return isHostedOasis() && Boolean(readAdminSession(request))
}

export function getOasisCapabilities(request?: Request | NextRequest): OasisCapabilities {
  const mode = getOasisMode()
  const profile = getOasisProfile()
  const admin = Boolean(request && isOasisAdmin(request))
  const local = mode === 'local'
  const role: OasisRole = local ? 'local' : admin ? 'hosted-admin' : 'hosted-user'
  return {
    mode,
    profile,
    role,
    admin,
    adminConfigured: isAdminAuthConfigured(),
    canSeeSettings: true,
    canUseAdminPanels: admin,
    canUseAgentPanels: local || admin,
    canUseLocalPanels: local || admin,
    canUseFullWizard: local || admin,
  }
}

/**
 * Return the user id to scope DB queries against.
 *
 * Local mode always resolves to `local-user`. Hosted mode resolves to the
 * verified browser session id and falls back to a non-owner anonymous identity
 * if the cookie is missing or invalid. Hosted routes that mutate user-owned
 * state should use `getRequiredOasisUserId` instead.
 */
export async function getOasisUserId(request: Request | NextRequest): Promise<string> {
  if (!isHostedOasis()) return 'local-user'
  if (isOasisAdmin(request)) return getAdminUserId()
  const session = readBrowserSession(request)
  return session?.browserSessionId ?? HOSTED_ANONYMOUS_USER_ID
}

/**
 * Return a route-scoped user id only when hosted identity is actually present.
 * Local mode remains the single-user cloneable app.
 */
export function getRequiredOasisUserId(request: Request | NextRequest): string | null {
  if (!isHostedOasis()) return 'local-user'
  if (isOasisAdmin(request)) return getAdminUserId()
  return readBrowserSession(request)?.browserSessionId ?? null
}

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
