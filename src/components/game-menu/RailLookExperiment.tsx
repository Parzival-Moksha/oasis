'use client'

// Settings > Experiments > HUD rail: the look of the buttons that are always on screen
// (Menu, World, Spells, Agents). Each card shows the four buttons in that look; a click wears it.

import { GameMenuButton } from '@/components/forge/GameMenuButton'
import { RAIL_LOOKS, setRailLook, useRailLook } from '@/lib/rail-look'

const SAMPLE: Array<{ label: string; accent: string; sublabel?: string }> = [
  { label: 'Menu', accent: '#7DD3FC' },
  { label: 'World', accent: '#2DD4BF' },
  { label: 'Spells', accent: '#FBBF24' },
  { label: 'Agents', accent: '#34D399', sublabel: '3 here' },
]

export function RailLookExperiment() {
  const look = useRailLook()
  return (
    <section data-experiment="rail-look">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">HUD rail</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        The buttons that are always in front of you. Each look is a whole design: shape, border,
        letters and how it answers a hover. Click one to wear it.
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {RAIL_LOOKS.map(option => {
          const active = look === option.id
          return (
            <div
              key={option.id}
              role="button"
              tabIndex={0}
              data-rail-look-choice={option.id}
              onClick={() => setRailLook(option.id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setRailLook(option.id) } }}
              title={option.blurb}
              className={`cursor-pointer rounded-lg border p-2 text-left transition-all ${
                active ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]' : 'border-white/12 hover:border-white/30'
              }`}
            >
              <div
                className="pointer-events-none flex flex-col gap-2 rounded-md p-3"
                style={{ background: 'linear-gradient(160deg, #3b4a6b 0%, #77604f 60%, #2a2622 100%)' }}
              >
                {SAMPLE.map(sample => (
                  <GameMenuButton
                    key={sample.label}
                    look={option.id}
                    label={sample.label}
                    sublabel={sample.sublabel}
                    accent={sample.accent}
                    tabIndex={-1}
                    widthClassName="w-[142px]"
                  />
                ))}
              </div>
              <div className="mt-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-white">
                {option.label}{active ? ' · in use' : ''}
              </div>
              <div className="text-[9.5px] leading-snug text-white/55">{option.blurb}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
