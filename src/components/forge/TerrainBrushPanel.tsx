'use client'

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { GROUND_PRESETS, getTextureUrls, type GroundPreset } from '@/lib/forge/ground-textures'
import { hasTerrainRelief } from '@/lib/forge/terrain-brush'
import { SettingsContext } from '../scene-lib'
import { DeleteButton } from './DeleteButton'
import { canMutateLibrary } from '@/lib/library-permissions'

const PANEL_WIDTH = 320
const PANEL_MARGIN = 12
const PANEL_POSITION_KEY = 'oasis-terrain-brush-panel-position'

interface PanelPosition {
  x: number
  y: number
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

function GroundTextureThumb({ preset }: { preset: GroundPreset }) {
  const [failed, setFailed] = useState(false)
  const src = preset.customTextureUrl || (preset.assetName ? getTextureUrls(preset.assetName).diffuse : null)

  return (
    <div
      className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border border-white/10"
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
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const exitPaintMode = useOasisStore(s => s.exitPaintMode)
  const clearAllGroundTiles = useOasisStore(s => s.clearAllGroundTiles)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)
  const bringPanelToFront = useOasisStore(s => s.bringPanelToFront)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('terrain-brush', 9996))
  const { settings } = useContext(SettingsContext)
  const [texturesExpanded, setTexturesExpanded] = useState(false)
  const [deletedPresetIds, setDeletedPresetIds] = useState<Set<string>>(() => new Set())
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(getInitialPanelPosition)

  const banishGroundPreset = useCallback(async (id: string) => {
    setDeletedPresetIds(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    try {
      await fetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'ground', id }),
      })
    } catch (err) {
      console.error('[TerrainBrush] Delete failed:', err)
    }
  }, [])
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
      setPanelPosition(current => {
        const clamped = clampPanelPosition(current)
        persistPanelPosition(clamped)
        return clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen, persistPanelPosition])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-ui-panel
      data-menu-portal="terrain-brush-panel"
      className="fixed w-[320px] overflow-hidden rounded-lg border border-emerald-400/25 shadow-2xl"
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
        zIndex: panelZIndex,
        background: `rgba(7, 12, 10, ${Math.max(0.72, settings.uiOpacity ?? 0.85)})`,
        color: '#d7f7e7',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45), 0 0 28px rgba(16,185,129,0.12)',
      }}
      onMouseDown={() => bringPanelToFront('terrain-brush')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="flex cursor-move select-none items-center justify-between border-b border-emerald-400/15 px-3 py-2"
        onPointerDown={beginPanelDrag}
        onPointerMove={dragPanel}
        onPointerUp={endPanelDrag}
        onPointerCancel={endPanelDrag}
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
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-mono font-bold text-emerald-200">
                  Paint Mode - {activePreset?.name || 'No Brush'}
                </div>
                <button
                  onClick={exitPaintMode}
                  className="rounded border border-red-400/25 px-1.5 py-0.5 text-[9px] font-mono text-red-300/80 hover:bg-red-400/10"
                >
                  Exit
                </button>
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
              <div className="mt-1.5 text-[8px] font-mono text-emerald-100/45">
                L-click: paint | R-click: erase tile | ESC: exit
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
              <div className="space-y-1.5">
                {allPresets.map(preset => {
                  const selected = paintMode && paintBrushPresetId === preset.id
                  return (
                    <div
                      key={preset.id}
                      className={`relative flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors cursor-pointer ${selected ? 'border-emerald-300/60 bg-emerald-300/15' : 'border-white/10 bg-black/20 hover:border-emerald-400/30'}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('[data-card-action="delete"]')) return
                        if (preset.id === 'none') exitPaintMode()
                        else enterPaintMode(preset.id)
                      }}
                    >
                      <GroundTextureThumb preset={preset} />
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-[11px] font-medium ${selected ? 'text-emerald-100' : 'text-emerald-100/70'}`}>
                          {preset.icon} {preset.name}
                        </div>
                        <div className="text-[9px] font-mono text-emerald-100/35">
                          {preset.customTextureUrl ? 'custom' : preset.assetName || 'none'}
                        </div>
                      </div>
                      {preset.id !== 'none' && canMutateLibrary() && (
                        <DeleteButton
                          onClick={(e) => {
                            e.stopPropagation()
                            void banishGroundPreset(preset.id)
                          }}
                          title={`Delete ${preset.name} from ground library`}
                        />
                      )}
                    </div>
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
