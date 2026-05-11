'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Client Providers — passthrough + viewer-cookie bootstrap + thumb queue.
// ─═̷─═̷─🪞─═̷─═̷─ Every browser gets a stable oasis-viewer-id ─═̷─═̷─🪞─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect } from 'react'
import { ensureViewerCookie } from '@/lib/viewer-identity-bootstrap'
import { useUnifiedThumbnailQueue } from '@/hooks/useUnifiedThumbnailQueue'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void ensureViewerCookie()
  }, [])
  // ░▒▓ Global thumbnail orchestrator — fires once per app mount, persists
  // for the session. Renders missing catalog/conjured thumbnails in the
  // background and bumps the store's per-asset version so <img> src tags
  // can cache-bust the browser's 404 cache. ▓▒░
  useUnifiedThumbnailQueue()
  return <>{children}</>
}
