// Music for the X-key dances, made with the Web Audio API: a small step sequencer with a drum kit
// and a bass, one groove per dance. No files. Volume and mute follow the Oasis sound settings.
// Nothing runs while no dance is playing (the scheduler's timer exists only between start and stop).

import { useAudioManager } from '@/lib/audio-manager'

interface Groove {
  bpm: number
  /** Steps in a bar: 16 (sixteenths in 4/4) or 12 (eighth triplets, or 3/4 in sixteenths). */
  steps: number
  kick: number[]
  snare: number[]
  hat: number[]
  /** Open or accented hats. */
  accent?: number[]
  /** Bass notes over the whole loop: [step from the loop's start, semitones above the root, steps long]. */
  bass: Array<[number, number, number]>
  /** Bars in the loop. */
  bars: number
  root: number
  bassWave: OscillatorType
  swing?: number
}

const E1 = 41.2
const note = (semitones: number) => Math.pow(2, semitones / 12)

export const DANCE_GROOVES: Record<string, Groove> = {
  // Boom-bap: lazy kick, snare on two and four.
  'hip-hop': {
    bpm: 92, steps: 16, bars: 2, root: E1 * note(3), bassWave: 'triangle', swing: 0.16,
    kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    bass: [[0, 12, 3], [7, 12, 2], [10, 10, 2], [16, 12, 3], [23, 15, 2], [26, 7, 4]],
  },
  breakdance: {
    bpm: 108, steps: 16, bars: 2, root: E1 * note(5), bassWave: 'sawtooth', swing: 0.08,
    kick: [0, 3, 8, 10], snare: [4, 12, 15], hat: [0, 2, 4, 6, 8, 10, 12, 14], accent: [6, 14],
    bass: [[0, 12, 2], [3, 12, 1], [8, 15, 2], [10, 12, 2], [16, 12, 2], [19, 10, 1], [24, 7, 2], [28, 10, 2]],
  },
  // Four on the floor with an off-beat bass.
  shuffling: {
    bpm: 128, steps: 16, bars: 2, root: E1 * note(1), bassWave: 'sawtooth',
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], accent: [2, 6, 10, 14],
    bass: [[2, 12, 2], [6, 12, 2], [10, 12, 2], [14, 15, 2], [18, 12, 2], [22, 12, 2], [26, 10, 2], [30, 7, 2]],
  },
  // Minor-key funk with a walking line.
  thriller: {
    bpm: 118, steps: 16, bars: 2, root: E1 * note(5), bassWave: 'sawtooth',
    kick: [0, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], accent: [14],
    bass: [[0, 12, 2], [3, 15, 1], [4, 17, 2], [7, 19, 1], [8, 22, 2], [11, 19, 1], [12, 17, 2], [16, 12, 2], [19, 15, 1], [20, 17, 2], [24, 15, 2], [28, 10, 2]],
  },
  // Rock and roll: quick, major, a walking bass.
  twist: {
    bpm: 162, steps: 16, bars: 4, root: E1 * note(8), bassWave: 'triangle',
    kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12], accent: [4, 12],
    bass: [
      [0, 12, 4], [4, 16, 4], [8, 19, 4], [12, 21, 4],
      [16, 12, 4], [20, 16, 4], [24, 19, 4], [28, 16, 4],
      [32, 17, 4], [36, 21, 4], [40, 24, 4], [44, 21, 4],
      [48, 19, 4], [52, 17, 4], [56, 16, 4], [60, 14, 4],
    ],
  },
  // A rolling hand-drum feel.
  capoeira: {
    bpm: 104, steps: 16, bars: 2, root: E1 * note(10), bassWave: 'triangle', swing: 0.1,
    kick: [0, 6, 8], snare: [3, 11, 14], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14],
    bass: [[0, 12, 2], [3, 12, 1], [6, 14, 2], [8, 12, 2], [16, 12, 2], [19, 12, 1], [22, 17, 2], [24, 14, 3]],
  },
  // Steady pop pulse.
  moonwalk: {
    bpm: 116, steps: 16, bars: 2, root: E1 * note(6), bassWave: 'sawtooth',
    kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], accent: [2, 10],
    bass: [[0, 12, 2], [2, 12, 2], [4, 19, 2], [6, 12, 2], [8, 22, 2], [10, 19, 2], [12, 17, 2], [14, 19, 2], [16, 12, 2], [18, 12, 2], [20, 19, 2], [22, 12, 2], [24, 17, 2], [26, 15, 2], [28, 12, 2], [30, 10, 2]],
  },
  // A waltz: one, two, three.
  twirl: {
    bpm: 138, steps: 12, bars: 4, root: E1 * note(8), bassWave: 'triangle',
    kick: [0], snare: [], hat: [4, 8], accent: [4, 8],
    bass: [[0, 12, 4], [4, 19, 2], [8, 19, 2], [12, 17, 4], [16, 21, 2], [20, 21, 2], [24, 19, 4], [28, 23, 2], [32, 23, 2], [36, 12, 4], [40, 16, 2], [44, 19, 2]],
  },
}

const DEFAULT_GROOVE = 'hip-hop'

export function grooveFor(danceId: string): Groove {
  return DANCE_GROOVES[danceId] ?? DANCE_GROOVES[DEFAULT_GROOVE]
}

/** Seconds from the loop's start to `step` (with swing: every second sixteenth comes late). */
export function stepTime(groove: Groove, step: number): number {
  // In 16-step bars a step is a sixteenth; in 12-step bars it is a sixteenth of a 3/4 bar.
  const stepSeconds = 60 / groove.bpm / 4
  const swing = groove.swing && step % 2 === 1 ? groove.swing * stepSeconds : 0
  return step * stepSeconds + swing
}

export function loopSeconds(groove: Groove): number {
  return groove.bars * groove.steps * (60 / groove.bpm / 4)
}

// ── playing ───────────────────────────────────────────────────────────────────────────────────

let context: AudioContext | null = null
let playing: { id: string; master: GainNode; timer: number; nextLoopAt: number } | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      context = new Ctor()
    }
    if (context.state === 'suspended') void context.resume().catch(() => {})
    return context
  } catch {
    return null
  }
}

function kick(ctx: AudioContext, out: AudioNode, t: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(46, t + 0.12)
  gain.gain.setValueAtTime(0.9, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + 0.24)
}

let noiseBuffer: AudioBuffer | null = null
function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

function burst(ctx: AudioContext, out: AudioNode, t: number, length: number, level: number, type: BiquadFilterType, frequency: number) {
  const source = ctx.createBufferSource()
  source.buffer = noise(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(level, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + length)
  source.connect(filter).connect(gain).connect(out)
  source.start(t)
  source.stop(t + length + 0.02)
}

function snare(ctx: AudioContext, out: AudioNode, t: number) {
  burst(ctx, out, t, 0.16, 0.5, 'bandpass', 1900)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(210, t)
  osc.frequency.exponentialRampToValueAtTime(140, t + 0.08)
  gain.gain.setValueAtTime(0.35, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + 0.12)
}

function bass(ctx: AudioContext, out: AudioNode, t: number, frequency: number, length: number, wave: OscillatorType) {
  const osc = ctx.createOscillator()
  const filter = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  osc.type = wave
  osc.frequency.value = frequency
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(900, t)
  filter.frequency.exponentialRampToValueAtTime(260, t + length)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(wave === 'sawtooth' ? 0.3 : 0.5, t + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, t + length)
  osc.connect(filter).connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + length + 0.02)
}

function scheduleLoop(ctx: AudioContext, out: AudioNode, groove: Groove, t0: number) {
  const stepSeconds = 60 / groove.bpm / 4
  for (let bar = 0; bar < groove.bars; bar++) {
    const at = (step: number) => t0 + stepTime(groove, bar * groove.steps + step)
    for (const s of groove.kick) kick(ctx, out, at(s))
    for (const s of groove.snare) snare(ctx, out, at(s))
    for (const s of groove.hat) burst(ctx, out, at(s), groove.accent?.includes(s) ? 0.09 : 0.035, groove.accent?.includes(s) ? 0.2 : 0.13, 'highpass', 7000)
  }
  for (const [step, semitones, length] of groove.bass) {
    bass(ctx, out, t0 + stepTime(groove, step), groove.root * note(semitones - 12), Math.max(0.08, length * stepSeconds * 0.92), groove.bassWave)
  }
}

export function currentDanceMusic(): string | null {
  return playing?.id ?? null
}

/** Start (or switch to) the groove for a dance. Does nothing when sound is muted. */
export function startDanceMusic(danceId: string): void {
  if (playing?.id === danceId) return
  stopDanceMusic()
  const manager = useAudioManager.getState()
  if (manager.muted || manager.volume <= 0) return
  const ctx = audio()
  if (!ctx) return
  const groove = grooveFor(danceId)
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, ctx.currentTime)
  master.gain.exponentialRampToValueAtTime(Math.min(1, manager.volume) * 0.45, ctx.currentTime + 0.25)
  master.connect(ctx.destination)
  const length = loopSeconds(groove)
  const state = { id: danceId, master, timer: 0, nextLoopAt: ctx.currentTime + 0.06 }
  let level = Math.min(1, manager.volume) * 0.45
  const pump = () => {
    // Follow the sound settings while it plays (muting mid-dance silences it).
    const now = useAudioManager.getState()
    const want = now.muted ? 0 : Math.min(1, now.volume) * 0.45
    if (want !== level) {
      level = want
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(Math.max(0.0001, want), ctx.currentTime, 0.05)
    }
    // A throttled timer (a hidden tab) fell behind: start the next loop now instead of firing the missed notes at once.
    if (state.nextLoopAt < ctx.currentTime) state.nextLoopAt = ctx.currentTime + 0.05
    // Keep one loop queued ahead of the clock.
    while (state.nextLoopAt < ctx.currentTime + 0.3) {
      scheduleLoop(ctx, master, groove, state.nextLoopAt)
      state.nextLoopAt += length
    }
  }
  pump()
  state.timer = window.setInterval(pump, 120)
  playing = state
}

export function stopDanceMusic(): void {
  if (!playing || !context) { playing = null; return }
  const { master, timer } = playing
  playing = null
  window.clearInterval(timer)
  const now = context.currentTime
  try {
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  } catch { /* context closed */ }
  window.setTimeout(() => { try { master.disconnect() } catch { /* gone */ } }, 500)
}
