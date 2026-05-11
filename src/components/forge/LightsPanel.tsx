'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTS PANEL — Standalone draggable/resizable world-lights editor
// ─═̷─ Replaces the "open WizCon" path for the Lights button in WorldMenu.
// Visitors (owner or FFA/sandbox) need lighting control without the full forge
// surface, so this panel lifts only the lights-section from WizardConsole.
// Chrome mimics TerrainBrushPanel; the inner controls reuse the same store
// actions WizCon does (addWorldLight / updateWorldLight / removeWorldLight) so
// scene mutations land identically. ─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

import { useCallback, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { useAudioManager } from '@/lib/audio-manager'
import { LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_STEP, type WorldLightType } from '@/lib/conjure/types'
import { LightTooltipWrap } from './wizard/shared'
import { SettingsContext } from '../scene-lib'

const PANEL_MIN_WIDTH = 280
const PANEL_MIN_HEIGHT = 360
const DEFAULT_PANEL_WIDTH = 360
const DEFAULT_PANEL_HEIGHT = 600
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-lights-panel-position'
const PANEL_SIZE_KEY = 'oasis-lights-panel-size'

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

interface LightsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function LightsPanel({ isOpen, onClose }: LightsPanelProps) {
  const worldLights = useOasisStore(s => s.worldLights)
  const addWorldLight = useOasisStore(s => s.addWorldLight)
  const updateWorldLight = useOasisStore(s => s.updateWorldLight)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)
  const bringPanelToFront = useOasisStore(s => s.bringPanelToFront)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('lights-panel', 9996))
  const { settings } = useContext(SettingsContext)

  const [panelSize, setPanelSize] = useState<PanelSize>(getInitialPanelSize)
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(() => getInitialPanelPosition(getInitialPanelSize()))

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startWidth: number; startHeight: number } | null>(null)

  useUILayer('lights-panel', isOpen)

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
    const panel = event.currentTarget.closest('[data-menu-portal="lights-panel"]') as HTMLElement | null
    const rect = panel?.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? panelPosition.x),
      offsetY: event.clientY - (rect?.top ?? panelPosition.y),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    bringPanelToFront('lights-panel')
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
    bringPanelToFront('lights-panel')
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
      data-menu-portal="lights-panel"
      className="fixed overflow-hidden rounded-lg border border-yellow-400/30 shadow-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
        width: panelSize.width,
        height: panelSize.height,
        zIndex: panelZIndex,
        background: `rgba(14, 10, 6, ${Math.max(0.72, settings.uiOpacity ?? 0.85)})`,
        color: '#fde9a8',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(250,204,21,0.16)',
      }}
      onMouseDown={() => bringPanelToFront('lights-panel')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      {/* ─═̷─ Title bar / drag handle ─═̷─ */}
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-yellow-400/20 px-3 py-2"
        onPointerDown={beginPanelDrag}
        onPointerMove={dragPanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-yellow-200">
            Lights
          </div>
          <div className="text-[9px] font-mono text-yellow-300/55">
            {worldLights.length} source{worldLights.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={close}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-yellow-100/70 hover:border-red-400/40 hover:text-red-200"
          aria-label="Close lights panel"
        >
          &times;
        </button>
      </div>

      {/* ─═̷─ Scrollable content (lifted from WizardConsole world-tab lights section) ─═̷─ */}
      <div
        className="overflow-y-auto p-3"
        style={{ height: `calc(100% - 40px - 16px)` }}
      >
        {/* ── Scene lights: ambient / hemisphere / directional / environment ── */}
        {worldLights.filter(l => l.type === 'ambient' || l.type === 'hemisphere' || l.type === 'directional' || l.type === 'environment').map(light => {
          const pos = light.position || [30, 40, 20]
          const dist = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) || 50
          const elevation = Math.asin(Math.min(1, Math.max(-1, pos[1] / dist))) * 180 / Math.PI
          const azimuth = ((Math.atan2(pos[0], pos[2]) * 180 / Math.PI) + 360) % 360

          return (
            <LightTooltipWrap key={light.id} type={light.type} className="relative mb-2">
              <div className="p-2 rounded-lg border border-gray-700/30 bg-black/30">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{light.type === 'ambient' ? '🌫️' : light.type === 'hemisphere' ? '🌗' : light.type === 'environment' ? '🌐' : '☀️'}</span>
                    <span className="text-[10px] font-medium text-gray-300">
                      {light.type === 'ambient' ? 'Ambient' : light.type === 'hemisphere' ? 'Hemisphere' : light.type === 'environment' ? 'Environment (IBL)' : 'Sun'}
                    </span>
                  </div>
                  <button
                    onClick={() => removeWorldLight(light.id)}
                    className="w-5 h-5 flex items-center justify-center rounded bg-red-500/10 border border-red-500/20 text-red-400/70 hover:bg-red-500/30 hover:text-red-300 hover:border-red-400/40 text-sm font-bold transition-all"
                    title="Remove light"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-1.5">
                  {light.type !== 'environment' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-mono w-10">{light.type === 'hemisphere' ? 'Sky' : 'Color'}</span>
                      <input
                        type="color"
                        value={light.color}
                        onChange={e => updateWorldLight(light.id, { color: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[8px] text-gray-400 font-mono">{light.color}</span>
                    </div>
                  )}
                  {light.type === 'hemisphere' && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-mono w-10">Gnd</span>
                      <input
                        type="color"
                        value={light.groundColor || '#3a5f0b'}
                        onChange={e => updateWorldLight(light.id, { groundColor: e.target.value })}
                        className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <span className="text-[8px] text-gray-400 font-mono">{light.groundColor || '#3a5f0b'}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 font-mono w-10">Int</span>
                    <input
                      type="range"
                      min={0}
                      max={LIGHT_INTENSITY_MAX[light.type]}
                      step={LIGHT_INTENSITY_STEP[light.type]}
                      value={light.intensity}
                      onChange={e => updateWorldLight(light.id, { intensity: parseFloat(e.target.value) })}
                      className="flex-1 h-1 accent-yellow-500"
                    />
                    <span className="text-[9px] text-yellow-400/70 font-mono w-8 text-right">{light.intensity.toFixed(1)}</span>
                  </div>
                  {light.type === 'directional' && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Azim</span>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={1}
                          value={Math.round(azimuth)}
                          onChange={e => {
                            const a = parseFloat(e.target.value) * Math.PI / 180
                            const el = Math.round(elevation) * Math.PI / 180
                            const r = 50
                            updateWorldLight(light.id, { position: [
                              r * Math.cos(el) * Math.sin(a),
                              r * Math.sin(el),
                              r * Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(azimuth)}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Elev</span>
                        <input
                          type="range"
                          min={5}
                          max={90}
                          step={1}
                          value={Math.round(elevation)}
                          onChange={e => {
                            const el = parseFloat(e.target.value) * Math.PI / 180
                            const a = Math.round(azimuth) * Math.PI / 180
                            const r = 50
                            updateWorldLight(light.id, { position: [
                              r * Math.cos(el) * Math.sin(a),
                              r * Math.sin(el),
                              r * Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(elevation)}°</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </LightTooltipWrap>
          )
        })}

        {/* Add scene light buttons */}
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <LightTooltipWrap type="directional" className="relative flex-1">
            <button
              onClick={() => addWorldLight('directional')}
              className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
            >
              + Sun
            </button>
          </LightTooltipWrap>
          <LightTooltipWrap type="ambient" className="relative flex-1">
            <button
              onClick={() => addWorldLight('ambient')}
              className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
            >
              + Ambient
            </button>
          </LightTooltipWrap>
          <LightTooltipWrap type="hemisphere" className="relative flex-1">
            <button
              onClick={() => addWorldLight('hemisphere')}
              className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
            >
              + Hemi
            </button>
          </LightTooltipWrap>
          {!worldLights.some(l => l.type === 'environment') && (
            <LightTooltipWrap type="environment" className="relative flex-1">
              <button
                onClick={() => addWorldLight('environment')}
                className="w-full text-[9px] font-mono text-gray-500 hover:text-yellow-300 border border-gray-700/30 hover:border-yellow-500/30 rounded px-2 py-1 transition-colors"
              >
                + IBL
              </button>
            </LightTooltipWrap>
          )}
        </div>

        {/* ── Positional lights: point / spot (3D-placed orbs) ── */}
        <div className="text-[9px] text-gray-400 font-mono mb-1">Place in world:</div>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            { type: 'point' as WorldLightType, icon: '💡', label: 'Point', desc: 'Omni glow' },
            { type: 'spot' as WorldLightType, icon: '🔦', label: 'Spot', desc: 'Cone beam' },
          ]).map(light => (
            <LightTooltipWrap key={light.type} type={light.type} className="relative">
              <button
                onClick={() => addWorldLight(light.type)}
                className="w-full rounded-lg border border-gray-700/30 bg-black/40 hover:border-yellow-500/40 hover:bg-yellow-500/5 p-2 transition-all duration-200 text-left group"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{light.icon}</span>
                  <div>
                    <div className="text-[10px] font-medium text-gray-400 group-hover:text-yellow-300 transition-colors">
                      {light.label}
                    </div>
                    <div className="text-[8px] text-gray-400">{light.desc}</div>
                  </div>
                </div>
              </button>
            </LightTooltipWrap>
          ))}
        </div>

        {/* ── Existing positional lights: inline controls ── */}
        {worldLights.filter(l => l.type === 'point' || l.type === 'spot').map(light => (
          <LightTooltipWrap key={light.id} type={light.type} className="relative mt-1.5">
            <div className="p-2 rounded-lg border border-gray-700/30 bg-black/30">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{light.type === 'point' ? '💡' : '🔦'}</span>
                  <span className="text-[10px] font-medium text-gray-300">
                    {light.type === 'point' ? 'Point' : 'Spot'}
                  </span>
                  <span className="text-[8px] text-gray-400 font-mono">
                    ({light.position.map(v => Math.round(v)).join(', ')})
                  </span>
                </div>
                <button
                  onClick={() => removeWorldLight(light.id)}
                  className="text-[9px] text-red-400/50 hover:text-red-300 font-mono"
                  title="Remove light"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-500 font-mono w-10">Color</span>
                  <input
                    type="color"
                    value={light.color}
                    onChange={e => updateWorldLight(light.id, { color: e.target.value })}
                    className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="text-[8px] text-gray-400 font-mono">{light.color}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-500 font-mono w-10">Int</span>
                  <input
                    type="range"
                    min={0}
                    max={LIGHT_INTENSITY_MAX[light.type]}
                    step={LIGHT_INTENSITY_STEP[light.type]}
                    value={light.intensity}
                    onChange={e => updateWorldLight(light.id, { intensity: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-yellow-500"
                  />
                  <span className="text-[9px] text-yellow-400/70 font-mono w-8 text-right">{light.intensity.toFixed(1)}</span>
                </div>
                {light.type === 'spot' && (() => {
                  const tgt = light.target || [0, -1, 0]
                  const tLen = Math.sqrt(tgt[0] * tgt[0] + tgt[1] * tgt[1] + tgt[2] * tgt[2]) || 1
                  const spotElev = Math.asin(Math.min(1, Math.max(-1, tgt[1] / tLen))) * 180 / Math.PI
                  const spotAzim = ((Math.atan2(tgt[0], tgt[2]) * 180 / Math.PI) + 360) % 360
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Angle</span>
                        <input
                          type="range"
                          min={5}
                          max={90}
                          step={1}
                          value={light.angle ?? 45}
                          onChange={e => updateWorldLight(light.id, { angle: parseFloat(e.target.value) })}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(light.angle ?? 45)}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Azim</span>
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={1}
                          value={Math.round(spotAzim)}
                          onChange={e => {
                            const a = parseFloat(e.target.value) * Math.PI / 180
                            const el = Math.round(spotElev) * Math.PI / 180
                            updateWorldLight(light.id, { target: [
                              Math.cos(el) * Math.sin(a),
                              Math.sin(el),
                              Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(spotAzim)}°</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-500 font-mono w-10">Elev</span>
                        <input
                          type="range"
                          min={-90}
                          max={90}
                          step={1}
                          value={Math.round(spotElev)}
                          onChange={e => {
                            const el = parseFloat(e.target.value) * Math.PI / 180
                            const a = Math.round(spotAzim) * Math.PI / 180
                            updateWorldLight(light.id, { target: [
                              Math.cos(el) * Math.sin(a),
                              Math.sin(el),
                              Math.cos(el) * Math.cos(a),
                            ] as [number, number, number] })
                          }}
                          className="flex-1 h-1 accent-orange-500"
                        />
                        <span className="text-[9px] text-orange-400/70 font-mono w-8 text-right">{Math.round(spotElev)}°</span>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </LightTooltipWrap>
        ))}
      </div>

      {/* ─═̷─ Resize handle (bottom-right) ─═̷─ */}
      <div
        className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end text-yellow-300/40 hover:text-yellow-200"
        onPointerDown={beginPanelResize}
        onPointerMove={resizePanel}
        onPointerUp={endPanelResize}
        onPointerCancel={endPanelResize}
        aria-label="Resize lights panel"
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
