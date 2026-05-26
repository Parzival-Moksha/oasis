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
  // ░▒▓ Opt-in thumbnail orchestrator — disabled for regular visitors so
  // Portal Zero does not spend startup time rendering background GLBs. ▓▒░
  useUnifiedThumbnailQueue()
  return <>{children}</>
}
