'use client'

// ░▒▓ SPOKEN PLAYER — a reply's spoken line in the thread, as a small player ▓▒░
// Play and pause, a bar to seek on, the time, the agent's speed, and the whole line written out with the word
// being said lit (ElevenLabs' character times, lib/village/spoken-words.ts). When the line plays on its own (the
// owner opened the agent with E or F, VillageVoice.tsx) it is the same line, so the same controls are there to
// pause it mid-sentence. Nothing is fetched until play: a line never heard costs nothing.
// Cost: one frame loop, only in the player of the line that is being said.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { showNotice } from '../forge/GlobalNotice'
import { speechSpeedPlan } from '../../lib/village/village-voices'
import { formatSpokenClock, nextPlayerSpeed, spokenTokens, spokenWordAt } from '../../lib/village/spoken-words'
import {
  getAgentVoiceSettings,
  getVillageSpeech,
  getVillageSpeechClock,
  getVoiceSettingsVersion,
  knownVillageClip,
  pauseVillageSpeech,
  prepareVillageSpeech,
  resumeVillageSpeech,
  seekVillageSpeech,
  setAgentVoiceSpeed,
  speakVillageAgent,
  stopVillageSpeech,
  subscribeVillageSpeech,
  subscribeVoiceSettings,
} from './village-companion'

/** How many players of each line are on screen (agentId + line). */
const mountedPlayers = new Map<string, number>()

export function SpokenPlayer({ agentId, agentKey, agentName, own = null, spoken }: { agentId: string; agentKey: string; agentName: string | null; own?: string | null; spoken: string }) {
  const speech = useSyncExternalStore(subscribeVillageSpeech, getVillageSpeech, () => null)
  useSyncExternalStore(subscribeVoiceSettings, getVoiceSettingsVersion, () => 0)
  const settings = getAgentVoiceSettings(agentKey, agentName, own)
  const mine = speech?.agentId === agentId && speech.text === spoken
  const phase = mine ? speech.phase : 'idle'
  const active = phase === 'speaking' || phase === 'paused'

  // Length and timings: from the clip being said, else from a clip made earlier on this page (heard once).
  const known = knownVillageClip(spoken, settings)
  const [clock, setClock] = useState<{ second: number; duration: number; rate: number; word: number }>({ second: 0, duration: 0, rate: 1, word: -1 })
  const bar = useRef<HTMLDivElement>(null)
  const alignment = active ? getVillageSpeechClock()?.alignment ?? known?.alignment ?? null : known?.alignment ?? null
  const tokens = useMemo(() => spokenTokens(spoken, alignment, active ? clock.duration || known?.seconds : known?.seconds), [spoken, alignment, active, clock.duration, known?.seconds])
  const tokensRef = useRef(tokens)
  tokensRef.current = tokens

  // While this line is being said: follow its clock. The bar moves every frame (no render); the time and the lit
  // word re-render only when they change.
  useEffect(() => {
    if (!active) {
      if (bar.current) bar.current.style.width = '0%'
      setClock(previous => (previous.word === -1 && previous.second === 0 ? previous : { ...previous, second: 0, word: -1 }))
      return
    }
    let frame = 0
    let last = { second: -1, duration: -1, rate: -1, word: -2 }
    const tick = () => {
      const now = getVillageSpeechClock()
      if (now && now.agentId === agentId && now.text === spoken) {
        const fraction = now.duration > 0 ? Math.min(1, now.time / now.duration) : 0
        if (bar.current) bar.current.style.width = `${(fraction * 100).toFixed(2)}%`
        const second = Math.floor(now.time / Math.max(0.1, now.rate))
        const word = spokenWordAt(tokensRef.current, now.time)
        const duration = Math.round(now.duration * 100) / 100
        if (second !== last.second || word !== last.word || duration !== last.duration || now.rate !== last.rate) {
          last = { second, duration, rate: now.rate, word }
          setClock({ second, duration, rate: now.rate, word })
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, agentId, spoken])

  // The last player of a line goes (its panel closed) while the line waits paused: the line is done, nobody can
  // go on with it. Going from E to F swaps one player for another of the same line, which keeps it.
  useEffect(() => {
    const key = `${agentId}|${spoken}`
    mountedPlayers.set(key, (mountedPlayers.get(key) || 0) + 1)
    return () => {
      mountedPlayers.set(key, (mountedPlayers.get(key) || 1) - 1)
      window.setTimeout(() => {
        if ((mountedPlayers.get(key) || 0) > 0) return
        mountedPlayers.delete(key)
        const now = getVillageSpeech()
        if (now && now.agentId === agentId && now.text === spoken && now.phase === 'paused') stopVillageSpeech()
      }, 400)
    }
  }, [agentId, spoken])

  /** Play from the start, or from `seconds` into the clip. */
  const play = async (seconds = 0) => {
    let startAt = seconds
    // A spot on the bar of a line not made yet: make it first, to know how long it is.
    if (startAt < 0) {
      try {
        const prepared = await prepareVillageSpeech(spoken, settings)
        startAt = -startAt * prepared.clipSeconds
      } catch {
        startAt = 0
      }
    }
    const played = await speakVillageAgent(agentId, spoken, settings, true, false, startAt)
    if (!played) showNotice('Could not play the spoken reply (see the console).', 'warn')
  }

  const toggle = () => {
    if (phase === 'speaking') pauseVillageSpeech()
    else if (phase === 'paused') void resumeVillageSpeech()
    else if (phase === 'loading') stopVillageSpeech()
    else void play()
  }

  /** Seek to a fraction of the line (a click or drag on the bar). */
  const seekTo = (fraction: number) => {
    const f = Math.max(0, Math.min(1, fraction))
    if (active) {
      const now = getVillageSpeechClock()
      if (now && now.duration > 0) seekVillageSpeech(f * now.duration)
      return
    }
    if (phase === 'loading') return
    // Not playing: start there (a known length plays from that spot at once; an unknown one is made first).
    void play(known?.seconds ? f * known.seconds : -f)
  }

  const fractionAt = (clientX: number) => {
    const track = bar.current?.parentElement
    if (!track) return 0
    const box = track.getBoundingClientRect()
    return box.width > 0 ? (clientX - box.left) / box.width : 0
  }

  const rate = active ? clock.rate : 0
  const shownDuration = active && clock.duration > 0 ? clock.duration / Math.max(0.1, rate) : known ? known.seconds / speechSpeedPlan(settings.speed).playbackRate : null
  const label = phase === 'speaking' ? 'Pause' : phase === 'paused' ? 'Continue' : phase === 'loading' ? 'Cancel' : 'Play'

  return (
    <div
      data-spoken-player={phase}
      className={`mt-1.5 rounded-lg border px-2 py-1.5 transition-colors ${active || phase === 'loading' ? 'border-fuchsia-300/45 bg-fuchsia-400/10' : 'border-white/12 bg-white/[0.04]'}`}
      // Space and Enter press its buttons, so the world must not take them too. Every other key goes on (Esc
      // leaves the agent, T talks, F full screen), and a click hands the focus back: the keys are the owner's.
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation() }}
      onClick={event => {
        event.stopPropagation()
        const focused = document.activeElement
        if (focused instanceof HTMLElement && event.currentTarget.contains(focused)) focused.blur()
      }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-spoken-toggle
          onClick={toggle}
          title={`${label} the spoken reply`}
          aria-label={`${label} the spoken reply`}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] transition ${active || phase === 'loading' ? 'border-fuchsia-200/70 bg-fuchsia-300/25 text-white' : 'border-white/25 bg-white/10 text-white/80 hover:border-fuchsia-300/60 hover:text-white'}`}
        >
          {phase === 'speaking' ? <PauseIcon /> : phase === 'loading' ? <span className="animate-pulse">…</span> : <PlayIcon />}
        </button>
        <div
          data-spoken-seek
          role="slider"
          aria-label="Position in the spoken reply"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          tabIndex={-1}
          className="group relative h-4 flex-1 cursor-pointer"
          onPointerDown={event => {
            event.stopPropagation()
            const target = event.currentTarget
            target.setPointerCapture(event.pointerId)
            seekTo(fractionAt(event.clientX))
          }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !active) return
            seekTo(fractionAt(event.clientX))
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15 group-hover:bg-white/25">
            <div ref={bar} className="relative h-full rounded-full bg-fuchsia-300" style={{ width: '0%' }}>
              {active && <span className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow" />}
            </div>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/60" data-spoken-time>
          {formatSpokenClock(active ? clock.second : 0)} / {formatSpokenClock(shownDuration)}
        </span>
        <button
          type="button"
          data-spoken-speed
          onClick={() => setAgentVoiceSpeed(agentKey, nextPlayerSpeed(settings.speed))}
          title={`How fast ${agentName || 'this agent'} speaks (its own setting, also in its settings menu). Click for ${nextPlayerSpeed(settings.speed)}x.`}
          className="shrink-0 rounded border border-white/15 px-1 font-mono text-[10px] text-white/70 hover:border-fuchsia-300/50 hover:text-white"
        >
          {formatSpeed(settings.speed)}
        </button>
        {active && (
          <button
            type="button"
            data-spoken-stop
            onClick={() => stopVillageSpeech()}
            title="Stop"
            aria-label="Stop the spoken reply"
            className="shrink-0 rounded px-1 text-[10px] text-white/55 hover:text-white"
          >
            ■
          </button>
        )}
      </div>
      <p className="mt-1 text-[12px] italic leading-snug text-white/75" data-spoken-text>
        {tokens.map((token, index) =>
          token.word ? (
            <span
              key={index}
              data-spoken-word={index === clock.word && active ? 'now' : undefined}
              onClick={() => {
                // A word: hear the line from there.
                if (active) seekVillageSpeech(token.start)
                else if (known) void play(token.start)
              }}
              className={`rounded-sm transition-colors ${index === clock.word && active ? 'bg-fuchsia-300/35 text-white' : active && index < clock.word ? 'text-white/90' : ''} ${active || known ? 'cursor-pointer hover:text-white' : ''}`}
            >
              {token.text}
            </span>
          ) : (
            <span key={index}>{token.text}</span>
          ),
        )}
      </p>
    </div>
  )
}

function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed.toFixed(0) : String(Math.round(speed * 100) / 100)}x`
}

function PlayIcon() {
  return <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 0.8v8.4L8.2 5z" fill="currentColor" /></svg>
}

function PauseIcon() {
  return <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M1 1h2.4v8H1zM5.6 1H8v8H5.6z" fill="currentColor" /></svg>
}

