'use client'

// ░▒▓ VOICE MESSAGES — record one for an agent, play it back in the thread ▓▒░
// The live mic (ElevenLabs or Moonshine) types while you talk; this records a message instead: the agent engine keeps
// the recording, ElevenLabs Scribe transcribes it (better quality), and the agent gets the transcript.
// The thread shows a small player with the transcript under it.
//   Click: start, click again: stop and send. Hold (over half a second): records until you let go.
//   Esc while recording: throw it away. No real limit (a forgotten recording stops after three hours).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { agentEngineFileUrl, getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'

/** Only a guard against a recording left running by mistake: ElevenLabs Scribe takes long files. */
const MAX_MS = 3 * 60 * 60 * 1000
/** Plenty for speech, and an hour stays about 15 MB. */
const AUDIO_BITS_PER_SECOND = 32_000
const HOLD_MS = 450
const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CHOICES.find(type => MediaRecorder.isTypeSupported?.(type)) || ''
}

export function formatClip(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error || new Error('could not read the recording'))
    reader.readAsDataURL(blob)
  })
}

type Phase = 'idle' | 'recording' | 'sending'

export function VoiceMessageButton({ agentId, priority, large = false }: { agentId: string; priority?: 'now' | 'later'; large?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; cancelled: boolean } | null>(null)
  /** The press that started a recording: held past HOLD_MS, letting go sends it. */
  const press = useRef<number | null>(null)

  const release = () => {
    rec.current?.stream.getTracks().forEach(track => track.stop())
  }

  const stop = (cancel = false) => {
    const r = rec.current
    if (!r || r.recorder.state === 'inactive') return
    r.cancelled = cancel
    r.recorder.stop()
  }

  const start = async () => {
    if (phase !== 'idle') return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showNotice('This browser cannot record audio.', 'error')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      showNotice('No microphone, or the browser is not allowed to use it.', 'error')
      return
    }
    const mimeType = pickMime()
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
    const r = { recorder, stream, chunks: [] as Blob[], startedAt: Date.now(), cancelled: false }
    rec.current = r
    recorder.ondataavailable = event => { if (event.data.size) r.chunks.push(event.data) }
    recorder.onstop = async () => {
      release()
      const durationMs = Date.now() - r.startedAt
      rec.current = null
      if (r.cancelled || !r.chunks.length || durationMs < 400) {
        setPhase('idle')
        return
      }
      setPhase('sending')
      try {
        const blob = new Blob(r.chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
        const audio = await blobToBase64(blob)
        await getAgentEngineClient().voiceMessage(agentId, audio, blob.type, durationMs, priority)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        showNotice(/unknown command/i.test(message)
          ? 'This agent engine is older than voice messages: restart it (pnpm dev:engine).'
          : `Voice message not sent: ${message}`, 'error')
      } finally {
        setPhase('idle')
      }
    }
    recorder.start(1000)
    setElapsed(0)
    setPhase('recording')
  }

  // Timer, the runaway guard, and Esc to throw the recording away.
  useEffect(() => {
    if (phase !== 'recording') return
    const timer = window.setInterval(() => {
      const r = rec.current
      if (!r) return
      const ms = Date.now() - r.startedAt
      setElapsed(ms)
      if (ms >= MAX_MS) stop()
    }, 250)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      stop(true)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [phase])

  // Unmount while recording: drop it and free the microphone.
  useEffect(() => () => { if (rec.current) { rec.current.cancelled = true; try { rec.current.recorder.stop() } catch { /* already */ } release() } }, [])

  const recording = phase === 'recording'
  const title = recording
    ? 'Recording a voice message: click (or let go) to send, Esc to throw it away'
    : phase === 'sending' ? 'Transcribing with ElevenLabs Scribe…' : 'Voice message: click to record (or hold), sent as a recording with its Scribe transcript'
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={recording}
      disabled={phase === 'sending'}
      onPointerDown={event => {
        if (event.button !== 0 || phase === 'sending') return
        if (rec.current) { press.current = null; stop(); return } // second click: send
        press.current = Date.now()
        void start()
      }}
      onPointerUp={() => {
        // Held down: letting go sends it. A short click keeps recording until the next click.
        const at = press.current
        press.current = null
        if (at !== null && Date.now() - at > HOLD_MS && rec.current) stop()
      }}
      onKeyDown={event => event.stopPropagation()}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-bold transition disabled:opacity-60 ${large ? 'text-[12px]' : 'text-[11px]'} ${recording
        ? 'border-rose-300/70 bg-rose-500/25 text-rose-50'
        : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/15'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        {recording
          ? <circle cx="12" cy="12" r="6" fill="currentColor" className="animate-pulse" />
          : <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />}
      </svg>
      {recording ? formatClip(elapsed) : phase === 'sending' ? 'scribing…' : 'voice'}
    </button>
  )
}

/** A voice message in the thread: play / pause, a bar that fills as it plays (click it to jump), elapsed / length. */
export function VoiceClip({ fileId, durationMs }: { fileId: string; durationMs?: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [length, setLength] = useState(durationMs || 0)
  const src = agentEngineFileUrl(fileId)
  // A recording from the browser (webm) says its duration is Infinity until it has played through, so the length
  // comes from the recording itself (durationMs) unless the file knows better.
  const lengthMs = length || durationMs || 0
  const progress = lengthMs ? Math.min(1, elapsedMs / lengthMs) : 0

  const ensure = () => {
    if (audioRef.current) return audioRef.current
    const audio = new Audio(src)
    audioRef.current = audio
    audio.preload = 'auto'
    audio.ontimeupdate = () => setElapsedMs(audio.currentTime * 1000)
    audio.ondurationchange = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) setLength(audio.duration * 1000) }
    audio.onended = () => { setPlaying(false); setElapsedMs(0) }
    audio.onpause = () => setPlaying(false)
    audio.onplay = () => setPlaying(true)
    audio.onerror = () => { setPlaying(false); showNotice('That recording is gone (the agent engine keeps them until it restarts).', 'warn') }
    return audio
  }

  const toggle = () => {
    const audio = ensure()
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }

  // The bar moves smoothly while it plays (timeupdate alone only fires a few times a second).
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) setElapsedMs(audio.currentTime * 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!lengthMs) return
    const box = event.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const audio = ensure()
    audio.currentTime = (fraction * lengthMs) / 1000
    setElapsedMs(fraction * lengthMs)
    if (audio.paused) void audio.play().catch(() => setPlaying(false))
  }

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null }, [])

  const started = playing || elapsedMs > 0
  return (
    <div className="mb-1 flex items-center gap-2" onClick={event => event.stopPropagation()}>
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-300/25 text-sky-50 hover:bg-sky-300/40">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}
        </svg>
      </button>
      <div
        role="slider"
        aria-label="Voice message position"
        aria-valuemin={0}
        aria-valuemax={Math.round(lengthMs / 1000)}
        aria-valuenow={Math.round(elapsedMs / 1000)}
        onPointerDown={seek}
        className="group relative flex h-4 min-w-[80px] flex-1 cursor-pointer items-center"
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <div data-voice-progress className="absolute inset-y-0 left-0 rounded-full bg-sky-300/85" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
        </div>
        {started && <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-sky-100 shadow" style={{ left: `${(progress * 100).toFixed(2)}%` }} />}
      </div>
      <span data-voice-time className="shrink-0 font-mono text-[10px] tabular-nums text-sky-100/75">
        {lengthMs ? (started ? `${formatClip(elapsedMs)} / ${formatClip(lengthMs)}` : formatClip(lengthMs)) : started ? formatClip(elapsedMs) : 'voice'}
      </span>
    </div>
  )
}
