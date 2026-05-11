// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIEWER IDENTITY — Cookie-backed "who is this browser" for the hosted Oasis
// ─═̷─═̷─🪞─═̷─═̷─ Not real auth. Just a stable stamp per device. ─═̷─═̷─🪞─═̷─═̷─
//
// V1 of the asset library uses this in place of full OAuth. The cookie
// `oasis-viewer-id` carries a stable UUID per browser. When real auth lands
// (next-auth v5 already in deps), we map cookie-id -> user-id on first
// sign-in (one row claim) and the rest of the codebase keeps working
// because everything reads from getViewerUserId() / getLocalUserId().
//
// Reads are cheap and safe from any server context. Writes only happen
// in a Route Handler (where Next.js allows cookies().set()).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { cookies } from 'next/headers'

// VIEWER_COOKIE / VIEWER_FALLBACK are re-exported here for back-compat with
// existing imports. The client-safe variant lives in viewer-identity-client.ts
// so client bundles don't have to drag in next/headers.
export { VIEWER_COOKIE, VIEWER_FALLBACK, getViewerUserIdClient } from './viewer-identity-client'
import { VIEWER_COOKIE, VIEWER_FALLBACK } from './viewer-identity-client'

export const VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function isValidViewerId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function generateViewerId(): string {
  // Prefix makes these visually distinct from 'local-user' and from any
  // future numeric user IDs.
  const rand = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  return `viewer-${rand}`
}

/** Read the cookie-bound viewer id. Returns VIEWER_FALLBACK if missing.
 *  Does NOT write the cookie — see ensureViewerUserId() for that. Safe to
 *  call from any server context (Route Handler, Server Component, RSC). */
export async function getViewerUserId(): Promise<string> {
  try {
    const c = await cookies()
    const v = c.get(VIEWER_COOKIE)?.value
    if (isValidViewerId(v)) return v
  } catch {
    // Cookies API not available (e.g. during build) — fall back.
  }
  return VIEWER_FALLBACK
}

/** Read-or-create the cookie and return the viewer id. Only call from a
 *  Route Handler or Server Action — cookies().set() is forbidden elsewhere. */
export async function ensureViewerUserId(): Promise<string> {
  const c = await cookies()
  const existing = c.get(VIEWER_COOKIE)?.value
  if (isValidViewerId(existing)) return existing
  const fresh = generateViewerId()
  c.set(VIEWER_COOKIE, fresh, {
    httpOnly: false,    // client can read its own id (handy for UI banners)
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIEWER_COOKIE_MAX_AGE,
  })
  // ░▒▓ LOCAL-MODE FIRST-COOKIE MIGRATION ▓▒░
  // On a local install, any existing rows tagged `ownerId='local-user'` (from
  // the backfill or pre-cookie writes) should be claimed by the new viewer.
  // This preserves the single-user illusion on a freshly-bootstrapped local
  // dev install. Hosted mode skips this — local-user content there is system
  // /admin content; we don't auto-grant it to arbitrary visitors.
  if (process.env.OASIS_MODE !== 'hosted') {
    void claimLocalUserRowsTo(fresh).catch(err => {
      console.warn('[viewer-identity] local-mode claim failed:', err)
    })
  }
  return fresh
}

async function claimLocalUserRowsTo(newViewerId: string): Promise<void> {
  // Lazy-load Prisma to avoid pulling the DB into edge contexts that won't hit
  // this branch (most of viewer-identity is cookie-only).
  const { prisma } = await import('./db')
  const assetUpdate = prisma.asset.updateMany({
    where: { ownerId: VIEWER_FALLBACK },
    data: { ownerId: newViewerId },
  })
  const worldUpdate = prisma.world.updateMany({
    where: { userId: VIEWER_FALLBACK },
    data: { userId: newViewerId },
  })
  const [a, w] = await Promise.all([assetUpdate, worldUpdate])
  if (a.count || w.count) {
    console.log(`[viewer-identity] claimed ${a.count} Asset rows + ${w.count} World rows from '${VIEWER_FALLBACK}' to '${newViewerId}'`)
  }
}
