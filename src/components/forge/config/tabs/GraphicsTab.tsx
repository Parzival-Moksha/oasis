'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPHICS TAB — bloom, post-FX toggles, FOV, grid, sky, opacity, FPS counter
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import type { SharedTabProps } from '../types'

function Toggle({
  label,
  active,
  onChange,
  accent = 'bg-purple-600',
}: {
  label: string
  active: boolean
  onChange: () => void
  accent?: string
}) {
  return (
    <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
      <div
        onClick={onChange}
        className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
          active ? `${accent} shadow-lg shadow-purple-500/30` : 'bg-gray-700'
        }`}
      >
        <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
          active ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </div>
      <span className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">{label}</span>
    </label>
  )
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

  return (
    <div className="space-y-3">
      <section>
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
        <Slider
          label="Config Menu Opacity"
          value={menuOpacity}
          min={0.5} max={1.0} step={0.05}
          display={`${Math.round(menuOpacity * 100)}%`}
          accent="accent-purple-500"
          onChange={v => onMenuOpacityChange(Math.round(v * 20) / 20)}
        />
      </section>
    </div>
  )
}
