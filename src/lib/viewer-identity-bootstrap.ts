// VIEWER IDENTITY - client-side bootstrap.
//
// Calls /api/viewer/me once on app load so hosted visitors get a stable
// `oasis-viewer-id` cookie. In local mode the same route normalizes stale
// viewer-* cookies back to `local-user`.

const BOOTSTRAP_KEY = '__oasis_viewer_bootstrap_fired__'
export const VIEWER_IDENTITY_EVENT = 'oasis:viewer-identity'

function publishViewerIdentity(viewerId: string | null): void {
  if (!viewerId || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(VIEWER_IDENTITY_EVENT, { detail: { viewerId } }))
}

export async function ensureViewerCookie(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>

  if (w[BOOTSTRAP_KEY] !== undefined) {
    const id = w[BOOTSTRAP_KEY] as string | null
    publishViewerIdentity(id)
    return id
  }

  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
    const res = await fetch(`${base}/api/viewer/me`, { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as { viewerId?: string }
    const id = typeof data.viewerId === 'string' ? data.viewerId : null
    w[BOOTSTRAP_KEY] = id
    publishViewerIdentity(id)
    return id
  } catch {
    return null
  }
}
