// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useLibraryCatalog — React hook over /api/library/list
// ─═̷─═̷─📚─═̷─═̷─ Replaces direct ASSET_CATALOG imports in the UI ─═̷─═̷─📚─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useState, useCallback } from 'react'
import type { LibraryAsset, AssetKind, AssetScope } from '../lib/forge/library/types'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

interface UseLibraryCatalogOptions {
  query?: string
  kind?: AssetKind
  scope?: AssetScope
  limit?: number
}

export function useLibraryCatalog(options: UseLibraryCatalogOptions = {}) {
  const { query, kind, scope, limit = 2000 } = options
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true)

    const params = new URLSearchParams()
    if (query) params.set('query', query)
    if (kind) params.set('kind', kind)
    if (scope) params.set('scope', scope)
    params.set('limit', String(limit))

    fetch(`${OASIS_BASE}/api/library/list?${params.toString()}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fetch failed')))
      .then((data: { assets?: LibraryAsset[] }) => {
        if (cancelled) return
        setAssets(Array.isArray(data.assets) ? data.assets : [])
      })
      .catch(err => {
        if (cancelled) return
        if (err.name !== 'AbortError') {
          console.warn('[useLibraryCatalog] fetch failed:', err)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true; ctrl.abort() }
  }, [query, kind, scope, limit, version])

  /** Re-run the fetch (useful after a delete or conjure completion). */
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return { assets, loading, refresh }
}
