'use client'

// The animation browser: every clip, each with where it comes from (CC0, ours, Mixamo), played on the owner's avatar.
// Opened from Settings > Experiments. A click plays the clip (looping), the avatar turns to face the
// camera; walking or Stop ends it. Nothing here runs while the panel is closed.

import { useEffect, useMemo, useState } from 'react'
import { freeUalClips } from '@/lib/forge/ual-catalog'
import { AUTHORED_CLIPS } from '@/lib/forge/authored-clips'
import { ANIMATION_LIBRARY } from '@/lib/forge/animation-library'
import { useUILayer } from '@/lib/input-manager'

export const OPEN_ANIMATION_BROWSER = 'oasis:open-animation-browser'
export const PREVIEW_ANIMATION_EVENT = 'oasis:player-preview-animation'

/**
 * Where a clip comes from, and so whether a stranger gets it (the owner, 2026-11-20: "I'm wondering if these animations
 * are the ones that are fully legit, that we have established that they are free licence").
 */
type ClipSource = 'cc0' | 'ours' | 'mixamo'
const SOURCE_BADGE: Record<ClipSource, { label: string; title: string; className: string }> = {
  cc0: { label: 'CC0', title: 'Quaternius Universal Animation Library, free tier: CC0, may be shipped and changed, no credit owed', className: 'border-emerald-300/50 text-emerald-200' },
  ours: { label: 'ours', title: 'Made in code in the Oasis: ours to ship', className: 'border-violet-300/50 text-violet-200' },
  mixamo: { label: 'Mixamo', title: 'Adobe Mixamo: fine inside your own Oasis, but the raw files may not be handed out, so they are not in the packaged Oasis or the public repository', className: 'border-amber-300/60 text-amber-200' },
}
const MIXAMO_GROUP = 'Mixamo: stays on this PC, not shipped'
const mixamoClips = () => ANIMATION_LIBRARY.filter(a => a.filename.toLowerCase().endsWith('.fbx'))

export function previewAnimation(animId: string | null): void {
  window.dispatchEvent(new CustomEvent(PREVIEW_ANIMATION_EVENT, { detail: { animId, faceCamera: true } }))
}

export function AnimationBrowser() {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  // The Mixamo files are left out of the packaged Oasis: list them only where they are.
  const [mixamoHere, setMixamoHere] = useState(false)
  useEffect(() => {
    if (!open) return
    const first = mixamoClips()[0]
    if (!first) return
    let live = true
    fetch(`/animations/${encodeURIComponent(first.filename)}`, { method: 'HEAD' })
      .then(r => { if (live) setMixamoHere(r.ok) })
      .catch(() => { if (live) setMixamoHere(false) })
    return () => { live = false }
  }, [open])
  useUILayer('animation-browser', open)
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_ANIMATION_BROWSER, onOpen)
    return () => window.removeEventListener(OPEN_ANIMATION_BROWSER, onOpen)
  }, [])
  const groups = useMemo(() => {
    if (!open) return []
    const all: { id: string; label: string; group: string; source: ClipSource; file?: string }[] = [
      ...AUTHORED_CLIPS.map(c => ({ id: c.id, label: c.label, group: 'Made in code by Hipster (a test)', source: 'ours' as const })),
      ...freeUalClips().map(c => ({ id: c.id, label: c.label, group: c.group, source: 'cc0' as const, file: `${c.file.includes('UAL2') ? 'UAL2' : 'UAL1'} ${c.clip}` })),
      ...(mixamoHere ? mixamoClips().map(c => ({ id: c.id, label: c.label, group: MIXAMO_GROUP, source: 'mixamo' as const, file: c.filename })) : []),
    ]
    const q = filter.trim().toLowerCase()
    const shown = q ? all.filter(c => c.label.toLowerCase().includes(q)) : all
    const order = ['Made in code by Hipster (a test)', 'Standing and sitting', 'Moving', 'Doing things', 'Fighting', MIXAMO_GROUP]
    return order.map(name => ({ name, clips: shown.filter(c => c.group === name) })).filter(g => g.clips.length)
  }, [open, filter, mixamoHere])

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
        Click a clip: your avatar plays it, facing you. Each says where it comes from:
      </div>
      <div className="mb-2 flex flex-wrap gap-1 text-[9.5px] leading-snug text-white/60">
        {(['cc0', 'ours', 'mixamo'] as const).filter(k => k !== 'mixamo' || mixamoHere).map(k => (
          <span key={k} className="flex items-center gap-1">
            <span className={`rounded border px-1 font-bold ${SOURCE_BADGE[k].className}`}>{SOURCE_BADGE[k].label}</span>
            {k === 'cc0' ? `free, may ship (Quaternius, ${freeUalClips().length})` : k === 'ours' ? 'made here' : 'this PC only'}
          </span>
        ))}
      </div>
      <div className="mb-2 text-[9.5px] leading-snug text-white/45">Everything agents and your walk use is CC0.</div>
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
                  data-anim-source={clip.source}
                  onClick={() => { previewAnimation(clip.id); setPlaying(clip.id) }}
                  className={`flex items-center gap-1 rounded border px-1.5 py-1 text-left text-[10.5px] transition ${playing === clip.id ? 'border-violet-300/80 bg-violet-400/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                  title={`${clip.label}${clip.file ? ` (${clip.file})` : ''}: ${SOURCE_BADGE[clip.source].title}`}
                >
                  <span className="min-w-0 flex-1 truncate">{clip.label}</span>
                  <span className={`shrink-0 rounded border px-0.5 text-[8px] font-bold leading-tight ${SOURCE_BADGE[clip.source].className}`}>{SOURCE_BADGE[clip.source].label}</span>
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
