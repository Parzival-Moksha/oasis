'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  DEFAULT_PORTAL_TRANSITION_SETTINGS,
  PORTAL_TRANSITION_START_EVENT,
  normalizePortalTransitionSettings,
  type PortalTransitionEffect,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'

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

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function phaseFor(settings: PortalTransitionSettings, elapsedSeconds: number): { phase: PhaseName; progress: number; effect: PortalTransitionEffect; total: number } {
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

function layerBackground(effect: PortalTransitionEffect, phase: PhaseName, progress: number, settings: PortalTransitionSettings): string {
  const alpha = Math.min(1, settings.intensity * 0.44)
  if (effect === 'star-streak') {
    return `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.12 + alpha * 0.2}) 0%, rgba(42,188,255,${0.18 + alpha * 0.22}) 8%, rgba(0,0,0,0.92) 30%, rgba(1,5,16,0.98) 100%),
      repeating-conic-gradient(from ${progress * 900}deg, rgba(255,255,255,0.92) 0deg, rgba(74,222,255,0.06) 3deg, rgba(0,0,0,0) 9deg, rgba(0,0,0,0) 14deg)`
  }
  if (effect === 'glass-shatter') {
    return `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.2 + alpha * 0.18}) 0%, rgba(103,232,249,${0.24 + alpha * 0.22}) 18%, rgba(9,18,32,0.82) 55%, rgba(0,0,0,0.96) 100%)`
  }
  if (effect === 'clockwork-iris') {
    return `radial-gradient(circle at 50% 50%, rgba(0,0,0,${phase === 'reveal' ? 0.55 : 0.94}) 0%, rgba(0,0,0,0.88) 26%, rgba(72,40,0,0.64) 42%, rgba(0,0,0,0.96) 100%),
      repeating-conic-gradient(from ${progress * -520}deg, rgba(250,204,21,0.72) 0deg, rgba(250,204,21,0.08) 8deg, rgba(0,0,0,0.85) 14deg, rgba(0,0,0,0.9) 24deg)`
  }
  if (effect === 'root-tendrils') {
    return `radial-gradient(circle at 50% 50%, rgba(0,0,0,${0.72 + progress * 0.22}) 0%, rgba(5,46,22,0.88) 38%, rgba(0,0,0,0.96) 100%),
      conic-gradient(from ${progress * 120}deg, rgba(34,197,94,0.2), rgba(20,83,45,0.82), rgba(0,0,0,0.94), rgba(134,239,172,0.22))`
  }
  if (effect === 'rainbow-vortex') {
    return `radial-gradient(circle at 50% 50%, rgba(255,255,255,${0.1 + alpha * 0.2}) 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.86) 76%, rgba(0,0,0,0.96) 100%),
      conic-gradient(from ${progress * 980}deg, #ff2bd6, #4df4ff, #ffe66d, #7cff6b, #4e6bff, #ff2bd6)`
  }
  return `radial-gradient(circle at 50% 50%, rgba(0,0,0,${phase === 'swallow' ? 0.98 : 0.82}) 0%, rgba(5,3,11,0.94) ${28 + progress * 18}%, rgba(79,70,229,${0.18 + alpha * 0.18}) 62%, rgba(0,0,0,0.96) 100%)`
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

  const shards = useMemo(() => {
    const seed = active?.seed ?? 0
    return Array.from({ length: 32 }, (_, index) => {
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
    })
  }, [active?.seed])

  const tendrils = useMemo(() => {
    const seed = active?.seed ?? 0
    return Array.from({ length: 38 }, (_, index) => ({
      angle: (index / 38) * 360 + Math.sin(seed + index) * 18,
      length: 34 + ((index * 17) % 44),
      width: 3 + (index % 5),
      offset: 8 + ((index * 19) % 30),
      bend: Math.sin(seed * 0.2 + index * 2.4) * 24,
    }))
  }, [active?.seed])

  if (!active) return null

  const settings = active.settings
  const { phase, progress, effect, total } = phaseFor(settings, tick)
  const totalProgress = Math.min(1, tick / Math.max(0.001, total))
  const revealFade = phase === 'reveal' ? 1 - progress : 1
  const opacity = Math.min(1, (phase === 'swallow' ? progress * 2.5 : 1) * revealFade)
  const shake = settings.shake * (phase === 'tunnel' ? 16 : 8) * Math.sin(tick * 38)
  const zoom = effect === 'star-streak'
    ? 1.05 + progress * (phase === 'tunnel' ? 1.4 : 0.55) * settings.particleSpeed
    : effect === 'rainbow-vortex'
      ? 1.02 + progress * 0.42
      : 1 + Math.sin(progress * Math.PI) * 0.12 * settings.intensity

  const layerStyle: CSSProperties = {
    position: 'absolute',
    inset: '-18%',
    background: layerBackground(effect, phase, progress, settings),
    transform: `translate3d(${shake}px, ${-shake * 0.55}px, 0) scale(${zoom}) rotate(${progress * (effect === 'clockwork-iris' ? -70 : 70)}deg)`,
    filter: `saturate(${1.2 + settings.intensity * 0.8}) contrast(${1.05 + settings.intensity * 0.28}) blur(${phase === 'reveal' ? progress * 4 : 0}px)`,
    mixBlendMode: effect === 'void-iris' || phase === 'swallow' ? 'normal' : 'screen',
  }

  const blackoutSize = phase === 'swallow'
    ? 18 + progress * 78
    : phase === 'tunnel'
      ? 52 + Math.sin(progress * Math.PI) * 28
      : Math.max(0, 84 - progress * 90)

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[260] overflow-hidden"
      style={{
        opacity,
        background: phase === 'reveal' ? `rgba(0,0,0,${0.68 * (1 - progress)})` : 'rgba(0,0,0,0.08)',
        backdropFilter: `blur(${phase === 'tunnel' ? 3 + settings.intensity * 2 : progress * 2}px) hue-rotate(${totalProgress * 210}deg) saturate(${1 + settings.intensity * 0.55})`,
      }}
    >
      <style>{`
        @keyframes portal-vfx-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes portal-vfx-pulse { 0%, 100% { opacity: 0.38; } 50% { opacity: 1; } }
      `}</style>
      <div style={layerStyle} />

      {effect === 'star-streak' && (
        <div className="absolute inset-0">
          {Array.from({ length: 96 }, (_, index) => {
            const angle = (index / 96) * 360
            const length = 24 + (index % 13) * 5
            const speed = 18 + (index % 9) * 8
            return (
              <i
                key={index}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${length}vw`,
                  height: index % 4 === 0 ? 3 : 2,
                  background: index % 5 === 0 ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.95), rgba(103,232,249,0))' : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(74,222,255,0.72), rgba(255,255,255,0))',
                  transformOrigin: '0 50%',
                  transform: `rotate(${angle + progress * speed}deg) translateX(${progress * 44 * settings.particleSpeed}vw) scaleX(${0.7 + settings.particleSpeed * 0.45})`,
                  opacity: phase === 'reveal' ? 1 - progress : 0.28 + (index % 7) * 0.09,
                  mixBlendMode: 'screen',
                }}
              />
            )
          })}
        </div>
      )}

      {effect === 'glass-shatter' && (
        <div className="absolute inset-0">
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
                  opacity: (phase === 'reveal' ? 1 - progress : 1) * (0.18 + shardProgress * 0.68),
                  filter: 'blur(0.4px)',
                  mixBlendMode: 'screen',
                }}
              />
            )
          })}
        </div>
      )}

      {effect === 'root-tendrils' && (
        <div className="absolute inset-0">
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
      )}

      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${blackoutSize}vmax`,
          height: `${blackoutSize}vmax`,
          borderRadius: effect === 'clockwork-iris' ? '16%' : '50%',
          transform: `translate(-50%, -50%) rotate(${progress * (effect === 'clockwork-iris' ? 220 : -80)}deg)`,
          background: effect === 'void-iris'
            ? 'radial-gradient(circle, rgba(0,0,0,1) 0%, rgba(0,0,0,0.98) 48%, rgba(95,240,255,0.18) 62%, rgba(0,0,0,0) 72%)'
            : 'radial-gradient(circle, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.65) 46%, rgba(255,255,255,0.08) 57%, rgba(0,0,0,0) 72%)',
          boxShadow: effect === 'void-iris' ? '0 0 90px rgba(95,240,255,0.22)' : '0 0 80px rgba(255,255,255,0.16)',
        }}
      />

      {effect === 'clockwork-iris' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '72vmax',
            height: '72vmax',
            borderRadius: '50%',
            transform: `translate(-50%, -50%) rotate(${progress * -260}deg)`,
            background: 'repeating-conic-gradient(rgba(250,204,21,0.42) 0deg, rgba(250,204,21,0.08) 9deg, rgba(0,0,0,0) 13deg, rgba(0,0,0,0) 25deg)',
            mixBlendMode: 'screen',
            opacity: phase === 'reveal' ? 1 - progress : 0.86,
          }}
        />
      )}

      {effect === 'rainbow-vortex' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '92vmax',
            height: '92vmax',
            borderRadius: '50%',
            transform: `translate(-50%, -50%) scale(${0.42 + progress * 1.25}) rotate(${progress * 640}deg)`,
            background: 'conic-gradient(#ff2bd6, #ff7a18, #fff95c, #51ff85, #47d8ff, #7b61ff, #ff2bd6)',
            opacity: (phase === 'reveal' ? 1 - progress * 0.82 : 0.52) * settings.intensity,
            filter: 'blur(18px)',
            mixBlendMode: 'screen',
          }}
        />
      )}
    </div>
  )
}
