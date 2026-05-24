// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TEXT 3D PANEL ░▒▓█ Type. Style. Place. Words become matter. █▓▒░
// ─═̷─═̷─ॐ─═̷─═̷─ Extruded letters land in front of the camera ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'

import { useUILayer } from '@/lib/input-manager'
import { SettingsContext } from '../scene-lib/contexts'
import { useOasisStore } from '@/store/oasisStore'
import {
  TEXT3D_FONT_OPTIONS,
  TEXT3D_MAX_LENGTH,
  clampText3DInput,
  makeText3DId,
  type Text3DFontId,
  type Text3DObject,
} from '@/lib/forge/text-3d-object'
import { getCameraSnapshot } from '@/lib/camera-bridge'

const PANEL_WIDTH = 300
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-text3d-panel-position'

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
  return clampPanelPosition({ x: 20, y: 96 })
}

export function Text3DPanel() {
  const isOpen = useOasisStore(s => s.text3dPanelOpen)
  const setOpen = useOasisStore(s => s.setText3dPanelOpen)
  const settings = useOasisStore(s => s.text3dSettings)
  const updateSettings = useOasisStore(s => s.updateText3dSettings)
  const addText3dObject = useOasisStore(s => s.addText3dObject)
  const { settings: uiSettings } = useContext(SettingsContext)

  const [panelPosition, setPanelPosition] = useState<PanelPosition>(getInitialPanelPosition)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const bringPanelToFront = useOasisStore(s => s.bringPanelToFront)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('text3d-panel', 9996))

  useUILayer('text3d-panel', isOpen)

  useEffect(() => {
    if (!isOpen) return
    const onResize = () => {
      setPanelPosition(current => {
        const clamped = clampPanelPosition(current)
        try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(clamped)) } catch {}
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen])

  const close = useCallback(() => setOpen(false), [setOpen])

  const persistPanelPosition = useCallback((position: PanelPosition) => {
    try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position)) } catch {}
  }, [])

  const beginPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const panel = event.currentTarget.closest('[data-menu-portal="text3d-panel"]') as HTMLElement | null
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

  const handlePlace = useCallback(() => {
    const text = clampText3DInput(settings.text || '').trim()
    if (!text) return
    const cam = getCameraSnapshot()
    let position: [number, number, number] = [0, 1.5, -3]
    let rotation: [number, number, number] = [0, 0, 0]
    if (cam) {
      // Place 3 metres in front of the camera at eye height; face the camera.
      const fwd = new THREE.Vector3(cam.forward[0], cam.forward[1], cam.forward[2]).normalize()
      const center = new THREE.Vector3(cam.position[0], cam.position[1], cam.position[2])
      const drop = center.clone().addScaledVector(fwd, 3)
      position = [drop.x, drop.y, drop.z]
      const yaw = Math.atan2(fwd.x, fwd.z)
      rotation = [0, yaw + Math.PI, 0]
    }
    const object: Text3DObject = {
      id: makeText3DId(),
      type: 'text_3d',
      text,
      fontId: settings.fontId as Text3DFontId,
      size: settings.size,
      depth: settings.depth,
      color: settings.color,
      toneBias: settings.toneBias,
      shininess: settings.shininess,
      position,
      rotation,
      createdAt: Date.now(),
    }
    addText3dObject(object)
  }, [settings, addText3dObject])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal="text3d-panel"
      className="fixed w-[300px] overflow-hidden rounded-lg border border-amber-400/30 shadow-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
        zIndex: panelZIndex,
        background: `rgba(18, 13, 6, ${Math.max(0.72, uiSettings.uiOpacity ?? 0.85)})`,
        color: '#fff3d6',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(245,158,11,0.18)',
      }}
      onMouseDown={() => bringPanelToFront('text3d-panel')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-amber-400/15 px-3 py-2"
        onPointerDown={beginPanelDrag}
        onPointerMove={dragPanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-200">Text 3D</div>
          <div className="text-[9px] font-mono text-amber-300/55">extruded · shiny · placeable</div>
        </div>
        <button
          onClick={close}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-amber-100/70 hover:border-red-400/40 hover:text-red-200"
          aria-label="Close text 3d panel"
        >
          ×
        </button>
      </div>

      <div className="space-y-3 p-3">
        <textarea
          value={settings.text}
          onChange={e => updateSettings({ text: clampText3DInput(e.target.value) })}
          rows={3}
          maxLength={TEXT3D_MAX_LENGTH}
          placeholder="Type your manifestation"
          className="w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-amber-50 placeholder-amber-100/30 focus:border-amber-300/40 focus:outline-none"
        />

        <div className="flex items-center gap-2">
          <label className="w-16 text-[10px] font-mono text-amber-100/65">font</label>
          <select
            value={settings.fontId}
            onChange={e => updateSettings({ fontId: e.target.value })}
            className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-amber-100"
          >
            {TEXT3D_FONT_OPTIONS.map(font => (
              <option key={font.id} value={font.id}>{font.label}</option>
            ))}
          </select>
        </div>

        <Slider label="size"  value={settings.size}  min={0.05} max={3} step={0.05} format={v => `${v.toFixed(2)}m`} onChange={v => updateSettings({ size: v })} />
        <Slider label="depth" value={settings.depth} min={0.01} max={1} step={0.01} format={v => `${(v * 100).toFixed(0)}cm`} onChange={v => updateSettings({ depth: v })} />
        <Slider label="shine" value={settings.shininess} min={0} max={1} step={0.05} format={v => `${(v * 100).toFixed(0)}%`} onChange={v => updateSettings({ shininess: v })} />
        <Slider
          label="tone"
          value={settings.toneBias}
          min={-1}
          max={1}
          step={0.05}
          format={v => v < -0.05 ? `B${Math.round(Math.abs(v) * 100)}` : v > 0.05 ? `W${Math.round(v * 100)}` : 'pick'}
          onChange={v => updateSettings({ toneBias: v })}
        />

        <div className="flex items-center gap-2">
          <label className="w-16 text-[10px] font-mono text-amber-100/65">color</label>
          <input
            type="color"
            value={settings.color}
            onChange={e => updateSettings({ color: e.target.value })}
            className="h-7 flex-1 cursor-pointer rounded border border-white/10 bg-black/30"
          />
        </div>

        <button
          onClick={handlePlace}
          disabled={!settings.text.trim()}
          className="w-full rounded-md border border-amber-300/60 bg-amber-400/25 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-amber-50 transition-colors hover:bg-amber-400/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Place 3m in front
        </button>

        <p className="text-[9px] leading-snug text-amber-200/40">
          Drops in front of your view. Drag with the Joystick after placement to fine-tune.
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
      <label className="w-16 text-[10px] font-mono text-amber-100/65">{label}</label>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 cursor-pointer accent-amber-400"
      />
      <span className="w-14 text-right text-[9px] font-mono text-amber-100/55">{format(value)}</span>
    </div>
  )
}
