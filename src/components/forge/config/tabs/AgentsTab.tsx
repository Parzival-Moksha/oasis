'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS TAB — embodiment toggle, walk speed, and timing for agent pipelines
// (conjure dwell, screenshot settle). One stop for everything that shapes how
// NPCs and agent-spawned spells play out.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'

export function AgentsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-4">
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Agent Embodiment</div>

        <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
          <div
            onClick={() => updateSetting('agentActionMode', settings.agentActionMode === 'embodied' ? 'instant' : 'embodied')}
            className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
              settings.agentActionMode === 'embodied' ? 'bg-cyan-600 shadow-lg shadow-cyan-500/30' : 'bg-gray-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
              settings.agentActionMode === 'embodied' ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Embodied Agent Actions</div>
            <div className="text-[10px] text-gray-500">
              {settings.agentActionMode === 'embodied'
                ? 'Agents walk, cast, and settle before manifestations visibly land.'
                : 'Agent world changes apply immediately without slow-mo staging.'}
            </div>
          </div>
        </label>

        <div className="py-1.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-gray-300">Agent Walk Speed</span>
            <span className="text-xs text-cyan-300 font-mono">{settings.agentWalkSpeed.toFixed(1)} m/s</span>
          </div>
          <input
            type="range"
            min={0.5} max={12} step={0.5}
            value={settings.agentWalkSpeed}
            onChange={e => updateSetting('agentWalkSpeed', parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
        </div>
      </section>

      <section className="border-t border-white/10 pt-3">
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
      </section>
    </div>
  )
}
