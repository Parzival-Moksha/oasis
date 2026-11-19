'use client'

import { useMemo, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { useAudioManager } from '@/lib/audio-manager'
import { holdUIFocusForMenuTransition } from '@/lib/input-manager'
import { railIconFor, railPlateFor, useRailLook, type RailIcon, type RailLookId } from '@/lib/rail-look'
import { cellsPath, textCells, textWidth } from '@/components/forge/splash/intro-overlay'

export const GAME_MENU_FONT ='"Arial Black", Impact, "Segoe UI Black", "Trebuchet MS", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

interface GameMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  sublabel?: string
  marker?: ReactNode
  accent?: string
  active?: boolean
  widthClassName?: string
  showCaret?: boolean
  /** Colour of the sublabel (an agent needing attention, say). */
  sublabelColor?: string
  /** Force a look (the picker's previews). Otherwise the owner's pick in Settings > Experiments. */
  look?: RailLookId
}

// ── The rail looks other than Classic: one structure, one stylesheet per look ──────────────────

const ICON_PATHS: Record<Exclude<RailIcon, 'none'>, string> = {
  menu: 'M4 7h16M4 12h16M4 17h10',
  world: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18',
  spells: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  agents: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M16.5 11a2.5 2.5 0 1 0 0-5M17.5 14c2.2.4 3.5 2 3.5 4.5',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.6 3.6-6 8-6s8 2.4 8 6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  help: 'M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 17.5v.5',
}

function RailIconSvg({ icon }: { icon: RailIcon }) {
  if (icon === 'none') return <svg viewBox="0 0 24 24" aria-hidden><path d="M12 5l7 7-7 7-7-7z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden><path d={ICON_PATHS[icon]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

/** A label in the Oasis dot-matrix letters (the Arcade look): the same on every system, no font file. */
function PixelLabel({ text }: { text: string }) {
  const upper = text.toUpperCase()
  const d = useMemo(() => cellsPath(textCells(upper, 0, 0, 1).flat(), 1, 'square', 1), [upper])
  const width = Math.max(1, textWidth(upper, 1))
  return (
    <svg viewBox={`0 0 ${width} 7`} height="11" width={Math.min(78, width * (11 / 7))} preserveAspectRatio="xMinYMid meet" aria-hidden style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <path d={d} fill="currentColor" />
    </svg>
  )
}

const RAIL_LOOK_CSS = `
.orb { position: relative; display: flex; align-items: center; gap: 7px; height: 44px; min-width: 142px; padding: 0 9px 0 7px; text-align: left; cursor: pointer; color: #fff; outline: none; -webkit-tap-highlight-color: transparent; transition: transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 140ms ease-out, border-color 140ms ease-out, background 140ms ease-out, filter 140ms ease-out; }
.orb:disabled { cursor: default; opacity: 0.5; }
/* Hover: towards you (a little larger, in place), not sideways. */
.orb:hover:not(:disabled) { transform: scale(1.08); z-index: 1; }
.orb:active:not(:disabled) { transform: scale(0.97); }
.orb:focus-visible { box-shadow: 0 0 0 2px #fff; }
.orb-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; }
.orb-icon svg { width: 17px; height: 17px; display: block; }
.orb-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.orb-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.05; }
.orb-sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.55); }
.orb-caret { flex: none; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid var(--orb-accent); opacity: 0.75; transition: transform 140ms ease-out; }
.orb:hover .orb-caret { opacity: 1; }
@media (max-width: 700px) { .orb { height: 30px; min-width: 82px; gap: 5px; padding: 0 7px 0 5px; } .orb-icon { width: 18px; height: 18px; } .orb-icon svg { width: 13px; height: 13px; } .orb-sub { display: none; } }

/* Forged: the spell book's material. A painted stone plate in gem-set iron (public/ui/rail/plate-*.png), the label carved in gold. */
.orb[data-look="forged"] { height: 58px; padding: 0 20px; justify-content: center; border: 0; background: var(--orb-plate) center / 100% 100% no-repeat; font-family: var(--font-cinzel), 'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', 'Iowan Old Style', Georgia, serif; filter: drop-shadow(0 5px 7px rgba(0,0,0,0.55)); }
.orb[data-look="forged"] .orb-icon, .orb[data-look="forged"] .orb-caret { display: none; }
.orb[data-look="forged"] .orb-text { align-items: center; text-align: center; gap: 1px; }
.orb[data-look="forged"] .orb-label { font-size: 14.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #f1dca8; background: linear-gradient(180deg, #fff3cf 0%, #e9c877 55%, #b98a3a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 1px 0 rgba(0,0,0,0.95)) drop-shadow(0 0 5px rgba(0,0,0,0.8)); }
.orb[data-look="forged"] .orb-sub { font-size: 8.5px; letter-spacing: 0.14em; color: rgba(236,222,190,0.72); text-shadow: 0 1px 2px #000; }
.orb[data-look="forged"]:hover:not(:disabled) { filter: drop-shadow(0 6px 9px rgba(0,0,0,0.6)) drop-shadow(0 0 9px var(--orb-accent)) brightness(1.22); }
.orb[data-look="forged"][data-active="1"] { filter: drop-shadow(0 6px 9px rgba(0,0,0,0.6)) drop-shadow(0 0 12px var(--orb-accent)) brightness(1.38) saturate(1.2); }
@media (max-width: 700px) { .orb[data-look="forged"] { height: 36px; padding: 0 10px; } .orb[data-look="forged"] .orb-label { font-size: 10px; } }

/* Parchment: a painted plaque in a carved frame (public/ui/rail/parchment-*.png, nine-sliced so the corners keep their shape), ink lettering. */
.orb[data-look="parchment"] { height: 52px; padding: 0 6px; justify-content: center; border: 15px solid transparent; border-image: var(--orb-plaque) 62 fill / 15px / 2px stretch; background: none; font-family: 'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', 'Iowan Old Style', Georgia, serif; color: #3b2710; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); }
.orb[data-look="parchment"] .orb-icon { width: 18px; height: 18px; color: #6a4517; }
.orb[data-look="parchment"] .orb-icon svg { width: 15px; height: 15px; }
.orb[data-look="parchment"] .orb-caret { display: none; }
.orb[data-look="parchment"] .orb-text { gap: 0; }
.orb[data-look="parchment"] .orb-label { font-size: 14.5px; font-weight: 700; letter-spacing: 0.06em; font-variant: small-caps; color: #3b2710; text-shadow: 0 1px 0 rgba(255,246,220,0.7); }
.orb[data-look="parchment"] .orb-sub { font-size: 8px; color: rgba(59,39,16,0.75) !important; letter-spacing: 0.06em; }
.orb[data-look="parchment"]:hover:not(:disabled) { filter: drop-shadow(0 6px 8px rgba(0,0,0,0.55)) drop-shadow(0 0 8px rgba(255,214,130,0.7)) brightness(1.08); }
.orb[data-look="parchment"][data-active="1"] { filter: drop-shadow(0 6px 8px rgba(0,0,0,0.55)) drop-shadow(0 0 11px rgba(255,214,130,0.95)) brightness(1.14) saturate(1.15); }


/* Rune: bronze-edged tablet, serif face */
.orb[data-look="rune"] { border-radius: 4px; border: 1px solid #b89358; background: linear-gradient(180deg, #43321f 0%, #2a1e12 55%, #1b130b 100%); box-shadow: 0 5px 14px rgba(0,0,0,0.55), inset 0 0 0 2px #1b130b, inset 0 0 0 3px rgba(214,178,116,0.45), inset 0 10px 14px -8px rgba(255,226,170,0.22); font-family: 'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', 'Iowan Old Style', Georgia, serif; color: #f6e7c8; }
.orb[data-look="rune"] .orb-icon { color: #e8c98a; }
.orb[data-look="rune"] .orb-label { font-size: 15px; font-weight: 700; letter-spacing: 0.05em; font-variant: small-caps; text-shadow: 0 1px 0 #000, 0 0 8px rgba(255,214,140,0.25); }
.orb[data-look="rune"] .orb-sub { color: rgba(246,231,200,0.6); font-family: inherit; letter-spacing: 0.06em; }
.orb[data-look="rune"] .orb-caret { border-left-color: #e8c98a; }
.orb[data-look="rune"] .orb-gem { position: absolute; left: -4px; top: 50%; width: 7px; height: 7px; transform: translateY(-50%) rotate(45deg); background: var(--orb-accent); box-shadow: 0 0 0 1px #1b130b, 0 0 8px var(--orb-accent); }
.orb[data-look="rune"]:hover:not(:disabled), .orb[data-look="rune"][data-active="1"] { border-color: #f0d199; filter: brightness(1.18); box-shadow: 0 7px 18px rgba(0,0,0,0.6), 0 0 18px -4px #f0c26e, inset 0 0 0 2px #1b130b, inset 0 0 0 3px rgba(240,209,153,0.7), inset 0 10px 14px -8px rgba(255,226,170,0.3); }

/* Arcade: pixel letters, hard edges, block shadow */
.orb[data-look="arcade"] { border-radius: 0; border: 2px solid #fff; background: #12121c; box-shadow: 4px 4px 0 var(--orb-accent); font-family: ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace; transition: transform 70ms steps(2), box-shadow 70ms steps(2), background 70ms steps(2); }
.orb[data-look="arcade"] .orb-icon { color: var(--orb-accent); }
.orb[data-look="arcade"] .orb-icon svg { stroke-linecap: square; stroke-linejoin: miter; }
.orb[data-look="arcade"] .orb-sub { font-size: 8.5px; font-weight: 700; }
.orb[data-look="arcade"] .orb-caret { border-left-color: #fff; }
.orb[data-look="arcade"]:hover:not(:disabled) { transform: scale(1.08); box-shadow: 6px 6px 0 var(--orb-accent); }
.orb[data-look="arcade"]:active:not(:disabled) { transform: scale(0.97); box-shadow: 1px 1px 0 var(--orb-accent); }
.orb[data-look="arcade"][data-active="1"] { background: var(--orb-accent); color: #0b0b12; }
.orb[data-look="arcade"][data-active="1"] .orb-icon, .orb[data-look="arcade"][data-active="1"] .orb-sub { color: #0b0b12; }
.orb[data-look="arcade"][data-active="1"] .orb-caret { border-left-color: #0b0b12; }

/* These buttons carry their name: the hover bubble of .oasis-tooltip (which the old cut-corner shape clipped away) stays off. */
.orb.oasis-tooltip::before, .orb.oasis-tooltip::after { content: none; display: none; }
.orb-line, .orb-gem { display: none; pointer-events: none; }
.orb[data-look="rune"] .orb-gem { display: block; }
@media (prefers-reduced-motion: reduce) { .orb, .orb-line, .orb-caret { transition: none; } }
`

let railCssInjected = false
function ensureRailCss() {
  if (railCssInjected || typeof document === 'undefined') return
  railCssInjected = true
  const style = document.getElementById('oasis-rail-look-css') ?? document.head.appendChild(document.createElement('style'))
  style.id = 'oasis-rail-look-css'
  style.textContent = RAIL_LOOK_CSS
}

export function GameMenuButton({
  label,
  sublabel,
  marker: _marker,
  accent = '#22D3EE',
  active = false,
  widthClassName = 'min-w-[110px] max-w-[142px] max-[700px]:min-w-[70px] max-[700px]:max-w-[82px]',
  showCaret = true,
  sublabelColor,
  look: forcedLook,
  className = '',
  onMouseEnter: _legacyMouseEnter,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  ...buttonProps
}: GameMenuButtonProps) {
  const hoverActiveRef = useRef(false)
  const pickedLook = useRailLook()
  const look = forcedLook ?? pickedLook

  if (look !== 'classic') {
    ensureRailCss()
    const plates = railPlateFor(railIconFor(label))
    return (
      <button
        {...buttonProps}
        onPointerDown={(event) => {
          if (!event.currentTarget.disabled) holdUIFocusForMenuTransition()
          onPointerDown?.(event)
        }}
        onPointerEnter={(event) => {
          if (!hoverActiveRef.current) {
            useAudioManager.getState().play('buttonHover')
            hoverActiveRef.current = true
          }
          onPointerEnter?.(event)
        }}
        onPointerLeave={(event) => {
          hoverActiveRef.current = false
          onPointerLeave?.(event)
        }}
        aria-label={buttonProps['aria-label'] ?? label}
        data-look={look}
        data-active={active ? '1' : '0'}
        className={`orb ${widthClassName} ${className}`}
        style={{
          ['--orb-accent' as string]: accent,
          ['--orb-plate' as string]: `url(/ui/rail/plate-${plates.plate}.png)`,
          ['--orb-plaque' as string]: `url(/ui/rail/parchment-${plates.plaque}.png)`,
          ...(buttonProps.style || {}),
        }}
      >
        <span className="orb-icon"><RailIconSvg icon={railIconFor(label)} /></span>
        <span className="orb-text">
          <span className="orb-label">{look === 'arcade' ? <PixelLabel text={label} /> : label}</span>
          {sublabel && <span className="orb-sub" style={sublabelColor ? { color: sublabelColor } : undefined}>{sublabel}</span>}
        </span>
        {showCaret && <span className="orb-caret" />}
        <span className="orb-line" /><span className="orb-gem" />
      </button>
    )
  }

  return (
    <button
      {...buttonProps}
      onPointerDown={(event) => {
        if (!event.currentTarget.disabled) holdUIFocusForMenuTransition()
        onPointerDown?.(event)
      }}
      onPointerEnter={(event) => {
        if (!hoverActiveRef.current) {
          useAudioManager.getState().play('buttonHover')
          hoverActiveRef.current = true
        }
        onPointerEnter?.(event)
      }}
      onPointerLeave={(event) => {
        hoverActiveRef.current = false
        onPointerLeave?.(event)
      }}
      className={`group relative h-11 max-[700px]:h-7 ${widthClassName} overflow-hidden rounded-lg border bg-black/80 px-3 max-[700px]:px-1.5 text-left text-white shadow-[0_0_28px_rgba(34,211,238,0.16)] transition hover:border-white/70 hover:shadow-[0_0_44px_rgba(34,211,238,0.24)] ${className}`}
      style={{
        borderColor: active ? `${accent}aa` : `${accent}4d`,
        clipPath: 'polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%)',
        fontFamily: GAME_MENU_FONT,
        boxShadow: active
          ? `0 0 36px ${accent}44, inset 0 0 0 1px rgba(255,255,255,0.08)`
          : `0 0 24px ${accent}22, inset 0 0 0 1px rgba(255,255,255,0.05)`,
        textShadow: '0 1px 0 rgba(0,0,0,0.95), 0 0 10px rgba(255,255,255,0.18)',
        ...(buttonProps.style || {}),
      }}
    >
      <span
        className="absolute inset-0 opacity-90"
        style={{
          background: `linear-gradient(105deg, ${accent}28, rgba(255,255,255,0.045) 48%, rgba(250,204,21,0.10))`,
        }}
      />
      <span
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <span
        className="absolute bottom-0 left-0 top-0 w-1"
        style={{ background: `linear-gradient(180deg, ${accent}, rgba(255,255,255,0.18))` }}
      />
      <span className="absolute inset-0 opacity-0 transition group-hover:opacity-100" style={{ background: `radial-gradient(circle at 18% 22%, ${accent}66, transparent 35%)` }} />
      <span className="relative flex h-full items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-black uppercase tracking-[0.12em] max-[700px]:text-[8px] max-[700px]:tracking-[0.08em]">{label}</span>
          {sublabel && (
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em] text-white/55" style={sublabelColor ? { color: sublabelColor } : undefined}>
              {sublabel}
            </span>
          )}
        </span>
        {showCaret && (
          <span
            className="h-0 w-0 shrink-0 border-b-[4px] border-l-[6px] border-t-[4px] border-b-transparent border-t-transparent"
            style={{ borderLeftColor: `${accent}aa` }}
          />
        )}
      </span>
    </button>
  )
}
