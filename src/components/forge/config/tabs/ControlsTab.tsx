'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROLS TAB — camera control mode, mouse sensitivity, move speed
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'

export function ControlsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Camera Mode</div>
        <select
          value={settings.controlMode}
          onChange={e => updateSetting('controlMode', e.target.value as 'orbit' | 'noclip' | 'third-person')}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 hover:border-emerald-500 focus:border-emerald-500 focus:outline-none transition-colors mb-2"
        >
          <option value="orbit">Orbit (Classic)</option>
          <option value="noclip">Noclip (fly)</option>
          <option value="third-person">Third Person (Avatar)</option>
        </select>
        <div className="text-[10px] text-gray-500">Switch with Ctrl+Alt+C in-world.</div>
      </section>

      {(settings.controlMode === 'noclip' || settings.controlMode === 'third-person') && (
        <section className="border-t border-white/10 pt-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Free-look</div>

          <div className="py-1.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-gray-300">Mouse Sensitivity</span>
              <span className="text-xs text-emerald-300 font-mono">{settings.mouseSensitivity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min={1} max={20} step={1}
              value={Math.round(settings.mouseSensitivity * 10)}
              onChange={e => updateSetting('mouseSensitivity', parseInt(e.target.value) / 10)}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          <div className="py-1.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-gray-300">Move Speed</span>
              <span className="text-xs text-emerald-300 font-mono">{settings.moveSpeed}</span>
            </div>
            <input
              type="range"
              min={1} max={20} step={1}
              value={settings.moveSpeed}
              onChange={e => updateSetting('moveSpeed', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>
        </section>
      )}
    </div>
  )
}
