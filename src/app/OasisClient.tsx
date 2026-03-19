'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS CLIENT — Local-first. No auth. No routing. Just mount.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { RealmSelector } from '@/components/realms/RealmSelector'
import { useOasisStore } from '@/store/oasisStore'

const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
  loading: () => null,
})

export default function OasisClient() {
  const worldReady = useOasisStore(s => s._worldReady)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const [ready, setReady] = useState(false)
  const initDone = useRef(false)

  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    // Strip any stale URL params (leftover from SaaS-era redirects)
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    setReady(true)
  }, [])

  if (!ready) {
    return <main className="w-full h-screen bg-black" />
  }

  const showLoading = !worldReady && !viewingWorldMeta

  return (
    <main className="w-full h-screen bg-black">
      <Scene />

      {showLoading && (
        <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center pointer-events-none">
          <div className="text-gray-600 text-sm animate-pulse font-mono tracking-wider">
            loading world...
          </div>
        </div>
      )}

      <RealmSelector />

      <div className="ui-overlay bottom-4 left-1/2 -translate-x-1/2">
        <p className="text-xs text-gray-600 text-center">
          Drag to orbit • Scroll to zoom • Click to interact
        </p>
      </div>
    </main>
  )
}
