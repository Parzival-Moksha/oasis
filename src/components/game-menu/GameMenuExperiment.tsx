'use client'

// The main menu's settled options, where they belong (the owner, 2026-11-19):
//   MenuFeelSettings: Settings > Misc > Main menu: how a tile answers a hover and a click, and how much the tiles
//     follow the mouse. (The camera drift and Esc-from-mouse-look are always on now, no switch.)
//   MenuSoundSettings: Settings > Sound > Menu and button sounds: the one sound set of every button in the Oasis.

import { FEEL_STYLES } from '@/lib/game-menu/menu-feel'
import { MENU_SOUNDS, useGameMenu } from '@/lib/game-menu/menu-store'
import { playMenuSound } from '@/lib/game-menu/menu-sounds'

function Choice({ active, label, blurb, onClick, tag }: { active: boolean; label: string; blurb: string; onClick: () => void; tag: string }) {
  return (
    <button
      type="button"
      data-menu-choice={tag}
      onClick={onClick}
      title={blurb}
      className={`rounded-lg border px-2 py-1.5 text-left transition-all ${
        active ? 'border-fuchsia-300/70 shadow-[0_0_18px_rgba(240,171,252,0.35)]' : 'border-white/12 hover:border-white/30'
      }`}
    >
      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-white">{label}{active ? ' · in use' : ''}</div>
      <div className="text-[9.5px] leading-snug text-white/55">{blurb}</div>
    </button>
  )
}

const HEADING = 'text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-mono'

export function MenuFeelSettings() {
  const prefs = useGameMenu(s => s.prefs)
  const setPrefs = useGameMenu(s => s.setPrefs)
  return (
    <section data-settings-section="main-menu">
      <div className={HEADING}>Main menu (M or Esc)</div>
      <div className="mb-1 text-[10px] text-white/50">How a tile answers a hover and a click</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {FEEL_STYLES.map(style => (
          <Choice key={style.id} tag={`feel-${style.id}`} active={prefs.feel === style.id} label={style.label} blurb={style.blurb} onClick={() => setPrefs({ feel: style.id })} />
        ))}
      </div>
      <label className="mt-3 block" data-menu-follow>
        <span className="flex justify-between text-[11px] text-gray-300">
          <span>Tiles follow the mouse</span>
          <span className="tabular-nums text-fuchsia-200">{prefs.tiltAmount === 0 ? 'off' : `${prefs.tiltAmount.toFixed(1)}×`}</span>
        </span>
        <input
          type="range"
          min={0}
          max={8}
          step={0.1}
          value={prefs.tiltAmount}
          onChange={event => { const tiltAmount = Number(event.target.value); setPrefs({ tiltAmount, tilt: tiltAmount > 0 }) }}
          className="w-full accent-fuchsia-400"
          aria-label="Tiles follow the mouse"
        />
        <span className="block text-[10px] text-gray-500">The tiles lean and the title turns towards the pointer. 1× was the first version; 0 is still.</span>
      </label>
      <button
        type="button"
        data-menu-action="open-menu"
        onClick={() => useGameMenu.getState().openMenu({ fromMouseLook: false })}
        className="mt-2 w-full rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 transition hover:bg-fuchsia-300/20"
      >
        Open the menu to feel it
      </button>
    </section>
  )
}

export function MenuSoundSettings() {
  const prefs = useGameMenu(s => s.prefs)
  const setPrefs = useGameMenu(s => s.setPrefs)
  return (
    <section data-settings-section="menu-sounds">
      <div className={HEADING}>Menu and button sounds</div>
      <div className="mb-1 text-[10px] text-white/50">One set for every menu, panel and button: a sound on hover, a softer one when you leave, one on click.</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {MENU_SOUNDS.map(sound => (
          <Choice
            key={sound.id}
            tag={`sound-${sound.id}`}
            active={prefs.sound === sound.id}
            label={sound.label}
            blurb={sound.blurb}
            onClick={() => {
              setPrefs({ sound: sound.id })
              playMenuSound(sound.id, 'hover')
              window.setTimeout(() => playMenuSound(sound.id, 'leave'), 220)
              window.setTimeout(() => playMenuSound(sound.id, 'click'), 480)
            }}
          />
        ))}
      </div>
    </section>
  )
}
