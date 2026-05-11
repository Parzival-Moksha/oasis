// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THUMBNAIL STORE — Unified status + cache-bust for every asset thumbnail
// ─═̷─═̷─📸─═̷─═̷─ One source of truth, one orchestrator, one event ─═̷─═̷─📸─═̷─═̷─
//
// Three states per asset:
//   'missing'  — never generated, render queue hasn't touched it yet
//   'pending'  — currently rendering or queued
//   'ready'    — file exists on disk, OK to <img src=...>
//   'failed'   — rendering failed (broken GLB, network error, etc.)
//
// `version` is bumped each time a thumbnail finishes rendering so <img> src
// queries can be cache-busted with ?v=<n>. The browser cached a 404 before
// the render; we need a fresh URL or it never reloads.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { create } from 'zustand'

export type ThumbStatus = 'missing' | 'pending' | 'ready' | 'failed'

interface ThumbnailStore {
  /** Per-asset status. Default 'missing' for unknown ids. */
  status: Record<string, ThumbStatus>
  /** Per-asset version counter — bump on transition to 'ready'. */
  versions: Record<string, number>
  /** Aggregate progress for UI display. */
  pending: number
  done: number
  total: number

  // Mutators
  markMissing(id: string): void
  markPending(id: string): void
  markReady(id: string): void
  markFailed(id: string): void
  seedKnown(ids: string[]): void
  resetProgress(total: number): void
  bumpDone(): void
}

export const useThumbnailStore = create<ThumbnailStore>((set) => ({
  status: {},
  versions: {},
  pending: 0,
  done: 0,
  total: 0,

  markMissing: (id) => set(s => ({ status: { ...s.status, [id]: 'missing' } })),
  markPending: (id) => set(s => {
    if (s.status[id] === 'pending') return s
    return { status: { ...s.status, [id]: 'pending' }, pending: s.pending + 1 }
  }),
  markReady: (id) => set(s => {
    const wasPending = s.status[id] === 'pending'
    return {
      status: { ...s.status, [id]: 'ready' },
      versions: { ...s.versions, [id]: (s.versions[id] || 0) + 1 },
      pending: wasPending ? Math.max(0, s.pending - 1) : s.pending,
      done: s.done + 1,
    }
  }),
  markFailed: (id) => set(s => {
    const wasPending = s.status[id] === 'pending'
    return {
      status: { ...s.status, [id]: 'failed' },
      pending: wasPending ? Math.max(0, s.pending - 1) : s.pending,
    }
  }),
  seedKnown: (ids) => set(s => {
    const next = { ...s.status }
    for (const id of ids) {
      if (next[id] !== 'pending' && next[id] !== 'failed') next[id] = 'ready'
    }
    return { status: next }
  }),
  resetProgress: (total) => set({ pending: 0, done: 0, total }),
  bumpDone: () => set(s => ({ done: s.done + 1 })),
}))

/** Convenience selector — gives a tuple suited for an `<img>`: a cache-busting suffix
 *  + the current status so consumers can render a placeholder. */
export function useThumbnailFor(id: string): { suffix: string; status: ThumbStatus } {
  const status = useThumbnailStore(s => s.status[id]) || 'missing'
  const version = useThumbnailStore(s => s.versions[id]) || 0
  return { suffix: version > 0 ? `?v=${version}` : '', status }
}
