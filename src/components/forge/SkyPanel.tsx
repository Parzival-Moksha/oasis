'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// SKY PANEL — Standalone draggable/resizable sky picker
// ─═̷─ Replaces the "open WizCon" path for the Sky button in WorldMenu. Visitors
// (owner or FFA/sandbox) need sky control without the whole forge surface, so
// this panel lifts only the sky-section from WizardConsole. Chrome mimics
// TerrainBrushPanel: title bar with drag handle, resize handle, scrollable
// content, X-button + Escape to close. ─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { useAudioManager } from '@/lib/audio-manager'
import { SKY_BACKGROUNDS } from '@/components/scene-lib/constants'
import { SettingsContext } from '../scene-lib'

const PANEL_MIN_WIDTH = 280
const PANEL_MIN_HEIGHT = 320
const DEFAULT_PANEL_WIDTH = 360
const DEFAULT_PANEL_HEIGHT = 540
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-sky-panel-position'
const PANEL_SIZE_KEY = 'oasis-sky-panel-size'

interface PanelPosition { x: number; y: number }
interface PanelSize { width: number; height: number }

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

function getInitialPanelPosition(size: PanelSize): PanelPosition {
  if (typeof window === 'undefined') return { x: 0, y: 96 }
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || 'null') as PanelPosition | null
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return clampPanelPosition(stored, size)
    }
  } catch {}
  // Center on first open.
  return clampPanelPosition({
    x: Math.round((window.innerWidth - size.width) / 2),
    y: Math.round((window.innerHeight - size.height) / 2),
  }, size)
}

function getInitialPanelSize(): PanelSize {
  if (typeof window === 'undefined') return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT }
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_SIZE_KEY) || 'null') as PanelSize | null
    if (stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)) {
      return clampPanelSize(stored)
    }
  } catch {}
  return clampPanelSize({ width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT })
}

interface SkyPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SkyPanel({ isOpen, onClose }: SkyPanelProps) {
  const worldSkyBackground = useOasisStore(s => s.worldSkyBackground)
  const setWorldSkyBackground = useOasisStore(s => s.setWorldSkyBackground)
  const bringPanelToFront = useOasisStore(s => s.bringPanelToFront)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('sky-panel', 9996))
  const { settings } = useContext(SettingsContext)

  const [panelSize, setPanelSize] = useState<PanelSize>(getInitialPanelSize)
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(() => getInitialPanelPosition(getInitialPanelSize()))

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)

  useUILayer('sky-panel', isOpen)

  const persistPanelPosition = useCallback((position: PanelPosition) => {
    try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position)) } catch {}
  }, [])
  const persistPanelSize = useCallback((size: PanelSize) => {
    try { localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(size)) } catch {}
  }, [])

  // Play audio on open/close transitions.
  const prevOpenRef = useRef(isOpen)
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      useAudioManager.getState().play('panelOpen')
    } else if (!isOpen && prevOpenRef.current) {
      useAudioManager.getState().play('panelClose')
    }
    prevOpenRef.current = isOpen
  }, [isOpen])

  const close = useCallback(() => onClose(), [onClose])

  // ── Drag (title bar)
  const beginPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const panel = event.currentTarget.closest('[data-menu-portal="sky-panel"]') as HTMLElement | null
    const rect = panel?.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? panelPosition.x),
      offsetY: event.clientY - (rect?.top ?? panelPosition.y),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    bringPanelToFront('sky-panel')
    event.preventDefault()
    event.stopPropagation()
  }, [bringPanelToFront, panelPosition.x, panelPosition.y])

  const dragPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPanelPosition(clampPanelPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }, panelSize))
    event.preventDefault()
    event.stopPropagation()
  }, [panelSize])

  const endPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setPanelPosition(current => {
      const clamped = clampPanelPosition(current, panelSize)
      persistPanelPosition(clamped)
      return clamped
    })
    event.preventDefault()
    event.stopPropagation()
  }, [panelSize, persistPanelPosition])

  // ── Resize (bottom-right handle)
  const beginPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    bringPanelToFront('sky-panel')
    event.preventDefault()
    event.stopPropagation()
  }, [bringPanelToFront, panelSize.height, panelSize.width])

  const resizePanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r || r.pointerId !== event.pointerId) return
    const next = clampPanelSize({
      width: r.startWidth + (event.clientX - r.startX),
      height: r.startHeight + (event.clientY - r.startY),
    })
    setPanelSize(next)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const endPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r || r.pointerId !== event.pointerId) return
    resizeRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setPanelSize(current => {
      const clamped = clampPanelSize(current)
      persistPanelSize(clamped)
      return clamped
    })
    setPanelPosition(current => clampPanelPosition(current, panelSize))
    event.preventDefault()
    event.stopPropagation()
  }, [panelSize, persistPanelSize])

  // ── Escape closes
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  // ── Window resize: keep panel on-screen
  useEffect(() => {
    if (!isOpen) return
    const onResize = () => {
      setPanelSize(current => {
        const clampedSize = clampPanelSize(current)
        persistPanelSize(clampedSize)
        setPanelPosition(currentPos => {
          const clampedPos = clampPanelPosition(currentPos, clampedSize)
          persistPanelPosition(clampedPos)
          return clampedPos
        })
        return clampedSize
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen, persistPanelPosition, persistPanelSize])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal="sky-panel"
      className="fixed overflow-hidden rounded-lg border border-indigo-400/30 shadow-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
        width: panelSize.width,
        height: panelSize.height,
        zIndex: panelZIndex,
        background: `rgba(8, 8, 18, ${Math.max(0.72, settings.uiOpacity ?? 0.85)})`,
        color: '#dde4ff',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(99,102,241,0.16)',
      }}
      onMouseDown={() => bringPanelToFront('sky-panel')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      {/* ─═̷─ Title bar / drag handle ─═̷─ */}
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-indigo-400/20 px-3 py-2"
        onPointerDown={beginPanelDrag}
        onPointerMove={dragPanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-200">
            Sky Background
          </div>
          <div className="text-[9px] font-mono text-indigo-300/55">
            {SKY_BACKGROUNDS.find(s => s.id === worldSkyBackground)?.name || 'Procedural Stars'}
          </div>
        </div>
        <button
          onClick={close}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-indigo-100/70 hover:border-red-400/40 hover:text-red-200"
          aria-label="Close sky panel"
        >
          &times;
        </button>
      </div>

      {/* ─═̷─ Scrollable content ─═̷─ */}
      <div
        className="overflow-y-auto p-3"
        style={{ height: `calc(100% - 40px - 16px)` }}
      >
        <div className="grid grid-cols-2 gap-1.5">
          {SKY_BACKGROUNDS.map(sky => {
            const isActive = worldSkyBackground === sky.id
            return (
              <button
                key={sky.id}
                onClick={() => setWorldSkyBackground(sky.id)}
                className={`rounded-lg border px-2 py-1.5 transition-all duration-200 text-left ${
                  isActive
                    ? 'border-indigo-500/60 bg-indigo-500/10'
                    : 'border-gray-700/30 bg-black/40 hover:border-indigo-500/30 hover:bg-indigo-500/5'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{sky.path ? (sky.path.endsWith('.exr') ? '\u{1F30C}' : '\u{1F303}') : '✨'}</span>
                  <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-300' : 'text-gray-400'}`}>
                    {sky.name}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─═̷─ Resize handle (bottom-right) ─═̷─ */}
      <div
        className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end text-indigo-300/40 hover:text-indigo-200"
        onPointerDown={beginPanelResize}
        onPointerMove={resizePanel}
        onPointerUp={endPanelResize}
        onPointerCancel={endPanelResize}
        aria-label="Resize sky panel"
        title="Drag to resize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 10 L10 0 M3 10 L10 3 M6 10 L10 6" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>
    </div>,
    document.body,
  )
}
