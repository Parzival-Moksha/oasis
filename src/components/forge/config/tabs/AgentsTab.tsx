'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// AGENTS TAB — embodiment toggle, walk speed, and timing for agent pipelines
// (conjure dwell, screenshot settle). One stop for everything that shapes how
// NPCs and agent-spawned spells play out.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext, useSyncExternalStore } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { DESK_SCREEN_LIMIT, isDeskScreensMode, type DeskScreensMode } from '@/lib/village/desk-screens'
import { isVillageSoundOn, setVillageSoundOn, subscribeVillageSound } from '@/components/village/village-sound'
import { TAG_SIZE, TAG_STYLES, getTagSettings, getTagSettingsVersion, setTagSettings, subscribeTagSettings } from '@/lib/village/tag-style'
import { isVillageVoiceOn, setVillageVoiceOn, subscribeVillageVoice } from '@/components/village/village-companion'
import { WakeUpSettings } from './WakeUpSettings'

/** An on/off row: a switch, a title and a line on what it does now. */
function SwitchRow({ on, onToggle, title, hint, data }: { on: boolean; onToggle: () => void; title: string; hint: string; data: string }) {
  return (
    <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
      <div
        role="switch"
        aria-checked={on}
        data-setting={data}
        data-state={on ? 'on' : 'off'}
        onClick={onToggle}
        className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${on ? 'bg-cyan-600 shadow-lg shadow-cyan-500/30' : 'bg-gray-700'}`}
      >
        <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">{title}</div>
        <div className="text-[10px] text-gray-500">{hint}</div>
      </div>
    </label>
  )
}

const DESK_SCREEN_CHOICES: Array<{ mode: DeskScreensMode; label: string; hint: string }> = [
  { mode: 'off', label: 'Off', hint: 'No screen above the desks. E or F next to an agent still opens its panel or screen at once.' },
  { mode: 'nearest', label: 'Nearest', hint: `The ${DESK_SCREEN_LIMIT.nearest} closest agents show their screen.` },
  { mode: 'all', label: 'All', hint: `Every agent near you shows its screen (up to ${DESK_SCREEN_LIMIT.all}). Costs the most per frame.` },
]

export function AgentsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  const deskScreens: DeskScreensMode = isDeskScreensMode(settings.villageDeskScreens) ? settings.villageDeskScreens : 'off'
  // Kept in this browser by village-sound.ts / village-companion.ts (they used to be the bell and speaker on the
  // Village bar).
  const chimeOn = useSyncExternalStore(subscribeVillageSound, isVillageSoundOn, () => true)
  const voicesOn = useSyncExternalStore(subscribeVillageVoice, isVillageVoiceOn, () => true)
  useSyncExternalStore(subscribeTagSettings, getTagSettingsVersion, () => 0)
  const tagSettings = getTagSettings()

  return (
    <div className="space-y-4">
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Name tags</div>
        <div className="py-1.5">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-sm text-gray-300">Style</span>
            <div className="flex overflow-hidden rounded-md border border-white/15" role="radiogroup" aria-label="Name tag style">
              {TAG_STYLES.map(choice => (
                <button
                  key={choice.id}
                  type="button"
                  role="radio"
                  aria-checked={tagSettings.style === choice.id}
                  data-tag-style={choice.id}
                  onClick={() => setTagSettings({ style: choice.id })}
                  className={`px-3 py-1 text-xs font-semibold transition-colors ${tagSettings.style === choice.id ? 'bg-cyan-600 text-white' : 'bg-transparent text-gray-400 hover:bg-white/10 hover:text-white'}`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-gray-500 mb-2">{TAG_STYLES.find(choice => choice.id === tagSettings.style)?.hint}</div>
          <label className="block">
            <span className="flex justify-between text-sm text-gray-300"><span>Size</span><span className="text-gray-500">{Math.round(tagSettings.size * 100)}%</span></span>
            <input
              type="range"
              data-tag-size
              min={TAG_SIZE.min * 100}
              max={TAG_SIZE.max * 100}
              step={5}
              value={Math.round(tagSettings.size * 100)}
              onChange={event => setTagSettings({ size: Number(event.target.value) / 100 })}
              className="w-full accent-cyan-400"
            />
          </label>
          <div className="text-[10px] text-gray-500">The name always turns to you; the marker (! or ?) stands upright and turns slowly. The colour is the agent's own, set in its settings menu.</div>
        </div>
      </section>
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Village</div>
        <div className="py-1.5">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-sm text-gray-300">Desk screens</span>
            <div className="flex overflow-hidden rounded-md border border-white/15" role="radiogroup" aria-label="Desk screens">
              {DESK_SCREEN_CHOICES.map(choice => (
                <button
                  key={choice.mode}
                  type="button"
                  role="radio"
                  aria-checked={deskScreens === choice.mode}
                  data-desk-screens={choice.mode}
                  onClick={() => updateSetting('villageDeskScreens', choice.mode)}
                  className={`px-3 py-1 text-xs font-semibold transition-colors ${deskScreens === choice.mode ? 'bg-cyan-600 text-white' : 'bg-transparent text-gray-400 hover:bg-white/10 hover:text-white'}`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-gray-500">
            {DESK_SCREEN_CHOICES.find(choice => choice.mode === deskScreens)?.hint} Name labels and status signs always show.
          </div>
        </div>
        <SwitchRow
          data="village-chime"
          on={chimeOn}
          onToggle={() => setVillageSoundOn(!chimeOn)}
          title="Chime when an agent needs you"
          hint={chimeOn ? 'A chime plays when an agent asks you something, finishes its work, or hits an error.' : 'Silent: the ! and ? over their heads still show it.'}
        />
        <SwitchRow
          data="village-voices"
          on={voicesOn}
          onToggle={() => setVillageVoiceOn(!voicesOn)}
          title="Agent voices"
          hint={voicesOn ? 'Agents with Voice on (their settings menu) say a short version of each reply out loud.' : 'Muted: nothing is spoken or generated, whatever each agent is set to.'}
        />
        <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
          <div
            role="switch"
            aria-checked={settings.villageAcademy !== false}
            data-village-academy={settings.villageAcademy !== false ? 'on' : 'off'}
            onClick={() => updateSetting('villageAcademy', settings.villageAcademy === false)}
            className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
              settings.villageAcademy !== false ? 'bg-amber-500 shadow-lg shadow-amber-500/30' : 'bg-gray-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
              settings.villageAcademy !== false ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Academy</div>
            <div className="text-[10px] text-gray-500">
              {settings.villageAcademy !== false
                ? 'The skill map opens with K, and agents in training are stone until they have Spirit and Body.'
                : 'No skill map and no stone agents. Progress is kept.'}
            </div>
          </div>
        </label>
        {settings.villageAcademy !== false && (
          <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
            <div
              role="switch"
              aria-checked={settings.villageAcademyTree === true}
              data-village-academy-tree={settings.villageAcademyTree === true ? 'on' : 'off'}
              onClick={() => updateSetting('villageAcademyTree', settings.villageAcademyTree !== true)}
              className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
                settings.villageAcademyTree === true ? 'bg-amber-500 shadow-lg shadow-amber-500/30' : 'bg-gray-700'
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
                settings.villageAcademyTree === true ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Skill tree in the world</div>
              <div className="text-[10px] text-gray-500">
                {settings.villageAcademyTree === true
                  ? 'The tree also stands behind the spawn point, as a stair of terraces.'
                  : 'Off: the skill map (K) is the way in.'}
              </div>
            </div>
          </label>
        )}
      </section>

      <section className="border-t border-white/10 pt-3">
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
      {/* Quiet hours and the daily cap of agents' scheduled wake-ups (the engine keeps them). */}
      <WakeUpSettings />
    </div>
  )
}
