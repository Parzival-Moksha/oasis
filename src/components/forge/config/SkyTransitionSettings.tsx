'use client'

// Settings > World VFX > Sky change: how one sky gives way to the next.

import { SKY_TRANSITION_STYLES, setSkyTransitionStyle, useSkyTransitionStyle } from '@/components/forge/SkyTransition'

export function SkyTransitionSettings() {
  const style = useSkyTransitionStyle()
  return (
    <section data-settings-section="sky-transition">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono">Sky change</div>
      <div className="grid grid-cols-2 gap-1.5">
        {SKY_TRANSITION_STYLES.map(option => (
          <button
            key={option.id}
            type="button"
            data-sky-transition={option.id}
            onClick={() => setSkyTransitionStyle(option.id)}
            title={option.blurb}
            className={`rounded-lg border px-2 py-1.5 text-left transition ${style === option.id ? 'border-pink-300/70 bg-pink-300/10' : 'border-white/10 bg-black/30 hover:border-white/30'}`}
          >
            <div className="text-[11px] font-bold text-white">{option.label}{style === option.id ? ' · in use' : ''}</div>
            <div className="text-[9.5px] leading-snug text-white/55">{option.blurb}</div>
          </button>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-gray-500">About 1.6 seconds, whoever changes the sky: you, an agent, or a world loading.</div>
    </section>
  )
}
