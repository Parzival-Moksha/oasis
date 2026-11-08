'use client'

// ░▒▓ VILLAGE COMPOSER — the text box under a focused agent, in the side panel or on its screen (F) ▓▒░
// Typing never reaches the world: keydown stops here, keyup still bubbles so no movement key can get
// stuck (the WASD-stuck bug class). The mic (button, T, Ctrl+Space) dictates live: your words appear
// in the box while you talk (Moonshine in the agent engine), and Enter sends as usual.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { isProbablyMobileDevice } from '../../lib/mobile-controls'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { useAgentVoiceInput } from '../../hooks/useAgentVoiceInput'
import { showNotice } from '../forge/GlobalNotice'
import { subscribeVillageVoiceToggle } from './village-actions'

const MOVEMENT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'])

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function joinText(base: string, spoken: string): string {
  if (!spoken) return base
  if (!base) return spoken
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`
}

export function VillageComposer({ agentId, large = false }: { agentId: string; large?: boolean }) {
  const status = useOasisStore(s => s.agentEngine.agents[agentId]?.status || 'idle')
  const pendingUser = useOasisStore(s => s.agentEngine.agents[agentId]?.pendingUser || 0)
  const [text, setText] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusedAtRef = useRef(0)
  /** What was in the box when the mic started; live words go after it. */
  const voiceBaseRef = useRef<string | null>(null)
  const working = status === 'working' || status === 'needs-decision'

  const voice = useAgentVoiceInput({
    focusTargetRef: textareaRef,
    enablePlayerLipSync: true,
    onLiveText: (spoken) => {
      if (voiceBaseRef.current === null) voiceBaseRef.current = textareaRef.current?.value ?? ''
      setText(joinText(voiceBaseRef.current, spoken))
    },
    onTranscript: (spoken) => {
      setText(joinText(voiceBaseRef.current ?? '', spoken))
      voiceBaseRef.current = null
    },
  })
  const voiceToggleRef = useRef(voice.toggle)
  voiceToggleRef.current = voice.toggle
  const voiceStopRef = useRef(voice.stop)
  voiceStopRef.current = voice.stop

  // T / Ctrl+Space from anywhere in the village toggle this box's mic.
  useEffect(() => subscribeVillageVoiceToggle(() => {
    if (!voice.listening) voiceBaseRef.current = textareaRef.current?.value ?? ''
    void voiceToggleRef.current()
  }), [voice.listening])

  // Wake the voice model while you are with an agent, so the first words come fast.
  useEffect(() => {
    getAgentEngineClient().warmEars().catch(() => {})
  }, [agentId])

  // Focus the composer right after the agent is focused (after the E keydown has finished).
  // Not on touch devices: the on-screen keyboard would cover most of the transcript.
  useEffect(() => {
    if (isProbablyMobileDevice()) return
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true })
      focusedAtRef.current = performance.now()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [agentId])

  const send = () => {
    const message = text.trim()
    if (!message || sending) return
    if (voice.listening) voiceStopRef.current()
    voiceBaseRef.current = null
    setSending(true)
    getAgentEngineClient()
      .send(agentId, message, urgent ? 'now' : undefined)
      .then(() => {
        setText('')
        setUrgent(false)
      })
      .catch(error => showNotice(`Send failed: ${describeError(error)}`, 'error'))
      .finally(() => setSending(false))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Space (dictate) goes on to the village key handler; everything else stays in the box.
    if (event.ctrlKey && event.code === 'Space') return
    // Never let typing reach KeyboardControls / world shortcuts. keyup is left alone on purpose.
    event.stopPropagation()
    // A movement key still held from walking up to the desk auto-repeats into the box: drop it.
    if (event.repeat && MOVEMENT_CODES.has(event.nativeEvent.code) && performance.now() - focusedAtRef.current < 1500) {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (voice.listening) {
        voiceStopRef.current()
        return
      }
      // First Esc leaves the text box (N works again), the next one leaves the agent.
      event.currentTarget.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const micColor = voice.listening ? '#f87171' : voice.error ? '#fbbf24' : '#a5f3fc'
  const voiceNote = voice.error
    ? voice.error
    : voice.listening
      ? (voice.backendState === 'loading' && voice.backendMessage ? voice.backendMessage : 'listening… pause and your words settle; Enter sends')
      : voice.transcribing ? 'settling the last words…' : ''

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-2">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={text}
          rows={large ? 4 : 3}
          onChange={event => {
            setText(event.target.value)
            // Typing while the mic is on: live words go after what you typed.
            if (voice.listening) voiceBaseRef.current = event.target.value
          }}
          onKeyDown={onKeyDown}
          placeholder={working ? 'Talk to it while it works: folds into the running turn…' : 'Message… (T or Ctrl+Space to talk)'}
          className={`w-full resize-none rounded-lg border bg-black/45 px-2.5 py-2 pr-11 leading-snug text-white placeholder:text-white/30 focus:outline-none ${large ? 'min-h-[96px] text-[15px]' : 'min-h-[64px] text-[13px]'} ${voice.listening ? 'border-rose-300/60' : 'border-white/15 focus:border-emerald-300/50'}`}
        />
        <button
          type="button"
          onClick={() => {
            if (!voice.listening) voiceBaseRef.current = textareaRef.current?.value ?? ''
            void voice.toggle()
          }}
          disabled={!voice.supported}
          title={voice.listening ? 'Stop dictating (T, Ctrl+Space, Esc)' : 'Dictate: words appear while you talk (T, Ctrl+Space)'}
          className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-md border transition disabled:opacity-30"
          style={{
            borderColor: `${micColor}88`,
            background: voice.listening ? 'rgba(248,113,113,0.22)' : 'rgba(255,255,255,0.06)',
            boxShadow: voice.listening ? `0 0 ${6 + Math.round((voice.level || 0) * 40)}px ${micColor}` : 'none',
            color: micColor,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
          </svg>
        </button>
      </div>
      {voiceNote && (
        <div className={`text-[10.5px] leading-snug ${voice.error ? 'text-amber-200/85' : 'text-rose-100/70'}`}>{voiceNote}</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-white/55" title='priority "now": stop at the next model request and answer this'>
          <input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} className="accent-amber-400" />
          urgent
        </label>
        <div className="flex items-center gap-1.5">
          {pendingUser > 0 && <span className="text-[10px] text-white/45">{pendingUser} queued</span>}
          <button
            type="button"
            disabled={!working}
            onClick={() => getAgentEngineClient().interrupt(agentId).catch(error => showNotice(`Interrupt failed: ${describeError(error)}`, 'error'))}
            className="rounded-md border border-rose-300/35 bg-rose-400/10 px-2.5 py-1 text-[11px] font-bold text-rose-100 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            interrupt
          </button>
          <button
            type="button"
            disabled={!text.trim() || sending}
            onClick={send}
            className="rounded-md border border-emerald-300/40 bg-emerald-400/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-emerald-50 transition hover:bg-emerald-400/35 disabled:cursor-not-allowed disabled:opacity-35"
          >
            send
          </button>
        </div>
      </div>
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-white/30 max-[700px]:hidden">
        Enter send · T or Ctrl+Space talk · F {large ? 'back to the side panel' : 'zoom into the screen'} · Esc leave box, Esc again back · N next agent
      </div>
    </div>
  )
}
