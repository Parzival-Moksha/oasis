// ═══════════════════════════════════════════════════════════════════════════════
// WORLD TAB — Sky background, ground paint, lights, terrain, import/export
// ═══════════════════════════════════════════════════════════════════════════════

'use client'

import { useState, useCallback, useRef } from 'react'
import { useOasisStore } from '../../../store/oasisStore'
import type { TerrainParams } from '../../../lib/forge/terrain-generator'
import type { WorldLightType } from '../../../lib/conjure/types'
import { LIGHT_INTENSITY_MAX, LIGHT_INTENSITY_STEP } from '../../../lib/conjure/types'
import { GROUND_PRESETS, getTextureUrls } from '../../../lib/forge/ground-textures'
import { SKY_BACKGROUNDS } from '../../scene-lib/constants'
import { LightTooltipWrap } from './shared'

interface WorldTabProps {
  setError: (error: string | null) => void
}

export function WorldTab({ setError }: WorldTabProps) {
  // ─═̷─ Ground texture + paint mode ─═̷─
  const groundPresetId = useOasisStore(s => s.groundPresetId)
  const groundTiles = useOasisStore(s => s.groundTiles)
  const paintMode = useOasisStore(s => s.paintMode)
  const paintBrushPresetId = useOasisStore(s => s.paintBrushPresetId)
  const paintBrushSize = useOasisStore(s => s.paintBrushSize)
  const enterPaintMode = useOasisStore(s => s.enterPaintMode)
  const exitPaintMode = useOasisStore(s => s.exitPaintMode)
  const setPaintBrushSize = useOasisStore(s => s.setPaintBrushSize)
  const clearAllGroundTiles = useOasisStore(s => s.clearAllGroundTiles)
  const customGroundPresets = useOasisStore(s => s.customGroundPresets)

  // ─═̷─ World sky ─═̷─
  const worldSkyBackground = useOasisStore(s => s.worldSkyBackground)
  const setWorldSkyBackground = useOasisStore(s => s.setWorldSkyBackground)
  // ─═̷─ World lights ─═̷─
  const worldLights = useOasisStore(s => s.worldLights)
  const addWorldLight = useOasisStore(s => s.addWorldLight)
  const updateWorldLight = useOasisStore(s => s.updateWorldLight)
  const removeWorldLight = useOasisStore(s => s.removeWorldLight)

  // ─═̷─ Terrain ─═̷─
  const terrainParams = useOasisStore(s => s.terrainParams)
  const terrainLoading = useOasisStore(s => s.terrainLoading)
  const setTerrainParams = useOasisStore(s => s.setTerrainParams)
  const setTerrainLoading = useOasisStore(s => s.setTerrainLoading)
  const [terrainPrompt, setTerrainPrompt] = useState('')
  const [terrainError, setTerrainError] = useState<string | null>(null)
  const sliderTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [sliderLocal, setSliderLocal] = useState<Record<string, number>>({})

  const handleTerrainGenerate = useCallback(async () => {
    if (!terrainPrompt.trim()) return
    setTerrainLoading(true)
    setTerrainError(null)
    try {
      const res = await fetch('/api/terrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: terrainPrompt.trim() }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); setTerrainError(e.error || `HTTP ${res.status}`); return }
      const data = await res.json()
      setTerrainParams(data.params as TerrainParams)
      setTerrainPrompt('')
    } catch (err) { setTerrainError(`Network error: ${err}`) }
    finally { setTerrainLoading(false) }
  }, [terrainPrompt, setTerrainParams, setTerrainLoading])

  const debouncedTerrainSlider = useCallback((field: string, value: number) => {
    setSliderLocal(prev => ({ ...prev, [field]: value }))
    if (sliderTimers.current[field]) clearTimeout(sliderTimers.current[field])
    sliderTimers.current[field] = setTimeout(() => {
      const current = useOasisStore.getState().terrainParams
      if (current) useOasisStore.getState().setTerrainParams({ ...current, [field]: value })
    }, 200)
  }, [])

  // ─═̷─ World management ─═̷─
  const exportCurrentWorld = useOasisStore(s => s.exportCurrentWorld)
  const importWorldFromJson = useOasisStore(s => s.importWorldFromJson)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldRegistry = useOasisStore(s => s.worldRegistry)

  // ─═̷─ Collapsible world-tab sections ─═̷─
  type WorldSection = 'sky' | 'ground' | 'lights' | 'terrain'
  const [collapsedSections, setCollapsedSections] = useState<Set<WorldSection>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = JSON.parse(localStorage.getItem('oasis-world-collapsed') || '[]')
      return new Set(stored as WorldSection[])
    } catch { return new Set() }
  })
  const toggleSection = (section: WorldSection) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section); else next.add(section)
      localStorage.setItem('oasis-world-collapsed', JSON.stringify([...next]))
      return next
    })
  }

  return (
    <div className="space-y-4">

      {/* ░▒▓█ SKY BACKGROUND — The heavens above █▓▒░ */}
      <div>
        <button onClick={() => toggleSection('sky')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-indigo-500/20 bg-indigo-950/40 hover:bg-indigo-900/30 hover:border-indigo-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
          <span className="text-[11px] text-indigo-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
            <span className={`text-xs text-indigo-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('sky') ? '' : 'rotate-90'}`}>&#9654;</span>
            Sky Background
          </span>
          <span className="text-[10px] text-indigo-400/50 font-mono">
            {SKY_BACKGROUNDS.find(s => s.id === worldSkyBackground)?.name || 'Procedural Stars'}
          </span>
        </button>
        {!collapsedSections.has('sky') && (
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
                    <span className="text-sm">{sky.path ? (sky.path.endsWith('.exr') ? '\u{1F30C}' : '\u{1F303}') : '\u2728'}</span>
                    <span className={`text-[10px] font-medium ${isActive ? 'text-indigo-300' : 'text-gray-400'}`}>
                      {sky.name}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ░▒▓█ GROUND PAINT — Tile-by-tile ground painting █▓▒░ */}
      <div>
        <button onClick={() => toggleSection('ground')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-emerald-500/20 bg-emerald-950/40 hover:bg-emerald-900/30 hover:border-emerald-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
          <span className="text-[11px] text-emerald-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
            <span className={`text-xs text-emerald-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('ground') ? '' : 'rotate-90'}`}>&#9654;</span>
            Ground Paint
          </span>
          <span className="text-[10px] text-emerald-400/50 font-mono">
            {Object.keys(groundTiles).length > 0 ? `${Object.keys(groundTiles).length} tiles` : 'base: '}{GROUND_PRESETS.find(p => p.id === groundPresetId)?.name || 'Grass'}
          </span>
        </button>
        {!collapsedSections.has('ground') && (<>

        {/* Paint mode indicator */}
        {paintMode && (
          <div className="mb-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-emerald-300 font-mono font-bold">
                {'\u{1F3A8}'} PAINT MODE — {[...GROUND_PRESETS, ...customGroundPresets].find(p => p.id === paintBrushPresetId)?.name}
              </div>
              <button
                onClick={exitPaintMode}
                className="text-[9px] text-red-400/70 hover:text-red-300 font-mono border border-red-500/20 rounded px-1.5 py-0.5"
              >
                Exit
              </button>
            </div>
            {/* Brush size selector */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-400 font-mono">Brush:</span>
              {[1, 3, 5].map(size => (
                <button
                  key={size}
                  onClick={() => setPaintBrushSize(size)}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                    paintBrushSize === size
                      ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                      : 'text-gray-400 border border-gray-700/30 hover:text-gray-200'
                  }`}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
            <div className="text-[8px] text-gray-400 font-mono mt-1">
              L-click: paint | R-click: erase tile | ESC: exit
            </div>
          </div>
        )}


        {/* Ground preset palette — click to enter paint mode with that brush */}
        <div className="grid grid-cols-3 gap-2">
          {GROUND_PRESETS.map(preset => {
            const isPaintBrush = paintMode && paintBrushPresetId === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => {
                  if (preset.id === 'none') {
                    exitPaintMode()
                  } else {
                    enterPaintMode(preset.id)
                  }
                }}
                className={`rounded-lg border p-2 transition-all duration-200 text-left ${
                  isPaintBrush
                    ? 'border-emerald-400/80 bg-emerald-500/20 scale-[1.02] ring-1 ring-emerald-400/40'
                    : 'border-gray-700/30 bg-black/40 hover:border-emerald-500/30 hover:bg-emerald-500/5'
                }`}
                title={preset.id === 'none' ? 'Exit paint mode' : `Paint with ${preset.name}`}
              >
                <div
                  className="w-full aspect-square rounded-md mb-1.5 border border-white/5 overflow-hidden"
                  style={{ backgroundColor: preset.color }}
                >
                  {preset.assetName && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getTextureUrls(preset.assetName).diffuse}
                      alt={preset.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm">{preset.icon}</span>
                  <span className={`text-[10px] font-medium ${isPaintBrush ? 'text-emerald-300' : 'text-gray-400'}`}>
                    {preset.name}
                  </span>
                </div>
              </button>
            )
          })}
          {/* ░▒▓ Custom textures from Imagine ▓▒░ */}
          {customGroundPresets.map(preset => {
            const isPaintBrush = paintMode && paintBrushPresetId === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => enterPaintMode(preset.id)}
                className={`rounded-lg border p-2 transition-all duration-200 text-left ${
                  isPaintBrush
                    ? 'border-pink-400/80 bg-pink-500/20 scale-[1.02] ring-1 ring-pink-400/40'
                    : 'border-gray-700/30 bg-black/40 hover:border-pink-500/30 hover:bg-pink-500/5'
                }`}
                title={`Paint with ${preset.name} (custom)`}
              >
                <div className="w-full aspect-square rounded-md mb-1.5 border border-pink-500/10 overflow-hidden bg-gray-800">
                  {preset.customTextureUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preset.customTextureUrl}
                      alt={preset.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm">{preset.icon}</span>
                  <span className={`text-[10px] font-medium truncate ${isPaintBrush ? 'text-pink-300' : 'text-gray-400'}`}>
                    {preset.name}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Tile count + clear button */}
        {Object.keys(groundTiles).length > 0 && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] text-gray-400 font-mono">
              {Object.keys(groundTiles).length} painted tiles
            </span>
            <button
              onClick={clearAllGroundTiles}
              className="text-[9px] text-red-400/60 hover:text-red-300 font-mono border border-red-500/20 rounded px-1.5 py-0.5"
            >
              Clear all tiles
            </button>
          </div>
        )}
        </>)}
      </div>

      {/* ░▒▓█ TERRAIN — Simplex noise heightmap terrain █▓▒░ */}
      <div>
        <button onClick={() => toggleSection('terrain')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-teal-500/20 bg-teal-950/40 hover:bg-teal-900/30 hover:border-teal-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
          <span className="text-[11px] text-teal-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
            <span className={`text-xs text-teal-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('terrain') ? '' : 'rotate-90'}`}>&#9654;</span>
            Terrain
          </span>
          <span className="text-[10px] text-teal-400/50 font-mono">
            {terrainParams ? terrainParams.name : 'none'}
          </span>
        </button>
        {!collapsedSections.has('terrain') && (<>
          {/* Generate from prompt */}
          <div className="flex gap-1.5 mb-2">
            <input type="text" value={terrainPrompt} onChange={e => setTerrainPrompt(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !terrainLoading && handleTerrainGenerate()}
              placeholder="volcanic island, coral reefs..."
              className="flex-1 bg-black/40 border border-teal-500/20 rounded px-2 py-1 text-[10px] font-mono text-gray-300 placeholder:text-gray-600 focus:border-teal-400/50 focus:outline-none" />
            <button onClick={handleTerrainGenerate} disabled={terrainLoading || !terrainPrompt.trim()}
              className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 disabled:opacity-30 transition-all shrink-0">
              {terrainLoading ? '...' : 'Generate'}
            </button>
          </div>

          {terrainError && (
            <div className="text-[9px] text-red-400 font-mono mb-2 px-1">{terrainError}</div>
          )}

          {/* Active terrain controls */}
          {terrainParams && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono text-teal-300/70 px-1 flex items-center justify-between">
                <span>{terrainParams.name}</span>
                <span className="text-gray-500">seed: {terrainParams.seed}</span>
              </div>

              {/* Sliders */}
              <div className="space-y-1.5 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-400 font-mono w-16 shrink-0">Height</span>
                  <input type="range" min="1" max="30" step="0.5"
                    defaultValue={terrainParams.heightScale}
                    onChange={e => debouncedTerrainSlider('heightScale', parseFloat(e.target.value))}
                    className="flex-1 accent-teal-400 h-1" />
                  <span className="text-[9px] text-teal-400/70 font-mono w-8 text-right">{sliderLocal.heightScale ?? terrainParams.heightScale}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-400 font-mono w-16 shrink-0">Water</span>
                  <input type="range" min="0" max="0.8" step="0.02"
                    defaultValue={terrainParams.waterLevel}
                    onChange={e => debouncedTerrainSlider('waterLevel', parseFloat(e.target.value))}
                    className="flex-1 accent-sky-400 h-1" />
                  <span className="text-[9px] text-sky-400/70 font-mono w-8 text-right">{(sliderLocal.waterLevel ?? terrainParams.waterLevel).toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-400 font-mono w-16 shrink-0">Detail</span>
                  <input type="range" min="1" max="8" step="1"
                    defaultValue={terrainParams.noiseOctaves}
                    onChange={e => debouncedTerrainSlider('noiseOctaves', parseInt(e.target.value))}
                    className="flex-1 accent-amber-400 h-1" />
                  <span className="text-[9px] text-amber-400/70 font-mono w-8 text-right">{sliderLocal.noiseOctaves ?? terrainParams.noiseOctaves}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-1.5 px-1">
                <button onClick={() => setTerrainParams({ ...terrainParams, seed: Math.floor(Math.random() * 999999) })}
                  className="flex-1 text-[9px] font-mono text-teal-400/70 border border-teal-500/20 rounded px-1.5 py-1 hover:bg-teal-500/10 transition-colors">
                  Reseed
                </button>
                <button onClick={() => setTerrainParams(null)}
                  className="text-[9px] font-mono text-red-400/60 border border-red-500/20 rounded px-1.5 py-1 hover:bg-red-500/10 hover:text-red-300 transition-colors">
                  Clear
                </button>
              </div>
            </div>
          )}
        </>)}
      </div>

      {/* ░▒▓█ LIGHTS — World illumination controls █▓▒░ */}
      <div>
        <button onClick={() => toggleSection('lights')} className="w-full flex items-center justify-between px-2.5 py-1.5 -mx-0.5 rounded-md border border-yellow-500/20 bg-yellow-950/40 hover:bg-yellow-900/30 hover:border-yellow-400/30 transition-all duration-150 group cursor-pointer mb-1.5">
          <span className="text-[11px] text-yellow-300/90 uppercase tracking-wider font-mono font-medium flex items-center gap-1.5">
            <span className={`text-xs text-yellow-400/70 transition-transform duration-150 inline-block ${collapsedSections.has('lights') ? '' : 'rotate-90'}`}>&#9654;</span>
            Lights
          </span>
          <span className="text-[10px] text-yellow-400/50 font-mono">
            {worldLights.length} source{worldLights.length !== 1 ? 's' : ''}
          </span>
        </button>
        {!collapsedSections.has('lights') && (<>

        {/* ── Scene lights: ambient / hemisphere / directional / environment (inline controls) ── */}
        {worldLights.filter(l => l.type === 'ambient' || l.type === 'hemisphere' || l.type === 'directional' || l.type === 'environment').map(light => {
          // For directional: derive azimuth/elevation from position vector
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
                  &#215;
                </button>
              </div>
              <div className="space-y-1.5">
                {/* Color (not for environment — IBL uses preset) */}
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
                {/* Ground color (hemisphere only) */}
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
                {/* Intensity — per-type max from LIGHT_INTENSITY_MAX */}
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
                {/* Azimuth + Elevation (directional/sun only) */}
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

        {/* Add scene light buttons — with styled HTML tooltips */}
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
                &#215;
              </button>
            </div>
            <div className="space-y-1.5">
              {/* Color */}
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
              {/* Intensity — per-type max from LIGHT_INTENSITY_MAX */}
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
              {/* Spot angle + direction (azimuth/elevation) */}
              {light.type === 'spot' && (() => {
                const tgt = light.target || [0, -1, 0]
                const tLen = Math.sqrt(tgt[0] * tgt[0] + tgt[1] * tgt[1] + tgt[2] * tgt[2]) || 1
                const spotElev = Math.asin(Math.min(1, Math.max(-1, tgt[1] / tLen))) * 180 / Math.PI
                const spotAzim = ((Math.atan2(tgt[0], tgt[2]) * 180 / Math.PI) + 360) % 360
                return (<>
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
                </>)
              })()}
            </div>
          </div>
          </LightTooltipWrap>
        ))}
        </>)}
      </div>


      {/* ░▒▓█ WORLD IMPORT/EXPORT █▓▒░ */}
      <div className="flex gap-2 pt-2 border-t border-gray-800/50">
        <button
          onClick={async () => {
            const json = await exportCurrentWorld()
            if (!json) return
            const blob = new Blob([json], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            const worldName = worldRegistry.find(w => w.id === activeWorldId)?.name || 'world'
            a.href = url
            a.download = `${worldName.replace(/\s+/g, '-').toLowerCase()}.oasis.json`
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="text-[10px] text-blue-400/70 hover:text-blue-300 font-mono border border-blue-500/20 rounded px-2 py-0.5"
        >
          Export world
        </button>
        <label
          className="text-[10px] text-blue-400/70 hover:text-blue-300 font-mono border border-blue-500/20 rounded px-2 py-0.5 cursor-pointer"
        >
          Import world
          <input
            type="file"
            accept=".json,.oasis.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = async () => {
                const result = await importWorldFromJson(reader.result as string)
                if (!result) setError('Failed to import world — invalid format')
              }
              reader.readAsText(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>

    </div>
  )
}
