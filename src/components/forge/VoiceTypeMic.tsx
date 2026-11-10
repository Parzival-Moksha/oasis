'use client'

// ░▒▓ VOICE TYPE MIC — a small live-dictation mic on whatever text field has focus ▓▒░
// One overlay for the whole page instead of a button in every panel: focus a text field and a mic
// appears at its right edge. Click it and talk: words land at the caret while you speak (Moonshine in
// the agent engine, same as the village composer). Click again, press Esc or leave the field to stop.
// Fields with their own mic (agent boxes) or data-voice-mic="off" are skipped (voice-type-field.ts).

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { clampToMaxLength, isVoiceTypeField, spliceDictation } from '@/lib/voice/voice-type-field'

type TextField = HTMLInputElement | HTMLTextAreaElement

interface Box { left: number; top: number; width: number; height: number }

const SIZE = 22

/** Set the value the way a user edit would, so React's controlled inputs see it. */
function setFieldValue(el: TextField, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

export function VoiceTypeMic() {
  const [field, setField] = useState<TextField | null>(null)
  const fieldRef = useRef<TextField | null>(null)
  fieldRef.current = field
  const [box, setBox] = useState<Box | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  /** The field and what was around the caret when the mic started. */
  const sessionRef = useRef<{ el: TextField; before: string; after: string } | null>(null)
  const [errorShown, setErrorShown] = useState('')

  const write = useCallback((spoken: string) => {
    const s = sessionRef.current
    if (!s || !s.el.isConnected) return
    const max = s.el.maxLength > 0 ? s.el.maxLength : null
    const { value, caret } = spliceDictation(s.before, clampToMaxLength(s.before, spoken.trim(), s.after, max), s.after)
    if (s.el.value !== value) setFieldValue(s.el, value)
    if (document.activeElement === s.el) {
      try { s.el.setSelectionRange(caret, caret) } catch { /* some input types have no selection */ }
    }
    // Keep the newest words in view while talking (a long dictation scrolled out of sight).
    if (!s.after) s.el.scrollTop = s.el.scrollHeight
  }, [])

  const voice = useAgentVoiceInput({
    enablePlayerLipSync: true,
    onLiveText: write,
    onTranscript: (text) => {
      write(text)
      sessionRef.current = null
    },
  })
  const listeningRef = useRef(false)
  listeningRef.current = voice.listening
  const stopRef = useRef(voice.stop)
  stopRef.current = voice.stop

  // Follow focus: a text field gains it → the mic shows there; focus leaves → hide (and stop talking).
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as TextField | null
      if (el && isVoiceTypeField(el)) setField(el)
    }
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next && buttonRef.current?.contains(next)) return
      window.setTimeout(() => {
        const active = document.activeElement
        if (active && active === fieldRef.current) return
        if (listeningRef.current) stopRef.current()
        if (!(active && isVoiceTypeField(active as TextField))) setField(null)
      }, 0)
    }
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
    }
  }, [])

  // Track the field's box while it is focused (panels drag, 3D windows move). State only on change.
  useEffect(() => {
    if (!field) {
      setBox(null)
      return
    }
    let raf = 0
    let last: Box | null = null
    const tick = () => {
      if (!field.isConnected) {
        setField(null)
        return
      }
      const r = field.getBoundingClientRect()
      const next = { left: r.left, top: r.top, width: r.width, height: r.height }
      if (!sameBox(last, next)) {
        last = next
        setBox(next)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [field])

  // Esc stops dictation first (and does not close the panel underneath).
  useEffect(() => {
    if (!voice.listening) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      stopRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [voice.listening])

  // Errors (engine offline, no mic permission) show for a few seconds under the button.
  useEffect(() => {
    if (!voice.error) return
    setErrorShown(voice.error)
    const timer = window.setTimeout(() => {
      setErrorShown('')
      voice.clearError()
    }, 4500)
    return () => window.clearTimeout(timer)
  }, [voice.error, voice.clearError])

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    // Keep the caret in the field: the button never takes focus.
    event.preventDefault()
    event.stopPropagation()
    const el = fieldRef.current
    if (!el) return
    if (!voice.listening) {
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      sessionRef.current = { el, before: el.value.slice(0, start), after: el.value.slice(end) }
    }
    void voice.toggle()
  }

  if (!field || !box || box.width < 80 || box.height < 16 || typeof document === 'undefined') return null
  if (box.top + box.height < 0 || box.top > window.innerHeight || box.left + box.width < 0 || box.left > window.innerWidth) return null

  const isArea = field instanceof HTMLTextAreaElement
  const left = Math.round(box.left + box.width - SIZE - 4)
  const top = Math.round(isArea ? box.top + 4 : box.top + (box.height - SIZE) / 2)
  const listening = voice.listening
  const busy = voice.transcribing || (listening && voice.backendState === 'loading')
  const color = listening ? '#fda4af' : errorShown ? '#fbbf24' : '#a5f3fc'
  const title = listening
    ? (voice.backendState === 'loading' && voice.backendMessage ? voice.backendMessage : 'Listening… click or Esc to stop')
    : 'Voice type: click and talk, words appear as you speak'

  return createPortal(
    <>
      <button
        ref={buttonRef}
        type="button"
        tabIndex={-1}
        data-voice-mic="overlay"
        aria-label={listening ? 'Stop voice typing' : 'Voice type into this field'}
        aria-pressed={listening}
        title={title}
        onPointerDown={onPointerDown}
        onMouseDown={event => event.preventDefault()}
        className="fixed flex items-center justify-center rounded-full border transition-[opacity,transform] hover:scale-110"
        style={{
          left,
          top,
          width: SIZE,
          height: SIZE,
          zIndex: 100000,
          opacity: listening ? 1 : 0.72,
          borderColor: listening ? 'rgba(253,164,175,0.7)' : 'rgba(165,243,252,0.35)',
          background: listening ? 'rgba(127,29,29,0.75)' : 'rgba(2,6,23,0.72)',
          boxShadow: listening ? `0 0 ${6 + Math.round((voice.level || 0) * 36)}px ${color}` : '0 1px 6px rgba(0,0,0,0.5)',
          color,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: busy ? 0.55 : 1 }}>
          <rect x="9" y="2" width="6" height="12" rx="3" fill={listening ? 'currentColor' : 'none'} />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v4" />
        </svg>
      </button>
      {errorShown && (
        <div
          className="pointer-events-none fixed max-w-[260px] rounded-md border border-amber-300/40 bg-slate-950/90 px-2 py-1 text-[10.5px] leading-snug text-amber-100 shadow-lg"
          style={{ left: Math.max(8, left - 230), top: top + SIZE + 6, zIndex: 100000 }}
        >
          {errorShown}
        </div>
      )}
    </>,
    document.body,
  )
}
