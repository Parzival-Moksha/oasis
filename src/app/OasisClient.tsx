'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS CLIENT — Local-first. No auth. No routing. Just mount.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useOasisStore } from '@/store/oasisStore'
import { registerStoreHandler } from '@/lib/event-bus'
import { registerAudioSubscriber } from '@/lib/audio-manager'
import {
  DEFAULT_LOCAL_CAPABILITIES,
  OasisModeProvider,
  type ClientOasisCapabilities,
  type ClientOasisMode,
} from '@/lib/oasis-mode-client'

const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
  loading: () => null,
})

export default function OasisClient() {
  const worldReady = useOasisStore(s => s._worldReady)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<ClientOasisMode>('local')
  const [capabilities, setCapabilities] = useState<ClientOasisCapabilities>(DEFAULT_LOCAL_CAPABILITIES)

  useEffect(() => {
    let cancelled = false
    // Register EventBus → oasisStore bridge
    // registerStoreHandler() handles its own dedup — safe to call on remount (HMR/StrictMode)
    const unregisterStore = registerStoreHandler()
    const unregisterAudio = registerAudioSubscriber()

    // Strip any stale URL params
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    fetch('/api/session/init', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.json().catch(() => null))
      .then(json => {
        if (cancelled) return
        const nextMode = json?.mode === 'hosted' ? 'hosted' : 'local'
        setMode(nextMode)
        if (json?.capabilities && typeof json.capabilities === 'object') {
          setCapabilities(json.capabilities)
        }
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
      unregisterStore()
      unregisterAudio()
    }
  }, [])

  if (!ready) {
    return <main className="w-full h-screen bg-black" />
  }

  const showLoading = !worldReady && !viewingWorldMeta

  return (
    <OasisModeProvider mode={mode} capabilities={capabilities}>
    <main className="w-full h-screen bg-black">
      <Scene />

      {showLoading && (
        <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center pointer-events-none">
          <div className="text-gray-600 text-sm animate-pulse font-mono tracking-wider">
            loading world...
          </div>
        </div>
      )}
    </main>
    </OasisModeProvider>
  )
}
