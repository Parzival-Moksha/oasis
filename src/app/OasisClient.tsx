'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS CLIENT — Local-first. No auth. No routing. Just mount.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useOasisStore } from '@/store/oasisStore'
import { registerStoreHandler } from '@/lib/event-bus'
import { registerAudioSubscriber } from '@/lib/audio-manager'
import { trackOasisEvent } from '@/lib/oasis-telemetry-client'
import {
  DEFAULT_LOCAL_CAPABILITIES,
  OasisModeProvider,
  type ClientOasisCapabilities,
  type ClientOasisMode,
} from '@/lib/oasis-mode-client'
import { SplashScreen } from '@/components/forge/splash/SplashScreen'
import { useSplashPreference } from '@/components/forge/splash/splash-preference'

const Scene = dynamic(() => import('@/components/Scene'), {
  ssr: false,
  loading: () => null,
})

export default function OasisClient({ initialWorldId }: { initialWorldId?: string }) {
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const enterViewMode = useOasisStore(s => s.enterViewMode)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<ClientOasisMode>('local')
  const [capabilities, setCapabilities] = useState<ClientOasisCapabilities>(DEFAULT_LOCAL_CAPABILITIES)
  const deepLinkHandledRef = useRef<string | null>(null)
  const sessionStartedAtRef = useRef<number>(Date.now())
  const lastVisitedWorldRef = useRef<string | null>(null)
  const latestSessionContextRef = useRef({
    activeWorldId: activeWorldId || null,
    mode,
    role: capabilities.role,
  })

  useEffect(() => {
    if (initialWorldId) window.__oasisPreferredWorldId = initialWorldId
    else delete window.__oasisPreferredWorldId
  }, [initialWorldId])

  useEffect(() => {
    let cancelled = false
    // Register EventBus → oasisStore bridge
    // registerStoreHandler() handles its own dedup — safe to call on remount (HMR/StrictMode)
    const unregisterStore = registerStoreHandler()
    const unregisterAudio = registerAudioSubscriber()

    // Strip stale URL params, but keep the explicit mobile test override alive.
    if (window.location.search) {
      const params = new URLSearchParams(window.location.search)
      const mobileOverride = params.get('mobile')
      if (mobileOverride === '1' || mobileOverride === '0') {
        window.localStorage.setItem('oasis-mobile-override', mobileOverride)
      }
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
    }

    // Kick off the Scene chunk download in parallel with session init. The
    // chunk normally starts fetching only when <Scene /> mounts; preloading
    // here typically shaves 100-300ms off cold-load time-to-playable.
    try {
      const sceneWithPreload = Scene as unknown as { preload?: () => void }
      sceneWithPreload.preload?.()
    } catch {}

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

  useEffect(() => {
    if (!ready || !initialWorldId || deepLinkHandledRef.current === initialWorldId || worldRegistry.length === 0) return
    if (activeWorldId === initialWorldId) {
      deepLinkHandledRef.current = initialWorldId
      return
    }

    const ownedWorld = worldRegistry.some(world => world.id === initialWorldId)
    deepLinkHandledRef.current = initialWorldId
    if (ownedWorld) {
      switchWorld(initialWorldId)
    } else {
      enterViewMode(initialWorldId, true)
    }
  }, [activeWorldId, enterViewMode, initialWorldId, ready, switchWorld, worldRegistry])

  useEffect(() => {
    latestSessionContextRef.current = {
      activeWorldId: activeWorldId || null,
      mode,
      role: capabilities.role,
    }
  }, [activeWorldId, capabilities.role, mode])

  useEffect(() => {
    if (!ready) return
    sessionStartedAtRef.current = Date.now()
    trackOasisEvent({
      eventType: 'session_start',
      worldId: activeWorldId,
      metadata: {
        mode,
        role: capabilities.role,
      },
    })

    const endSession = () => {
      const context = latestSessionContextRef.current
      trackOasisEvent({
        eventType: 'session_end',
        worldId: context.activeWorldId,
        durationMs: Date.now() - sessionStartedAtRef.current,
        metadata: {
          mode: context.mode,
          role: context.role,
        },
      }, { beacon: true })
    }

    window.addEventListener('pagehide', endSession)
    return () => {
      window.removeEventListener('pagehide', endSession)
      endSession()
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !activeWorldId || lastVisitedWorldRef.current === activeWorldId) return
    lastVisitedWorldRef.current = activeWorldId
    trackOasisEvent({
      eventType: 'world_visit',
      worldId: activeWorldId,
      metadata: {
        mode,
        role: capabilities.role,
      },
    })
  }, [activeWorldId, capabilities.role, mode, ready])

  const splashPref = useSplashPreference()
  const [splashFaded, setSplashFaded] = useState(false)
  const onSplashFadeComplete = useCallback(() => setSplashFaded(true), [])

  return (
    <OasisModeProvider mode={mode} capabilities={capabilities}>
      <main className="w-full h-screen bg-black">
        {/* Splash mounts first; fades out once `ready` flips true and its
            internal load-progress reaches 100%. Stays out of the React tree
            after the fade so it doesn't keep timers running. */}
        {!splashFaded && (
          <SplashScreen
            designId={splashPref.design}
            modelSlug={splashPref.model}
            ready={ready}
            holdMs={splashPref.holdMs}
            onFadeComplete={onSplashFadeComplete}
          />
        )}
        {/* Scene mounts in parallel. Its dynamic chunk + Three.js asset loads
            are reflected in the splash bar via THREE.DefaultLoadingManager. */}
        {ready && <Scene />}
      </main>
    </OasisModeProvider>
  )
}
