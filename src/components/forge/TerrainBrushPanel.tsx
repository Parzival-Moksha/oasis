'use client'

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { GROUND_PRESETS, getTextureUrls, type GroundPreset } from '@/lib/forge/ground-textures'
import { hasTerrainRelief } from '@/lib/forge/terrain-brush'
import { SettingsContext } from '../scene-lib'

const PANEL_WIDTH = 320
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-terrain-brush-panel-position'
const MOBILE_VIEWPORT_PX = 700

interface PanelPosition {
  x: number
  y: number
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= MOBILE_VIEWPORT_PX
}

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
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return clampPanelPosition(stored)
    }
  } catch {}
  return clampPanelPosition({ x: window.innerWidth - PANEL_WIDTH - 20, y: 96 })
}

function GroundTextureThumb({ preset, size = 12 }: { preset: GroundPreset; size?: 12 | 16 }) {
  const [failed, setFailed] = useState(false)
  const src = preset.customTextureUrl || (preset.assetName ? getTextureUrls(preset.assetName).diffuse : null)
  const sizeClasses = size === 16 ? 'h-16 w-16' : 'h-12 w-12'

  return (
    <div
      className={`relative ${sizeClasses} flex-shrink-0 overflow-hidden rounded-md border border-white/10`}
      style={{ backgroundColor: preset.color }}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={preset.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-lg">
          {preset.icon}
        </div>
      )}
    </div>
  )
}

export function TerrainBrushPanel() {
  const isOpen = useOasisStore(s => s.terrainBrushPanelOpen)
  const mode = useOasisStore(s => s.terrainBrushMode)
  const setOpen = useOasisStore(s => s.setTerrainBrushPanelOpen)
  const setMode = useOasisStore(s => s.setTerrainBrushMode)
  const terrainBrushIntensity = useOasisStore(s => s.terrainBrushIntensity)
  const terrainBrushRadius = useOasisStore(s => s.terrainBrushRadius)
  const terrainBrushDirection = useOasisStore(s => s.terrainBrushDirection)
  const setTerrainBrushIntensity = useOasisStore(s => s.setTerrainBrushIntensity)
  const setTerrainBrushRadius = useOasisStore(s => s.setTerrainBrushRadius)
  const setTerrainBrushDirection = useOasisStore(s => s.setTerrainBrushDirection)
  const resetTerrainHeights = useOasisStore(s => s.resetTerrainHeights)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const groundTiles = useOasisStore(s => s.groundTiles)
  const paintMode = useOasisStore(s => s.paintMode)
  const paintBrushPresetId = useOasisStore(s => s.paintBrushPresetId)
  const paintBrushSize = useOasisStore(s => s.paintBrushSize)
  const setPaintBrushSize = useOasisStore(s => s.setPaintBrushSize)
  const paintBrushStretch = useOasisStore(s => s.paintBrushStretch)
  const setPaintBrushStretch = useOasisStore(s => s.setPaintBrushStretch)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const exitPaintMode = useOasisStore(s => s.exitPaintMode)
  const setGroundPreset = useOasisStore(s => s.setGroundPreset)
  const clearAllGroundTiles = useOasisStore(s => s.clearAllGroundTiles)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const bringPanelToFront = useOasisStore(s => s.bringPanelToFront)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('terrain-brush', 9996))
  const { settings } = useContext(SettingsContext)
  const [texturesExpanded, setTexturesExpanded] = useState(false)
  const [deletedPresetIds, setDeletedPresetIds] = useState<Set<string>>(() => new Set())
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(getInitialPanelPosition)
  const [mobileViewport, setMobileViewport] = useState<boolean>(() => isMobileViewport())

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useUILayer('terrain-brush', isOpen)

  const allPresets = useMemo(
    () => [...GROUND_PRESETS, ...customGroundPresets].filter(p => !deletedPresetIds.has(p.id)),
    [customGroundPresets, deletedPresetIds],
  )
  const activePreset = allPresets.find(preset => preset.id === paintBrushPresetId)
  const reliefActive = hasTerrainRelief(terrainHeights)

  const close = useCallback(() => setOpen(false), [setOpen])

  const persistPanelPosition = useCallback((position: PanelPosition) => {
    try {
      localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(position))
    } catch {}
  }, [])

  const beginPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const panel = event.currentTarget.closest('[data-menu-portal="terrain-brush-panel"]') as HTMLElement | null
    const rect = panel?.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? panelPosition.x),
      offsetY: event.clientY - (rect?.top ?? panelPosition.y),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    bringPanelToFront('terrain-brush')
    event.preventDefault()
    event.stopPropagation()
  }, [bringPanelToFront, panelPosition.x, panelPosition.y])

  const dragPanel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = clampPanelPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    })
    setPanelPosition(next)
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const endPanelDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {}
    setPanelPosition(current => {
      const clamped = clampPanelPosition(current)
      persistPanelPosition(clamped)
      return clamped
    })
    event.preventDefault()
    event.stopPropagation()
  }, [persistPanelPosition])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen) return
    const onResize = () => {
      setMobileViewport(isMobileViewport())
      setPanelPosition(current => {
        const clamped = clampPanelPosition(current)
        persistPanelPosition(clamped)
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen, persistPanelPosition])

  // ─═̷─ Auto-collapse the texture grid whenever paint mode is (re-)entered.
  // External triggers like "Use as tile" from a text-to-pic spelltab call
  // enterPaintMode + open this panel; the grid is noise at that moment.
  useEffect(() => {
    if (paintMode) setTexturesExpanded(false)
  }, [paintMode, paintBrushPresetId])

  if (!isOpen || typeof document === 'undefined') return null

  const panelStyle: React.CSSProperties = mobileViewport
    ? {
        right: 8,
        top: 64,
        width: `min(${PANEL_WIDTH}px, calc(100vw - 16px))`,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        zIndex: panelZIndex,
        background: `rgba(7, 12, 10, ${Math.max(0.72, settings.uiOpacity ?? 0.85)})`,
        color: '#d7f7e7',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(16,185,129,0.12)',
      }
    : {
        left: panelPosition.x,
        top: panelPosition.y,
        width: PANEL_WIDTH,
        zIndex: panelZIndex,
        background: `rgba(7, 12, 10, ${Math.max(0.72, settings.uiOpacity ?? 0.85)})`,
        color: '#d7f7e7',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(16,185,129,0.12)',
      }

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal="terrain-brush-panel"
      className="fixed overflow-hidden rounded-lg border border-emerald-400/25 shadow-2xl"
      style={panelStyle}
      onMouseDown={() => bringPanelToFront('terrain-brush')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className={`flex select-none items-center justify-between border-b border-emerald-400/15 px-3 py-2 ${mobileViewport ? '' : 'cursor-move'}`}
        onPointerDown={mobileViewport ? undefined : beginPanelDrag}
        onPointerMove={mobileViewport ? undefined : dragPanel}
        onPointerUp={mobileViewport ? undefined : endPanelDrag}
        onPointerCancel={mobileViewport ? undefined : endPanelDrag}
      >
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">
            Terrain Brush
          </div>
          <div className="text-[9px] font-mono text-emerald-300/55">
            {mode === 'sculpt' ? 'Elevation' : activePreset ? `Paint - ${activePreset.name}` : 'Texture'}
          </div>
        </div>
        <button
          onClick={close}
          onPointerDown={event => event.stopPropagation()}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-lg leading-none text-emerald-100/70 hover:border-red-400/40 hover:text-red-200"
          aria-label="Close terrain brush"
        >
          &times;
        </button>
      </div>

      <div className="flex gap-1 border-b border-emerald-400/10 p-2">
        <button
          onClick={() => setMode('texture')}
          className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-bold transition-colors ${mode === 'texture' ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-100' : 'border-white/10 bg-black/25 text-emerald-100/55 hover:text-emerald-100'}`}
        >
          Texture
        </button>
        <button
          onClick={() => setMode('sculpt')}
          className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-bold transition-colors ${mode === 'sculpt' ? 'border-amber-400/50 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-black/25 text-emerald-100/55 hover:text-emerald-100'}`}
        >
          Elevation
        </button>
      </div>

      <div className="max-h-[68vh] overflow-y-auto p-3">
        {mode === 'texture' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-2.5">
              <div className="mb-2 text-[10px] font-mono font-bold text-emerald-200">
                Paint Mode - {activePreset?.name || 'No Brush'}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-emerald-100/55">Brush:</span>
                {[1, 3, 5].map(size => (
                  <button
                    key={size}
                    onClick={() => setPaintBrushSize(size)}
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-mono ${paintBrushSize === size ? 'border-emerald-300/60 bg-emerald-300/20 text-emerald-100' : 'border-white/10 text-emerald-100/55 hover:text-emerald-100'}`}
                  >
                    {size}x{size}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[9px] font-mono text-emerald-100/55">Stretch:</span>
                {[1, 2, 4, 8].map(stretch => (
                  <button
                    key={stretch}
                    onClick={() => setPaintBrushStretch(stretch)}
                    title={`Each tile renders ${stretch}x${stretch}m (texture zoomed ${stretch}x)`}
                    className={`rounded border px-1.5 py-0.5 text-[9px] font-mono ${paintBrushStretch === stretch ? 'border-amber-300/60 bg-amber-300/20 text-amber-100' : 'border-white/10 text-emerald-100/55 hover:text-emerald-100'}`}
                  >
                    {stretch}x
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (paintBrushPresetId) setGroundPreset(paintBrushPresetId)
                }}
                disabled={!paintBrushPresetId}
                className="mt-2 w-full rounded-md border-2 border-amber-300/55 bg-gradient-to-r from-amber-500/25 via-amber-400/30 to-amber-500/25 px-3 py-2.5 text-[12px] font-black uppercase tracking-[0.2em] text-amber-50 shadow-[0_0_22px_rgba(251,191,36,0.3)] transition hover:from-amber-500/40 hover:via-amber-400/45 hover:to-amber-500/40 hover:shadow-[0_0_36px_rgba(251,191,36,0.55)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.035] disabled:text-white/35 disabled:shadow-none"
                title="Paint the entire ground with the selected texture"
              >
                FULL PAINT
              </button>
              <div className="mt-1.5 text-[8px] font-mono text-emerald-100/45">
                L-click: paint | R-click: erase | ESC: exit
              </div>
            </div>

            <button
              onClick={() => setTexturesExpanded(expanded => !expanded)}
              className="flex w-full items-center justify-between rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-left text-[10px] font-mono text-emerald-100/75 hover:border-emerald-400/25"
            >
              <span>Texture thumbnails</span>
              <span>{texturesExpanded ? 'Hide' : 'Show'} ({allPresets.length})</span>
            </button>

            {texturesExpanded && (
              <div className="grid grid-cols-4 gap-1.5">
                {allPresets.filter(preset => preset.id !== 'none').map(preset => {
                  const selected = paintMode && paintBrushPresetId === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      className={`relative flex items-center justify-center rounded-md border p-1 transition-colors cursor-pointer ${selected ? 'border-emerald-300/70 bg-emerald-300/15 shadow-[0_0_14px_rgba(16,185,129,0.35)]' : 'border-white/10 bg-black/20 hover:border-emerald-400/30'}`}
                      onClick={() => {
                        enterPaintMode(preset.id)
                        setTexturesExpanded(false)
                      }}
                    >
                      <GroundTextureThumb preset={preset} size={16} />
                    </button>
                  )
                })}
              </div>
            )}

            {Object.keys(groundTiles).length > 0 && (
              <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[9px] font-mono">
                <span className="text-emerald-100/45">{Object.keys(groundTiles).length} painted tiles</span>
                <button onClick={clearAllGroundTiles} className="text-red-300/70 hover:text-red-200">
                  Clear all tiles
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {(['up', 'down'] as const).map(direction => (
                <button
                  key={direction}
                  onClick={() => setTerrainBrushDirection(direction)}
                  className={`rounded-md border px-2 py-2 text-[11px] font-bold capitalize ${terrainBrushDirection === direction ? (direction === 'up' ? 'border-amber-300/60 bg-amber-300/15 text-amber-100' : 'border-sky-300/60 bg-sky-300/15 text-sky-100') : 'border-white/10 bg-black/25 text-emerald-100/55 hover:text-emerald-100'}`}
                >
                  {direction}
                </button>
              ))}
            </div>

            <label className="block rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="mb-2 flex items-center justify-between text-[10px] font-mono">
                <span className="text-emerald-100/55">Intensity / second</span>
                <span className="text-amber-200">{terrainBrushIntensity.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={8}
                step={0.1}
                value={terrainBrushIntensity}
                onChange={event => setTerrainBrushIntensity(parseFloat(event.target.value))}
                className="h-1 w-full accent-amber-400"
              />
            </label>

            <label className="block rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="mb-2 flex items-center justify-between text-[10px] font-mono">
                <span className="text-emerald-100/55">Range radius</span>
                <span className="text-emerald-200">{terrainBrushRadius.toFixed(1)}m</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={terrainBrushRadius}
                onChange={event => setTerrainBrushRadius(parseFloat(event.target.value))}
                className="h-1 w-full accent-emerald-400"
              />
            </label>

            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-[9px] font-mono text-amber-100/70">
              Hold L-click on the ground to sculpt. Release to save the stroke.
            </div>

            <button
              onClick={resetTerrainHeights}
              disabled={!reliefActive}
              className="w-full rounded-md border border-red-400/25 px-2 py-2 text-[10px] font-mono text-red-200/80 disabled:cursor-not-allowed disabled:opacity-35 enabled:hover:bg-red-400/10"
            >
              Reset relief
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
