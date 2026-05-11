// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIEWER IDENTITY (client-only) — Read `oasis-viewer-id` from the browser
// ─═̷─═̷─🪞─═̷─═̷─ Split from viewer-identity.ts so client code doesn't pull
// in `next/headers` (server-only) via bundle inclusion. ─═̷─═̷─🪞─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

export const VIEWER_COOKIE = 'oasis-viewer-id'
export const VIEWER_FALLBACK = 'local-user'

function isValidViewerId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && /^[A-Za-z0-9_-]+$/.test(value)
}

/** Synchronous client-side read of the viewer cookie. Returns VIEWER_FALLBACK
 *  if `document` is unavailable (SSR) or the cookie is missing. Safe to call
 *  from any client component, store action, or browser event handler. */
export function getViewerUserIdClient(): string {
  if (typeof document === 'undefined') return VIEWER_FALLBACK
  const match = document.cookie.match(/(?:^|;\s*)oasis-viewer-id=([^;]+)/)
  if (!match) return VIEWER_FALLBACK
  try {
    const decoded = decodeURIComponent(match[1])
    return isValidViewerId(decoded) ? decoded : VIEWER_FALLBACK
  } catch {
    return VIEWER_FALLBACK
  }
}
