'use client'

// ░▒▓ GAME KEYCAP — a chunky physical key for on-screen key prompts (hints, "T talk", "E summon") ▓▒░

import type { CSSProperties, ReactNode } from 'react'

import { GAME_MENU_FONT } from './GameMenuButton'

export { GAME_MENU_FONT }

type KeycapSize = 'sm' | 'md' | 'lg'

const SIZES: Record<KeycapSize, { h: number; min: number; font: number; pad: number; depth: number }> = {
  sm: { h: 19, min: 21, font: 10, pad: 5, depth: 3 },
  md: { h: 25, min: 27, font: 12.5, pad: 7, depth: 4 },
  lg: { h: 31, min: 33, font: 15, pad: 9, depth: 4 },
}

export function GameKeycap({ children, size = 'sm', accent = '#fbbf24', dim = false, pulse = false, style }: {
  children: ReactNode
  size?: KeycapSize
  /** Glow and rim colour. */
  accent?: string
  /** Not usable right now: flat and grey. */
  dim?: boolean
  /** Softly breathes: "press me now". */
  pulse?: boolean
  style?: CSSProperties
}) {
  const s = SIZES[size]
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center uppercase leading-none ${pulse && !dim ? 'oasis-keycap-pulse' : ''}`}
      style={{
        height: s.h,
        minWidth: s.min,
        padding: `0 ${s.pad}px`,
        fontFamily: GAME_MENU_FONT,
        fontSize: s.font,
        letterSpacing: '0.04em',
        color: dim ? 'rgba(226,232,240,0.6)' : '#fffbeb',
        textShadow: '0 1px 0 rgba(0,0,0,0.9)',
        borderRadius: 5,
        border: `1px solid ${dim ? 'rgba(255,255,255,0.14)' : `${accent}b3`}`,
        borderBottom: `${s.depth}px solid ${dim ? 'rgba(0,0,0,0.6)' : '#05060a'}`,
        background: dim
          ? 'linear-gradient(180deg, rgba(71,85,105,0.55), rgba(15,23,42,0.7))'
          : `linear-gradient(180deg, #4a5160 0%, #262b36 52%, #151820 100%)`,
        boxShadow: dim
          ? 'inset 0 1px 0 rgba(255,255,255,0.12)'
          : `inset 0 1px 0 rgba(255,255,255,0.38), inset 0 -1px 0 ${accent}55, 0 2px 6px rgba(0,0,0,0.65), 0 0 12px ${accent}40`,
        ...(pulse && !dim ? ({ '--keycap-glow': `${accent}88` } as CSSProperties) : {}),
        ...style,
      }}
    >
      {children}
      {pulse && !dim && (
        <style>{'@keyframes oasisKeycapPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3) drop-shadow(0 0 6px var(--keycap-glow))}}.oasis-keycap-pulse{animation:oasisKeycapPulse 1.6s ease-in-out infinite}'}</style>
      )}
    </span>
  )
}

/** Outlined HUD text that reads on any sky or ground, in the menu font. */
export const GAME_HUD_TEXT: CSSProperties = {
  fontFamily: GAME_MENU_FONT,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: '#f8fafc',
  textShadow: '0 1px 0 #000, 0 0 3px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.7)',
}
