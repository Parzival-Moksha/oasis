'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS CLIENT — Local-first. No auth. No routing. Just mount.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { RealmSelector } from '@/components/realms/RealmSelector'
import { useOasisStore } from '@/store/oasisStore'
import { registerStoreHandler } from '@/lib/event-bus'
import { registerAudioSubscriber } from '@/lib/audio-manager'

const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
  loading: () => null,
})

export default function OasisClient() {
  const worldReady = useOasisStore(s => s._worldReady)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Register EventBus → oasisStore bridge
    // registerStoreHandler() handles its own dedup — safe to call on remount (HMR/StrictMode)
    const unregisterStore = registerStoreHandler()
    const unregisterAudio = registerAudioSubscriber()

    // Strip any stale URL params
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    setReady(true)
    return () => { unregisterStore(); unregisterAudio() }
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

    </main>
  )
}
