'use client'

// Settings > Experiments > Animations: open the animation browser, and pick which walk, run and sprint
// the owner's avatar uses (Mixamo, as until now, or the free Quaternius loops we may ship).

import { useState } from 'react'
import { OPEN_ANIMATION_BROWSER } from '@/components/forge/AnimationBrowser'
import { getDefaultPace, getLocomotionSet, PACE_SPEED, setDefaultPace, setLocomotionSet, type DefaultPace, type LocomotionSet } from '@/lib/forge/locomotion-set'

export const LOCOMOTION_CHANGED_EVENT = 'oasis:locomotion-set-changed'

export function AnimationsExperiment() {
  const [set, setSet] = useState<LocomotionSet>(() => getLocomotionSet())
  const [pace, setPace] = useState<DefaultPace>(() => getDefaultPace())
  const pick = (next: LocomotionSet) => {
    setLocomotionSet(next)
    setSet(next)
    window.dispatchEvent(new CustomEvent(LOCOMOTION_CHANGED_EVENT))
  }
  return (
    <section data-experiment="animations">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Animations</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        See every clip we may ship on your own avatar, and compare the walk you have with the free one.
      </p>
      <button
        type="button"
        data-anim-action="open-browser"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('oasis:close-config'))
          window.dispatchEvent(new CustomEvent(OPEN_ANIMATION_BROWSER))
        }}
        className="mt-2 w-full rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 transition hover:bg-fuchsia-300/20"
      >
        Open the animation browser
      </button>
      <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Walk, run and sprint</div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {([
          ['quaternius', 'Free (Quaternius)', 'CC0 loops from the packs we already have. May be shipped. In use by default.'],
          ['mixamo', 'Mixamo', 'What you had until 20 Nov. Fine on your PC; may not be shared.'],
        ] as const).map(([id, label, blurb]) => (
          <button
            key={id}
            type="button"
            data-locomotion={id}
            onClick={() => pick(id)}
            className={`rounded-lg border px-2 py-1.5 text-left transition-all ${set === id ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]' : 'border-white/12 hover:border-white/30'}`}
          >
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white">{label}{set === id ? ' · in use' : ''}</div>
            <div className="text-[9.5px] leading-snug text-white/55">{blurb}</div>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-white/45">Takes effect at once: walk off and look. Steps follow your real speed either way.</p>
      <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Plain WASD</div>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {([
          ['walk', 'Walk', `${PACE_SPEED.walk} m/s, a real walk. Shift ${PACE_SPEED.walk * 4} m/s, a sprint.`],
          ['jog', 'Jog (as before)', `${PACE_SPEED.jog} m/s, which can only look like a jog. Shift ${PACE_SPEED.jog * 4} m/s.`],
        ] as const).map(([id, label, blurb]) => (
          <button
            key={id}
            type="button"
            data-pace={id}
            onClick={() => { setDefaultPace(id); setPace(id) }}
            className={`rounded-lg border px-2 py-1.5 text-left transition-all ${pace === id ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]' : 'border-white/12 hover:border-white/30'}`}
          >
            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white">{label}{pace === id ? ' · in use' : ''}</div>
            <div className="text-[9.5px] leading-snug text-white/55">{blurb}</div>
          </button>
        ))}
      </div>
    </section>
  )
}
