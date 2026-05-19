// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useRealtimeTranscribe — OpenAI Realtime live-transcription, browser side.
// ─═̷─═̷─🎙─═̷─═̷─ press to start, deltas land in the input box ─═̷─═̷─🎙─═̷─═̷─
//
// Mirrors the shape of useAgentVoiceInput (supported/ready/listening/
// transcribing/error + toggle + stop + clearError) so the existing
// AgentVoiceInputButton component drops in unchanged.
//
// Flow:
//   1. toggle() → POST /api/voice/realtime-session for an ephemeral client_secret
//   2. open WebSocket to wss://api.openai.com/v1/realtime?intent=transcription
//      authenticated via the Sec-WebSocket-Protocol subprotocol channel
//   3. getUserMedia({ audio: true }) → AudioWorklet (or ScriptProcessor
//      fallback) downsamples to 24kHz mono PCM16
//   4. each ~50ms buffer → base64 → `input_audio_buffer.append` event
//   5. incoming `conversation.item.input_audio_transcription.delta`
//      and `.completed` events drive the onTranscript callback
//   6. toggle() again (or stop()) → ws.close + stream tracks released
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { AgentVoiceInputController } from './useAgentVoiceInput'

export interface UseRealtimeTranscribeOptions {
  enabled?: boolean
  onTranscript: (transcript: string) => void
  focusTargetRef?: RefObject<{ focus: () => void } | null>
  /** Endpoint that mints the ephemeral session. Defaults to /api/voice/realtime-session. */
  sessionEndpoint?: string
}

const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'
const TARGET_SAMPLE_RATE = 24000  // OpenAI realtime expects 24kHz pcm16

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.AudioContext !== 'undefined' &&
    typeof WebSocket !== 'undefined'
  )
}

/** Float32 in -1..1 → Int16 PCM. */
function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}

/** Downsample naively from sourceRate → 24000. Good enough for speech. */
function downsampleTo24k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input
  const ratio = sourceRate / TARGET_SAMPLE_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  let outIdx = 0
  let inIdx = 0
  while (outIdx < outLen) {
    const nextInIdx = Math.floor((outIdx + 1) * ratio)
    let sum = 0
    let count = 0
    for (let i = inIdx; i < nextInIdx && i < input.length; i++) {
      sum += input[i]
      count++
    }
    out[outIdx++] = count > 0 ? sum / count : 0
    inIdx = nextInIdx
  }
  return out
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
  let bin = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return typeof window === 'undefined' ? '' : btoa(bin)
}

export function useRealtimeTranscribe({
  enabled = true,
  onTranscript,
  focusTargetRef,
  sessionEndpoint = '/api/voice/realtime-session',
}: UseRealtimeTranscribeOptions): AgentVoiceInputController {
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const inFlightDeltaRef = useRef<string>('')
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [warming, setWarming] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setSupported(isSupported()) }, [])

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close() } catch { /* noop */ }
      wsRef.current = null
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect() } catch { /* noop */ }
      processorRef.current = null
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close() } catch { /* noop */ }
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } })
      streamRef.current = null
    }
    inFlightDeltaRef.current = ''
  }, [])

  const stop = useCallback(() => {
    cleanup()
    setListening(false)
    setWarming(false)
  }, [cleanup])

  // Clean up when component unmounts or enabled flips off.
  useEffect(() => {
    if (!enabled && listening) stop()
    return () => { cleanup() }
  }, [cleanup, enabled, listening, stop])

  const start = useCallback(async () => {
    if (!isSupported()) {
      setError('Realtime transcription not supported in this browser.')
      return
    }
    if (listening || warming) return
    setError('')
    setWarming(true)
    try {
      // 1. Mint the ephemeral session
      const sessionRes = await fetch(sessionEndpoint, { method: 'POST' })
      if (!sessionRes.ok) {
        const detail = await sessionRes.text().catch(() => '')
        throw new Error(`session mint failed: ${sessionRes.status} ${detail.slice(0, 160)}`)
      }
      const session = await sessionRes.json() as { clientSecret?: string; error?: string }
      if (!session.clientSecret) throw new Error(session.error || 'no clientSecret returned')

      // 2. Open WebSocket. Auth lives in Sec-WebSocket-Protocol per OpenAI's
      //    browser-friendly handshake; the second protocol token is the
      //    bearer with a literal "openai-insecure-api-key." prefix because
      //    browsers can't send Authorization headers on WebSocket connects.
      const ws = new WebSocket(REALTIME_WS_URL, [
        'realtime',
        `openai-insecure-api-key.${session.clientSecret}`,
        'openai-beta.realtime-v1',
      ])
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onerror = () => {
        setError('Live transcription connection lost')
        stop()
      }
      ws.onclose = () => {
        // If we were still in flight and have a pending delta, flush it.
        const pending = inFlightDeltaRef.current
        if (pending) {
          onTranscriptRef.current(pending)
          inFlightDeltaRef.current = ''
        }
        if (listening) setListening(false)
        if (warming) setWarming(false)
      }
      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return
        let parsed: { type?: string; delta?: string; transcript?: string }
        try {
          parsed = JSON.parse(event.data)
        } catch { return }
        if (parsed.type === 'conversation.item.input_audio_transcription.delta' && typeof parsed.delta === 'string') {
          inFlightDeltaRef.current += parsed.delta
          // ─═̷─ Stream the in-flight delta out as it arrives. The button
          // consumer (OpenclawPanel etc) appends transcripts to the input;
          // we wait for "completed" to flush the FINAL accumulated form so
          // we don't append fragments mid-word. ─═̷─
        } else if (parsed.type === 'conversation.item.input_audio_transcription.completed') {
          const finalText = (parsed.transcript || inFlightDeltaRef.current).trim()
          inFlightDeltaRef.current = ''
          if (finalText) onTranscriptRef.current(finalText)
        } else if (parsed.type === 'error') {
          setError((parsed as { error?: { message?: string } }).error?.message || 'Realtime error')
        }
      }

      // 3. Capture mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioContextCtor()
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      // ScriptProcessor is deprecated but universally supported and fine
      // for our buffer size; AudioWorklet would be cleaner if we want to
      // ship a separate worklet file.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      source.connect(processor)
      processor.connect(audioCtx.destination)

      const sourceRate = audioCtx.sampleRate
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const channel = event.inputBuffer.getChannelData(0)
        const downsampled = downsampleTo24k(channel, sourceRate)
        const pcm = floatTo16BitPCM(downsampled)
        const b64 = int16ToBase64(pcm)
        if (!b64) return
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }))
      }

      // 4. Wait until the WS is open before flipping to "listening"
      if (ws.readyState !== WebSocket.OPEN) {
        await new Promise<void>((resolve, reject) => {
          ws.addEventListener('open', () => resolve(), { once: true })
          ws.addEventListener('error', () => reject(new Error('ws failed before open')), { once: true })
        })
      }
      // Focus the target input so the transcript visibly lands there
      focusTargetRef?.current?.focus?.()
      setWarming(false)
      setListening(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start live transcription'
      setError(message)
      stop()
    }
  }, [focusTargetRef, listening, sessionEndpoint, stop, warming])

  const toggle = useCallback(async () => {
    if (listening || warming) {
      // Tell OpenAI we're done — commit the buffer so the final
      // .completed event fires before we close. The ws.onclose handler
      // catches any residual delta as a fallback.
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' })) } catch { /* noop */ }
      }
      // Give the commit ~250ms to round-trip, then close.
      window.setTimeout(() => stop(), 250)
      return
    }
    await start()
  }, [listening, start, stop, warming])

  const clearError = useCallback(() => setError(''), [])

  return {
    supported,
    ready: supported,           // No warm-up step like local whisper — readiness equals support
    warming,
    backendState: warming ? 'loading' : listening ? 'ready' : 'idle',
    backendMessage: '',
    listening,
    transcribing: false,         // No batch-mode transcribe step in realtime
    error,
    clearError,
    stop,
    toggle,
  }
}
