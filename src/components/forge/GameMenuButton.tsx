'use client'

import { useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { useAudioManager } from '@/lib/audio-manager'
import { holdUIFocusForMenuTransition } from '@/lib/input-manager'

const GAME_MENU_FONT = '"Arial Black", Impact, "Segoe UI Black", "Trebuchet MS", system-ui, sans-serif'

interface GameMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  sublabel?: string
  marker?: ReactNode
  accent?: string
  active?: boolean
  widthClassName?: string
  showCaret?: boolean
}

export function GameMenuButton({
  label,
  sublabel,
  marker: _marker,
  accent = '#22D3EE',
  active = false,
  widthClassName = 'min-w-[136px] max-w-[178px] max-[700px]:min-w-[78px] max-[700px]:max-w-[92px]',
  showCaret = true,
  className = '',
  onMouseEnter: _legacyMouseEnter,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  ...buttonProps
}: GameMenuButtonProps) {
  const hoverActiveRef = useRef(false)

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
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em] text-white/55">
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
