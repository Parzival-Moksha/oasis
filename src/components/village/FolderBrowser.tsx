'use client'

// ░▒▓ FOLDER BROWSER — "Browse…" for a new agent's working folder ▓▒░
// Walks the folders of the machine the agents run on (GET /api/local/dirs), from any device: a desktop
// browser, an iPad or a phone. Tap a folder to open it, tap the path to jump back up, "Use this folder"
// to pick. Recent folders (from your sessions) are one tap away at the top level.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import type { DirListing } from '@/lib/local-dirs'
import { pathCrumbs } from '@/lib/path-crumbs'

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function FolderBrowser({ initialPath, recent, onPick, onClose }: {
  initialPath: string
  /** Folders your sessions ran in, newest first. */
  recent: string[]
  onPick: (path: string) => void
  onClose: () => void
}) {
  useUILayer('folder-browser', true)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [loading, setLoading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [error, setError] = useState('')

  const open = useCallback(async (dir: string, hidden = showHidden) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${BASE}/api/local/dirs?path=${encodeURIComponent(dir)}${hidden ? '&hidden=1' : ''}`)
      const data = await response.json().catch(() => null) as DirListing | { error?: string } | null
      if (!response.ok || !data || !('entries' in data)) {
        setError((data && 'error' in data && data.error) || `Could not list folders (HTTP ${response.status}).`)
        return
      }
      setListing(data)
      if (data.error) setError(data.error)
    } catch {
      setError('Could not reach the Oasis server.')
    } finally {
      setLoading(false)
    }
  }, [showHidden])

  useEffect(() => { void open(initialPath) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes; keys never reach the world while browsing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [onClose])

  const here = listing?.path || ''
  const crumbs = pathCrumbs(here)
  const atTop = !here

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm"
      onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }}
      onKeyDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <div className="flex max-h-[min(640px,calc(100vh-24px))] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-emerald-300/30 bg-slate-950/95 text-white shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <span className="text-[13px] font-black uppercase tracking-[0.14em] text-emerald-200">Working folder</span>
          <span className="ml-auto text-[10.5px] text-white/45">on this machine</span>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[13px] text-white/70 hover:bg-white/10" aria-label="Close">✕</button>
        </div>

        {/* where you are: tap a piece to go back up */}
        <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-3 py-2 text-[12px]">
          <button type="button" onClick={() => void open('')} className={`rounded px-1.5 py-1 font-bold ${atTop ? 'bg-emerald-400/20 text-emerald-100' : 'text-white/70 hover:bg-white/10'}`}>⌂ Drives</button>
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <span className="text-white/30">›</span>
              <button type="button" onClick={() => void open(crumb.path)} className={`max-w-[180px] truncate rounded px-1.5 py-1 ${index === crumbs.length - 1 ? 'bg-white/10 font-bold text-white' : 'text-white/70 hover:bg-white/10'}`}>
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5 [scrollbar-width:thin]">
          {atTop && recent.length > 0 && (
            <div className="mb-2">
              <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Recent</div>
              {recent.slice(0, 6).map(dir => (
                <FolderRow key={`r-${dir}`} label={dir} git={false} onOpen={() => void open(dir)} onPick={() => onPick(dir)} />
              ))}
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Drives</div>
            </div>
          )}
          {listing?.parent !== null && listing?.parent !== undefined && !atTop && (
            <button type="button" onClick={() => void open(listing.parent || '')} className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-white/70 hover:bg-white/10">
              <span className="w-5 text-center">↰</span> ..
            </button>
          )}
          {listing?.entries.map(entry => (
            <FolderRow key={entry.path} label={entry.name} git={entry.git} onOpen={() => void open(entry.path)} onPick={atTop ? undefined : () => onPick(entry.path)} />
          ))}
          {listing && !listing.entries.length && !error && <div className="px-3 py-6 text-center text-[12px] text-white/45">No folders in here.</div>}
          {error && <div className="mx-2 my-2 rounded-md border border-amber-300/30 bg-amber-400/10 px-2.5 py-2 text-[12px] text-amber-100">{error}</div>}
          {listing?.truncated && <div className="px-3 py-2 text-[11px] text-white/45">Showing the first 1500 folders.</div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2.5">
          <label className="flex items-center gap-1.5 text-[11px] text-white/60">
            <input type="checkbox" checked={showHidden} onChange={event => { setShowHidden(event.target.checked); void open(here, event.target.checked) }} />
            hidden{listing?.hidden ? ` (${listing.hidden})` : ''}
          </label>
          {loading && <span className="text-[11px] text-white/45">…</span>}
          <span className="ml-auto" />
          <button type="button" onClick={onClose} className="rounded-md border border-white/15 px-3 py-2 text-[12px] text-white/75 hover:bg-white/10">Cancel</button>
          <button
            type="button"
            disabled={atTop || Boolean(listing?.error)}
            onClick={() => here && onPick(here)}
            className="max-w-[260px] truncate rounded-md border border-emerald-300/50 bg-emerald-400/20 px-3 py-2 text-[12px] font-bold text-emerald-50 hover:bg-emerald-400/35 disabled:opacity-40"
            title={here}
          >
            Use this folder{crumbs.length ? `: ${crumbs[crumbs.length - 1].label}` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FolderRow({ label, git, onOpen, onPick }: { label: string; git: boolean; onOpen: () => void; onPick?: () => void }) {
  return (
    <div className="group flex min-h-[40px] items-center gap-1 rounded-md hover:bg-white/[0.07]">
      <button type="button" onClick={onOpen} className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 px-2 text-left text-[13px] text-white/90">
        <span className="w-5 shrink-0 text-center text-amber-200/80">▸</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {git && <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-emerald-200">git</span>}
      </button>
      {onPick && (
        <button type="button" onClick={onPick} className="mr-1 shrink-0 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-white/60 opacity-100 hover:border-emerald-300/50 hover:text-emerald-100 sm:opacity-0 sm:group-hover:opacity-100">
          use
        </button>
      )}
    </div>
  )
}
