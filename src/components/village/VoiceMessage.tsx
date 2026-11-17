'use client'

// ░▒▓ VOICE MESSAGES — record one for an agent, play it back in the thread ▓▒░
// The live mic (ElevenLabs or Moonshine) types while you talk; this records a message instead: the agent engine keeps
// the recording, ElevenLabs Scribe transcribes it (better quality), and the agent gets the transcript.
// The thread shows a small player with the transcript under it.
//   Click: start, click again: stop and send. Hold (over half a second): records until you let go.
//   No real limit (a forgotten recording stops after three hours). Esc doesn't touch it (it used to throw the
//   recording away): the voice widget at the bottom left has Send, Stop (keeps it as an unsent draft) and x.
// The recording belongs to the agent, not to the button: F (panel <-> screen) and a hot reload don't stop it,
// and one that fails to send stays as an unsent draft (click: send again).

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'

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

type Phase = 'idle' | 'recording' | 'sending' | 'unsent'

// ─── the recording, per agent, outside React ─────────────────────────────────
// The side panel (E) and the screen (F) each have a voice button; F unmounts one and mounts the other. The
// recording belongs to the agent, not to a button: it keeps recording through F, N and a hot reload of this code
// (the state sits on globalThis), and a send that fails keeps the recording as an unsent draft to send again.

interface Recording {
  phase: Phase
  recorder: MediaRecorder | null
  stream: MediaStream | null
  chunks: Blob[]
  mime: string
  startedAt: number
  durationMs: number
  cancelled: boolean
  priority?: 'now' | 'later'
  blob: Blob | null
  timer: number
  /** Stopped to keep, not to send (the widget's Stop): it becomes an unsent draft. */
  keep: boolean
}

interface VoiceStore { recordings: Map<string, Recording>; listeners: Set<() => void>; version: number; escape?: ((event: KeyboardEvent) => void) | null }
const gv = globalThis as unknown as { __oasisVoiceMessages?: VoiceStore }
const voiceStore: VoiceStore = gv.__oasisVoiceMessages ??= { recordings: new Map(), listeners: new Set(), version: 0 }
// An Escape listener from the code before this one (it threw the recording away) goes.
if (voiceStore.escape && typeof window !== 'undefined') { window.removeEventListener('keydown', voiceStore.escape, { capture: true }); voiceStore.escape = null }

function changed() {
  voiceStore.version += 1
  voiceStore.listeners.forEach(listener => listener())
}

function freeMic(r: Recording) {
  window.clearInterval(r.timer)
  r.stream?.getTracks().forEach(track => track.stop())
  r.stream = null
}

export async function sendRecording(agentId: string, r: Recording) {
  if (!r.blob) return
  r.phase = 'sending'
  changed()
  try {
    const audio = await blobToBase64(r.blob)
    await getAgentEngineClient().voiceMessage(agentId, audio, r.blob.type, r.durationMs, r.priority)
    if (voiceStore.recordings.get(agentId) === r) voiceStore.recordings.delete(agentId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showNotice(/unknown command/i.test(message)
      ? 'This agent engine is older than voice messages: restart it (pnpm dev:engine). The recording is kept: send it again.'
      : `Voice message not sent: ${message}. The recording is kept: click it to send again.`, 'error')
    r.phase = 'unsent'
  }
  changed()
}

export async function startRecording(agentId: string, priority?: 'now' | 'later'): Promise<void> {
  if (voiceStore.recordings.has(agentId)) return
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    showNotice('This browser cannot record audio.', 'error')
    return
  }
  const r: Recording = { phase: 'recording', recorder: null, stream: null, chunks: [], mime: pickMime(), startedAt: Date.now(), durationMs: 0, cancelled: false, priority, blob: null, timer: 0, keep: false }
  voiceStore.recordings.set(agentId, r)
  changed()
  try {
    r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch {
    voiceStore.recordings.delete(agentId)
    changed()
    showNotice('No microphone, or the browser is not allowed to use it.', 'error')
    return
  }
  if (voiceStore.recordings.get(agentId) !== r || r.cancelled) { freeMic(r); return }
  const recorder = new MediaRecorder(r.stream, { ...(r.mime ? { mimeType: r.mime } : {}), audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
  r.recorder = recorder
  recorder.ondataavailable = event => { if (event.data.size) r.chunks.push(event.data) }
  recorder.onstop = () => {
    freeMic(r)
    r.durationMs = Date.now() - r.startedAt
    if (r.cancelled || !r.chunks.length || r.durationMs < 400) {
      if (voiceStore.recordings.get(agentId) === r) voiceStore.recordings.delete(agentId)
      changed()
      return
    }
    r.blob = new Blob(r.chunks, { type: recorder.mimeType || r.mime || 'audio/webm' })
    if (r.keep) {
      r.phase = 'unsent'
      changed()
      return
    }
    void sendRecording(agentId, r)
  }
  recorder.start(1000)
  // The clock on the buttons, and the runaway guard (kept, not sent, when it runs out).
  r.timer = window.setInterval(() => {
    if (Date.now() - r.startedAt >= MAX_MS) stopRecording(agentId, { keep: true })
    changed()
  }, 250)
}

/** Stop and send; keep: stop and keep it as an unsent draft; cancel: throw it away. */
export function stopRecording(agentId: string, { cancel = false, keep = false }: { cancel?: boolean; keep?: boolean } = {}): void {
  const r = voiceStore.recordings.get(agentId)
  if (!r || r.phase !== 'recording') return
  r.cancelled = cancel
  r.keep = keep
  if (r.recorder && r.recorder.state !== 'inactive') r.recorder.stop()
  else if (!r.recorder) { voiceStore.recordings.delete(agentId); changed() } // still asking for the mic
}

export function discardUnsent(agentId: string) {
  const r = voiceStore.recordings.get(agentId)
  if (r?.phase === 'unsent') { voiceStore.recordings.delete(agentId); changed() }
}

/** Every voice message being recorded, sent or waiting to be sent again (for the voice widget). */
export function voiceMessageList(): Array<{ agentId: string; phase: Phase; startedAt: number; durationMs: number }> {
  return [...voiceStore.recordings.entries()].map(([agentId, r]) => ({ agentId, phase: r.phase, startedAt: r.startedAt, durationMs: r.durationMs }))
}

export function subscribeVoiceMessages(listener: () => void): () => void {
  voiceStore.listeners.add(listener)
  return () => { voiceStore.listeners.delete(listener) }
}

export function voiceMessagesVersion(): number {
  return voiceStore.version
}

/** Send an unsent draft again (the widget, or a click on the button). */
export function resendRecording(agentId: string): void {
  const r = voiceStore.recordings.get(agentId)
  if (r?.phase === 'unsent') void sendRecording(agentId, r)
}

function useRecording(agentId: string): Recording | null {
  useSyncExternalStore(
    listener => { voiceStore.listeners.add(listener); return () => { voiceStore.listeners.delete(listener) } },
    () => voiceStore.version,
    () => 0,
  )
  return voiceStore.recordings.get(agentId) || null
}

export function VoiceMessageButton({ agentId, priority, large = false }: { agentId: string; priority?: 'now' | 'later'; large?: boolean }) {
  const r = useRecording(agentId)
  const phase: Phase = r?.phase || 'idle'
  /** The press that started a recording: held past HOLD_MS, letting go sends it. */
  const press = useRef<number | null>(null)

  const recording = phase === 'recording'
  const unsent = phase === 'unsent'
  const elapsed = r ? (recording ? Date.now() - r.startedAt : r.durationMs) : 0
  const title = recording
    ? 'Recording a voice message: click (or let go) to send'
    : phase === 'sending' ? 'Transcribing with ElevenLabs Scribe…'
      : unsent ? 'This voice message was not sent: click to send it again (x throws it away)'
        : 'Voice message: click to record (or hold), sent as a recording with its Scribe transcript'
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={recording}
        disabled={phase === 'sending'}
        onPointerDown={event => {
          if (event.button !== 0 || phase === 'sending') return
          if (unsent && r) { void sendRecording(agentId, r); return }
          if (recording) { press.current = null; stopRecording(agentId); return } // second click: send
          press.current = Date.now()
          void startRecording(agentId, priority)
        }}
        onPointerUp={() => {
          // Held down: letting go sends it. A short click keeps recording until the next click.
          const at = press.current
          press.current = null
          if (at !== null && Date.now() - at > HOLD_MS && voiceStore.recordings.get(agentId)?.phase === 'recording') stopRecording(agentId)
        }}
        onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation() }}
        className={`flex items-center gap-1 rounded-md border px-2 py-1 font-bold transition disabled:opacity-60 ${large ? 'text-[12px]' : 'text-[11px]'} ${recording
          ? 'border-rose-300/70 bg-rose-500/25 text-rose-50'
          : unsent ? 'border-amber-300/70 bg-amber-500/20 text-amber-50'
            : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/15'}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          {recording
            ? <circle cx="12" cy="12" r="6" fill="currentColor" className="animate-pulse" />
            : <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />}
        </svg>
        {recording ? formatClip(elapsed) : phase === 'sending' ? 'scribing…' : unsent ? `send ${formatClip(elapsed)} again` : 'voice'}
      </button>
      {unsent && (
        <button type="button" onClick={() => discardUnsent(agentId)} aria-label="Throw the unsent voice message away" title="Throw it away" className="rounded px-1 text-[11px] text-white/55 hover:text-white">x</button>
      )}
    </span>
  )
}

/** A voice message in the thread: play / pause, a bar that fills as it plays (click it to jump), elapsed / length. */
const SPEEDS = [1, 1.25, 1.5, 2, 0.75]

/**
 * A voice message, or a sound file an agent sent (name: shown above, its length read up front, a speed button):
 * play / pause, a bar that fills (click to jump), elapsed / length. It plays in the thread: the page never goes
 * to the file.
 */
export function VoiceClip({ fileId, durationMs, name, sizeLabel }: { fileId: string; durationMs?: number; name?: string; sizeLabel?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [rate, setRate] = useState(1)
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
    audio.onerror = () => { setPlaying(false); showNotice(`${name ? `${name} is` : 'That recording is'} gone (the agent engine keeps files until it restarts).`, 'warn') }
    return audio
  }

  // A sent sound file: read its length up front (no durationMs from a recording).
  useEffect(() => {
    if (!name || durationMs) return
    const audio = ensure()
    audio.preload = 'metadata'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]
    setRate(next)
    const audio = ensure()
    audio.playbackRate = next
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
  const what = name ? name : 'voice message'
  const player = (
    <div className="mb-1 flex items-center gap-2" onClick={event => event.stopPropagation()} data-audio-player={name ? 'file' : 'voice'}>
      <button type="button" onClick={toggle} aria-label={`${playing ? 'Pause' : 'Play'} ${what}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-300/25 text-sky-50 hover:bg-sky-300/40">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}
        </svg>
      </button>
      <div
        role="slider"
        aria-label={`${what} position`}
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
        {lengthMs ? (started ? `${formatClip(elapsedMs)} / ${formatClip(lengthMs)}` : formatClip(lengthMs)) : started ? formatClip(elapsedMs) : name ? '…' : 'voice'}
      </span>
      {name && (
        <button type="button" onClick={nextSpeed} title="Playback speed" aria-label={`Playback speed ${rate} times`} className="shrink-0 rounded border border-sky-300/30 px-1 font-mono text-[10px] text-sky-100/85 hover:bg-sky-300/15">
          {rate}×
        </button>
      )}
    </div>
  )
  if (!name) return player
  return (
    <div className="rounded-lg border border-sky-300/25 bg-sky-400/[0.06] px-2 pb-0.5 pt-1.5" data-audio-file>
      <div className="mb-1 truncate text-[11px] text-sky-100/85" title={name}>🎵 {name}{sizeLabel ? <span className="text-sky-100/50"> · {sizeLabel}</span> : null}</div>
      {player}
    </div>
  )
}
