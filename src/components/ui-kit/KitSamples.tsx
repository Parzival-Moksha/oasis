'use client'

// Settings > Experiments > Menu styles: every kit part in each style, side by side, for the owner to judge
// (2026-11-19, 7:25: "three big buttons… the picture and the icon and the colours rhyme"). "Use this" sets the
// one style of every menu.

import { useState } from 'react'
import { MENU_STYLES, setMenuLook, useMenuLook, type MenuStyleId } from '@/lib/ui-kit/menu-look'
import { KitButton, KitCard, KitPanel, KitPickTile, KitProgress, KitSlider, KitStyleOverride, KitTabs, KitTextField, KitTileButton, KitToggle, kitConfirm } from './index'

const TILES = [
  { picture: '/ui/spellbook/tiles/sky-background.gpt2.webp', icon: '☀', label: 'Background', sub: 'Skies and light', accent: '#ffb35c' },
  { picture: '/ui/spellbook/tiles/text-to-3d.gpt2.webp', icon: '✦', label: 'Create', sub: 'Make anything', accent: '#b48cff' },
  { picture: '/ui/spellbook/tiles/portal-create.gpt2.webp', icon: '◎', label: 'Portal', sub: 'Go somewhere', accent: '#6fe3ff' },
]

function Sample({ style }: { style: MenuStyleId }) {
  const [on, setOn] = useState(true)
  const [pick, setPick] = useState(0)
  const [skyPick, setSkyPick] = useState(1)
  const [level, setLevel] = useState(60)
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one')
  const look = useMenuLook()
  const meta = MENU_STYLES.find(s => s.id === style)!
  return (
    <KitStyleOverride.Provider value={style}>
      <KitPanel title={meta.label} data-kit-sample={style} style={{ minHeight: 0 }}>
        <div className="mb-2 text-[12px] opacity-70">{meta.blurb}</div>
        <div className="grid grid-cols-3 gap-2">
          {TILES.map((tile, i) => <KitTileButton key={tile.label} {...tile} selected={i === pick} onClick={() => setPick(i)} />)}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {['sky-background', 'ground-texture', 'catalog-place', 'brush-wand'].map((id, i) => (
            <KitPickTile key={id} picture={`/ui/spellbook/tiles/${id}.gpt2.webp`} label={id.replace(/-/g, ' ')} selected={i === skyPick} onClick={() => setSkyPick(i)} />
          ))}
        </div>
        <div className="mt-3"><KitTabs tabs={[{ id: 'one', label: 'This world' }, { id: 'two', label: 'My worlds' }, { id: 'three', label: 'Public' }]} active={tab} onChange={setTab} /></div>
        <div className="mt-2 grid grid-cols-2 gap-x-4">
          <KitToggle checked={on} onChange={setOn} label="Name tags" hint="Above every agent" />
          <KitSlider label="Volume" value={level} min={0} max={100} onChange={setLevel} format={v => `${v}%`} />
        </div>
        <div className="mt-2"><KitTextField label="Name" placeholder="Call it something" /></div>
        <KitCard title="Level 7 · Journeyman" className="mt-2"><KitProgress label="XP to level 8" value={340} max={500} format={(v, m) => `${v} / ${m}`} accent="#ffd66b" /></KitCard>
        <div className="mt-3 flex flex-wrap gap-2">
          <KitButton variant="primary" onClick={() => setMenuLook({ style })}>{look.style === style ? 'In use' : 'Use this'}</KitButton>
          <KitButton>Cancel</KitButton>
          <KitButton variant="danger" onClick={() => {
            // The dialog wears the style in use; switch first to see it in this one.
            void kitConfirm({ title: 'Dismiss Jerry?', body: 'Jerry leaves the village. His conversation stays in your sessions and can be continued.', confirm: 'Dismiss', danger: true })
          }}>Try the dialog</KitButton>
        </div>
      </KitPanel>
    </KitStyleOverride.Provider>
  )
}

export function KitSamples() {
  return (
    <section data-experiment="menu-styles">
      <h3 className="text-[11px] font-black uppercase tracking-[0.16em] text-fuchsia-200">Menu styles</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        One style for every menu built with the Oasis kit (Settings, World, Summon, the dialogs, more as they move over).
        Glass follows the see-through, blur and colour at the top right. &quot;Use this&quot; switches every menu at once.
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-4">
        {MENU_STYLES.map(style => <Sample key={style.id} style={style.id} />)}
      </div>
    </section>
  )
}
