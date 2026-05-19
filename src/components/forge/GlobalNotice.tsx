'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// GLOBAL NOTICE — fixed-position center-screen toast, 3s auto-dismiss.
// ─═̷─═̷─📣─═̷─═̷─ Triggered by window event `oasis:notice` ─═̷─═̷─📣─═̷─═̷─
//
// Anyone in the codebase can fire `showNotice(message, tone?)` to flash a
// prominent message. Used today for: read-only-world spell rejections,
// but ready for any other "tell the player something important" beat.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useEffect, useRef, useState } from 'react'

export type NoticeTone = 'warn' | 'info' | 'error'

interface NoticeState {
  id: number
  message: string
  tone: NoticeTone
}

export function GlobalNotice() {
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const message = typeof detail.message === 'string' ? detail.message : ''
      if (!message) return
      const tone: NoticeTone = detail.tone === 'info' || detail.tone === 'error' ? detail.tone : 'warn'
      if (timerRef.current) window.clearTimeout(timerRef.current)
      setNotice({ id: Date.now(), message, tone })
      timerRef.current = window.setTimeout(() => setNotice(null), 3000)
    }
    window.addEventListener('oasis:notice', handler)
    return () => {
      window.removeEventListener('oasis:notice', handler)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  if (!notice) return null

  const toneClasses: Record<NoticeTone, string> = {
    warn:  'border-amber-300/65 bg-amber-950/86 text-amber-50 shadow-[0_0_50px_rgba(251,191,36,0.44)]',
    info:  'border-cyan-300/60  bg-cyan-950/86  text-cyan-50  shadow-[0_0_50px_rgba(34,211,238,0.40)]',
    error: 'border-rose-400/70  bg-rose-950/86  text-rose-50  shadow-[0_0_50px_rgba(244,63,94,0.46)]',
  }

  return (
    <div
      key={notice.id}
      className={`pointer-events-none fixed left-1/2 top-1/3 z-[400] -translate-x-1/2 rounded-lg border-2 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.16em] backdrop-blur-md max-[700px]:top-1/2 max-[700px]:max-w-[88vw] max-[700px]:px-4 max-[700px]:py-3 max-[700px]:text-xs ${toneClasses[notice.tone]}`}
      style={{
        animation: 'oasisNoticeIn 220ms ease-out',
      }}
    >
      <style>{`
        @keyframes oasisNoticeIn {
          0%   { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
          100% { opacity: 1; transform: translate(-50%, 0)    scale(1);    }
        }
      `}</style>
      {notice.message}
    </div>
  )
}

/** Fire a transient on-screen notice. Safe to call from anywhere. */
export function showNotice(message: string, tone: NoticeTone = 'warn') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('oasis:notice', { detail: { message, tone } }))
}
