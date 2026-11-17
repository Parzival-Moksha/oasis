'use client'

// ░▒▓ VILLAGE COMPOSER — the text box under an open agent, in the side panel or on its screen (F) ▓▒░
// Talking comes first: the box never grabs the keyboard when it opens, so T starts and stops the mic,
// Enter sends and F / N / Esc keep working. Click the box to type. Typing never reaches the world:
// keydown stops here, keyup still bubbles so no movement key can get stuck (the WASD-stuck bug class).
// The mic dictates live: your words appear while you talk (ElevenLabs or Moonshine through the agent engine).
// The draft and the mic session live outside this component (lib/voice/village-dictation.ts): the side panel and
// the screen show the same ones, and F, N or a hot reload never stop the mic or lose a word.
// The box grows with what is in it up to about 450 px, then scrolls, and keeps the newest words in view.
// Drag the grip above it to make it taller or shorter (double-click the grip: automatic again).

import { markWorkActivity } from './work-vow-client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import {
  clearDictationError,
  dictationVersion,
  dictationView,
  setDraftText,
  stopDictation,
  subscribeDictation,
  takeDraftForSend,
  toggleDictation,
} from '../../lib/voice/village-dictation'
import { DESK_WINDOW_PX } from '../../lib/village/village-layout'
import { composerHeight, composerMaxHeight, composerRoom } from '../../lib/village/village-keys'
import { VILLAGE_FONT_BODY, VILLAGE_TYPE_CLASS } from './village-status'
import { showNotice } from '../forge/GlobalNotice'
import { canInterrupt } from '../../lib/village/village-interrupt'
import { VoiceMessageButton } from './VoiceMessage'
import { getVoiceTypingEngine } from '../../lib/voice/voice-typing-engine'
import { PictureChips, useComposerPictures } from './ComposerPictures'
import { subscribeVillageSend, subscribeVillageVoiceStop, subscribeVillageVoiceToggle, takeVillageVoiceRequest } from './village-actions'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The agent's draft and mic, from village-dictation (outside React: they outlive this box). */
function useVillageDictation(agentId: string) {
  useSyncExternalStore(subscribeDictation, dictationVersion, dictationVersion)
  return dictationView(agentId)
}
/** Height the owner dragged the box to, per place (null: automatic). */
const manualHeights: Record<'panel' | 'screen', number | null> = { panel: null, screen: null }

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

export function VillageComposer({ agentId, large = false, containerHeight }: {
  agentId: string
  /** On the agent's screen (F): bigger type. */
  large?: boolean
  /** Height of what holds the box (side panel, screen): the box takes at most half of it. */
  containerHeight?: number
}) {
  const status = useOasisStore(s => s.agentEngine.agents[agentId]?.status || 'idle')
  const pendingUser = useOasisStore(s => s.agentEngine.agents[agentId]?.pendingUser || 0)
  // A desktop-app session reached through the Oasis plugin: the app owns interrupt and priorities.
  const owned = useOasisStore(s => Boolean(s.agentEngine.agents[agentId]?.owned))
  // Only while a turn runs (village-interrupt.ts): not for a finished agent with a leftover status.
  const interruptible = useOasisStore(s => canInterrupt(s.agentEngine.agents[agentId]))
  const dictation = useVillageDictation(agentId)
  const text = dictation.text
  const setText = useCallback((next: string) => setDraftText(agentId, next), [agentId])
  const [urgent, setUrgent] = useState(false)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Pictures pasted (Ctrl+V, box focused or not) or dropped: chips above the box, sent with the next message.
  const pictures = useComposerPictures(agentId, useCallback(() => textareaRef.current, []))
  const working = status === 'working' || status === 'needs-decision'
  const viewportHeight = useViewportHeight()
  const minHeight = large ? 96 : 64
  const maxHeight = composerMaxHeight(containerHeight ?? (large ? DESK_WINDOW_PX.screen.height : viewportHeight))
  const place = large ? 'screen' : 'panel'

  // The box stays out of the keyboard's way after dictation too (T, Enter keep working).
  const voice = {
    supported: dictation.supported,
    listening: dictation.listening,
    transcribing: dictation.settling,
    level: dictation.level,
    error: dictation.error,
    backendMessage: dictation.status,
  }
  const voiceStopRef = useRef(() => { stopDictation(agentId) })
  voiceStopRef.current = () => { stopDictation(agentId) }
  // Dictating is working: no key is pressed while talking, so tell the work counter (Mindcraft vow).
  useEffect(() => {
    if (!voice.listening) return
    markWorkActivity()
    const timer = window.setInterval(markWorkActivity, 20_000)
    return () => window.clearInterval(timer)
  }, [voice.listening])
  const listeningRef = useRef(voice.listening)
  listeningRef.current = voice.listening

  const toggleVoice = useCallback(() => {
    clearDictationError(agentId)
    toggleDictation(agentId)
  }, [agentId])

  // T / Ctrl+Space from anywhere in the village toggle this box's mic; Esc stops it first.
  useEffect(() => subscribeVillageVoiceToggle(toggleVoice), [toggleVoice])
  useEffect(() => subscribeVillageVoiceStop(() => {
    if (!listeningRef.current) return false
    voiceStopRef.current()
    return true
  }), [])

  // T next to the agent opened this window: the mic starts right away.
  useEffect(() => {
    if (takeVillageVoiceRequest(agentId)) toggleVoice()
  }, [agentId, toggleVoice])

  // Wake the voice model while you are with an agent, so the first words come fast.
  useEffect(() => {
    getAgentEngineClient().warmEars(getVoiceTypingEngine()).catch(() => {})
  }, [agentId])

  /** The cap right now: about 450 px, and never so tall that the thread above drops under its minimum. */
  const capNow = useCallback((el: HTMLTextAreaElement) => {
    const thread = el.closest('[data-ui-panel]')?.querySelector<HTMLElement>('[data-village-thread]') || null
    return composerRoom(el.offsetHeight, thread ? thread.clientHeight : null, minHeight, maxHeight)
  }, [minHeight, maxHeight])

  // Grow with the text (up to the cap, then scroll) and keep the newest words in view. A dragged height sticks.
  const fitHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const cap = capNow(el) // measured before 'auto' collapses the box
    el.style.maxHeight = `${cap}px`
    el.style.height = 'auto'
    const borders = el.offsetHeight - el.clientHeight
    el.style.height = `${composerHeight({ content: el.scrollHeight + borders, min: minHeight, max: cap, manual: manualHeights[place] })}px`
  }, [capNow, minHeight, place])

  useLayoutEffect(() => {
    fitHeight()
    const el = textareaRef.current
    if (!el) return
    // Dictation appends at the end; so does typing at the end. Editing in the middle keeps its place.
    if (document.activeElement !== el || el.selectionEnd === el.value.length) el.scrollTop = el.scrollHeight
  }, [text, fitHeight])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    // The screen (F) is scaled in 3D: turn screen pixels into the box's own pixels.
    const scale = el.getBoundingClientRect().height / Math.max(1, el.offsetHeight) || 1
    const startY = event.clientY
    const startHeight = el.offsetHeight
    const cap = capNow(el)
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => {
      const next = Math.round(Math.min(cap, Math.max(minHeight, startHeight + (startY - move.clientY) / scale)))
      manualHeights[place] = next
      el.style.height = `${next}px`
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      fitHeight()
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const send = () => {
    const message = text.trim()
    const images = pictures.list.length ? pictures.payload() : undefined
    if ((!message && !images) || sending) return
    // The message is what the box holds now. The mic stops, and the words it is still settling are not added
    // again (they are in the message). A failed send leaves the box as it was (village-dictation takeDraftForSend).
    const take = takeDraftForSend(agentId)
    setSending(true)
    getAgentEngineClient()
      .send(agentId, message, urgent && owned ? 'now' : undefined, images)
      .then(() => {
        take.sent()
        if (images) pictures.clear()
        setUrgent(false)
      })
      .catch(error => showNotice(`Send failed: ${describeError(error)}`, 'error'))
      .finally(() => setSending(false))
  }

  // Enter while the box doesn't have the keyboard sends what you dictated.
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => subscribeVillageSend(() => sendRef.current()), [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Space (dictate) goes on to the village key handler; everything else stays in the box.
    if (event.ctrlKey && event.code === 'Space') return
    // Never let typing reach KeyboardControls / world shortcuts. keyup is left alone on purpose.
    event.stopPropagation()
    // While dictating, T stops the mic even inside the box (nobody types while talking).
    if (voice.listening && event.code === 'KeyT' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault()
      voiceStopRef.current()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      // First Esc leaves the text box (T, F, N work again), the next one leaves the agent. The mic stays on.
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
      ? (voice.backendMessage || 'listening… T stops · Enter sends · Esc leaves, the mic stays on')
      : voice.transcribing ? 'settling the last words…' : ''

  return (
    <div className={`flex shrink-0 flex-col gap-1.5 border-t border-white/10 pt-1 ${VILLAGE_TYPE_CLASS}`} style={{ fontFamily: VILLAGE_FONT_BODY }} {...pictures.dropProps}>
      {!owned && (
        <div className={`pt-1 leading-snug text-cyan-100/90 ${large ? 'text-[13px]' : 'text-[11.5px]'}`}>
          Live in the desktop app too: what you say here goes to the same session.
        </div>
      )}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => { manualHeights[place] = null; fitHeight() }}
        title="Drag to make the box taller or shorter (double-click: automatic)"
        className="group -mb-1 flex h-3 cursor-ns-resize touch-none items-center justify-center"
      >
        <span className="h-1 w-12 rounded-full bg-white/20 transition group-hover:bg-white/55" />
      </div>
      <PictureChips pictures={pictures.list} onRemove={pictures.remove} large={large} />
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={event => {
            // Typing while the mic is on: what is in the box is kept, and new words go after it.
            setText(event.target.value)
          }}
          onKeyDown={onKeyDown}
          placeholder={working ? 'Talk to it while it works: folds into the running turn… (T talks, click to type)' : 'Press T and talk, or click here to type…'}
          style={{ minHeight }}
          className={`block w-full resize-none overflow-y-auto rounded-lg border bg-black/45 px-2.5 py-2 pr-11 leading-snug text-slate-50 [scrollbar-width:thin] placeholder:text-white/45 focus:outline-none ${large ? 'text-[15px]' : 'text-[13.5px]'} ${voice.listening ? 'border-rose-300/60' : 'border-white/20 focus:border-emerald-300/50'}`}
        />
        <button
          type="button"
          onClick={toggleVoice}
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
        <div className={`text-[11px] leading-snug ${voice.error ? 'text-amber-200' : 'text-rose-100/90'}`}>{voiceNote}</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {owned ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/75" title='priority "now": stop at the next model request and answer this'>
            <input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} className="accent-amber-400" />
            urgent
          </label>
        ) : <span />}
        <div className="flex items-center gap-1.5">
          {pendingUser > 0 && <span className="text-[10.5px] text-white/70">{pendingUser} queued</span>}
          {/* A recorded voice message (ElevenLabs Scribe transcript), next to the live mic's typing. */}
          {owned && <VoiceMessageButton agentId={agentId} priority={urgent ? 'now' : undefined} large={large} />}
          {owned && (
            <button
              type="button"
              disabled={!interruptible}
              onClick={() => getAgentEngineClient().interrupt(agentId).catch(error => showNotice(`Interrupt failed: ${describeError(error)}`, 'error'))}
              title={interruptible ? 'Stop the running turn' : 'Nothing to interrupt: no turn is running'}
              className="rounded-md border border-rose-300/35 bg-rose-400/10 px-2.5 py-1 text-[11px] font-bold text-rose-100 transition hover:bg-rose-400/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-white/30 disabled:hover:bg-transparent"
            >
              interrupt
            </button>
          )}
          <button
            type="button"
            disabled={(!text.trim() && !pictures.list.length) || sending}
            onClick={send}
            className="rounded-md border border-emerald-300/40 bg-emerald-400/20 px-3 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-emerald-50 transition hover:bg-emerald-400/35 disabled:cursor-not-allowed disabled:opacity-35"
          >
            send
          </button>
        </div>
      </div>
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-white/55 max-[700px]:hidden">
        {large
          ? 'T talk, T again to stop · Enter send · click the box to type · F or Esc back to the side panel · N next agent'
          : 'T talk, T again to stop · Enter send · click the box to type · F zoom into the screen · Esc back · N next agent'}
      </div>
    </div>
  )
}
