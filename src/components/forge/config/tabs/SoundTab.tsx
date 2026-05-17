'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// SOUND TAB — master/SFX/music/ambient volumes, spatial audio, per-event Sound
// Lab, and the per-spell Spell Sounds selector.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext, useState } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'
import { useAudioManager, SOUND_OPTIONS, type SoundEvent } from '@/lib/audio-manager'
import { SpellSoundsSelector } from './SpellSoundsSelector'

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

export function SoundTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
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
          <label className="flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/[0.06] p-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.spatialAudioEnabled}
              onChange={e => updateSetting('spatialAudioEnabled', e.target.checked)}
              className="w-3.5 h-3.5 accent-violet-500"
            />
            <div className="flex-1">
              <div className="text-[11px] font-bold text-violet-200">3D spatial audio</div>
              <div className="text-[10px] text-white/55">Bolts emit positional sound; volume falls off with distance from the camera</div>
            </div>
          </label>
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
