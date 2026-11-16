'use client'

// The intro overlay: the title and subtitle drawn over the live world for about three seconds,
// then gone from the page. It never takes a click or a key (pointer-events: none, no focus), and
// it holds no timers once it has left. Data, layout and timing live in intro-overlay.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  INTRO_CHANGED_EVENT,
  INTRO_FADE_IN_MS,
  INTRO_FADE_OUT_MS,
  INTRO_PREVIEW_EVENT,
  INTRO_SUBTITLE,
  INTRO_TITLE,
  INTRO_VIEW,
  SUBTITLE_CELL,
  TITLE_CELL,
  cellsPath,
  introLayout,
  introPhase,
  isIntroChoice,
  readIntroChoice,
  textCells,
  type CellShape,
  type IntroChoice,
  type IntroPhase,
  type IntroVariantId,
} from './intro-overlay'

const L = introLayout()

interface VariantLook {
  titleShape: CellShape
  titleFill: number
  subtitleShape: CellShape
}

const LOOKS: Record<IntroVariantId, VariantLook> = {
  pixels: { titleShape: 'square', titleFill: 0.84, subtitleShape: 'square' },
  scanline: { titleShape: 'bars', titleFill: 0.92, subtitleShape: 'square' },
  sigil: { titleShape: 'diamond', titleFill: 1, subtitleShape: 'diamond' },
  ghost: { titleShape: 'square', titleFill: 0.8, subtitleShape: 'square' },
  sunrise: { titleShape: 'dot', titleFill: 0.86, subtitleShape: 'square' },
}

function usePaths(variant: IntroVariantId) {
  return useMemo(() => {
    const look = LOOKS[variant]
    const title = textCells(INTRO_TITLE, L.titleX, L.titleY, TITLE_CELL)
      .map(cells => cellsPath(cells, TITLE_CELL, look.titleShape, look.titleFill))
    const subtitle = cellsPath(
      textCells(INTRO_SUBTITLE, L.subtitleX, L.subtitleY, SUBTITLE_CELL).flat(),
      SUBTITLE_CELL,
      look.subtitleShape,
      look.subtitleShape === 'diamond' ? 1 : 0.86,
    )
    return { title, subtitle }
  }, [variant])
}

/** The five title glyphs, each arriving a beat after the one before. */
function Title({ paths, ...rest }: { paths: string[] } & React.SVGProps<SVGPathElement>) {
  return (
    <>
      {paths.map((d, i) => (
        <path key={i} d={d} className="oasis-intro-glyph" style={{ animationDelay: `${90 + i * 70}ms` }} {...rest} />
      ))}
    </>
  )
}

function Pixels({ title, subtitle }: { title: string[]; subtitle: string }) {
  const ruleY = L.titleY + L.titleH + 29
  return (
    <>
      <defs>
        <linearGradient id="oasisIntroRule" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#7de3ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#7de3ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7de3ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g transform="translate(4 4)"><Title paths={title} fill="rgba(4,10,24,0.38)" /></g>
      <Title paths={title} fill="rgba(255,255,255,0.66)" />
      <rect className="oasis-intro-late" x={L.titleX} y={ruleY - 1.5} width={L.titleW} height={3} fill="url(#oasisIntroRule)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(4,10,24,0.4)" transform="translate(2 2)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(125,227,255,0.92)" />
    </>
  )
}

function Scanline({ title, subtitle }: { title: string[]; subtitle: string }) {
  const top = L.titleY - 46
  const bottom = L.subtitleY + L.subtitleH + 46
  const left = L.titleX - 60
  const right = L.titleX + L.titleW + 60
  const arm = 54
  const brackets =
    `M${left + arm} ${top}H${left}V${top + arm}` +
    `M${right - arm} ${top}H${right}V${top + arm}` +
    `M${left + arm} ${bottom}H${left}V${bottom - arm}` +
    `M${right - arm} ${bottom}H${right}V${bottom - arm}`
  return (
    <>
      <g transform="translate(3 3)"><Title paths={title} fill="rgba(0,16,6,0.45)" /></g>
      <Title paths={title} fill="rgba(93,255,155,0.86)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(170,255,205,0.9)" />
      <path className="oasis-intro-late" d={brackets} fill="none" stroke="rgba(93,255,155,0.75)" strokeWidth={3} />
      <rect
        className="oasis-intro-sweep"
        x={left}
        y={top}
        width={right - left}
        height={4}
        fill="rgba(190,255,215,0.6)"
        style={{ ['--oasis-intro-sweep' as string]: `${bottom - top}px` }}
      />
    </>
  )
}

function Sigil({ title, subtitle }: { title: string[]; subtitle: string }) {
  const cx = L.centerX
  const cy = L.centerY - 10
  const ring = 392
  const diamond = 430
  const tick = (x: number, y: number) => `M${x} ${y - 13}l13 13l-13 13l-13 -13z`
  return (
    <>
      <circle
        className="oasis-intro-draw"
        cx={cx}
        cy={cy}
        r={ring}
        pathLength={1}
        fill="none"
        stroke="rgba(255,205,105,0.72)"
        strokeWidth={3}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <circle cx={cx} cy={cy} r={ring - 16} fill="none" stroke="rgba(255,205,105,0.3)" strokeWidth={1.5} strokeDasharray="2 14" />
      <path
        className="oasis-intro-late"
        d={`M${cx} ${cy - diamond}L${cx + diamond} ${cy}L${cx} ${cy + diamond}L${cx - diamond} ${cy}Z`}
        fill="none"
        stroke="rgba(255,225,160,0.34)"
        strokeWidth={2}
      />
      <path
        className="oasis-intro-late"
        d={tick(cx, cy - ring) + tick(cx, cy + ring)}
        fill="rgba(255,225,160,0.85)"
      />
      <g transform="translate(3 4)"><Title paths={title} fill="rgba(30,14,0,0.42)" /></g>
      <Title paths={title} fill="rgba(255,214,128,0.9)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(255,240,205,0.95)" />
    </>
  )
}

function Ghost({ title, subtitle }: { title: string[]; subtitle: string }) {
  const m = 56
  const arm = 70
  const w = INTRO_VIEW.width
  const h = INTRO_VIEW.height
  const corners =
    `M${m + arm} ${m}H${m}V${m + arm}` +
    `M${w - m - arm} ${m}H${w - m}V${m + arm}` +
    `M${m + arm} ${h - m}H${m}V${h - m - arm}` +
    `M${w - m - arm} ${h - m}H${w - m}V${h - m - arm}`
  return (
    <>
      <Title paths={title} fill="rgba(255,255,255,0.13)" stroke="rgba(8,12,24,0.5)" strokeWidth={5} />
      <Title paths={title} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(8,12,24,0.4)" transform="translate(2 2)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(255,255,255,0.88)" />
      <path className="oasis-intro-late" d={corners} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} />
    </>
  )
}

function Sunrise({ title, subtitle }: { title: string[]; subtitle: string }) {
  const cx = L.centerX
  const horizon = L.titleY + L.titleH + 29
  const radius = 330
  // Bands of the sun: thick at the top, thinner and wider apart towards the horizon.
  const bands: Array<{ y: number; h: number }> = []
  let y = horizon - radius
  let i = 0
  while (y < horizon) {
    const t = (y - (horizon - radius)) / radius
    const h = Math.max(5, 34 * (1 - t * 0.85))
    bands.push({ y, h: Math.min(h, horizon - y) })
    y += h + 6 + t * 16
    i += 1
    if (i > 40) break
  }
  return (
    <>
      <defs>
        <clipPath id="oasisIntroSun"><circle cx={cx} cy={horizon} r={radius} /></clipPath>
        <linearGradient id="oasisIntroSunFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffe36b" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff4fb8" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id="oasisIntroHorizon" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#6fe8ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#6fe8ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#6fe8ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath="url(#oasisIntroSun)" className="oasis-intro-rise">
        {bands.map((b, k) => (
          <rect key={k} x={cx - radius} y={b.y} width={radius * 2} height={b.h} fill="url(#oasisIntroSunFill)" />
        ))}
      </g>
      <rect className="oasis-intro-late" x={L.titleX - 120} y={horizon - 1.5} width={L.titleW + 240} height={3} fill="url(#oasisIntroHorizon)" />
      <g transform="translate(4 4)"><Title paths={title} fill="rgba(30,0,40,0.45)" /></g>
      <Title paths={title} fill="rgba(255,255,255,0.9)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(30,0,40,0.4)" transform="translate(2 2)" />
      <path className="oasis-intro-late" d={subtitle} fill="rgba(111,232,255,0.95)" />
    </>
  )
}

/** The drawing alone, for the overlay and for the picker's thumbnails. */
export function IntroArt({ variant }: { variant: IntroVariantId }) {
  const paths = usePaths(variant)
  return (
    <svg
      viewBox={`0 0 ${INTRO_VIEW.width} ${INTRO_VIEW.height}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      aria-hidden
      data-variant={variant}
    >
      {variant === 'pixels' && <Pixels {...paths} />}
      {variant === 'scanline' && <Scanline {...paths} />}
      {variant === 'sigil' && <Sigil {...paths} />}
      {variant === 'ghost' && <Ghost {...paths} />}
      {variant === 'sunrise' && <Sunrise {...paths} />}
    </svg>
  )
}

const INTRO_CSS = `
.oasis-intro {
  position: fixed; inset: 0; z-index: 99990;
  pointer-events: none; user-select: none;
  opacity: 1;
  animation: oasisIntroIn ${INTRO_FADE_IN_MS}ms ease-out both;
  transition: opacity ${INTRO_FADE_OUT_MS}ms ease-in;
}
.oasis-intro[data-phase="leaving"] { opacity: 0; }
@keyframes oasisIntroIn { from { opacity: 0; } to { opacity: 1; } }
.oasis-intro-glyph { animation: oasisIntroGlyph 520ms cubic-bezier(0.2, 0.9, 0.25, 1.15) both; }
@keyframes oasisIntroGlyph { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
.oasis-intro-late { animation: oasisIntroLate 600ms ease-out 480ms both; }
@keyframes oasisIntroLate { from { opacity: 0; } to { opacity: 1; } }
.oasis-intro-draw { stroke-dasharray: 1; animation: oasisIntroDraw 1300ms cubic-bezier(0.5, 0, 0.2, 1) 120ms both; }
@keyframes oasisIntroDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.oasis-intro-sweep { animation: oasisIntroSweep 1700ms linear 300ms infinite both; }
@keyframes oasisIntroSweep { from { transform: translateY(0); opacity: 0.9; } to { transform: translateY(var(--oasis-intro-sweep)); opacity: 0.15; } }
.oasis-intro-rise { animation: oasisIntroRise 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes oasisIntroRise { from { opacity: 0; transform: translateY(60px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .oasis-intro-glyph, .oasis-intro-late, .oasis-intro-draw, .oasis-intro-sweep, .oasis-intro-rise { animation: none; }
  .oasis-intro-sweep { display: none; }
}
`

interface Run { key: number; variant: IntroVariantId; phase: IntroPhase }

function canvasOnScreen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('canvas') !== null
}

export function IntroOverlay() {
  const [run, setRun] = useState<Run | null>(null)
  const nextKeyRef = useRef(1)

  // The first run, on page load, with the saved choice.
  useEffect(() => {
    const choice = readIntroChoice()
    if (choice !== 'off') setRun({ key: nextKeyRef.current++, variant: choice, phase: 'showing' })
  }, [])

  // The picker in Settings plays a variant again without reloading the page.
  useEffect(() => {
    const onPreview = (event: Event) => {
      const choice = (event as CustomEvent<{ choice?: IntroChoice }>).detail?.choice
      if (!isIntroChoice(choice)) return
      setRun(choice === 'off' ? null : { key: nextKeyRef.current++, variant: choice, phase: 'showing' })
    }
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ choice?: IntroChoice }>).detail?.choice === 'off') setRun(null)
    }
    window.addEventListener(INTRO_PREVIEW_EVENT, onPreview)
    window.addEventListener(INTRO_CHANGED_EVENT, onChanged)
    return () => {
      window.removeEventListener(INTRO_PREVIEW_EVENT, onPreview)
      window.removeEventListener(INTRO_CHANGED_EVENT, onChanged)
    }
  }, [])

  // One clock per run: wait for the canvas, count three seconds over it, fade, leave the page.
  const runKey = run?.key ?? 0
  useEffect(() => {
    if (!runKey) return
    const mountedAt = performance.now()
    let sceneAt: number | null = canvasOnScreen() ? mountedAt : null
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (sceneAt === null && canvasOnScreen()) sceneAt = now
      const phase = introPhase(now, mountedAt, sceneAt)
      if (phase === 'gone') {
        window.clearInterval(timer)
        setRun(current => (current && current.key === runKey ? null : current))
      } else {
        setRun(current => (current && current.key === runKey && current.phase !== phase ? { ...current, phase } : current))
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [runKey])

  if (!run) return null
  return (
    <div className="oasis-intro" data-phase={run.phase} data-variant={run.variant} key={run.key} aria-hidden>
      <style dangerouslySetInnerHTML={{ __html: INTRO_CSS }} />
      <IntroArt variant={run.variant} />
    </div>
  )
}
