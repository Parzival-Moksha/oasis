'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// FORK WELCOME MODAL — fires once when a visitor's first mutation in a
// template world (e.g. the OpenClaw Hub lobby) forks them into their
// own private oasis. Listens for `oasis:fork-welcome` window events
// dispatched by world-persistence.ts on a successful fork.
//
// More prominent than the regular GlobalNotice toast because:
//   * the visitor LITERALLY just left the shared lobby
//   * they may have been mid-conversation with other visitors
//   * the world they're looking at is new + owned by them
// A center modal forces a pause + read before they keep playing.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useState } from 'react'

interface ForkWelcomeDetail {
  forkedFromWorldId?: string
  newWorldId?: string
}

export function ForkWelcomeModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ForkWelcomeDetail>).detail || {}
      void detail  // future: could show name of forked-from world
      setOpen(true)
    }
    window.addEventListener('oasis:fork-welcome', handler)
    return () => window.removeEventListener('oasis:fork-welcome', handler)
  }, [])

  if (!open) return null

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[450] flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-[min(420px,calc(100vw-3rem))] rounded-xl border-2 border-amber-300/55 bg-gradient-to-br from-amber-950/95 via-orange-950/95 to-black/95 p-6 text-amber-50 shadow-[0_0_70px_rgba(251,191,36,0.45)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-3 text-center text-6xl">🦞</div>
        <div className="mb-2 text-center text-[11px] font-black uppercase tracking-[0.22em] text-amber-200/85">
          You forked the lobby
        </div>
        <div className="mb-4 text-center text-lg font-black tracking-[0.02em] text-amber-50">
          Welcome to your own oasis
        </div>
        <p className="mb-5 text-center text-[12px] leading-relaxed text-amber-100/90">
          The OpenClaw Hub is a read-only museum. Your first edit just spawned
          you a private copy. Other visitors stay in the lobby — you're the
          owner here. Build whatever you want.
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full rounded-lg border border-amber-300/55 bg-amber-900/70 px-4 py-3 text-[12px] font-black uppercase tracking-[0.18em] text-amber-50 transition hover:bg-amber-800/80"
        >
          Let's build
        </button>
      </div>
    </div>
  )
}
