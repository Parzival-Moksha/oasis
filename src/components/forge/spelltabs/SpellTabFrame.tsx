// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPELL TAB FRAME — Shared chrome for all premium spelltab popups
// ─═̷─ Each premium spelltab (text-to-3D, text-to-pic, text-to-music, text-to-video)
// opens as a draggable medium panel on desktop and a top-right strip on mobile.
// The strip lives in the top-right so it never blocks the world target where the
// player is aiming. ─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useUILayer } from '@/lib/input-manager'
import { useAudioManager } from '@/lib/audio-manager'

const PANEL_MIN_WIDTH = 320
const PANEL_MIN_HEIGHT = 420
const DEFAULT_PANEL_WIDTH = 480
const DEFAULT_PANEL_HEIGHT = 600
const PANEL_MARGIN = 12
const MOBILE_BREAKPOINT = 700

interface PanelPosition { x: number; y: number }
interface PanelSize { width: number; height: number }

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_BREAKPOINT
}

function clampPanelPosition(position: PanelPosition, size: PanelSize): PanelPosition {
  if (typeof window === 'undefined') return position
  return {
    x: Math.max(PANEL_MARGIN, Math.min(window.innerWidth - size.width - PANEL_MARGIN, position.x)),
    y: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - 96, position.y)),
  }
}

function clampPanelSize(size: PanelSize): PanelSize {
  if (typeof window === 'undefined') return size
  return {
    width: Math.max(PANEL_MIN_WIDTH, Math.min(window.innerWidth - 2 * PANEL_MARGIN, size.width)),
    height: Math.max(PANEL_MIN_HEIGHT, Math.min(window.innerHeight - 2 * PANEL_MARGIN, size.height)),
  }
}

function readPanelSize(spellId: string): PanelSize {
  if (typeof window === 'undefined') return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT }
  try {
    const raw = localStorage.getItem(`oasis-spelltab-size-${spellId}`)
    if (raw) {
      const parsed = JSON.parse(raw) as PanelSize
      if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
        return clampPanelSize(parsed)
      }
    }
  } catch {}
  return clampPanelSize({ width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT })
}

function readPanelPosition(spellId: string, size: PanelSize): PanelPosition {
  if (typeof window === 'undefined') return { x: 80, y: 96 }
  try {
    const raw = localStorage.getItem(`oasis-spelltab-pos-${spellId}`)
    if (raw) {
      const parsed = JSON.parse(raw) as PanelPosition
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return clampPanelPosition(parsed, size)
      }
    }
  } catch {}
  // Default desktop position: right side, leaving room for world view on the left
  const x = Math.max(PANEL_MARGIN, window.innerWidth - size.width - 48)
  const y = 80
  return clampPanelPosition({ x, y }, size)
}

export interface SpellTabFrameProps {
  /** True when the spelltab should render. */
  isOpen: boolean
  /** Title shown in the frame header. */
  title: string
  /** Spell id — used as the localStorage namespace and the UI-layer id. */
  spellId: string
  /** Optional accent color for the header text/border (defaults to amber). */
  accentColor?: string
  /** Close callback — fired by the X button, Escape key, or programmatic close. */
  onClose: () => void
  /** Body content rendered in the scrollable region. */
  children: ReactNode
}

/**
 * Shared draggable / resizable frame used by every premium spelltab.
 *
 * Desktop: medium draggable panel (~480x600) anchored top-right by default.
 * Mobile (<= 700px width): fixed strip in the top-right corner so it never
 * occludes the world target zone where the user is aiming.
 *
 * Registers a UI layer while open (`spelltab-{spellId}`) so 3D world input
 * is correctly suppressed. Plays the `buttonClick` audio on close.
 */
export function SpellTabFrame({
  isOpen,
  title,
  spellId,
  accentColor = '#FBBF24',
  onClose,
  children,
}: SpellTabFrameProps) {
  useUILayer(`spelltab-${spellId}`, isOpen)

  const [mobile, setMobile] = useState<boolean>(() => isMobileViewport())
  const [size, setSize] = useState<PanelSize>(() => readPanelSize(spellId))
  const [position, setPosition] = useState<PanelPosition>(() => readPanelPosition(spellId, readPanelSize(spellId)))

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)
  const prevOpenRef = useRef(isOpen)

  const persistPosition = useCallback((next: PanelPosition) => {
    try { localStorage.setItem(`oasis-spelltab-pos-${spellId}`, JSON.stringify(next)) } catch {}
  }, [spellId])
  const persistSize = useCallback((next: PanelSize) => {
    try { localStorage.setItem(`oasis-spelltab-size-${spellId}`, JSON.stringify(next)) } catch {}
  }, [spellId])

  // ── Audio on open / close transition
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      useAudioManager.getState().play('panelOpen')
    } else if (!isOpen && prevOpenRef.current) {
      useAudioManager.getState().play('buttonClick')
    }
    prevOpenRef.current = isOpen
  }, [isOpen])

  // ── Track mobile viewport
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      setMobile(isMobileViewport())
      // Keep desktop panel on-screen after window resize
      setSize(current => {
        const clamped = clampPanelSize(current)
        persistSize(clamped)
        setPosition(currentPos => {
          const clampedPos = clampPanelPosition(currentPos, clamped)
          persistPosition(clampedPos)
          return clampedPos
        })
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [persistPosition, persistSize])

  // ── Escape closes
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  // ── Drag (title bar — desktop only)
  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (mobile || event.button !== 0) return
    const panel = event.currentTarget.closest('[data-menu-portal]') as HTMLElement | null
    const rect = panel?.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? position.x),
      offsetY: event.clientY - (rect?.top ?? position.y),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }, [mobile, position.x, position.y])

  const handleDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition(clampPanelPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }, size))
    event.preventDefault()
    event.stopPropagation()
  }, [size])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setPosition(current => {
      const clamped = clampPanelPosition(current, size)
      persistPosition(clamped)
      return clamped
    })
    event.preventDefault()
    event.stopPropagation()
  }, [persistPosition, size])

  // ── Resize handle (desktop only)
  const beginResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (mobile || event.button !== 0) return
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }, [mobile, size.height, size.width])

  const handleResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r || r.pointerId !== event.pointerId) return
    const next = clampPanelSize({
      width: r.startWidth + (event.clientX - r.startX),
      height: r.startHeight + (event.clientY - r.startY),
    })
    setSize(next)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const endResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r || r.pointerId !== event.pointerId) return
    resizeRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setSize(current => {
      const clamped = clampPanelSize(current)
      persistSize(clamped)
      return clamped
    })
    setPosition(current => clampPanelPosition(current, size))
    event.preventDefault()
    event.stopPropagation()
  }, [persistSize, size])

  if (!isOpen || typeof document === 'undefined') return null

  // ── Compute layout: mobile is a fixed top-right strip, desktop is positioned
  const panelStyle: React.CSSProperties = mobile
    ? {
        position: 'fixed',
        top: 8,
        right: 8,
        width: 'min(320px, calc(100vw - 16px))',
        maxHeight: 'calc(100vh - 16px)',
        zIndex: 9997,
        background: 'rgba(8, 8, 18, 0.92)',
        color: '#dde4ff',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
        border: `1px solid ${accentColor}55`,
      }
    : {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: 9997,
        background: 'rgba(8, 8, 18, 0.92)',
        color: '#dde4ff',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
        border: `1px solid ${accentColor}55`,
      }

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal={`spelltab-${spellId}`}
      className="overflow-hidden rounded-lg shadow-2xl flex flex-col"
      style={panelStyle}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      {/* ── Title bar (drag handle on desktop) */}
      <div
        className={`flex select-none items-center justify-between border-b px-3 py-2 ${mobile ? '' : 'cursor-move'}`}
        style={{ borderColor: `${accentColor}33` }}
        onPointerDown={beginDrag}
        onPointerMove={handleDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-base">{accentColorIcon(spellId)}</span>
          <span
            className="text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: accentColor }}
          >
            {title}
          </span>
        </div>
        <button
          onClick={onClose}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-white/70 hover:border-red-400/40 hover:text-red-200"
          aria-label={`Close ${title}`}
        >
          &times;
        </button>
      </div>

      {/* ── Scrollable body */}
      <div className="overflow-y-auto p-3 flex-1 min-h-0">
        {children}
      </div>

      {/* ── Desktop resize handle */}
      {!mobile && (
        <div
          className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end"
          style={{ color: `${accentColor}66` }}
          onPointerDown={beginResize}
          onPointerMove={handleResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          aria-label="Resize spelltab"
          title="Drag to resize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 10 L10 0 M3 10 L10 3 M6 10 L10 6" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  )
}

function accentColorIcon(spellId: string): string {
  if (spellId === 'text-to-3d') return '⚙️'
  if (spellId === 'text-to-pic') return '\u{1F3A8}'
  if (spellId === 'text-to-pic-building') return '\u{1F3DB}️'
  if (spellId === 'text-to-music') return '\u{1F3B5}'
  if (spellId === 'text-to-video') return '\u{1F3AC}'
  return '✨'
}

// ═══════════════════════════════════════════════════════════════════════════════
// Collapsible section header — reused inside every spelltab body
// ═══════════════════════════════════════════════════════════════════════════════

interface CollapsibleSectionProps {
  label: string
  expanded: boolean
  onToggle: () => void
  accentColor?: string
  rightSlot?: ReactNode
  children: ReactNode
}

export function CollapsibleSection({
  label,
  expanded,
  onToggle,
  accentColor = '#FBBF24',
  rightSlot,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="border border-gray-700/30 rounded-md overflow-hidden mb-2" style={{ borderColor: `${accentColor}33` }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 transition-colors cursor-pointer"
        style={{ background: expanded ? `${accentColor}10` : 'rgba(20, 20, 20, 0.5)' }}
      >
        <span
          className="text-[11px] uppercase tracking-wider font-mono font-medium flex items-center gap-1.5"
          style={{ color: accentColor }}
        >
          <span
            className="text-xs transition-transform duration-150 inline-block"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            &#9654;
          </span>
          {label}
        </span>
        {rightSlot ? (
          <span className="text-[9px] text-gray-400 font-mono">{rightSlot}</span>
        ) : null}
      </button>
      {expanded && (
        <div className="px-2.5 py-2 space-y-2" style={{ background: 'rgba(20, 20, 20, 0.3)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile soft-keyboard helper — scrolls focused input into view
// ═══════════════════════════════════════════════════════════════════════════════

/** Attach to onFocus on inputs/textareas inside spelltabs. */
export function scrollIntoViewOnFocus(event: React.FocusEvent<HTMLElement>) {
  const target = event.currentTarget
  // Defer so the soft keyboard has a chance to push the viewport first.
  window.setTimeout(() => {
    try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
  }, 120)
}
