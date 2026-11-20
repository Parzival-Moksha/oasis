'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// SOUND TAB — master/SFX/music/ambient volumes, spatial audio, per-event Sound
// Lab, and the per-spell Spell Sounds selector.
// ═══════════════════════════════════════════════════════════════════════════════

import { KitToggle } from '@/components/ui-kit'
import { useContext, useState, useSyncExternalStore } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { useAudioManager, SOUND_OPTIONS, type SoundEvent, getFootstepVolume, setFootstepVolume, subscribeFootstepVolume } from '@/lib/audio-manager'
import { SpellSoundsSelector } from './SpellSoundsSelector'
import { MenuSoundSettings } from '@/components/game-menu/GameMenuExperiment'
import {
  DEFAULT_VOICE_TYPING_ENGINE,
  getVoiceTypingEngine,
  setVoiceTypingEngine,
  subscribeVoiceTypingEngine,
  type VoiceTypingEngine,
} from '@/lib/voice/voice-typing-engine'

/** Your own footsteps (0 = silent; the default is a third of the old, too-loud level). */
function FootstepSlider() {
  const value = useSyncExternalStore(subscribeFootstepVolume, getFootstepVolume, () => 0.17)
  return (
    <VolumeSlider
      label="Footsteps"
      accent="rgba(190,170,140,0.85)"
      value={value}
      onChange={v => setFootstepVolume(v)}
    />
  )
}

function VolumeSlider({
  label,
  accent,
  value,
  onChange,
}: {
  label: string
  accent: string
  value: number
  onChange: (next: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <label className="block rounded-lg border p-2" style={{ borderColor: `${accent.replace('0.85', '0.3')}`, background: 'rgba(0,0,0,0.35)' }}>
      <div className="mb-1 flex items-center justify-between text-[10px] font-mono">
        <span className="text-white/65">{label}</span>
        <span className="font-bold" style={{ color: accent }}>{pct}%</span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1 w-full"
        style={{ accentColor: accent }}
      />
    </label>
  )
}

const EVENT_LABELS: Record<string, string> = {
  select: 'Select Object', deselect: 'Deselect', place: 'Place Object', delete: 'Delete Object',
  panelOpen: 'Panel Open', panelClose: 'Panel Close', buttonClick: 'Button Click', buttonHover: 'Button Hover',
  modeSwitch: 'Camera Mode', conjureStart: 'Conjure Start', conjureDone: 'Conjure Done',
  anorakDone: 'Anorak Done', notification: 'Notification', undo: 'Undo', redo: 'Redo',
  connected: 'Agent Connected', levelUp: 'Level Up', chooseCharacter: 'Choose Character',
  agentFocus: 'Agent Focus', agentUnfocus: 'Agent Unfocus', tilePaint: 'Tile Paint',
  error: 'Error',
}

function PerEventSoundLab() {
  const { volume, muted, selections, setVolume, toggleMute, selectSound, preview } = useAudioManager()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
          <span>{expanded ? '▼' : '▸'}</span>
          <span className="text-[11px] font-bold">UI Sound Lab</span>
        </button>
        <button onClick={toggleMute} className="text-[10px] cursor-pointer px-1.5 py-0.5 rounded" style={{ background: muted ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)', color: muted ? '#ef4444' : '#22c55e' }}>
          {muted ? '🔇 Muted' : '🔊 On'}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-gray-500">UI Vol</span>
        <input type="range" min={0} max={100} value={Math.round(volume * 100)}
          onChange={e => setVolume(parseInt(e.target.value) / 100)}
          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
        />
        <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{Math.round(volume * 100)}%</span>
      </div>

      {expanded && (
        <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {Object.entries(EVENT_LABELS).map(([event, label]) => {
            const options = (SOUND_OPTIONS as Record<string, Array<{ id: string; label: string }>>)[event]
            if (!options) return null
            return (
              <div key={event} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-gray-500 w-24 truncate flex-shrink-0">{label}</span>
                <select
                  value={(selections as Record<string, string>)[event] || options[0]?.id}
                  onChange={e => {
                    selectSound(event as SoundEvent, e.target.value)
                    preview(event as SoundEvent, e.target.value)
                  }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 cursor-pointer outline-none text-[10px]"
                >
                  {options.map((opt: { id: string; label: string }) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button onClick={() => preview(event as SoundEvent, (selections as Record<string, string>)[event])}
                  className="rounded border border-sky-300/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-gray-500 hover:border-sky-300/45 hover:text-sky-300 cursor-pointer">Test</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const VOICE_TYPING_CHOICES: Array<{ id: VoiceTypingEngine; label: string; detail: string }> = [
  { id: 'elevenlabs', label: 'ElevenLabs', detail: 'Scribe Realtime in the cloud: best quality, words after about a second' },
  { id: 'local', label: 'Local', detail: 'Moonshine on this computer: free and offline, a bit rougher' },
]

/** Who types what you say (T, and the mic on text fields). */
function VoiceTypingSection() {
  const engine = useSyncExternalStore(subscribeVoiceTypingEngine, getVoiceTypingEngine, () => DEFAULT_VOICE_TYPING_ENGINE)
  return (
    <section>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Voice typing</div>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Voice typing">
        {VOICE_TYPING_CHOICES.map(choice => {
          const active = engine === choice.id
          return (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setVoiceTypingEngine(choice.id)}
              className={`rounded-lg border p-2 text-left transition ${active ? 'border-emerald-300/60 bg-emerald-500/15' : 'border-white/10 bg-black/30 hover:bg-white/5'}`}
            >
              <div className={`text-[11px] font-bold ${active ? 'text-emerald-200' : 'text-white/80'}`}>{active ? '● ' : '○ '}{choice.label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-white/50">{choice.detail}</div>
            </button>
          )
        })}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-white/40">
        Used by T and the mic on text fields. Without an ElevenLabs key the agent engine types with Moonshine.
      </div>
    </section>
  )
}

export function SoundTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
      <VoiceTypingSection />
      <MenuSoundSettings />
      <section>
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Volume Mixers</div>
        <div className="space-y-2">
          <VolumeSlider
            label="Master"
            accent="rgba(167,139,250,0.85)"
            value={settings.masterVolume}
            onChange={v => updateSetting('masterVolume', v)}
          />
          <VolumeSlider
            label="SFX (spells, UI)"
            accent="rgba(251,146,60,0.85)"
            value={settings.sfxVolume}
            onChange={v => updateSetting('sfxVolume', v)}
          />
          <FootstepSlider />
          <VolumeSlider
            label="Music"
            accent="rgba(244,114,182,0.85)"
            value={settings.musicVolume}
            onChange={v => updateSetting('musicVolume', v)}
          />
          <VolumeSlider
            label="Ambient (drone, world)"
            accent="rgba(125,211,252,0.85)"
            value={settings.ambientVolume}
            onChange={v => updateSetting('ambientVolume', v)}
          />
          <KitToggle
            checked={settings.spatialAudioEnabled}
            onChange={next => updateSetting('spatialAudioEnabled', next)}
            label="3D spatial audio"
            hint="Bolts emit positional sound; volume falls off with distance from the camera"
            data-setting="spatial-audio"
          />
        </div>
      </section>

      <section className="border-t border-white/10 pt-3">
        <SpellSoundsSelector />
      </section>

      <section className="border-t border-white/10 pt-3">
        <PerEventSoundLab />
      </section>
    </div>
  )
}
