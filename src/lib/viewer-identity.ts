// VIEWER IDENTITY - cookie-backed browser identity for hosted Oasis.
//
// Hosted mode uses `oasis-viewer-id` as a stable per-browser owner stamp until
// real auth lands. Local mode deliberately resolves to `local-user` even if a
// stale viewer cookie exists, so a local checkout remains cloneable and keeps
// showing worlds/assets written before browser identity existed.
//
// Reads are cheap and safe from any server context. Writes only happen in a
// Route Handler, where Next.js allows cookies().set().

// VIEWER_COOKIE / VIEWER_FALLBACK / getViewerUserIdClient are re-exported here
// for back-compat with existing imports. next/headers is NOT imported at module
// top; see getCookies() below.
export { VIEWER_COOKIE, VIEWER_FALLBACK, getViewerUserIdClient } from './viewer-identity-client'
import { isHostedOasis } from './oasis-profile'
import { VIEWER_COOKIE, VIEWER_FALLBACK } from './viewer-identity-client'

async function getCookies() {
  const mod = await import('next/headers')
  return mod.cookies()
}

export const VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function isValidViewerId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function generateViewerId(): string {
  const rand = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return `viewer-${rand}`
}

/** Read the cookie-bound viewer id. Local mode always returns local-user. */
export async function getViewerUserId(): Promise<string> {
  if (!isHostedOasis()) return VIEWER_FALLBACK
  try {
    const c = await getCookies()
    const v = c.get(VIEWER_COOKIE)?.value
    if (isValidViewerId(v)) return v
  } catch {
    // Cookies API not available, e.g. during build.
  }
  return VIEWER_FALLBACK
}

/** Read-or-create the cookie and return the viewer id. Only call from a Route Handler. */
export async function ensureViewerUserId(): Promise<string> {
  const c = await getCookies()

  if (!isHostedOasis()) {
    c.set(VIEWER_COOKIE, VIEWER_FALLBACK, {
      httpOnly: false,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: VIEWER_COOKIE_MAX_AGE,
    })
    return VIEWER_FALLBACK
  }

  const existing = c.get(VIEWER_COOKIE)?.value
  if (isValidViewerId(existing)) return existing

  const fresh = generateViewerId()
  c.set(VIEWER_COOKIE, fresh, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIEWER_COOKIE_MAX_AGE,
  })
  return fresh
}
