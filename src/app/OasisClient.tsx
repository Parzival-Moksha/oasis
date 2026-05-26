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
const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export default function OasisClient({ initialWorldId, fallbackWorldId }: { initialWorldId?: string; fallbackWorldId?: string }) {
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const viewingWorldId = useOasisStore(s => s.viewingWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const switchWorld = useOasisStore(s => s.switchWorld)
  const enterViewMode = useOasisStore(s => s.enterViewMode)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<ClientOasisMode>('local')
  const [capabilities, setCapabilities] = useState<ClientOasisCapabilities>(DEFAULT_LOCAL_CAPABILITIES)
  const deepLinkAttemptRef = useRef<string | null>(null)
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
    const shortCode = new URLSearchParams(window.location.search).get('short')
    if (initialWorldId && shortCode && /^\d{4,6}$/.test(shortCode)) window.__oasisPreferredShortCode = shortCode
    else delete window.__oasisPreferredShortCode
    if (fallbackWorldId) window.__oasisFallbackWorldId = fallbackWorldId
    else delete window.__oasisFallbackWorldId
  }, [fallbackWorldId, initialWorldId])

  useEffect(() => {
    const shortCodes: Record<string, string> = {}
    for (const world of worldRegistry) {
      if (world.shortCode) shortCodes[world.id] = world.shortCode
    }
    window.__oasisWorldShortCodes = shortCodes
  }, [worldRegistry])

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
    if (!ready || !initialWorldId || worldRegistry.length === 0) return
    if (activeWorldId === initialWorldId || viewingWorldId === initialWorldId) {
      deepLinkAttemptRef.current = null
      return
    }

    const ownedWorld = worldRegistry.some(world => world.id === initialWorldId)
    const attemptKey = `${initialWorldId}:${activeWorldId || ''}:${viewingWorldId || ''}:${ownedWorld ? 'owned' : 'view'}`
    if (deepLinkAttemptRef.current === attemptKey) return
    deepLinkAttemptRef.current = attemptKey
    if (ownedWorld) {
      switchWorld(initialWorldId)
    } else {
      enterViewMode(initialWorldId, true)
    }
  }, [activeWorldId, enterViewMode, initialWorldId, ready, switchWorld, viewingWorldId, worldRegistry])

  useEffect(() => {
    if (!ready || !initialWorldId) return
    if (activeWorldId !== initialWorldId && viewingWorldId !== initialWorldId) return
    const shortCode = window.__oasisPreferredShortCode
    if (!shortCode || !/^\d{4,6}$/.test(shortCode)) return
    const expectedPath = `${OASIS_BASE}/${encodeURIComponent(shortCode)}`
    if (window.location.pathname === expectedPath || typeof window.history?.replaceState !== 'function') return
    try { window.history.replaceState({}, '', expectedPath + window.location.search + window.location.hash) } catch {}
  }, [activeWorldId, initialWorldId, ready, viewingWorldId])

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
