// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PAINT BRUSH PANEL ░▒▓█ Wand customization — color, thickness, distance, mode █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Toggle PAINT MODE to capture canvas pointer events ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { SettingsContext } from '../scene-lib/contexts'
import { useOasisStore } from '@/store/oasisStore'

const PANEL_WIDTH = 280
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-paint-brush-panel-position'

interface PanelPosition { x: number; y: number }

function clampPanelPosition(position: PanelPosition): PanelPosition {
  if (typeof window === 'undefined') return position
  return {
    x: Math.max(PANEL_MARGIN, Math.min(window.innerWidth - PANEL_WIDTH - PANEL_MARGIN, position.x)),
    y: Math.max(PANEL_MARGIN, Math.min(window.innerHeight - 96, position.y)),
  }
}

function getInitialPanelPosition(): PanelPosition {
  if (typeof window === 'undefined') return { x: 0, y: 96 }
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || 'null') as PanelPosition | null
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return clampPanelPosition(stored)
  } catch {}
  return clampPanelPosition({ x: window.innerWidth - PANEL_WIDTH - 20, y: 96 })
}

export function PaintBrushPanel() {
  const isOpen = useOasisStore(s => s.paintBrushPanelOpen)
  const setOpen = useOasisStore(s => s.setPaintBrushPanelOpen)
  const settings = useOasisStore(s => s.paintBrushSettings)
  const updateSettings = useOasisStore(s => s.updatePaintBrushSettings)
  const paintHeldActive = useOasisStore(s => s.paintHeldActive)
  const setPaintHeldActive = useOasisStore(s => s.setPaintHeldActive)
  const { settings: uiSettings } = useContext(SettingsContext)

  const [panelPosition, setPanelPosition] = useState<PanelPosition>(getInitialPanelPosition)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useUILayer('paint-brush-panel', isOpen)

  // Auto-arm paint mode when the panel opens; release on close OR unmount.
  // Unmount-release matters: if hideEditTools flips true (visibility change,
  // portal jump to a read-only world), Scene.tsx unmounts the panel without
  // firing the close handler. Without the cleanup, paintHeldActive stays true
  // and PaintCursor silently captures canvas pointers in a world the user
  // can't actually paint in.
  useEffect(() => {
    if (isOpen) setPaintHeldActive(true)
    else setPaintHeldActive(false)
    return () => setPaintHeldActive(false)
  }, [isOpen, setPaintHeldActive])

  const close = useCallback(() => setOpen(false), [setOpen])

  const persistPanelPosition = useCallback((position: PanelPosition) => {
    try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position)) } catch {}
  }, [])

  const beginPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const panel = event.currentTarget.closest('[data-menu-portal="paint-brush-panel"]') as HTMLElement | null
    const rect = panel?.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? panelPosition.x),
      offsetY: event.clientY - (rect?.top ?? panelPosition.y),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }, [panelPosition.x, panelPosition.y])

  const dragPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPanelPosition(clampPanelPosition({ x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY }))
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const endPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    setPanelPosition(current => {
      const clamped = clampPanelPosition(current)
      persistPanelPosition(clamped)
      return clamped
    })
  }, [persistPanelPosition])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal="paint-brush-panel"
      className="fixed w-[280px] overflow-hidden rounded-lg border border-fuchsia-400/30 shadow-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
        zIndex: 9996,
        background: `rgba(15, 7, 18, ${Math.max(0.72, uiSettings.uiOpacity ?? 0.85)})`,
        color: '#f5e1ff',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(217,70,239,0.18)',
      }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-fuchsia-400/15 px-3 py-2"
        onPointerDown={beginPanelDrag}
        onPointerMove={dragPanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-fuchsia-200">
            Paint Wand
          </div>
          <div className="text-[9px] font-mono text-fuchsia-300/55">
            csillagszóró edition
          </div>
        </div>
        <button
          onClick={close}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-fuchsia-100/70 hover:border-red-400/40 hover:text-red-200"
          aria-label="Close paint wand"
        >
          ×
        </button>
      </div>

      <div className="space-y-3 p-3">
        <button
          onClick={() => setPaintHeldActive(!paintHeldActive)}
          className={`w-full rounded-md border px-3 py-2 text-[11px] font-bold uppercase tracking-wide transition-colors ${
            paintHeldActive
              ? 'border-fuchsia-300/60 bg-fuchsia-500/30 text-fuchsia-50'
              : 'border-white/15 bg-black/30 text-fuchsia-100/70 hover:text-fuchsia-100'
          }`}
        >
          {paintHeldActive ? 'Paint mode: ON — drag to draw' : 'Paint mode: OFF — click to arm'}
        </button>

        {/* Color */}
        <div className="flex items-center gap-2">
          <label className="w-20 text-[10px] font-mono text-fuchsia-100/65">color</label>
          <input
            type="color"
            value={settings.color}
            onChange={e => updateSettings({ color: e.target.value })}
            className="h-7 flex-1 cursor-pointer rounded border border-white/10 bg-black/30"
          />
        </div>

        {/* Thickness */}
        <Slider label="thickness" value={settings.thickness} min={0.005} max={0.2} step={0.005} format={v => `${(v * 100).toFixed(1)}cm`} onChange={v => updateSettings({ thickness: v })} />

        {/* Shininess */}
        <Slider label="shine" value={settings.shininess} min={0} max={1} step={0.05} format={v => `${(v * 100).toFixed(0)}%`} onChange={v => updateSettings({ shininess: v })} />

        {/* Distance */}
        <Slider label="distance" value={settings.distance} min={0.5} max={20} step={0.25} format={v => `${v.toFixed(2)}m`} onChange={v => updateSettings({ distance: v })} />

        {/* 2D / 3D */}
        <div className="flex items-center gap-2">
          <label className="w-20 text-[10px] font-mono text-fuchsia-100/65">mode</label>
          <div className="flex flex-1 gap-1">
            {(['3d', '2d'] as const).map(m => (
              <button
                key={m}
                onClick={() => updateSettings({ mode: m })}
                className={`flex-1 rounded border px-2 py-1 text-[10px] font-bold uppercase ${settings.mode === m ? 'border-fuchsia-300/60 bg-fuchsia-500/25 text-fuchsia-50' : 'border-white/10 bg-black/30 text-fuchsia-100/55 hover:text-fuchsia-100'}`}
              >
                {m === '3d' ? 'Tube 3D' : 'Line 2D'}
              </button>
            ))}
          </div>
        </div>

        {/* Velocity */}
        <div className="flex items-center gap-2">
          <label className="w-20 text-[10px] font-mono text-fuchsia-100/65">velocity</label>
          <button
            onClick={() => updateSettings({ varyByVelocity: !settings.varyByVelocity })}
            className={`flex-1 rounded border px-2 py-1 text-[10px] font-bold uppercase ${settings.varyByVelocity ? 'border-amber-300/60 bg-amber-400/20 text-amber-100' : 'border-white/10 bg-black/30 text-fuchsia-100/55 hover:text-fuchsia-100'}`}
            disabled={settings.mode !== '3d'}
            title={settings.mode !== '3d' ? '3D tube only' : 'Faster sweep = thinner stroke'}
          >
            {settings.varyByVelocity ? 'Velocity → thickness ON' : 'Uniform thickness'}
          </button>
        </div>

        <p className="text-[9px] leading-snug text-fuchsia-200/40">
          Hold mouse / finger and drag in the world. Strokes broadcast live to other visitors.
          Keep the panel open to keep painting; close it to interact normally.
        </p>
      </div>
    </div>,
    document.body,
  )
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-20 text-[10px] font-mono text-fuchsia-100/65">{label}</label>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 cursor-pointer accent-fuchsia-400"
      />
      <span className="w-14 text-right text-[9px] font-mono text-fuchsia-100/55">{format(value)}</span>
    </div>
  )
}
