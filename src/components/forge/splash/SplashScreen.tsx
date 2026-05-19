'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPLASH SCREEN — first thing the user sees, every visit.
//
// Layers, bottom to top:
//   1. CSS fallback gradient (always there, instant paint)
//   2. Generated background image (mix-blend-mode: screen on dark designs)
//   3. Overlay effect (scanlines / particles / grid / bloom / …)
//   4. Center brand: OASIS · 04515
//   5. Status text + progress bar
//   6. Tiny "press . to skip" hint when applicable
//
// Progress is a hybrid: a synthetic ease-in for the first 60% (covers React
// hydration + dynamic-chunk fetch), then real Three.js LoadingManager progress
// for the last 40%. We snap to 100% only when `ready=true` AND the Three
// progress has fired at least once OR a safety timeout elapses.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState } from 'react'
import {
  subscribeWorldLoad,
  getWorldLoadState,
  type WorldLoadState,
} from '@/lib/world-load-progress'
import {
  getDesign,
  splashImageCandidates,
  type SplashDesign,
  type SplashDesignId,
  type SplashModelSlug,
} from './splash-designs'

export interface SplashScreenProps {
  designId: SplashDesignId
  modelSlug: SplashModelSlug
  /** Flip true once OasisClient has finished session-init AND Scene has mounted. */
  ready: boolean
  /** Minimum ms the splash must stay visible after `ready` (preview tool). */
  holdMs?: number
  /** Fired after the fade-out finishes. Parent should unmount us. */
  onFadeComplete?: () => void
}

// ─── Bar styles ───────────────────────────────────────────────────────────

function NeonFillBar({ progress, accent, accentAlt }: { progress: number; accent: string; accentAlt?: string }) {
  return (
    <div className="oasis-splash-bar-track" style={{ borderColor: `${accent}55` }}>
      <div
        className="oasis-splash-bar-fill"
        style={{
          width: `${Math.round(progress * 100)}%`,
          background: `linear-gradient(90deg, ${accent} 0%, ${accentAlt ?? accent} 100%)`,
          boxShadow: `0 0 12px ${accent}, 0 0 28px ${accent}aa`,
        }}
      />
    </div>
  )
}

function TerminalBar({ progress, accent }: { progress: number; accent: string }) {
  const total = 24
  const filled = Math.max(0, Math.min(total, Math.round(progress * total)))
  const empty = total - filled
  const pct = Math.round(progress * 100)
  return (
    <div className="oasis-splash-bar-terminal" style={{ color: accent, textShadow: `0 0 6px ${accent}` }}>
      <span>[</span>
      <span style={{ color: accent }}>{'█'.repeat(filled)}</span>
      <span style={{ color: `${accent}33` }}>{'░'.repeat(empty)}</span>
      <span>]</span>
      <span style={{ marginLeft: 8 }}>{String(pct).padStart(3, ' ')}%</span>
    </div>
  )
}

function ManaRingBar({ progress, accent, accentAlt }: { progress: number; accent: string; accentAlt?: string }) {
  const size = 110
  const stroke = 6
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id="oasisManaGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={accentAlt ?? accent} />
        </linearGradient>
      </defs>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={`${accent}33`}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#oasisManaGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 6px ${accent})`, transition: 'stroke-dashoffset 240ms ease-out' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={accent}
        fontFamily="'Courier New', monospace"
        fontSize="18"
        fontWeight="700"
        style={{ filter: `drop-shadow(0 0 4px ${accent})` }}
      >
        {Math.round(progress * 100)}%
      </text>
    </svg>
  )
}

function QuillLineBar({ progress, accent }: { progress: number; accent: string }) {
  return (
    <div className="oasis-splash-bar-quill">
      <div
        className="oasis-splash-quill-line"
        style={{
          width: `${Math.round(progress * 100)}%`,
          background: `linear-gradient(90deg, transparent 0%, ${accent} 30%, ${accent} 100%)`,
          boxShadow: `0 0 8px ${accent}aa`,
        }}
      />
      <span
        className="oasis-splash-quill-tip"
        style={{ left: `${Math.round(progress * 100)}%`, color: accent, textShadow: `0 0 6px ${accent}` }}
      >✒</span>
    </div>
  )
}

// ─── Overlays ─────────────────────────────────────────────────────────────

function RetrowaveGridOverlay({ accent }: { accent: string }) {
  return (
    <div className="oasis-splash-retrowave-grid pointer-events-none absolute inset-0" aria-hidden>
      <div className="oasis-splash-rwave-sun" style={{ borderColor: accent, boxShadow: `0 0 60px ${accent}55` }} />
    </div>
  )
}

function EmberParticlesOverlay({ accent }: { accent: string }) {
  return (
    <div className="oasis-splash-embers pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 28 }).map((_, i) => (
        <span
          key={i}
          className="oasis-splash-ember"
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i * 0.31) % 6}s`,
            animationDuration: `${4 + (i % 5)}s`,
            background: accent,
            boxShadow: `0 0 6px ${accent}`,
          }}
        />
      ))}
    </div>
  )
}

function CrtScanlinesOverlay() {
  return (
    <>
      <div className="oasis-splash-scanlines pointer-events-none absolute inset-0" aria-hidden />
      <div className="oasis-splash-crt-vignette pointer-events-none absolute inset-0" aria-hidden />
    </>
  )
}

function GoldBloomOverlay({ accent }: { accent: string }) {
  return (
    <div className="oasis-splash-gold-bloom pointer-events-none absolute inset-0" aria-hidden>
      <div className="oasis-splash-gold-bloom-core" style={{ background: `radial-gradient(circle, ${accent}55 0%, transparent 60%)` }} />
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="oasis-splash-mote"
          style={{
            left: `${(i * 53) % 100}%`,
            animationDelay: `${(i * 0.41) % 8}s`,
            animationDuration: `${6 + (i % 4)}s`,
            background: accent,
          }}
        />
      ))}
    </div>
  )
}

function PsychedelicPulseOverlay() {
  return (
    <div className="oasis-splash-psychedelic pointer-events-none absolute inset-0" aria-hidden>
      <div className="oasis-splash-psy-pulse" />
    </div>
  )
}

function NeonRainOverlay({ accent, accentAlt }: { accent: string; accentAlt?: string }) {
  return (
    <div className="oasis-splash-neon-rain pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className="oasis-splash-rain-streak"
          style={{
            left: `${(i * 53) % 100}%`,
            animationDelay: `${(i * 0.17) % 3}s`,
            animationDuration: `${1.5 + (i % 4) * 0.3}s`,
            background: `linear-gradient(180deg, transparent 0%, ${i % 2 ? accentAlt ?? accent : accent}aa 70%, transparent 100%)`,
          }}
        />
      ))}
    </div>
  )
}

function DustySunbeamOverlay({ accent }: { accent: string }) {
  return (
    <div className="oasis-splash-dusty pointer-events-none absolute inset-0" aria-hidden>
      <div className="oasis-splash-sunbeam" style={{ background: `linear-gradient(115deg, transparent 38%, ${accent}33 50%, transparent 62%)` }} />
      {Array.from({ length: 22 }).map((_, i) => (
        <span
          key={i}
          className="oasis-splash-dust"
          style={{
            left: `${(i * 41) % 100}%`,
            top: `${(i * 19) % 100}%`,
            animationDelay: `${(i * 0.27) % 9}s`,
            animationDuration: `${8 + (i % 5)}s`,
          }}
        />
      ))}
    </div>
  )
}

function WorldConjuringOverlay({ accent, accentAlt }: { accent: string; accentAlt?: string }) {
  return (
    <div className="oasis-splash-conjuring pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 32 }).map((_, i) => (
        <span
          key={i}
          className="oasis-splash-vertex"
          style={{
            left: `${(i * 23) % 100}%`,
            top: `${(i * 47) % 100}%`,
            animationDelay: `${(i * 0.19) % 5}s`,
            animationDuration: `${3 + (i % 4)}s`,
            background: i % 2 ? accentAlt ?? accent : accent,
            boxShadow: `0 0 8px ${accent}`,
          }}
        />
      ))}
      <div className="oasis-splash-conjuring-fog" />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatMB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ─── Main component ───────────────────────────────────────────────────────

export function SplashScreen({ designId, modelSlug, ready, holdMs = 0, onFadeComplete }: SplashScreenProps) {
  const design = getDesign(designId)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBroken, setImageBroken] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)
  const [fading, setFading] = useState(false)
  const [removed, setRemoved] = useState(false)

  const candidatesRef = useRef<string[]>([])
  const candidateIdxRef = useRef(0)
  const mountedAtRef = useRef<number>(0)
  const worldLoadStartedRef = useRef(false)
  const progressRef = useRef(0)
  const playableSignalRef = useRef(false)
  const [metrics, setMetrics] = useState({ files: 0, bytes: 0 })

  // Resolve which image URL to try first whenever design × model changes.
  useEffect(() => {
    candidatesRef.current = splashImageCandidates(designId, modelSlug)
    candidateIdxRef.current = 0
    setImageUrl(candidatesRef.current[0] ?? null)
    setImageBroken(false)
  }, [designId, modelSlug])

  // Mount timer (drives synthetic progress + holdMs).
  useEffect(() => {
    mountedAtRef.current = Date.now()
  }, [])

  // Synthetic + real progress fusion. Runs every animation frame while visible.
  useEffect(() => {
    if (removed) return
    let raf = 0
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      const elapsed = Date.now() - mountedAtRef.current
      const world = getWorldLoadState()
      const sawWorldLoad = world.total > 0 || world.progress < 1
      if (sawWorldLoad) worldLoadStartedRef.current = true

      // Synthetic curve: 0→0.55 over 1200ms, then 0.55→0.85 over the next 2000ms.
      let synth: number
      if (elapsed < 1200) synth = 0.55 * (elapsed / 1200)
      else if (elapsed < 3200) synth = 0.55 + 0.30 * ((elapsed - 1200) / 2000)
      else synth = 0.85

      // Real Three.js LoadingManager progress, scaled into the 0.55 → 0.95 window.
      const realComponent = worldLoadStartedRef.current
        ? 0.55 + world.progress * 0.40
        : 0

      const current = progressRef.current
      const baseline = Math.max(synth, realComponent, current)
      const dismissNow = playableSignalRef.current && elapsed >= holdMs

      let target: number
      if (dismissNow) {
        // World said "I'm playable" — ease the bar to 1.0 fast, no matter what.
        // current + 0.06 accumulates each frame (this was the bug before: the
        // old code did baseline+0.04 which doesn't compound because baseline
        // is recomputed every frame from synth, which plateaus).
        target = Math.min(1, current + 0.06)
      } else if (ready && elapsed >= holdMs) {
        // Ready but no explicit playable signal — crawl the bar to 0.99 only;
        // hold there until the playable signal fires or the safety timeout
        // (see effect below) flips dismissNow.
        target = Math.min(0.99, current + 0.025)
      } else if (!ready) {
        target = Math.min(0.95, baseline)
      } else {
        target = Math.min(0.97, baseline)
      }

      const next = Math.max(current, target)
      if (next !== current) {
        progressRef.current = next
        setProgress(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [ready, holdMs, removed])

  // ─── Minimum-playable signal ────────────────────────────────────────────
  // The Scene component dispatches `oasis:world-playable` from R3F's
  // <Canvas onCreated> callback (first rendered frame). That's the real
  // "user can walk around" moment. We also enforce an 8-second hard cap so
  // a stalled load (or a missing dispatch on some route) can't trap the
  // user behind the splash forever.
  useEffect(() => {
    if (removed) return
    const fire = () => { playableSignalRef.current = true }
    const onPlayable = () => fire()
    window.addEventListener('oasis:world-playable', onPlayable)
    const hardCap = window.setTimeout(fire, 8000)
    return () => {
      window.removeEventListener('oasis:world-playable', onPlayable)
      window.clearTimeout(hardCap)
    }
  }, [removed])

  // ─── Real byte / file metrics via PerformanceObserver ───────────────────
  // Counts every resource the browser fetched after the splash mounted.
  // `transferSize` is the gzipped wire size; cached resources report 0,
  // which is exactly what we want (we don't want to "double-count" hits
  // that came from disk cache instantly).
  useEffect(() => {
    if (removed) return
    if (typeof PerformanceObserver === 'undefined') return
    let files = 0
    let bytes = 0
    let pending = 0
    const flush = () => {
      pending = 0
      setMetrics({ files, bytes })
    }
    const obs = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.entryType !== 'resource') continue
        const r = e as PerformanceResourceTiming
        if (r.name.includes('/_next/data/')) continue
        files += 1
        bytes += r.transferSize || r.encodedBodySize || 0
      }
      if (!pending) pending = window.setTimeout(flush, 120)
    })
    try { obs.observe({ type: 'resource', buffered: true }) }
    catch { obs.observe({ entryTypes: ['resource'] }) }
    return () => { obs.disconnect() }
  }, [removed])

  // Subscribe to Three.js LoadingManager so the bar reacts to real loads
  // (not just our synthetic curve). The fusion above already reads
  // getWorldLoadState() each frame; this subscription forces a tick on
  // discrete onStart events so the status label updates immediately.
  useEffect(() => {
    const handle = (s: WorldLoadState) => {
      if (s.total > 0 || s.isLoading) worldLoadStartedRef.current = true
    }
    return subscribeWorldLoad(handle)
  }, [])

  // Status text rotation, every 1.2s — but bounded by progress so we don't
  // race past "ready" with a "still loading" tagline.
  useEffect(() => {
    const expectedIdx = Math.min(3, Math.floor(progress * 4))
    if (expectedIdx !== statusIdx) {
      const t = window.setTimeout(() => setStatusIdx(expectedIdx), 80)
      return () => window.clearTimeout(t)
    }
  }, [progress, statusIdx])

  // Trigger fade once progress hits 1 and we're ready.
  useEffect(() => {
    if (!ready || progress < 1 || fading) return
    setFading(true)
    const t = window.setTimeout(() => {
      setRemoved(true)
      onFadeComplete?.()
    }, 650)
    return () => window.clearTimeout(t)
  }, [ready, progress, fading, onFadeComplete])

  if (removed) return null

  const onImgError = () => {
    candidateIdxRef.current += 1
    const next = candidatesRef.current[candidateIdxRef.current]
    if (next) {
      setImageUrl(next)
    } else {
      setImageBroken(true)
      setImageUrl(null)
    }
  }

  return (
    <div
      className="oasis-splash-root"
      data-design={design.id}
      data-fading={fading ? '1' : '0'}
      role="status"
      aria-live="polite"
      aria-busy={!ready || progress < 1}
    >
      <SplashStyles />

      {/* L1: fallback gradient — always painted */}
      <div className="oasis-splash-bg-fallback" style={{ background: design.fallbackGradient }} />

      {/* L2: generated image, optionally screen-blended */}
      {imageUrl && !imageBroken && (
        <img
          src={imageUrl}
          alt=""
          className="oasis-splash-bg-image"
          style={{ mixBlendMode: design.screenBlend ? 'screen' : 'normal' }}
          onError={onImgError}
          decoding="async"
          fetchPriority="high"
        />
      )}

      {/* L3: design-specific overlay */}
      <RenderOverlay design={design} />

      {/* L4: status + bar.  The image itself contains the "04515" brand,
          so we no longer paint another OASIS/04515 over the top — that was
          double-stamping and crowded the centerpiece. */}
      <div className="oasis-splash-foot">
        <div className="oasis-splash-status" style={{ color: design.accent, textShadow: `0 0 6px ${design.accent}66` }}>
          {design.statusLines[statusIdx]}
        </div>
        <div className="oasis-splash-bar-shell">
          {design.bar === 'neon-fill' && <NeonFillBar progress={progress} accent={design.accent} accentAlt={design.accentAlt} />}
          {design.bar === 'terminal' && <TerminalBar progress={progress} accent={design.accent} />}
          {design.bar === 'mana-ring' && <ManaRingBar progress={progress} accent={design.accent} accentAlt={design.accentAlt} />}
          {design.bar === 'quill-line' && <QuillLineBar progress={progress} accent={design.accent} />}
        </div>
        <div className="oasis-splash-metrics" style={{ color: `${design.accent}b0` }}>
          {metrics.files > 0
            ? `${metrics.files} file${metrics.files === 1 ? '' : 's'} · ${formatMB(metrics.bytes)}`
            : 'awaiting first byte…'}
        </div>
      </div>
    </div>
  )
}

function RenderOverlay({ design }: { design: SplashDesign }) {
  switch (design.overlay) {
    case 'retrowave-grid':   return <RetrowaveGridOverlay   accent={design.accent} />
    case 'ember-particles':  return <EmberParticlesOverlay  accent={design.accent} />
    case 'crt-scanlines':    return <CrtScanlinesOverlay />
    case 'gold-bloom':       return <GoldBloomOverlay       accent={design.accent} />
    case 'psychedelic-pulse':return <PsychedelicPulseOverlay />
    case 'neon-rain':        return <NeonRainOverlay        accent={design.accent} accentAlt={design.accentAlt} />
    case 'dusty-sunbeam':    return <DustySunbeamOverlay    accent={design.accent} />
    case 'world-conjuring':  return <WorldConjuringOverlay  accent={design.accent} accentAlt={design.accentAlt} />
  }
}

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// All splash CSS lives here — self-contained so the splash module can be
// dropped/extracted without touching globals. Animations are GPU-cheap:
// translate/opacity/scale only. No filter:blur on full-screen surfaces.
// We inject as a plain <style> tag so we don't depend on styled-jsx (which
// the rest of this project doesn't use).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
const SPLASH_CSS = `
      .oasis-splash-root {
        position: fixed;
        inset: 0;
        z-index: 99999;
        overflow: hidden;
        font-family: 'Courier New', monospace;
        color: #fff;
        opacity: 1;
        transition: opacity 600ms ease-out;
      }
      .oasis-splash-root[data-fading="1"] { opacity: 0; pointer-events: none; }

      .oasis-splash-bg-fallback {
        position: absolute; inset: 0;
      }
      .oasis-splash-bg-image {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        object-fit: cover;
        user-select: none;
        animation:
          oasisSplashImageDrift 14s ease-in-out infinite alternate,
          oasisSplashImageBreathe 5.5s ease-in-out infinite alternate;
        /* Radial mask: image is opaque in the central 55% and feathers to
           transparent at the edges, so the CSS fallback gradient bleeds in
           around it instead of a hard rectangle edge. This is the cheap
           "alpha-melt" — combined with mix-blend-mode: screen on dark
           designs, dark areas vanish AND the edges fade out. */
        -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 52%, #000 30%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.0) 92%);
                mask-image: radial-gradient(ellipse 70% 70% at 50% 52%, #000 30%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0.0) 92%);
      }
      @keyframes oasisSplashImageDrift {
        0%   { transform: scale(1.04) translate(-0.4%, -0.3%); }
        100% { transform: scale(1.09) translate(0.6%, 0.4%); }
      }
      @keyframes oasisSplashImageBreathe {
        0%   { filter: brightness(0.94) saturate(1.0); }
        100% { filter: brightness(1.08) saturate(1.12); }
      }

      .oasis-splash-metrics {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        opacity: 0.85;
      }

      .oasis-splash-foot {
        position: absolute;
        bottom: clamp(28px, 6vh, 64px);
        left: 50%;
        transform: translateX(-50%);
        width: min(640px, 86vw);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        z-index: 5;
      }
      .oasis-splash-status {
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        min-height: 1.2em;
      }
      .oasis-splash-bar-shell { width: 100%; display: flex; justify-content: center; }

      /* Neon-fill bar */
      .oasis-splash-bar-track {
        width: 100%;
        height: 10px;
        border: 1px solid;
        border-radius: 999px;
        background: rgba(0,0,0,0.45);
        backdrop-filter: blur(2px);
        overflow: hidden;
      }
      .oasis-splash-bar-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 240ms ease-out;
      }

      /* Terminal bar */
      .oasis-splash-bar-terminal {
        font-family: 'Courier New', monospace;
        font-size: 14px;
        letter-spacing: 0.05em;
      }

      /* Quill bar */
      .oasis-splash-bar-quill {
        position: relative;
        width: 100%;
        height: 22px;
      }
      .oasis-splash-quill-line {
        position: absolute;
        left: 0; top: 50%;
        height: 2px;
        transform: translateY(-50%);
        transition: width 240ms ease-out;
      }
      .oasis-splash-quill-tip {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -55%);
        font-size: 22px;
        transition: left 240ms ease-out;
      }

      /* ░░░ Retrowave grid ░░░ */
      .oasis-splash-retrowave-grid {
        background:
          linear-gradient(0deg, rgba(255,61,248,0.18) 0%, transparent 35%, transparent 65%, rgba(60,220,255,0.10) 100%);
      }
      .oasis-splash-retrowave-grid::before {
        content: '';
        position: absolute;
        left: 0; right: 0; bottom: 0;
        height: 50%;
        background:
          linear-gradient(transparent 78%, rgba(60,220,255,0.55) 79%, transparent 81%),
          linear-gradient(90deg, transparent 78%, rgba(60,220,255,0.55) 79%, transparent 81%);
        background-size: 5vw 5vw, 5vw 5vw;
        transform: perspective(420px) rotateX(58deg);
        transform-origin: center top;
        animation: oasisSplashGridScroll 8s linear infinite;
        opacity: 0.55;
      }
      @keyframes oasisSplashGridScroll {
        0%   { background-position: 0 0, 0 0; }
        100% { background-position: 0 5vw, 0 5vw; }
      }
      .oasis-splash-rwave-sun {
        position: absolute;
        top: 40%;
        left: 50%;
        width: 36vmin;
        height: 36vmin;
        transform: translate(-50%, -50%);
        border: 2px solid;
        border-radius: 50%;
        opacity: 0.0;
        animation: oasisSplashSunPulse 5s ease-in-out infinite;
      }
      @keyframes oasisSplashSunPulse {
        0%, 100% { transform: translate(-50%, -50%) scale(0.96); opacity: 0.22; }
        50%      { transform: translate(-50%, -50%) scale(1.04); opacity: 0.36; }
      }

      /* ░░░ Ember particles ░░░ */
      .oasis-splash-ember {
        position: absolute;
        bottom: -4px;
        width: 3px; height: 3px;
        border-radius: 50%;
        opacity: 0;
        animation-name: oasisSplashEmberRise;
        animation-iteration-count: infinite;
        animation-timing-function: ease-out;
      }
      @keyframes oasisSplashEmberRise {
        0%   { transform: translateY(0) scale(0.8); opacity: 0; }
        15%  { opacity: 0.95; }
        100% { transform: translateY(-92vh) scale(0.2); opacity: 0; }
      }

      /* ░░░ CRT scanlines ░░░ */
      .oasis-splash-scanlines {
        background-image: repeating-linear-gradient(
          0deg,
          rgba(0,0,0,0.0) 0px,
          rgba(0,0,0,0.0) 2px,
          rgba(0,0,0,0.28) 3px,
          rgba(0,0,0,0.28) 4px
        );
        mix-blend-mode: multiply;
        animation: oasisSplashScanShift 6s linear infinite;
      }
      @keyframes oasisSplashScanShift {
        0%   { background-position: 0 0; }
        100% { background-position: 0 4px; }
      }
      .oasis-splash-crt-vignette {
        background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%);
      }

      /* ░░░ Gold bloom ░░░ */
      .oasis-splash-gold-bloom-core {
        position: absolute;
        top: 50%; left: 50%;
        width: 80vmin; height: 80vmin;
        transform: translate(-50%, -50%);
        animation: oasisSplashBloomPulse 4.5s ease-in-out infinite;
      }
      @keyframes oasisSplashBloomPulse {
        0%, 100% { transform: translate(-50%, -50%) scale(0.95); opacity: 0.7; }
        50%      { transform: translate(-50%, -50%) scale(1.05); opacity: 1.0; }
      }
      .oasis-splash-mote {
        position: absolute;
        top: 100%;
        width: 4px; height: 4px;
        border-radius: 50%;
        opacity: 0;
        box-shadow: 0 0 5px currentColor;
        animation-name: oasisSplashMote;
        animation-iteration-count: infinite;
        animation-timing-function: ease-out;
      }
      @keyframes oasisSplashMote {
        0%   { transform: translateY(0); opacity: 0; }
        20%  { opacity: 0.7; }
        100% { transform: translateY(-110vh); opacity: 0; }
      }

      /* ░░░ Psychedelic ░░░ */
      .oasis-splash-psy-pulse {
        position: absolute; inset: 0;
        background:
          radial-gradient(circle at 50% 50%, rgba(255,94,224,0.35) 0%, transparent 32%),
          radial-gradient(circle at 50% 50%, rgba(107,208,255,0.25) 0%, transparent 48%);
        animation: oasisSplashPsy 6s ease-in-out infinite, oasisSplashPsyRot 22s linear infinite;
      }
      @keyframes oasisSplashPsy {
        0%, 100% { filter: hue-rotate(0deg); opacity: 0.85; }
        50%      { filter: hue-rotate(80deg); opacity: 1.0; }
      }
      @keyframes oasisSplashPsyRot {
        0%   { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* ░░░ Neon rain ░░░ */
      .oasis-splash-rain-streak {
        position: absolute;
        top: -20vh;
        width: 2px;
        height: 38vh;
        opacity: 0;
        animation-name: oasisSplashRain;
        animation-iteration-count: infinite;
        animation-timing-function: linear;
      }
      @keyframes oasisSplashRain {
        0%   { transform: translateY(0); opacity: 0; }
        20%  { opacity: 0.9; }
        100% { transform: translateY(140vh); opacity: 0; }
      }

      /* ░░░ Dusty sunbeam ░░░ */
      .oasis-splash-sunbeam {
        position: absolute; inset: 0;
        animation: oasisSplashSunbeamSweep 14s ease-in-out infinite alternate;
      }
      @keyframes oasisSplashSunbeamSweep {
        0%   { transform: translateX(-6%); }
        100% { transform: translateX(6%); }
      }
      .oasis-splash-dust {
        position: absolute;
        width: 3px; height: 3px;
        border-radius: 50%;
        background: rgba(255,255,255,0.85);
        opacity: 0;
        animation-name: oasisSplashDust;
        animation-iteration-count: infinite;
        animation-timing-function: ease-in-out;
      }
      @keyframes oasisSplashDust {
        0%, 100% { transform: translate(0,0); opacity: 0.15; }
        50%      { transform: translate(8px, -16px); opacity: 0.7; }
      }

      /* ░░░ World conjuring ░░░ */
      .oasis-splash-vertex {
        position: absolute;
        width: 4px; height: 4px;
        border-radius: 50%;
        opacity: 0;
        animation-name: oasisSplashVertex;
        animation-iteration-count: infinite;
        animation-timing-function: ease-in-out;
      }
      @keyframes oasisSplashVertex {
        0%   { transform: scale(0.4); opacity: 0; }
        40%  { opacity: 1; }
        100% { transform: scale(1.4); opacity: 0; }
      }
      .oasis-splash-conjuring-fog {
        position: absolute; inset: 0;
        background:
          radial-gradient(ellipse at 50% 90%, rgba(196,77,255,0.25) 0%, transparent 55%),
          radial-gradient(ellipse at 50% 10%, rgba(77,208,255,0.15) 0%, transparent 55%);
        animation: oasisSplashFog 11s ease-in-out infinite alternate;
      }
      @keyframes oasisSplashFog {
        0%   { transform: translateY(0); }
        100% { transform: translateY(-2vh); }
      }
    `

function SplashStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
}
