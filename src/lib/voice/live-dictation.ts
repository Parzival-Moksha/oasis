// ░▒▓ LIVE DICTATION — words while you talk ▓▒░
// The mic goes to the agent engine (ws://127.0.0.1:4530/listen) in ~100 ms pieces of 16 kHz 16-bit mono
// (public/voice/ears-worklet.js cuts them). The engine streams them to ElevenLabs Scribe Realtime, or runs Moonshine
// Medium Streaming on the CPU (Settings → Sound → Voice typing), and sends back "partial" lines that can still change
// and a "final" line once you pause. One dictation at a time.
// Ported from Tyler (C:/7f_Tyler/Tyler/public/js/ears.js).

import { withLocalToken } from '../local-token'
import { resolveAgentEngineUrl } from '../agent-engine-client'
import { getVoiceTypingEngine, type VoiceTypingEngine } from './voice-typing-engine'

export interface DictationLine {
  line: number
  text: string
  final: boolean
}

export interface LiveDictationHandlers {
  lang?: string
  /** Every partial or final line, keyed by line number; a final line replaces its partial. */
  onLine?: (line: DictationLine) => void
  onStatus?: (text: string) => void
  onReady?: () => void
  onLevel?: (level: number) => void
  onError?: (text: string) => void
  /** Called once, after the last words have settled (or the connection ended). */
  onDone?: (stats: { firstWordsS: number | null; settleS: number | null; audioS: number | null }) => void
  /** The raw mic stream, e.g. for the player's lip sync. */
  onStream?: (stream: MediaStream) => void
}

export interface LiveDictation {
  /** Stop the mic; the last words settle, then onDone. */
  stop: () => void
  /** Drop everything now. */
  cancel: () => void
}

export function dictationUrl(lang = 'en', typing: VoiceTypingEngine = getVoiceTypingEngine()): string {
  const engine = resolveAgentEngineUrl()
  const url = new URL(engine.replace(/^ws/i, 'http'))
  url.pathname = '/listen'
  url.search = `?lang=${encodeURIComponent(lang)}&engine=${typing}`
  return withLocalToken(url.toString().replace(/^http/i, 'ws'))
}

/** Joins the lines of one dictation into text, in line order. */
export function joinDictation(lines: Map<number, DictationLine>): string {
  return [...lines.values()]
    .sort((a, b) => a.line - b.line)
    .map(l => l.text.trim())
    .filter(Boolean)
    .join(' ')
}

export function isLiveDictationSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof AudioWorkletNode !== 'undefined'
    && typeof WebSocket !== 'undefined'
}

export async function startLiveDictation(handlers: LiveDictationHandlers): Promise<LiveDictation> {
  const { lang = 'en', onLine, onStatus, onReady, onLevel, onError, onDone, onStream } = handlers
  const ws = new WebSocket(dictationUrl(lang))
  ws.binaryType = 'arraybuffer'
  const queue: Array<ArrayBuffer | string> = []
  const send = (x: ArrayBuffer | string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(x)
    else if (ws.readyState === WebSocket.CONNECTING) queue.push(x)
  }
  let onset: number | null = null
  let firstWordsS: number | null = null
  let stopAt: number | null = null
  let settleS: number | null = null
  let audioS: number | null = null
  let done = false
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let failsafe: number | null = null

  const finish = () => {
    if (done) return
    done = true
    if (failsafe !== null) window.clearTimeout(failsafe)
    stream?.getTracks().forEach(t => t.stop())
    ctx?.close().catch(() => {})
    if (ws.readyState <= WebSocket.OPEN) ws.close()
    onDone?.({ firstWordsS, settleS, audioS })
  }

  ws.onopen = () => { queue.splice(0).forEach(x => ws.send(x)) }
  ws.onmessage = (event) => {
    let m: { t?: string; text?: string; line?: number; audio_s?: number }
    try { m = JSON.parse(String(event.data)) } catch { return }
    if (m.t === 'partial' || m.t === 'final') {
      if (firstWordsS === null && m.text && onset !== null) firstWordsS = (performance.now() - onset) / 1000
      onLine?.({ line: Number(m.line) || 0, text: m.text || '', final: m.t === 'final' })
    } else if (m.t === 'status') onStatus?.(m.text || '')
    else if (m.t === 'ready') onReady?.()
    else if (m.t === 'error') onError?.(m.text || 'Voice error')
    else if (m.t === 'stopped') {
      if (stopAt !== null) settleS = (performance.now() - stopAt) / 1000
      audioS = typeof m.audio_s === 'number' ? m.audio_s : null
      finish()
    }
  }
  ws.onerror = () => onError?.("Can't reach the voice helper: is the agent engine running? (pnpm dev:engine)")
  ws.onclose = finish

  const idle: LiveDictation = { stop() {}, cancel() {} }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch {
    finish()
    throw new Error("No microphone here, or the browser isn't allowed to use it (click the icon left of the address)")
  }
  if (done) {
    stream.getTracks().forEach(t => t.stop())
    return idle
  }
  onStream?.(stream)
  // A 16 kHz context lets the browser resample; where it can't mix rates the worklet averages down itself.
  let source: MediaStreamAudioSourceNode
  try {
    ctx = new AudioContext({ sampleRate: 16000 })
    source = ctx.createMediaStreamSource(stream)
  } catch {
    await ctx?.close().catch(() => {})
    ctx = new AudioContext()
    source = ctx.createMediaStreamSource(stream)
  }
  await ctx.audioWorklet.addModule('/voice/ears-worklet.js')
  if (done) {
    finish()
    return idle
  }
  const node = new AudioWorkletNode(ctx, 'ears-capture')
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute).connect(ctx.destination)
  node.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer; level: number; last: boolean }>) => {
    onLevel?.(data.level)
    if (onset === null && data.level > 0.08) onset = performance.now()
    if (data.pcm.byteLength) send(data.pcm)
    if (data.last) send(JSON.stringify({ t: 'stop' }))
  }

  return {
    stop() {
      if (stopAt !== null || done) return
      stopAt = performance.now()
      stream?.getTracks().forEach(t => t.stop()) // the mic light goes off at once
      node.port.postMessage('flush') // the last few ms of audio, then "stop"
      failsafe = window.setTimeout(finish, 10000) // the engine always answers "stopped"; this is in case it can't
    },
    cancel: finish,
  }
}
