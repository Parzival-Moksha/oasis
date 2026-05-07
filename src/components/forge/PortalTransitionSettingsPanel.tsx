'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_PORTAL_TRANSITION_SETTINGS,
  PORTAL_TRANSITION_EFFECTS,
  PORTAL_TRANSITION_START_EVENT,
  patchPortalTransitionSettings,
  preloadPortalRevealRoll,
  readPortalTransitionSettings,
  subscribePortalTransitionSettings,
  type PortalTransitionEffect,
  type PortalTransitionSettings,
} from '../../lib/portal-transition-settings'

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 font-mono w-20">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="flex-1 h-1 accent-cyan-400 cursor-pointer"
      />
      <span className="text-[10px] text-gray-500 font-mono w-12 text-right">{value.toFixed(step < 1 ? 2 : 0)}{suffix}</span>
    </div>
  )
}

function EffectSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: PortalTransitionEffect
  onChange: (value: PortalTransitionEffect) => void
}) {
  return (
    <label className="block">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-mono">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value as PortalTransitionEffect)}
        className="mt-1 w-full rounded-md border border-cyan-500/20 bg-black/60 px-2 py-1 text-[10px] text-cyan-100 outline-none focus:border-cyan-300/50"
      >
        {PORTAL_TRANSITION_EFFECTS.map(effect => (
          <option key={effect.id} value={effect.id}>
            {effect.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function PortalTransitionSettingsPanel() {
  const [settings, setSettings] = useState<PortalTransitionSettings>(() => readPortalTransitionSettings())
  const [rollReady, setRollReady] = useState(false)

  useEffect(() => subscribePortalTransitionSettings(setSettings), [])

  useEffect(() => {
    if (!settings.rollReveal) return
    let cancelled = false
    preloadPortalRevealRoll().then(ok => {
      if (!cancelled) setRollReady(ok)
    })
    return () => { cancelled = true }
  }, [settings.rollReveal])

  const patch = (next: Partial<PortalTransitionSettings>) => {
    setSettings(patchPortalTransitionSettings(next))
  }

  const preview = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(PORTAL_TRANSITION_START_EVENT, {
      detail: {
        settings,
        gateLabel: 'Preview Gate',
        targetWorldName: 'Target World',
      },
    }))
  }

  const reset = () => {
    setSettings(patchPortalTransitionSettings(DEFAULT_PORTAL_TRANSITION_SETTINGS))
  }

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-mono">Portal Transition Lab</div>
          <div className="text-[9px] text-gray-500">Swallow, tunnel, reveal</div>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={event => patch({ enabled: event.target.checked })}
            className="accent-cyan-400"
          />
          enabled
        </label>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <EffectSelect label="Swallow" value={settings.swallowEffect} onChange={value => patch({ swallowEffect: value })} />
        <EffectSelect label="Tunnel" value={settings.tunnelEffect} onChange={value => patch({ tunnelEffect: value })} />
        <EffectSelect label="Reveal" value={settings.revealEffect} onChange={value => patch({ revealEffect: value })} />
      </div>

      <div className="space-y-1.5">
        <SliderRow label="Swallow" value={settings.swallowSeconds} min={0.15} max={1.5} step={0.05} suffix="s" onChange={value => patch({ swallowSeconds: value })} />
        <SliderRow label="Tunnel" value={settings.tunnelSeconds} min={0.4} max={4.5} step={0.05} suffix="s" onChange={value => patch({ tunnelSeconds: value })} />
        <SliderRow label="Reveal" value={settings.revealSeconds} min={0.15} max={1.75} step={0.05} suffix="s" onChange={value => patch({ revealSeconds: value })} />
        <SliderRow label="FOV boost" value={settings.fovBoost} min={0} max={45} step={1} onChange={value => patch({ fovBoost: value })} />
        <SliderRow label="Camera pull" value={settings.cameraPull} min={0} max={1.6} step={0.05} onChange={value => patch({ cameraPull: value })} />
        <SliderRow label="Intensity" value={settings.intensity} min={0.25} max={2.5} step={0.05} onChange={value => patch({ intensity: value })} />
        <SliderRow label="Particle speed" value={settings.particleSpeed} min={0.25} max={3.5} step={0.05} onChange={value => patch({ particleSpeed: value })} />
        <SliderRow label="Shake" value={settings.shake} min={0} max={0.7} step={0.01} onChange={value => patch({ shake: value })} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={preview}
          className="rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100 hover:bg-cyan-400/20"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-gray-600/40 bg-black/40 px-2 py-1 text-[10px] text-gray-300 hover:border-gray-400/50"
        >
          Reset
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-400">
          <input
            type="checkbox"
            checked={settings.rollReveal}
            onChange={event => patch({ rollReveal: event.target.checked })}
            className="accent-cyan-400"
          />
          Roll reveal
        </label>
        <span className="text-[9px] text-gray-500 font-mono">{settings.rollReveal ? (rollReady ? 'ready' : 'loading') : 'off'}</span>
      </div>
    </div>
  )
}
