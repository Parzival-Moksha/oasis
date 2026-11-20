'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPHICS TAB — bloom, post-FX toggles, FOV, grid, sky, opacity, FPS counter
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext, useEffect, useState } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import type { SharedTabProps } from '../types'
import { canRequestFullscreen, isFullscreenActive, setOasisFullscreen } from '@/lib/fullscreen-controls'
import { setGraphicsPref, type FlopSaverMode, type GroundSharpness, type ShadowMode, type ShadowQuality, type ShadowRefresh } from '@/lib/graphics-prefs'
import { useSavedGraphicsPrefs } from '@/lib/use-graphics-prefs'
import { useFlopCaps } from '@/lib/use-flop-caps'
import { restNow } from '@/lib/away-mode'
import { KitButton, KitSelectField, KitToggle } from '@/components/ui-kit'

function Choice<T extends string | number>({ label, hint, value, options, name, onChange }: {
  label: string
  hint: string
  value: T
  options: Array<{ value: T; label: string }>
  name: string
  onChange: (value: T) => void
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <div className="flex overflow-hidden rounded-md border border-white/15" role="radiogroup" aria-label={label}>
          {options.map(option => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={value === option.value}
              data-graphics-choice={`${name}:${option.value}`}
              onClick={() => onChange(option.value)}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${value === option.value ? 'bg-purple-600 text-white' : 'bg-transparent text-gray-400 hover:bg-white/10 hover:text-white'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[10px] text-gray-500">{hint}</div>
    </div>
  )
}

const SHARPNESS_OPTIONS: Array<{ value: GroundSharpness; label: string }> = [
  { value: 1, label: 'Standard' }, { value: 2, label: '2x' }, { value: 4, label: '4x' },
]
const SHARPNESS_HINT: Record<GroundSharpness, string> = {
  1: 'The ground as it was: one soft texture, blurry at a low angle.',
  2: 'Twice the detail and sharp at a low angle. Free: the graphics card does it.',
  4: 'Four times the detail. Still free; up close the ground looks busier.',
}
const SHADOW_OPTIONS: Array<{ value: ShadowMode; label: string }> = [
  { value: 'off', label: 'Off' }, { value: 'avatars', label: 'Avatars' }, { value: 'all', label: 'All' },
]
const SHADOW_QUALITY_OPTIONS: Array<{ value: ShadowQuality; label: string }> = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]
const SHADOW_QUALITY_HINT: Record<ShadowQuality, string> = {
  low: 'A 1024 px shadow map: 6 cm of ground per pixel. Blocky up close.',
  medium: '2048 px: 3 cm per pixel.',
  high: '4096 px: 1.6 cm per pixel. Clean edges; costs graphics memory, not frame time.',
}
const SHADOW_REFRESH_OPTIONS: Array<{ value: ShadowRefresh; label: string }> = [
  { value: 'auto', label: 'Auto' }, { value: 'frame', label: 'Every frame' }, { value: '60', label: '60/s' }, { value: '30', label: '30/s' },
]
const SHADOW_REFRESH_HINT: Record<ShadowRefresh, string> = {
  auto: 'Every frame while something moves, 60 times a second otherwise.',
  frame: 'Redrawn on every frame. Smoothest, costs the most.',
  '60': 'At most 60 times a second: a moving shadow steps a little on a fast screen.',
  '30': 'At most 30 times a second: cheapest, visibly steps behind moving bodies.',
}
const FLOP_OPTIONS: Array<{ value: FlopSaverMode; label: string }> = [
  { value: 'auto', label: 'Auto' }, { value: 'all', label: 'Everything on' }, { value: 'saver', label: 'Saver' },
]
const FLOP_HINT: Record<FlopSaverMode, string> = {
  auto: 'All effects on; if the frame rate stays under 30, effects switch off one tier at a time, cheapest loss first, and come back when it recovers.',
  all: 'All effects stay on, however slow it gets.',
  saver: 'The heavy effects stay off: post effects, bloom, shadows, sharper ground, particles, and 75% resolution.',
}
const SHADOW_HINT: Record<ShadowMode, string> = {
  off: 'No shadows.',
  avatars: 'You and the agents cast soft shadows from the world\'s sun. Cheap.',
  all: 'World objects cast shadows too. Costs the most per frame.',
}

/** An on/off row: the kit switch (the design picked in Settings > Experiments > Switches). */
function Toggle({ label, active, onChange }: { label: string; active: boolean; onChange: () => void; accent?: string }) {
  return <KitToggle checked={active} onChange={onChange} label={label} data-setting-switch={label} />
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  accent = 'accent-purple-500',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display?: string
  accent?: string
  onChange: (next: number) => void
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-xs text-purple-400 font-mono">{display ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className={`w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer ${accent}`}
      />
    </div>
  )
}

export function GraphicsTab({ menuOpacity, onMenuOpacityChange }: SharedTabProps) {
  const { settings, updateSetting } = useContext(SettingsContext)
  const graphics = useSavedGraphicsPrefs()
  const flop = useFlopCaps()
  const [fullscreenActive, setFullscreenActive] = useState(false)
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false)

  useEffect(() => {
    const sync = () => setFullscreenActive(isFullscreenActive())
    setFullscreenAvailable(canRequestFullscreen())
    sync()
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  return (
    <div className="space-y-3">
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Display</div>
        <Toggle
          label="Fullscreen"
          active={fullscreenActive}
          onChange={() => {
            void setOasisFullscreen(!fullscreenActive).finally(() => {
              setFullscreenActive(isFullscreenActive())
            })
          }}
          accent="bg-cyan-600"
        />
        {!fullscreenAvailable && (
          <div className="px-1 pb-1 text-[10px] text-gray-500">This browser may already be in standalone app mode.</div>
        )}
        <div className="mt-2">
          <div className="mb-1.5 text-sm text-gray-300">Camera Mode</div>
          <select
            value={settings.controlMode}
            onChange={e => updateSetting('controlMode', e.target.value as 'orbit' | 'noclip' | 'third-person')}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 hover:border-emerald-500 focus:border-emerald-500 focus:outline-none transition-colors"
          >
            <option value="orbit">Orbit (Classic)</option>
            <option value="noclip">Noclip (fly)</option>
            <option value="third-person">Third Person (Avatar)</option>
          </select>
        </div>
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Post-FX</div>
        <Toggle label="Bloom" active={settings.bloomEnabled} onChange={() => updateSetting('bloomEnabled', !settings.bloomEnabled)} />
        {settings.bloomEnabled && (
          <Slider
            label="Bloom Intensity"
            value={settings.bloomIntensity ?? 0.4}
            min={0.05} max={2.0} step={0.05}
            display={(settings.bloomIntensity ?? 0.4).toFixed(2)}
            onChange={v => updateSetting('bloomIntensity', v)}
          />
        )}
        <Toggle label="Vignette" active={settings.vignetteEnabled} onChange={() => updateSetting('vignetteEnabled', !settings.vignetteEnabled)} />
        <Toggle label="Chromatic Aberration" active={settings.chromaticEnabled} onChange={() => updateSetting('chromaticEnabled', !settings.chromaticEnabled)} />
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">View</div>
        <Slider
          label="Field of View"
          value={settings.fov}
          min={30} max={120} step={5}
          display={`${settings.fov}°`}
          accent="accent-green-500"
          onChange={v => updateSetting('fov', Math.round(v))}
        />
        <Toggle label="Helper Grid" active={settings.showGrid} onChange={() => updateSetting('showGrid', !settings.showGrid)} />
        <Toggle label="Show Orbit Pivot" active={settings.showOrbitTarget} onChange={() => updateSetting('showOrbitTarget', !settings.showOrbitTarget)} />
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">World</div>
        <Choice
          label="Flop saver"
          name="flopSaver"
          value={graphics.flopSaver}
          options={FLOP_OPTIONS}
          hint={`${FLOP_HINT[graphics.flopSaver]}${flop.level > 0 ? ` Now at tier ${flop.level} of 5: some effects below are held down.` : ''}`}
          onChange={value => setGraphicsPref('flopSaver', value)}
        />
        <div className="flex items-end gap-2 py-1.5">
          <div className="flex-1">
            <KitSelectField
              label="Rest when away"
              hint="With no mouse or key for this long, or with the window hidden or covered, the 3D world stops drawing (no graphics card or processor spent on it). Sounds, replies and the chime keep going. Any move wakes it."
              value={String(graphics.restAfter)}
              options={[
                { value: '1', label: 'After 1 minute' }, { value: '3', label: 'After 3 minutes' }, { value: '5', label: 'After 5 minutes' },
                { value: '10', label: 'After 10 minutes' }, { value: '0', label: 'Only when hidden or on F8' },
              ]}
              onChange={event => setGraphicsPref('restAfter', Number(event.target.value) as 0 | 1 | 3 | 5 | 10)}
            />
          </div>
          <KitButton onClick={() => restNow()} title="Stops drawing until you move (F8 does the same)">Rest now (F8)</KitButton>
        </div>
        <Choice
          label="Ground sharpness"
          name="groundSharpness"
          value={graphics.groundSharpness}
          options={SHARPNESS_OPTIONS}
          hint={SHARPNESS_HINT[graphics.groundSharpness]}
          onChange={value => setGraphicsPref('groundSharpness', value)}
        />
        <Choice
          label="Shadows"
          name="shadows"
          value={graphics.shadows}
          options={SHADOW_OPTIONS}
          hint={`${SHADOW_HINT[graphics.shadows]} Needs a directional light in the world (the sun).`}
          onChange={value => setGraphicsPref('shadows', value)}
        />
        {graphics.shadows !== 'off' && (
          <>
            <Choice
              label="Shadow quality"
              name="shadowQuality"
              value={graphics.shadowQuality}
              options={SHADOW_QUALITY_OPTIONS}
              hint={SHADOW_QUALITY_HINT[graphics.shadowQuality]}
              onChange={value => setGraphicsPref('shadowQuality', value)}
            />
            <Slider
              label="Shadow softness"
              value={Math.round(graphics.shadowSoftness * 100)}
              min={0} max={100} step={5}
              display={`${Math.round(graphics.shadowSoftness * 100)}%`}
              onChange={v => setGraphicsPref('shadowSoftness', v / 100)}
            />
            <Slider
              label="Shadow strength"
              value={Math.round(graphics.shadowStrength * 100)}
              min={0} max={100} step={5}
              display={`${Math.round(graphics.shadowStrength * 100)}%`}
              onChange={v => setGraphicsPref('shadowStrength', v / 100)}
            />
            <Choice
              label="Shadow refresh"
              name="shadowRefresh"
              value={graphics.shadowRefresh}
              options={SHADOW_REFRESH_OPTIONS}
              hint={SHADOW_REFRESH_HINT[graphics.shadowRefresh]}
              onChange={value => setGraphicsPref('shadowRefresh', value)}
            />
          </>
        )}
      </section>

      <section className="border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">UI</div>
        <Toggle label="FPS Counter" active={settings.fpsCounterEnabled} onChange={() => updateSetting('fpsCounterEnabled', !settings.fpsCounterEnabled)} />
        {settings.fpsCounterEnabled && (
          <Slider
            label="FPS Font Size"
            value={settings.fpsCounterFontSize}
            min={10} max={24}
            display={`${settings.fpsCounterFontSize}px`}
            onChange={v => updateSetting('fpsCounterFontSize', Math.round(v))}
          />
        )}
        <Slider
          label="UI Opacity"
          value={settings.uiOpacity}
          min={0.1} max={1.0} step={0.05}
          display={`${Math.round(settings.uiOpacity * 100)}%`}
          accent="accent-orange-500"
          onChange={v => updateSetting('uiOpacity', Math.round(v * 20) / 20)}
        />
        {/* Settings' own see-through, blur and colour sit in its top right (SettingsLookControls). */}
      </section>
    </div>
  )
}
