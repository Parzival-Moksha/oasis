'use client'

// The animation browser: every clip the Oasis may ship, played on the owner's own avatar.
// Opened from Settings > Experiments. A click plays the clip (looping), the avatar turns to face the
// camera; walking or Stop ends it. Nothing here runs while the panel is closed.

import { useEffect, useMemo, useState } from 'react'
import { freeUalClips } from '@/lib/forge/ual-catalog'
import { AUTHORED_CLIPS } from '@/lib/forge/authored-clips'
import { useUILayer } from '@/lib/input-manager'

export const OPEN_ANIMATION_BROWSER = 'oasis:open-animation-browser'
export const PREVIEW_ANIMATION_EVENT = 'oasis:player-preview-animation'

export function previewAnimation(animId: string | null): void {
  window.dispatchEvent(new CustomEvent(PREVIEW_ANIMATION_EVENT, { detail: { animId, faceCamera: true } }))
}

export function AnimationBrowser() {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  useUILayer('animation-browser', open)
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_ANIMATION_BROWSER, onOpen)
    return () => window.removeEventListener(OPEN_ANIMATION_BROWSER, onOpen)
  }, [])
  const groups = useMemo(() => {
    if (!open) return []
    const all = [
      ...AUTHORED_CLIPS.map(c => ({ id: c.id, label: c.label, group: 'Made in code by Hipster (a test)' })),
      ...freeUalClips().map(c => ({ id: c.id, label: c.label, group: c.group })),
    ]
    const q = filter.trim().toLowerCase()
    const shown = q ? all.filter(c => c.label.toLowerCase().includes(q)) : all
    const order = ['Made in code by Hipster (a test)', 'Standing and sitting', 'Moving', 'Doing things', 'Fighting']
    return order.map(name => ({ name, clips: shown.filter(c => c.group === name) })).filter(g => g.clips.length)
  }, [open, filter])

  if (!open) return null
  const close = () => { previewAnimation(null); setPlaying(null); setOpen(false) }
  return (
    <div
      data-ui-panel="animation-browser"
      className="fixed bottom-4 right-4 top-4 z-[9500] flex w-[300px] flex-col rounded-lg border border-white/15 p-3 font-mono text-white"
      style={{ background: 'rgba(24,26,30,0.78)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onKeyDown={event => event.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[12px] font-black uppercase tracking-[0.16em]">Animations</div>
        <button type="button" onClick={close} className="rounded border border-white/20 px-2 py-0.5 text-[12px] hover:bg-white/10" title="Close">✕</button>
      </div>
      <div className="mb-2 text-[10px] leading-snug text-white/55">
        Every clip the Oasis may ship: Quaternius&apos;s two free packs (CC0, {freeUalClips().length} clips). Click one: your avatar plays it, facing you.
      </div>
      <input
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder="Search (sit, walk, idle…)"
        className="mb-2 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] outline-none focus:border-white/40"
      />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {groups.map(group => (
          <div key={group.name} className="mb-2">
            <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/45">{group.name} · {group.clips.length}</div>
            <div className="grid grid-cols-2 gap-1">
              {group.clips.map(clip => (
                <button
                  key={clip.id}
                  type="button"
                  data-anim-id={clip.id}
                  onClick={() => { previewAnimation(clip.id); setPlaying(clip.id) }}
                  className={`truncate rounded border px-1.5 py-1 text-left text-[10.5px] transition ${playing === clip.id ? 'border-violet-300/80 bg-violet-400/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  title={clip.label}
                >
                  {clip.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => { previewAnimation(null); setPlaying(null) }} className="mt-2 rounded border border-white/20 px-2 py-1 text-[11px] font-bold hover:bg-white/10">
        Stop
      </button>
    </div>
  )
}
