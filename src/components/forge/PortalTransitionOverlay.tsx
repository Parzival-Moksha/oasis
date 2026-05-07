'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  DEFAULT_PORTAL_TRANSITION_SETTINGS,
  PORTAL_TRANSITION_START_EVENT,
  normalizePortalTransitionSettings,
  type PortalTransitionEffect,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'
import { WormholeCanvas, type WormholeVariant } from './WormholeCanvas'
import { getWorldLoadState, subscribeWorldLoad } from '../../lib/world-load-progress'

const WEBGL_WORMHOLE_VARIANTS: PortalTransitionEffect[] = [
  'bobbyroe-wormhole',
  'infinite-tubes',
  'wormhole-extreme',
  'tsl-vortex',
]
function isWebglWormhole(effect: PortalTransitionEffect): effect is WormholeVariant {
  return WEBGL_WORMHOLE_VARIANTS.includes(effect)
}

interface PortalTransitionStartDetail {
  settings?: Partial<PortalTransitionSettings>
  gateLabel?: string
  targetWorldName?: string
}

interface ActiveTransition {
  startedAt: number
  seed: number
  settings: PortalTransitionSettings
}

type PhaseName = 'swallow' | 'tunnel' | 'reveal'

interface PhaseInfo {
  phase: PhaseName
  progress: number
  effect: PortalTransitionEffect
  total: number
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// Phase boundaries can extend at run-time when the target world is still
// loading (worldLoading=true). The tunnel phase is held open until either
//   (a) the manager flips idle (all GLB/HDRI/texture URLs resolved), OR
//   (b) the safety cap LOAD_GATED_TUNNEL_MAX_S is hit — failsafe so a stuck
//       loader doesn't trap the player in the tunnel forever.
const LOAD_GATED_TUNNEL_MAX_S = 18
function phaseFor(settings: PortalTransitionSettings, elapsedSeconds: number, worldLoading: boolean): PhaseInfo {
  const swallowEnd = settings.swallowSeconds
  const tunnelMinEnd = swallowEnd + settings.tunnelSeconds
  const tunnelHardCap = swallowEnd + LOAD_GATED_TUNNEL_MAX_S
  // Effective tunnel end: extends past the slider's tunnelSeconds while the
  // load manager still has work in flight, capped by the hard safety value.
  const tunnelEnd = worldLoading
    ? Math.min(tunnelHardCap, Math.max(tunnelMinEnd, elapsedSeconds + 0.05))
    : tunnelMinEnd
  const total = tunnelEnd + settings.revealSeconds

  if (elapsedSeconds < swallowEnd) {
    return {
      phase: 'swallow',
      progress: Math.min(1, elapsedSeconds / Math.max(0.001, settings.swallowSeconds)),
      effect: settings.swallowEffect,
      total,
    }
  }

  if (elapsedSeconds < tunnelEnd) {
    // Progress within the tunnel: when load-gated, lock at 0.95 so the visual
    // doesn't keep drifting past 100% mid-flight; once load is done it
    // resumes natural ramp toward 1.
    const naturalProgress = (elapsedSeconds - swallowEnd) / Math.max(0.001, settings.tunnelSeconds)
    const progress = worldLoading ? Math.min(0.95, naturalProgress) : Math.min(1, naturalProgress)
    return {
      phase: 'tunnel',
      progress,
      effect: settings.tunnelEffect,
      total,
    }
  }

  return {
    phase: 'reveal',
    progress: Math.min(1, (elapsedSeconds - tunnelEnd) / Math.max(0.001, settings.revealSeconds)),
    effect: settings.revealEffect,
    total,
  }
}

function ambientBackground(effect: PortalTransitionEffect, phase: PhaseName, progress: number, settings: PortalTransitionSettings): string {
  const alpha = Math.min(1, settings.intensity * 0.44)
  switch (effect) {
    case 'void-iris':
      return `radial-gradient(circle at 50% 50%, rgba(0,0,0,${phase === 'swallow' ? 0.98 : 0.82}) 0%, rgba(5,3,11,0.94) ${28 + progress * 18}%, rgba(79,70,229,${0.18 + alpha * 0.18}) 62%, rgba(0,0,0,0.96) 100%)`
    case 'black-hole-pinch':
      return `radial-gradient(circle at 50% 50%,
        rgba(255,250,235,${0.42 + alpha * 0.38}) 0%,
        rgba(255,168,72,${0.32 + alpha * 0.28}) 6%,
        rgba(225,72,12,${0.24 + alpha * 0.2}) 13%,
        rgba(20,4,0,0.92) 32%,
        rgba(0,0,0,0.98) 100%)`
    case 'prism-burst':
      return `radial-gradient(circle at 50% 50%,
        rgba(255,255,255,${0.45 + alpha * 0.3}) 0%,
        rgba(186,230,253,${0.3 + alpha * 0.22}) 14%,
        rgba(167,139,250,${0.26 + alpha * 0.2}) 32%,
        rgba(2,6,23,0.78) 64%,
        rgba(0,0,0,0.96) 100%)`
    case 'bobbyroe-wormhole':
    case 'infinite-tubes':
    case 'wormhole-extreme':
    case 'tsl-vortex':
      // WebGL variants render their own canvas above this layer; the ambient
      // backdrop just needs to be black so the canvas isn't bleed-through.
      return 'rgba(0,0,0,1)'
    case 'none':
      // Transparent — caller skips overlay rendering entirely for this phase.
      return 'rgba(0,0,0,0)'
  }
}

const RENDERLESS_OVERLAY: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' }

function BlackHolePinch({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  // Swallow effect: an accretion ring with rotating bright streaks pulls inward
  // while the screen pinches into the singularity. On reveal, we run it backward.
  const eaten = phase === 'swallow' ? progress : phase === 'tunnel' ? 1 : 1 - progress
  const ringRadius = 5 + (1 - eaten) * 36
  const lensSize = 2 + (1 - eaten) * 56
  const streakCount = 36
  const streaks = useMemo(() => Array.from({ length: streakCount }, (_, index) => ({
    angle: (index / streakCount) * 360 + ((Math.sin(seed + index) + 1) * 8),
    length: 14 + ((index * 9) % 22),
    tier: index % 3,
  })), [seed])

  return (
    <div style={{ ...RENDERLESS_OVERLAY, overflow: 'hidden' }}>
      {/* gravitational lens — screen edges pulled toward singularity */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          background: `radial-gradient(circle at 50% 50%,
            rgba(0,0,0,0) 0%,
            rgba(0,0,0,${Math.min(0.85, eaten * 1.4)}) ${30 + eaten * 30}%,
            rgba(0,0,0,1) 100%)`,
          transform: `scale(${1 + eaten * 0.4})`,
          opacity: 1,
        }}
      />
      {/* accretion ring — orange/red */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${ringRadius * 2}vmax`,
          height: `${ringRadius * 2}vmax`,
          borderRadius: '50%',
          transform: `translate(-50%, -50%) rotate(${tick * 90}deg)`,
          background: `conic-gradient(from 0deg,
            rgba(255,243,200,1) 0deg,
            rgba(251,146,60,0.95) 40deg,
            rgba(220,38,38,0.85) 90deg,
            rgba(120,8,8,0.65) 160deg,
            rgba(255,243,200,1) 250deg,
            rgba(251,146,60,0.9) 300deg,
            rgba(255,243,200,1) 360deg)`,
          maskImage: `radial-gradient(circle at 50% 50%,
            rgba(0,0,0,0) ${36 + eaten * 8}%,
            rgba(0,0,0,1) ${48 + eaten * 6}%,
            rgba(0,0,0,1) ${82 - eaten * 6}%,
            rgba(0,0,0,0) 100%)`,
          WebkitMaskImage: `radial-gradient(circle at 50% 50%,
            rgba(0,0,0,0) ${36 + eaten * 8}%,
            rgba(0,0,0,1) ${48 + eaten * 6}%,
            rgba(0,0,0,1) ${82 - eaten * 6}%,
            rgba(0,0,0,0) 100%)`,
          filter: 'blur(2px) saturate(1.4)',
          opacity: (1 - eaten * 0.4) * settings.intensity,
          mixBlendMode: 'screen',
        }}
      />
      {/* hot streaks spiraling inward */}
      <div style={RENDERLESS_OVERLAY}>
        {streaks.map((s, i) => {
          const swirl = (s.angle + tick * 220) % 360
          const reach = ringRadius + s.length * (1 - eaten * 0.4)
          return (
            <i
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: `${s.length * 0.4}vmax`,
                height: s.tier === 0 ? 2.4 : s.tier === 1 ? 1.6 : 1,
                background: s.tier === 0
                  ? 'linear-gradient(90deg, rgba(255,243,200,0) 0%, rgba(255,243,200,1) 70%, rgba(255,255,255,1) 100%)'
                  : 'linear-gradient(90deg, rgba(251,146,60,0) 0%, rgba(251,146,60,0.95) 70%, rgba(255,243,200,0.9) 100%)',
                transformOrigin: '0 50%',
                transform: `rotate(${swirl}deg) translateX(${reach * 0.7}vmax)`,
                opacity: (1 - eaten * 0.7) * settings.intensity,
                mixBlendMode: 'screen',
                filter: 'blur(0.6px)',
                boxShadow: '0 0 8px rgba(255,243,200,0.85)',
              }}
            />
          )
        })}
      </div>
      {/* singularity (black core) — grows as we get swallowed */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${lensSize}vmax`,
          height: `${lensSize}vmax`,
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 60%, rgba(40,8,0,0.85) 80%, rgba(255,168,72,0) 100%)',
          boxShadow: '0 0 80px rgba(0,0,0,0.95), 0 0 120px rgba(220,38,38,0.55)',
          opacity: Math.max(0.3, eaten),
        }}
      />
      {/* einstein ring photon flash near event horizon */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${lensSize + 4}vmax`,
          height: `${lensSize + 4}vmax`,
          borderRadius: '50%',
          transform: `translate(-50%, -50%)`,
          border: '1.5px solid rgba(255,243,200,0.95)',
          boxShadow: '0 0 40px rgba(255,243,200,0.85), inset 0 0 24px rgba(251,146,60,0.5)',
          opacity: (1 - eaten * 0.4) * settings.intensity,
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}

function PrismBurst({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  // Reveal explosion: chromatic aberration layers + lens-flare ray rake.
  // On swallow it implodes, on reveal it explodes.
  const burst = phase === 'reveal' ? progress : phase === 'tunnel' ? 0.3 : 1 - progress
  const aberration = (1 - Math.abs(burst - 0.5) * 2) * 30
  const reveal = phase === 'reveal' ? 1 - progress : 1

  const rays = useMemo(() => Array.from({ length: 18 }, (_, index) => ({
    angle: (index / 18) * 360 + ((Math.sin(seed + index) + 1) * 4),
    width: 6 + ((index * 5) % 12),
    tier: index % 3,
  })), [seed])

  return (
    <div style={{ ...RENDERLESS_OVERLAY, overflow: 'hidden' }}>
      {/* chromatic aberration triplet — RGB layers offset by `aberration` */}
      {[
        { color: 'rgba(248,113,113,0.55)', offset: aberration },
        { color: 'rgba(74,222,128,0.55)', offset: 0 },
        { color: 'rgba(96,165,250,0.55)', offset: -aberration },
      ].map((layer, idx) => (
        <div
          key={idx}
          style={{
            ...RENDERLESS_OVERLAY,
            background: `radial-gradient(circle at 50% 50%, ${layer.color} 0%, rgba(0,0,0,0) ${30 + burst * 50}%)`,
            transform: `translate3d(${layer.offset}px, ${layer.offset * 0.4}px, 0) scale(${0.7 + burst * 1.3})`,
            mixBlendMode: 'screen',
            opacity: reveal,
            filter: 'blur(2px)',
          }}
        />
      ))}
      {/* spectral conic ring — rainbow halo */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${10 + burst * 100}vmax`,
          height: `${10 + burst * 100}vmax`,
          borderRadius: '50%',
          transform: `translate(-50%, -50%) rotate(${tick * 80}deg)`,
          background: 'conic-gradient(from 0deg, #f87171, #fbbf24, #4ade80, #22d3ee, #818cf8, #f472b6, #f87171)',
          maskImage: `radial-gradient(circle at 50% 50%,
            rgba(0,0,0,0) ${Math.max(0, 38 - burst * 26)}%,
            rgba(0,0,0,1) ${Math.max(8, 48 - burst * 26)}%,
            rgba(0,0,0,1) ${Math.max(18, 60 - burst * 30)}%,
            rgba(0,0,0,0) ${Math.max(28, 72 - burst * 30)}%)`,
          WebkitMaskImage: `radial-gradient(circle at 50% 50%,
            rgba(0,0,0,0) ${Math.max(0, 38 - burst * 26)}%,
            rgba(0,0,0,1) ${Math.max(8, 48 - burst * 26)}%,
            rgba(0,0,0,1) ${Math.max(18, 60 - burst * 30)}%,
            rgba(0,0,0,0) ${Math.max(28, 72 - burst * 30)}%)`,
          filter: 'blur(8px) saturate(1.4)',
          opacity: (1 - Math.abs(burst - 0.5) * 1.6) * settings.intensity,
          mixBlendMode: 'screen',
        }}
      />
      {/* lens flare rays */}
      <div style={RENDERLESS_OVERLAY}>
        {rays.map((r, i) => (
          <i
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: `${50 + burst * 40}vmax`,
              height: `${r.width * 0.18}vmax`,
              background: r.tier === 0
                ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(186,230,253,0) 100%)'
                : r.tier === 1
                  ? 'linear-gradient(90deg, rgba(244,114,182,0) 0%, rgba(244,114,182,0.85) 50%, rgba(244,114,182,0) 100%)'
                  : 'linear-gradient(90deg, rgba(125,211,252,0) 0%, rgba(125,211,252,0.85) 50%, rgba(125,211,252,0) 100%)',
              transformOrigin: '50% 50%',
              transform: `translate(-50%, -50%) rotate(${r.angle + tick * 22}deg)`,
              opacity: (1 - Math.abs(burst - 0.5) * 1.8) * settings.intensity,
              mixBlendMode: 'screen',
              filter: 'blur(1.2px)',
            }}
          />
        ))}
      </div>
      {/* hot center bloom */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${10 + (1 - Math.abs(burst - 0.5) * 2) * 14}vmax`,
          height: `${10 + (1 - Math.abs(burst - 0.5) * 2) * 14}vmax`,
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(186,230,253,0.85) 32%, rgba(244,114,182,0.4) 60%, rgba(0,0,0,0) 82%)',
          boxShadow: '0 0 80px rgba(255,255,255,0.95), 0 0 160px rgba(244,114,182,0.6)',
          opacity: (1 - Math.abs(burst - 0.5) * 1.4) * settings.intensity,
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}

function VoidIris({ phase, progress, effect }: {
  phase: PhaseName
  progress: number
  effect: PortalTransitionEffect
}) {
  // The shrinking/growing black aperture is a leftover universal element used by void-iris.
  const blackoutSize = phase === 'swallow'
    ? 18 + progress * 78
    : phase === 'tunnel'
      ? 52 + Math.sin(progress * Math.PI) * 28
      : Math.max(0, 84 - progress * 90)

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${blackoutSize}vmax`,
        height: `${blackoutSize}vmax`,
        borderRadius: '50%',
        transform: `translate(-50%, -50%) rotate(${progress * -80}deg)`,
        background: effect === 'void-iris'
          ? 'radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.98) 48%, rgba(95,240,255,0.18) 62%, rgba(0,0,0,0) 72%)'
          : 'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.65) 46%, rgba(255,255,255,0.08) 57%, rgba(0,0,0,0) 72%)',
        boxShadow: effect === 'void-iris' ? '0 0 90px rgba(95,240,255,0.22)' : '0 0 80px rgba(255,255,255,0.16)',
      }}
    />
  )
}

export function PortalTransitionOverlay() {
  const [active, setActive] = useState<ActiveTransition | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<PortalTransitionStartDetail>).detail
      const settings = normalizePortalTransitionSettings(detail?.settings || DEFAULT_PORTAL_TRANSITION_SETTINGS)
      if (!settings.enabled) return
      setActive({
        startedAt: nowMs(),
        seed: Math.random() * 10000,
        settings,
      })
      setTick(0)
    }
    window.addEventListener(PORTAL_TRANSITION_START_EVENT, onStart)
    return () => window.removeEventListener(PORTAL_TRANSITION_START_EVENT, onStart)
  }, [])

  // Subscribe to the world-load manager. The tunnel phase is gated on this
  // — we keep the wormhole running until isLoading flips false.
  const [worldLoading, setWorldLoading] = useState(() => getWorldLoadState().isLoading)
  useEffect(() => subscribeWorldLoad(s => setWorldLoading(s.isLoading)), [])
  const worldLoadingRef = useRef(worldLoading)
  worldLoadingRef.current = worldLoading

  useEffect(() => {
    if (!active) return
    let frame = 0
    const loop = () => {
      const elapsedSeconds = (nowMs() - active.startedAt) / 1000
      const phase = phaseFor(active.settings, elapsedSeconds, worldLoadingRef.current)
      setTick(elapsedSeconds)
      if (elapsedSeconds < phase.total + 0.08) {
        frame = requestAnimationFrame(loop)
      } else {
        setActive(null)
      }
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [active])

  if (!active) return null

  const settings = active.settings
  const { phase, progress, effect, total } = phaseFor(settings, tick, worldLoading)
  const totalProgress = Math.min(1, tick / Math.max(0.001, total))
  const revealFade = phase === 'reveal' ? 1 - progress : 1
  // 'none' for a phase = skip the overlay entirely. Camera animations driven
  // by PortalGateLayer still run; we just don't paint anything on top.
  const opacity = effect === 'none'
    ? 0
    : Math.min(1, (phase === 'swallow' ? progress * 2.5 : 1) * revealFade)
  const shake = settings.shake * (phase === 'tunnel' ? 16 : 8) * Math.sin(tick * 38)
  const zoom = isWebglWormhole(effect)
    ? 1.0
    : effect === 'prism-burst'
      ? 1.02 + progress * 0.42
      : 1 + Math.sin(progress * Math.PI) * 0.12 * settings.intensity

  const layerStyle: CSSProperties = {
    position: 'absolute',
    inset: '-18%',
    background: ambientBackground(effect, phase, progress, settings),
    transform: `translate3d(${shake}px, ${-shake * 0.55}px, 0) scale(${zoom})`,
    filter: `saturate(${1.2 + settings.intensity * 0.8}) contrast(${1.05 + settings.intensity * 0.28}) blur(${phase === 'reveal' ? progress * 4 : 0}px)`,
    mixBlendMode: effect === 'void-iris' || effect === 'black-hole-pinch' || phase === 'swallow' ? 'normal' : 'screen',
  }

  return (
    <div
      data-portal-transition-overlay=""
      data-portal-transition-phase={phase}
      data-portal-transition-effect={effect}
      data-portal-transition-total={total.toFixed(2)}
      className="fixed inset-0 pointer-events-none z-[260] overflow-hidden"
      style={{
        opacity,
        background: phase === 'reveal' ? `rgba(0,0,0,${0.68 * (1 - progress)})` : 'rgba(0,0,0,0.08)',
        backdropFilter: `blur(${phase === 'tunnel' ? 3 + settings.intensity * 2 : progress * 2}px) hue-rotate(${totalProgress * 210}deg) saturate(${1 + settings.intensity * 0.55})`,
      }}
    >
      {/* WebGL wormhole variants run on a separate Three.js canvas overlaid
          full-screen. Mounted only during the tunnel phase so other phases
          stay on the cheaper CSS path. */}
      {phase === 'tunnel' && isWebglWormhole(effect) && (
        <WormholeCanvas
          variant={effect}
          intensity={settings.intensity}
          speed={settings.particleSpeed}
          hue={settings.wormholeHue}
          noiseAmp={settings.wormholeNoiseAmp}
          radius={settings.wormholeRadius}
          bob={settings.wormholeBob}
        />
      )}

      <div style={layerStyle} />

      {effect === 'black-hole-pinch' && (
        <BlackHolePinch tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'prism-burst' && (
        <PrismBurst tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'void-iris' && (
        <VoidIris phase={phase} progress={progress} effect={effect} />
      )}
    </div>
  )
}
