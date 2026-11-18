'use client'

// Settings > Experiments > Main menu: how the tiles answer the mouse, which sounds they make, and
// the camera and Escape options. Every pick is saved at once and is live the next time the menu opens.

import { FEEL_STYLES } from '@/lib/game-menu/menu-feel'
import { MENU_SOUNDS, useGameMenu, type MenuPrefs } from '@/lib/game-menu/menu-store'
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

function Toggle({ on, label, blurb, onChange, tag }: { on: boolean; label: string; blurb: string; onChange: (next: boolean) => void; tag: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-black/30 px-2.5 py-2" data-menu-toggle={tag}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-fuchsia-400" />
      <span>
        <span className="block text-[11px] font-bold text-white">{label}</span>
        <span className="block text-[10px] leading-snug text-white/55">{blurb}</span>
      </span>
    </label>
  )
}

export function GameMenuExperiment() {
  const prefs = useGameMenu(s => s.prefs)
  const setPrefs = useGameMenu(s => s.setPrefs)
  const set = (patch: Partial<MenuPrefs>) => setPrefs(patch)

  return (
    <section data-experiment="game-menu">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Main menu</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        Escape, when nothing else is open, lays the menu over the world. Pick how a tile answers a
        hover and a click, then open the menu to feel it.
      </p>

      <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Hover and click</div>
      <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        {FEEL_STYLES.map(style => (
          <Choice key={style.id} tag={`feel-${style.id}`} active={prefs.feel === style.id} label={style.label} blurb={style.blurb} onClick={() => set({ feel: style.id })} />
        ))}
      </div>

      <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Sound · every menu, panel and button in the Oasis</div>
      <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
        {MENU_SOUNDS.map(sound => (
          <Choice
            key={sound.id}
            tag={`sound-${sound.id}`}
            active={prefs.sound === sound.id}
            label={sound.label}
            blurb={sound.blurb}
            onClick={() => {
              set({ sound: sound.id })
              playMenuSound(sound.id, 'hover')
              window.setTimeout(() => playMenuSound(sound.id, 'click'), 260)
            }}
          />
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        <Toggle tag="tilt" on={prefs.tilt} onChange={tilt => set({ tilt })} label="Follow the mouse" blurb="Tiles lean towards the pointer; the title turns and the grid shifts a little against it." />
        <Toggle tag="drift" on={prefs.drift} onChange={drift => set({ drift })} label="Camera drifts behind the menu" blurb="About 1 m/s along an arc around a point 10 m ahead, back in 0.9 s when the menu closes. Off: the camera stays put." />
        <Toggle tag="mouselook" on={prefs.openFromMouseLook} onChange={openFromMouseLook => set({ openFromMouseLook })} label="Escape out of mouse-look opens the menu" blurb="One press frees the mouse and opens the menu. Off: the first press only frees the mouse, the second opens the menu." />
      </div>

      <button
        type="button"
        data-menu-action="open-menu"
        onClick={() => useGameMenu.getState().openMenu({ fromMouseLook: false })}
        className="mt-3 w-full rounded border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-fuchsia-100 transition hover:bg-fuchsia-300/20"
      >
        Open the menu
      </button>
    </section>
  )
}
