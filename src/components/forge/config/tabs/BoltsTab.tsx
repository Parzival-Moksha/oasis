'use client'

// ═══════════════════════════════════════════════════════════════════════════════
// BOLTS TAB — visual-design picker for firebolt / lightning / ice bolts.
// Each design letter (A/B/C/D) maps to a separate VFX implementation in
// src/components/forge/bolts/.
// ═══════════════════════════════════════════════════════════════════════════════

import { useContext } from 'react'
import { SettingsContext } from '@/components/scene-lib/contexts'

interface BoltDesignOption {
  value: string
  label: string
  desc: string
}

function BoltDesignSelector({
  spellLabel,
  spellIcon,
  accent,
  value,
  onChange,
  options,
}: {
  spellLabel: string
  spellIcon: string
  accent: string
  value: string
  onChange: (next: string) => void
  options: BoltDesignOption[]
}) {
  const activeOption = options.find(opt => opt.value === value) || options[0]
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: `${accent.replace('0.8', '0.35').replace('0.85', '0.35')}`, background: 'rgba(0,0,0,0.35)' }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold tracking-[0.05em]" style={{ color: accent }}>
          {spellIcon} {spellLabel}
        </span>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="rounded border bg-black/60 px-2 py-1 font-mono text-[10px] text-white/85 focus:outline-none cursor-pointer"
          style={{ borderColor: `${accent.replace('0.8', '0.45').replace('0.85', '0.45')}` }}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="text-[10px] text-white/55 leading-snug">{activeOption.desc}</div>
    </div>
  )
}

export function BoltsTab() {
  const { settings, updateSetting } = useContext(SettingsContext)

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-mono">⚔ Bolt Lab</div>
      <div className="text-[10px] text-gray-500 mb-2">Pick a visual design per combat spell. Change applies on next cast.</div>

      <div className="space-y-2">
        <BoltDesignSelector
          spellLabel="Firebolt"
          spellIcon="🔥"
          accent="rgba(251,146,60,0.85)"
          value={settings.fireboltDesign}
          onChange={v => updateSetting('fireboltDesign', v as 'A' | 'B' | 'C')}
          options={[
            { value: 'A', label: 'A — Comet Tail',     desc: 'Classic flame projectile + sparks + smoke trail' },
            { value: 'B', label: 'B — Solar Flare',    desc: 'Sun-disc with corona prominences + supernova impact' },
            { value: 'C', label: 'C — Phoenix Feather', desc: 'Gold-crimson feather + ember trail + phoenix-flare impact' },
          ]}
        />
        <BoltDesignSelector
          spellLabel="Lightning Bolt"
          spellIcon="⚡"
          accent="rgba(167,139,250,0.85)"
          value={settings.lightningBoltDesign}
          onChange={v => updateSetting('lightningBoltDesign', v as 'A' | 'B' | 'C' | 'D')}
          options={[
            { value: 'A', label: 'A — Plasma Filament', desc: 'Jagged forked plasma + recursive branches + grounding chains' },
            { value: 'B', label: 'B — Tesla Coil',      desc: 'Stacked toroidal rings + leaping arcs + rolling discharge' },
            { value: 'C', label: 'C — Storm Lance',     desc: 'Stormcloud sleeve around a gold lightning shaft' },
            { value: 'D', label: 'D — Thunderbolt',     desc: 'Arming arrows + 15m top-down strike + recursive zigzag' },
          ]}
        />
        <BoltDesignSelector
          spellLabel="Ice Bolt"
          spellIcon="❄"
          accent="rgba(125,211,252,0.85)"
          value={settings.iceBoltDesign}
          onChange={v => updateSetting('iceBoltDesign', v as 'A' | 'B' | 'C')}
          options={[
            { value: 'A', label: 'A — Crystal Spear',  desc: 'Faceted chrome spear + frost crystals + shatter impact' },
            { value: 'B', label: 'B — Frozen Flame',   desc: 'Cold-fire projectile + freezing snowflakes + frost patch' },
            { value: 'C', label: 'C — Boreal Spiral',  desc: 'Double-helix around snowflake core + frost-rune impact' },
          ]}
        />
      </div>
    </div>
  )
}
