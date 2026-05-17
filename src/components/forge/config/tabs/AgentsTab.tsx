'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS TAB — timing for embodied agent pipelines (conjure dwell, screenshot
// settle). Walk speed + embodied toggle live in World VFX since they affect
// the in-world spell pipeline visually.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'

export function AgentsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-mono">Agent Timing</div>
      <div className="text-[10px] text-gray-500 mb-2">
        How long agents pause for conjure VFX and pre-screenshot settling. Tune up for cinematic playback, down for headless speed.
      </div>

      <div className="py-1.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-gray-300">Conjure Duration</span>
          <span className="text-xs text-cyan-300 font-mono">{(settings.agentConjureDurationMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0} max={12000} step={250}
          value={settings.agentConjureDurationMs}
          onChange={e => updateSetting('agentConjureDurationMs', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
      </div>

      <div className="py-1.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-gray-300">Screenshot Settle</span>
          <span className="text-xs text-cyan-300 font-mono">{settings.agentScreenshotSettleMs} ms</span>
        </div>
        <input
          type="range"
          min={0} max={2000} step={20}
          value={settings.agentScreenshotSettleMs}
          onChange={e => updateSetting('agentScreenshotSettleMs', parseInt(e.target.value))}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
      </div>
    </div>
  )
}
