'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS CLIENT — routing + scene mount
// Receives server-resolved props → applies Zustand state → mounts Scene.
// Scene only mounts AFTER routing decision = no forge flash.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { RealmSelector } from '@/components/realms/RealmSelector'
import { useOasisStore } from '@/store/oasisStore'

// Dynamic import to avoid SSR issues with Three.js
const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
  loading: () => null,  // No overlay — scene renders progressively on black bg
})

interface OasisClientProps {
  initialViewWorld: string | null   // ?view= param (anon or auth)
  initialSwitchWorld: string | null // ?world= param (auth only)
  isAuthenticated: boolean          // from server-side auth()
  defaultNewUserWorld: string | null // admin-configured first-visit world
}

export default function OasisClient({
  initialViewWorld,
  initialSwitchWorld,
  isAuthenticated,
  defaultNewUserWorld,
}: OasisClientProps) {
  const switchWorld = useOasisStore(s => s.switchWorld)
  const enterViewMode = useOasisStore(s => s.enterViewMode)
  const worldReady = useOasisStore(s => s._worldReady)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const routeHandled = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (routeHandled.current) return
    routeHandled.current = true

    if (initialViewWorld) {
      // View someone else's world (anon gets read-only, auth gets allowEdit based on visibility)
      enterViewMode(initialViewWorld, isAuthenticated)
    } else if (initialSwitchWorld) {
      // Authenticated user switching to own world via ?world=
      const registry = useOasisStore.getState().worldRegistry
      if (registry.some(w => w.id === initialSwitchWorld)) {
        switchWorld(initialSwitchWorld)
      }
    } else if (isAuthenticated) {
      // Authenticated user, no params — check if first visit
      const hasVisited = localStorage.getItem('oasis-has-visited')
      if (!hasVisited && defaultNewUserWorld) {
        localStorage.setItem('oasis-has-visited', '1')
        enterViewMode(defaultNewUserWorld)
      }
      // else: returning user — activeWorldId loaded from store (localStorage)
    }

    // Strip URL params after processing (prevents re-trigger on refresh)
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    setReady(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally runs once

  // Before routing resolves: black screen (same as canvas bg, no flash)
  if (!ready) {
    return <main className="w-full h-screen bg-black" />
  }

  // World loaded: _worldReady (own world) or viewingWorldMeta set (view mode, even read-only)
  const showLoading = !worldReady && !viewingWorldMeta

  return (
    <main className="w-full h-screen bg-black">
      <Scene />

      {/* Loading overlay — hides forge flash while world loads from Supabase */}
      {showLoading && (
        <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center pointer-events-none">
          <div className="text-gray-600 text-sm animate-pulse font-mono tracking-wider">
            loading world...
          </div>
        </div>
      )}

      {/* Realm selector — top center (also serves as exit from view mode) */}
      <RealmSelector />

      {/* Controls hint - bottom center */}
      <div className="ui-overlay bottom-4 left-1/2 -translate-x-1/2">
        <p className="text-xs text-gray-600 text-center">
          Drag to orbit • Scroll to zoom • Click to interact
        </p>
      </div>
    </main>
  )
}
