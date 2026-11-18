'use client'

// Tooltips in the Oasis's own material instead of the browser's grey box.
//
// One listener for the whole page: when the pointer rests on anything that carries a `title`, the
// title is taken off the element (so the browser shows nothing), kept as `data-game-tip`, and
// drawn here as a small dark plate with a bronze edge and the Oasis's serif. Nothing runs while
// the pointer is not over such an element, and nothing runs per frame.

import { useEffect, useRef, useState } from 'react'
import { startUiSounds } from '@/lib/ui-sounds'

interface Tip { text: string; x: number; y: number; below: boolean }

const DELAY_MS = 380
const MAX_WIDTH = 300

function tipHost(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null
  for (let depth = 0; el && el.nodeType === 1 && depth < 12; depth++, el = el.parentElement) {
    if (el.hasAttribute('title') || el.hasAttribute('data-game-tip')) return el
  }
  return null
}

export function GameTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  // The other half of the Oasis's page-wide chrome: one hover tick and one click for every button (ui-sounds.ts).
  useEffect(() => startUiSounds(), [])
  const hostRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
      hostRef.current = null
      setTip(current => (current ? null : current))
    }
    const onOver = (event: MouseEvent) => {
      const host = tipHost(event.target)
      if (host === hostRef.current) return
      clear()
      if (!host) return
      // Take the title away so the browser's own tooltip never appears; keep it for screen readers.
      const title = host.getAttribute('title')
      if (title !== null) {
        host.removeAttribute('title')
        if (title) host.setAttribute('data-game-tip', title)
        if (title && !host.getAttribute('aria-label') && !host.textContent?.trim()) host.setAttribute('aria-label', title)
      }
      const text = host.getAttribute('data-game-tip')
      if (!text) return
      hostRef.current = host
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (hostRef.current !== host || !host.isConnected) return
        const rect = host.getBoundingClientRect()
        const below = rect.top < 90
        const x = Math.max(MAX_WIDTH / 2 + 8, Math.min(window.innerWidth - MAX_WIDTH / 2 - 8, rect.left + rect.width / 2))
        setTip({ text, x, y: below ? rect.bottom + 10 : rect.top - 10, below })
      }, DELAY_MS)
    }
    const onOut = (event: MouseEvent) => {
      const host = hostRef.current
      if (!host) return
      const to = event.relatedTarget as Node | null
      if (to && host.contains(to)) return
      clear()
    }
    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', onOut, true)
    document.addEventListener('mousedown', clear, true)
    document.addEventListener('keydown', clear, true)
    window.addEventListener('wheel', clear, { capture: true, passive: true })
    window.addEventListener('blur', clear)
    return () => {
      clear()
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', onOut, true)
      document.removeEventListener('mousedown', clear, true)
      document.removeEventListener('keydown', clear, true)
      window.removeEventListener('wheel', clear, { capture: true })
      window.removeEventListener('blur', clear)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      role="tooltip"
      data-game-tooltip
      style={{
        position: 'fixed',
        left: tip.x,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
        zIndex: 100000,
        maxWidth: MAX_WIDTH,
        pointerEvents: 'none',
        padding: '7px 12px 8px',
        borderRadius: 5,
        border: '1px solid rgba(201,162,86,0.75)',
        background: 'linear-gradient(180deg, rgba(40,33,23,0.98) 0%, rgba(16,13,9,0.98) 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,225,160,0.18), inset 0 0 0 1px rgba(0,0,0,0.6), 0 8px 22px rgba(0,0,0,0.6)',
        color: '#efe6d2',
        fontFamily: "var(--font-cormorant), 'Palatino Linotype', Palatino, Georgia, 'Apple Color Emoji', 'Oasis Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif",
        fontSize: 15,
        lineHeight: 1.25,
        textAlign: 'left',
        whiteSpace: 'pre-line',
        animation: 'oasisTipIn 120ms ease-out both',
      }}
    >
      <style>{'@keyframes oasisTipIn{from{opacity:0;transform:translate(-50%,' + (tip.below ? '-4px' : 'calc(-100% + 4px)') + ')}}'}</style>
      {tip.text}
    </div>
  )
}
