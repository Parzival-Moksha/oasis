'use client'

// Settings > Experiments > Intro overlay: pick one of the drawn variants or Off. Clicking a card
// saves it and plays it once over the world, without a reload.

import { useState } from 'react'
import {
  INTRO_PREVIEW_EVENT,
  INTRO_VARIANTS,
  readIntroChoice,
  saveIntroChoice,
  type IntroChoice,
} from './intro-overlay'
import { IntroArt } from './IntroOverlay'

function play(choice: IntroChoice) {
  window.dispatchEvent(new CustomEvent(INTRO_PREVIEW_EVENT, { detail: { choice } }))
}

export function IntroOverlayExperiment() {
  const [choice, setChoice] = useState<IntroChoice>(() => readIntroChoice())

  const pick = (next: IntroChoice) => {
    setChoice(next)
    saveIntroChoice(next)
    play(next)
  }

  return (
    <section data-experiment="intro-overlay">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">
        Intro overlay
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        The world shows at once and loads in front of you. For about three seconds the title sits on
        top of it, mostly see-through, and never takes a click or a key. Click one to use it and see
        it play.
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
        {INTRO_VARIANTS.map(variant => {
          const active = choice === variant.id
          return (
            <button
              key={variant.id}
              type="button"
              data-intro-variant={variant.id}
              onClick={() => pick(variant.id)}
              title={variant.blurb}
              className={`overflow-hidden rounded-lg border text-left transition-all ${
                active
                  ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]'
                  : 'border-white/12 hover:border-white/30'
              }`}
            >
              <div
                className="aspect-[16/9] w-full"
                style={{ background: 'linear-gradient(180deg, #27406b 0%, #6d5a7c 55%, #2c2a26 56%, #15130f 100%)' }}
              >
                <IntroArt variant={variant.id} />
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white">
                  {variant.label}{active ? ' · in use' : ''}
                </div>
                <div className="truncate text-[9.5px] text-white/55">{variant.blurb}</div>
              </div>
            </button>
          )
        })}
        <button
          type="button"
          data-intro-variant="off"
          onClick={() => pick('off')}
          className={`rounded-lg border px-2 py-1.5 text-left transition-all ${
            choice === 'off'
              ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]'
              : 'border-white/12 hover:border-white/30'
          }`}
        >
          <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white">
            Off{choice === 'off' ? ' · in use' : ''}
          </div>
          <div className="text-[9.5px] text-white/55">Nothing over the world at start.</div>
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/45">
        A link can force one: <code className="text-fuchsia-200">?intro=sigil</code> or{' '}
        <code className="text-fuchsia-200">?intro=off</code>.
      </p>
    </section>
  )
}
