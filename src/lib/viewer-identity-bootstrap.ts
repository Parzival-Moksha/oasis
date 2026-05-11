// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// VIEWER IDENTITY — Client-side bootstrap
// ─═̷─═̷─🪞─═̷─═̷─ Calls /api/viewer/me once on app load ─═̷─═̷─🪞─═̷─═̷─
//
// The server-side getViewerUserId() can only READ the cookie; setting it
// requires a Route Handler context. So we POKE /api/viewer/me from the
// browser on first paint to ensure every visitor has a stable cookie.
//
// Idempotent: if the cookie already exists, /api/viewer/me reads and returns
// it without changing anything.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

const BOOTSTRAP_KEY = '__oasis_viewer_bootstrap_fired__'

export async function ensureViewerCookie(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  // Once per page load is enough.
  if (w[BOOTSTRAP_KEY] !== undefined) {
    return w[BOOTSTRAP_KEY] as string | null
  }
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const res = await fetch(`${base}/api/viewer/me`, { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as { viewerId?: string }
    const id = typeof data.viewerId === 'string' ? data.viewerId : null
    w[BOOTSTRAP_KEY] = id
    return id
  } catch {
    return null
  }
}
