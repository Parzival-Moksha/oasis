'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  DEFAULT_PORTAL_TRANSITION_SETTINGS,
  PORTAL_TRANSITION_START_EVENT,
  normalizePortalTransitionSettings,
  type PortalTransitionEffect,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'
import { WormholeCanvas, type WormholeVariant } from './WormholeCanvas'

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

function phaseFor(settings: PortalTransitionSettings, elapsedSeconds: number): PhaseInfo {
  const swallowEnd = settings.swallowSeconds
  const tunnelEnd = swallowEnd + settings.tunnelSeconds
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
    return {
      phase: 'tunnel',
      progress: Math.min(1, (elapsedSeconds - swallowEnd) / Math.max(0.001, settings.tunnelSeconds)),
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
    case 'glass-shatter':
      return `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.2 + alpha * 0.18}) 0%, rgba(103,232,249,${0.24 + alpha * 0.22}) 18%, rgba(9,18,32,0.82) 55%, rgba(0,0,0,0.96) 100%)`
    case 'prism-burst':
      return `radial-gradient(circle at 50% 50%,
        rgba(255,255,255,${0.45 + alpha * 0.3}) 0%,
        rgba(186,230,253,${0.3 + alpha * 0.22}) 14%,
        rgba(167,139,250,${0.26 + alpha * 0.2}) 32%,
        rgba(2,6,23,0.78) 64%,
        rgba(0,0,0,0.96) 100%)`
    case 'wireframe-wormhole':
      return `radial-gradient(ellipse at 50% 50%,
        rgba(34,211,238,${0.28 + alpha * 0.22}) 0%,
        rgba(8,28,52,0.88) 28%,
        rgba(2,6,23,0.96) 70%,
        rgba(0,0,0,1) 100%)`
    case 'cosmic-wormhole':
      return `radial-gradient(circle at 50% 50%,
        rgba(255,255,255,${0.18 + alpha * 0.18}) 0%,
        rgba(168,85,247,${0.32 + alpha * 0.22}) 8%,
        rgba(67,56,202,${0.42 + alpha * 0.18}) 22%,
        rgba(8,4,30,0.88) 58%,
        rgba(0,0,0,0.98) 100%)`
    case 'plasma-wormhole':
      return `radial-gradient(circle at 50% 50%,
        rgba(255,255,255,${0.55 + alpha * 0.32}) 0%,
        rgba(125,211,252,${0.42 + alpha * 0.28}) 7%,
        rgba(37,99,235,${0.36 + alpha * 0.18}) 22%,
        rgba(8,12,40,0.88) 60%,
        rgba(0,0,0,0.98) 100%)`
    case 'datawave-wormhole':
      return `radial-gradient(circle at 50% 50%,
        rgba(74,222,128,${0.24 + alpha * 0.18}) 0%,
        rgba(6,46,28,0.78) 28%,
        rgba(0,12,6,0.94) 70%,
        rgba(0,0,0,1) 100%)`
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

function WireframeWormhole({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  // Concentric perspective rings flying past the camera. Each ring is sized via
  // exponential depth, hue-shifted, and gets a magenta/cyan double-stroke for that
  // Tron-grid pop. Cheap: pure DOM border-rings, no SVG.
  const ringCount = 14
  const rings = useMemo(() => Array.from({ length: ringCount }, (_, index) => index), [])
  const reveal = phase === 'reveal' ? 1 - progress : 1
  const speed = settings.particleSpeed * 1.6
  const baseTilt = 6 * Math.sin(tick * 0.6) * settings.intensity

  // Radial spokes that radiate from center to give the lattice feel.
  const spokes = 24
  return (
    <div style={{ ...RENDERLESS_OVERLAY, perspective: '1000px', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `rotateX(${baseTilt}deg) rotateY(${baseTilt * -0.4}deg) rotateZ(${tick * 6}deg)`,
        }}
      >
        {/* spokes */}
        {Array.from({ length: spokes }, (_, i) => {
          const angle = (i / spokes) * 360
          return (
            <i
              key={`spoke-${i}`}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: '2px',
                height: '120vmax',
                background: i % 2 === 0
                  ? 'linear-gradient(180deg, rgba(34,211,238,0) 0%, rgba(34,211,238,0.65) 38%, rgba(236,72,153,0.85) 60%, rgba(236,72,153,0) 100%)'
                  : 'linear-gradient(180deg, rgba(34,211,238,0) 0%, rgba(125,211,252,0.45) 50%, rgba(34,211,238,0) 100%)',
                transformOrigin: '50% 0%',
                transform: `translate(-50%, 0) rotate(${angle}deg)`,
                opacity: (0.18 + (i % 3) * 0.08) * reveal,
                mixBlendMode: 'screen',
                filter: 'blur(0.6px)',
              }}
            />
          )
        })}

        {/* rings — deeper rings smaller (further) and shift forward as tick advances */}
        {rings.map(i => {
          const t = ((tick * speed) + i) % ringCount
          const depth = t / ringCount // 0 = far, 1 = close
          const size = 6 + Math.pow(depth, 2.8) * 220 // exponential growth toward camera
          const ringOpacity = depth < 0.05
            ? depth / 0.05
            : depth > 0.92
              ? Math.max(0, (1 - depth) / 0.08)
              : 1
          const isMagenta = i % 2 === 0
          const stroke = isMagenta
            ? `0 0 ${10 + depth * 28}px rgba(236,72,153,${0.6 * ringOpacity}), inset 0 0 ${6 + depth * 16}px rgba(236,72,153,0.45)`
            : `0 0 ${12 + depth * 32}px rgba(34,211,238,${0.7 * ringOpacity}), inset 0 0 ${8 + depth * 18}px rgba(125,211,252,0.5)`
          return (
            <div
              key={`ring-${i}`}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: `${size}vmax`,
                height: `${size}vmax`,
                borderRadius: '50%',
                border: `${1.5 + depth * 1.5}px solid ${isMagenta ? 'rgba(236,72,153,0.9)' : 'rgba(34,211,238,0.9)'}`,
                transform: `translate(-50%, -50%)`,
                boxShadow: stroke,
                opacity: ringOpacity * (0.55 + depth * 0.45) * reveal,
                mixBlendMode: 'screen',
              }}
            />
          )
        })}

        {/* hot vanishing-point core */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '8vmax',
            height: '8vmax',
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(125,211,252,0.85) 35%, rgba(34,211,238,0) 75%)',
            boxShadow: '0 0 60px rgba(125,211,252,0.9), 0 0 120px rgba(34,211,238,0.5)',
            opacity: reveal,
            mixBlendMode: 'screen',
          }}
        />

        {/* sparse grid noise dots — adds parallax flecks */}
        {Array.from({ length: 32 }, (_, i) => {
          const angle = ((Math.sin(seed + i * 7.13) + 1) / 2) * 360
          const offset = ((Math.cos(seed * 1.7 + i * 4.3) + 1) / 2)
          const t = ((tick * speed * 0.8) + offset * ringCount + i * 0.3) % ringCount
          const depth = t / ringCount
          const size = 2 + Math.pow(depth, 2.4) * 14
          const distance = 4 + Math.pow(depth, 2.6) * 60
          return (
            <i
              key={`dot-${i}`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${Math.cos((angle * Math.PI) / 180) * distance}vmax)`,
                top: `calc(50% + ${Math.sin((angle * Math.PI) / 180) * distance}vmax)`,
                width: size,
                height: size,
                borderRadius: '50%',
                background: i % 3 === 0 ? 'rgba(236,72,153,0.95)' : 'rgba(125,211,252,0.95)',
                boxShadow: i % 3 === 0 ? '0 0 12px rgba(236,72,153,0.8)' : '0 0 12px rgba(125,211,252,0.8)',
                opacity: depth * reveal,
                mixBlendMode: 'screen',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function CosmicWormhole({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  const reveal = phase === 'reveal' ? 1 - progress : 1
  const speed = settings.particleSpeed * 1.4

  // Star streaks rushing past the camera + slow nebula clouds rotating behind.
  const streakCount = 120
  const streaks = useMemo(() => Array.from({ length: streakCount }, (_, index) => {
    const angle = (index / streakCount) * 360 + ((Math.sin(seed + index * 1.3) + 1) * 18)
    const offset = ((Math.cos(seed * 0.6 + index * 2.1) + 1) / 2)
    const length = 18 + ((index * 7) % 24) + offset * 18
    const tier = index % 3 // 0 = bright, 1 = medium, 2 = faint
    return { angle, offset, length, tier, hue: (index * 11 + seed * 31) % 360 }
  }), [seed])

  return (
    <div style={{ ...RENDERLESS_OVERLAY, overflow: 'hidden' }}>
      {/* nebula layer 1 */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          background: `conic-gradient(from ${tick * 18}deg at 50% 50%,
            rgba(168,85,247,0.55),
            rgba(236,72,153,0.32),
            rgba(67,56,202,0.7),
            rgba(14,165,233,0.45),
            rgba(168,85,247,0.55))`,
          mixBlendMode: 'screen',
          filter: 'blur(36px) saturate(1.4)',
          opacity: 0.7 * reveal,
          transform: `scale(${1.4 + Math.sin(tick * 0.4) * 0.08})`,
        }}
      />
      {/* nebula layer 2 — counter-rotating, brighter core */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.65) 0%, rgba(186,230,253,0.32) 6%, rgba(0,0,0,0) 28%),
            conic-gradient(from ${tick * -32}deg at 50% 50%, rgba(244,114,182,0.4), rgba(56,189,248,0.4), rgba(192,132,252,0.4), rgba(244,114,182,0.4))`,
          mixBlendMode: 'screen',
          filter: 'blur(18px)',
          opacity: 0.85 * reveal,
        }}
      />
      {/* star streaks — radial outward from center */}
      <div style={RENDERLESS_OVERLAY}>
        {streaks.map((s, i) => {
          // Each streak rides toward the camera: position pulses based on tick + offset
          const t = ((tick * speed * 0.6) + s.offset * 4) % 4
          const depth = t / 4
          const distance = Math.pow(depth, 2.4) * 60
          const opacity = depth < 0.06 ? depth / 0.06 : depth > 0.92 ? (1 - depth) / 0.08 : 1
          const baseColor = s.tier === 0
            ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 60%, rgba(255,255,255,0.95) 100%)'
            : s.tier === 1
              ? 'linear-gradient(90deg, rgba(186,230,253,0) 0%, rgba(186,230,253,0.95) 60%, rgba(244,114,182,0.85) 100%)'
              : 'linear-gradient(90deg, rgba(167,139,250,0) 0%, rgba(167,139,250,0.65) 60%, rgba(56,189,248,0.55) 100%)'
          return (
            <i
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: `${s.length * (0.4 + depth * 1.6)}vmax`,
                height: s.tier === 0 ? 2.5 : s.tier === 1 ? 1.8 : 1.2,
                background: baseColor,
                transformOrigin: '0 50%',
                transform: `rotate(${s.angle}deg) translateX(${distance}vmax)`,
                opacity: opacity * reveal,
                mixBlendMode: 'screen',
                filter: s.tier === 0 ? 'blur(0.4px)' : 'none',
                boxShadow: s.tier === 0 ? '0 0 6px rgba(255,255,255,0.9)' : 'none',
              }}
            />
          )
        })}
      </div>
      {/* far-back static stars (parallax) */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          backgroundImage: `radial-gradient(1px 1px at 16% 22%, white, transparent 60%),
            radial-gradient(1px 1px at 82% 14%, rgba(244,114,182,0.95), transparent 60%),
            radial-gradient(1.5px 1.5px at 33% 78%, white, transparent 60%),
            radial-gradient(1px 1px at 64% 41%, rgba(125,211,252,0.95), transparent 60%),
            radial-gradient(1px 1px at 12% 64%, white, transparent 60%),
            radial-gradient(1.5px 1.5px at 88% 88%, white, transparent 60%),
            radial-gradient(1px 1px at 48% 8%, rgba(255,255,255,0.9), transparent 60%)`,
          opacity: 0.8 * reveal,
          mixBlendMode: 'screen',
          transform: `scale(${1 + Math.sin(tick * 0.5) * 0.02})`,
        }}
      />
      {/* hot core */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '10vmax',
          height: '10vmax',
          borderRadius: '50%',
          transform: `translate(-50%, -50%) scale(${0.85 + Math.sin(tick * 4) * 0.08})`,
          background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(244,114,182,0.85) 28%, rgba(168,85,247,0.4) 55%, rgba(0,0,0,0) 80%)',
          boxShadow: '0 0 80px rgba(244,114,182,0.7), 0 0 160px rgba(168,85,247,0.5)',
          opacity: reveal,
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}

function PlasmaWormhole({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  // Electric arcs branching outward from a hot core. SVG paths are cheap and look great
  // for jagged lightning. We build a procedural zigzag path per arc, regenerated on tick
  // intervals so they "flicker".
  const reveal = phase === 'reveal' ? 1 - progress : 1
  const arcCount = 14
  // Quantize flicker to 18 bucket-frames per second so the SVG paths only regenerate
  // at the flicker rate, not every animation frame. ~3× cheaper at 60fps.
  const flickerBucket = Math.floor(tick * 18)

  const arcs = useMemo(() => {
    return Array.from({ length: arcCount }, (_, index) => {
      const angle = ((index / arcCount) * Math.PI * 2) + Math.sin(seed + index) * 0.3
      const segments = 8 + (index % 4)
      const points: Array<[number, number]> = [[50, 50]]
      for (let s = 1; s <= segments; s++) {
        const reach = (s / segments) * 70
        const wobble = Math.sin(seed * 0.3 + index * 1.7 + s * 4 + flickerBucket * 0.5) * 6
        const sideAngle = angle + (wobble / 90) * 0.4
        const x = 50 + Math.cos(sideAngle) * reach
        const y = 50 + Math.sin(sideAngle) * reach
        points.push([x, y])
      }
      const flicker = ((flickerBucket + index) % 7) === 0 ? 0.2 : 1
      return { points, flicker, hue: index % 3 }
    })
  }, [flickerBucket, seed])

  const speed = settings.particleSpeed * 1.5

  return (
    <div style={{ ...RENDERLESS_OVERLAY, overflow: 'hidden' }}>
      {/* pulsing electric haze */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.18 + Math.sin(tick * 24) * 0.05}) 0%, rgba(56,189,248,0.32) 14%, rgba(8,32,80,0.0) 48%)`,
          filter: 'blur(28px)',
          opacity: 0.8 * reveal,
          mixBlendMode: 'screen',
        }}
      />
      {/* arcing pulses — concentric ring shockwaves */}
      {Array.from({ length: 4 }, (_, i) => {
        const t = ((tick * speed * 0.5) + i * 0.25) % 1
        const size = 5 + t * 110
        return (
          <div
            key={`pulse-${i}`}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: `${size}vmax`,
              height: `${size}vmax`,
              borderRadius: '50%',
              border: '2px solid rgba(125,211,252,0.95)',
              boxShadow: '0 0 30px rgba(125,211,252,0.7), inset 0 0 24px rgba(56,189,248,0.55)',
              transform: 'translate(-50%, -50%)',
              opacity: (1 - t) * 0.85 * reveal,
              mixBlendMode: 'screen',
            }}
          />
        )
      })}
      {/* lightning arcs */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: reveal,
          mixBlendMode: 'screen',
          filter: 'drop-shadow(0 0 4px rgba(125,211,252,0.9)) drop-shadow(0 0 10px rgba(56,189,248,0.6))',
        }}
      >
        {arcs.map((arc, i) => {
          const d = arc.points
            .map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
            .join(' ')
          const stroke = arc.hue === 0 ? '#bae6fd' : arc.hue === 1 ? '#7dd3fc' : '#f0abfc'
          return (
            <g key={i} opacity={arc.flicker}>
              <path d={d} fill="none" stroke={stroke} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" stroke="white" strokeWidth={0.3} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}
      </svg>
      {/* hot core */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '12vmax',
          height: '12vmax',
          borderRadius: '50%',
          transform: `translate(-50%, -50%) scale(${0.8 + Math.sin(tick * 16) * 0.12})`,
          background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(186,230,253,0.85) 30%, rgba(56,189,248,0.4) 60%, rgba(0,0,0,0) 82%)',
          boxShadow: '0 0 90px rgba(186,230,253,0.95), 0 0 180px rgba(56,189,248,0.55)',
          opacity: reveal,
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}

const DATAWAVE_GLYPHS = '01∆◊∇⊕⌬⌘☰꧁꧂ﾐⱯⰰ⏣ZX'

function DatawaveWormhole({ tick, progress, phase, settings, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  settings: PortalTransitionSettings
  seed: number
}) {
  const reveal = phase === 'reveal' ? 1 - progress : 1
  const speed = settings.particleSpeed * 1.6

  const streamCount = 64
  const streams = useMemo(() => Array.from({ length: streamCount }, (_, index) => {
    const angle = (index / streamCount) * 360 + ((Math.sin(seed * 0.3 + index) + 1) * 6)
    const offset = ((Math.cos(seed * 0.7 + index * 1.7) + 1) / 2)
    const len = 20 + ((index * 13) % 30) + offset * 20
    const glyph = DATAWAVE_GLYPHS[(index + Math.floor(seed)) % DATAWAVE_GLYPHS.length]
    const tier = index % 4
    return { angle, offset, len, glyph, tier }
  }), [seed])

  // Chromatic glitch jitter — pulses 3-4 times per second
  const glitchBucket = Math.floor(tick * 7)
  const glitchOn = (glitchBucket % 11) === 0
  const glitchOffset = glitchOn ? (Math.sin(seed + glitchBucket * 3.7) * 4) : 0

  return (
    <div style={{ ...RENDERLESS_OVERLAY, overflow: 'hidden' }}>
      {/* dark subgrid background */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          backgroundImage: `repeating-linear-gradient(0deg, rgba(34,197,94,0.06) 0px, rgba(34,197,94,0.06) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 28px),
            repeating-linear-gradient(90deg, rgba(34,197,94,0.06) 0px, rgba(34,197,94,0.06) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 28px)`,
          opacity: 0.65 * reveal,
          transform: `translate(${Math.sin(tick * 1.3) * 4}px, ${tick * 26 % 28}px)`,
        }}
      />
      {/* radial scanline */}
      <div
        style={{
          ...RENDERLESS_OVERLAY,
          background: `repeating-conic-gradient(from ${tick * 60}deg at 50% 50%,
            rgba(34,197,94,0.45) 0deg,
            rgba(34,197,94,0) 1.2deg,
            rgba(0,0,0,0) 7deg)`,
          mixBlendMode: 'screen',
          opacity: 0.62 * reveal,
        }}
      />
      {/* glyph streams streaming outward */}
      <div style={RENDERLESS_OVERLAY}>
        {streams.map((s, i) => {
          const t = ((tick * speed * 0.55) + s.offset * 3 + i * 0.07) % 3
          const depth = t / 3
          const distance = Math.pow(depth, 2.4) * 58
          const opacity = depth < 0.06 ? depth / 0.06 : depth > 0.9 ? (1 - depth) / 0.1 : 1
          const color = s.tier === 0 ? '#bbf7d0' : s.tier === 1 ? '#4ade80' : s.tier === 2 ? '#22c55e' : '#16a34a'
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                color,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: `${0.6 + depth * 1.6}vmax`,
                letterSpacing: '0.3em',
                whiteSpace: 'nowrap',
                transformOrigin: '0 50%',
                transform: `rotate(${s.angle}deg) translateX(${distance}vmax) scaleX(${0.8 + depth * 1.4})`,
                opacity: opacity * reveal,
                textShadow: s.tier === 0 ? '0 0 6px rgba(187,247,208,0.95), 0 0 12px rgba(74,222,128,0.6)' : '0 0 4px rgba(74,222,128,0.6)',
                mixBlendMode: 'screen',
                userSelect: 'none',
              }}
            >
              {s.glyph} {s.glyph} {s.glyph}
            </span>
          )
        })}
      </div>
      {/* chromatic split overlay (red/blue split during glitch) */}
      {glitchOn && (
        <>
          <div
            style={{
              ...RENDERLESS_OVERLAY,
              background: 'radial-gradient(circle at 50% 50%, rgba(248,113,113,0.32) 0%, rgba(248,113,113,0) 38%)',
              transform: `translate(${glitchOffset}px, 0)`,
              mixBlendMode: 'screen',
            }}
          />
          <div
            style={{
              ...RENDERLESS_OVERLAY,
              background: 'radial-gradient(circle at 50% 50%, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 38%)',
              transform: `translate(${-glitchOffset}px, 0)`,
              mixBlendMode: 'screen',
            }}
          />
        </>
      )}
      {/* core */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '7vmax',
          height: '7vmax',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(187,247,208,1) 0%, rgba(74,222,128,0.7) 30%, rgba(22,163,74,0.4) 60%, rgba(0,0,0,0) 82%)',
          boxShadow: '0 0 50px rgba(74,222,128,0.85), 0 0 100px rgba(34,197,94,0.5)',
          opacity: reveal,
          mixBlendMode: 'screen',
        }}
      />
    </div>
  )
}

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

function GlassShatter({ progress, phase, seed, settings }: {
  progress: number
  phase: PhaseName
  seed: number
  settings: PortalTransitionSettings
}) {
  const shards = useMemo(() => Array.from({ length: 32 }, (_, index) => {
    const x = ((Math.sin(seed + index * 13.17) + 1) / 2) * 100
    const y = ((Math.cos(seed * 0.7 + index * 8.11) + 1) / 2) * 100
    return {
      x,
      y,
      w: 8 + ((index * 7) % 18),
      h: 8 + ((index * 11) % 22),
      rot: (index * 37 + seed) % 360,
      delay: (index % 9) / 9,
    }
  }), [seed])
  return (
    <div style={RENDERLESS_OVERLAY}>
      {shards.map((shard, index) => {
        const shardProgress = Math.max(0, Math.min(1, (progress - shard.delay * 0.16) / 0.84))
        return (
          <i
            key={index}
            style={{
              position: 'absolute',
              left: `${shard.x}%`,
              top: `${shard.y}%`,
              width: `${shard.w}vw`,
              height: `${shard.h}vh`,
              clipPath: 'polygon(12% 4%, 96% 22%, 68% 100%, 0 64%)',
              background: index % 3 === 0
                ? 'linear-gradient(135deg, rgba(255,255,255,0.85), rgba(103,232,249,0.18))'
                : 'linear-gradient(135deg, rgba(147,197,253,0.45), rgba(255,255,255,0.12))',
              border: '1px solid rgba(255,255,255,0.22)',
              transform: `translate3d(${(shard.x - 50) * shardProgress * 1.8}px, ${(shard.y - 50) * shardProgress * 1.4}px, 0) rotate(${shard.rot + shardProgress * 170}deg) scale(${0.4 + shardProgress * 1.1})`,
              opacity: (phase === 'reveal' ? 1 - progress : 1) * (0.18 + shardProgress * 0.68) * settings.intensity,
              filter: 'blur(0.4px)',
              mixBlendMode: 'screen',
            }}
          />
        )
      })}
    </div>
  )
}

function RootTendrils({ tick, progress, phase, seed }: {
  tick: number
  progress: number
  phase: PhaseName
  seed: number
}) {
  const tendrils = useMemo(() => Array.from({ length: 38 }, (_, index) => ({
    angle: (index / 38) * 360 + Math.sin(seed + index) * 18,
    length: 34 + ((index * 17) % 44),
    width: 3 + (index % 5),
    offset: 8 + ((index * 19) % 30),
    bend: Math.sin(seed * 0.2 + index * 2.4) * 24,
  })), [seed])
  return (
    <div style={RENDERLESS_OVERLAY}>
      {tendrils.map((tendril, index) => {
        const grow = phase === 'reveal' ? 1 - progress : Math.min(1, progress * 1.6)
        return (
          <i
            key={index}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: tendril.width,
              height: `${tendril.length}vh`,
              borderRadius: 999,
              background: index % 4 === 0
                ? 'linear-gradient(180deg, rgba(134,239,172,0.92), rgba(21,128,61,0.18))'
                : 'linear-gradient(180deg, rgba(54,83,59,0.95), rgba(2,20,10,0.2))',
              transformOrigin: '50% 0%',
              transform: `rotate(${tendril.angle + tendril.bend * Math.sin(tick * 3 + index)}deg) translateY(${tendril.offset}vh) scaleY(${grow})`,
              opacity: 0.18 + grow * 0.72,
              boxShadow: index % 5 === 0 ? '0 0 18px rgba(134,239,172,0.6)' : 'none',
            }}
          />
        )
      })}
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

  useEffect(() => {
    if (!active) return
    let frame = 0
    const loop = () => {
      const elapsedSeconds = (nowMs() - active.startedAt) / 1000
      const phase = phaseFor(active.settings, elapsedSeconds)
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
  const { phase, progress, effect, total } = phaseFor(settings, tick)
  const totalProgress = Math.min(1, tick / Math.max(0.001, total))
  const revealFade = phase === 'reveal' ? 1 - progress : 1
  // 'none' for a phase = skip the overlay entirely. Camera animations driven
  // by PortalGateLayer still run; we just don't paint anything on top.
  const opacity = effect === 'none'
    ? 0
    : Math.min(1, (phase === 'swallow' ? progress * 2.5 : 1) * revealFade)
  const shake = settings.shake * (phase === 'tunnel' ? 16 : 8) * Math.sin(tick * 38)
  const isWormhole = effect === 'wireframe-wormhole'
    || effect === 'cosmic-wormhole'
    || effect === 'plasma-wormhole'
    || effect === 'datawave-wormhole'
  const zoom = isWormhole
    ? 1.05 + progress * (phase === 'tunnel' ? 1.4 : 0.55) * settings.particleSpeed
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

      {effect === 'wireframe-wormhole' && (
        <WireframeWormhole tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'cosmic-wormhole' && (
        <CosmicWormhole tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'plasma-wormhole' && (
        <PlasmaWormhole tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'datawave-wormhole' && (
        <DatawaveWormhole tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'black-hole-pinch' && (
        <BlackHolePinch tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'prism-burst' && (
        <PrismBurst tick={tick} progress={progress} phase={phase} settings={settings} seed={active.seed} />
      )}
      {effect === 'glass-shatter' && (
        <GlassShatter progress={progress} phase={phase} seed={active.seed} settings={settings} />
      )}
      {effect === 'void-iris' && (
        <VoidIris phase={phase} progress={progress} effect={effect} />
      )}
    </div>
  )
}
