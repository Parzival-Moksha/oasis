// The main menu's hover and click sounds, made with the Web Audio API (no files, no downloads).
// Volume and mute follow the Oasis sound settings. "Classic" plays the existing button samples.

import { useAudioManager } from '@/lib/audio-manager'
import type { MenuSoundId } from './menu-store'

export type MenuSoundEvent = 'hover' | 'click' | 'open' | 'close'

let context: AudioContext | null = null

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

interface Tone {
  type: OscillatorType
  from: number
  to?: number
  at?: number
  length: number
  gain: number
  /** Seconds to reach full level (a soft start hides the click of a hard edge). */
  attack?: number
}

function tone(ctx: AudioContext, out: AudioNode, t0: number, n: Tone) {
  const start = t0 + (n.at ?? 0)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = n.type
  osc.frequency.setValueAtTime(n.from, start)
  if (n.to && n.to !== n.from) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.length)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(n.gain, start + (n.attack ?? 0.004))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + n.length)
  osc.connect(gain).connect(out)
  osc.start(start)
  osc.stop(start + n.length + 0.02)
}

function noise(ctx: AudioContext, out: AudioNode, t0: number, length: number, gainValue: number, cutoff: number) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * length))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  const gain = ctx.createGain()
  gain.gain.value = gainValue
  source.connect(filter).connect(gain).connect(out)
  source.start(t0)
}

type Recipe = (ctx: AudioContext, out: AudioNode, t: number) => void

const RECIPES: Record<Exclude<MenuSoundId, 'classic' | 'off'>, Record<MenuSoundEvent, Recipe>> = {
  glass: {
    hover: (c, o, t) => { tone(c, o, t, { type: 'sine', from: 1320, to: 1480, length: 0.09, gain: 0.16 }); tone(c, o, t, { type: 'sine', from: 2640, length: 0.05, gain: 0.04 }) },
    click: (c, o, t) => {
      tone(c, o, t, { type: 'sine', from: 150, to: 70, length: 0.12, gain: 0.5 })
      tone(c, o, t, { type: 'sine', from: 880, length: 0.22, gain: 0.22, at: 0.02 })
      tone(c, o, t, { type: 'sine', from: 1320, length: 0.3, gain: 0.2, at: 0.085 })
    },
    open: (c, o, t) => { tone(c, o, t, { type: 'sine', from: 440, to: 660, length: 0.22, gain: 0.2, attack: 0.03 }); tone(c, o, t, { type: 'sine', from: 990, length: 0.3, gain: 0.12, at: 0.1 }) },
    close: (c, o, t) => { tone(c, o, t, { type: 'sine', from: 660, to: 400, length: 0.2, gain: 0.18, attack: 0.02 }) },
  },
  arcade: {
    hover: (c, o, t) => tone(c, o, t, { type: 'square', from: 660, length: 0.045, gain: 0.07 }),
    click: (c, o, t) => {
      tone(c, o, t, { type: 'square', from: 523, length: 0.06, gain: 0.1 })
      tone(c, o, t, { type: 'square', from: 784, length: 0.07, gain: 0.1, at: 0.06 })
      tone(c, o, t, { type: 'triangle', from: 110, to: 60, length: 0.1, gain: 0.35 })
    },
    open: (c, o, t) => { [392, 523, 659].forEach((f, i) => tone(c, o, t, { type: 'square', from: f, length: 0.06, gain: 0.08, at: i * 0.055 })) },
    close: (c, o, t) => { [659, 523, 392].forEach((f, i) => tone(c, o, t, { type: 'square', from: f, length: 0.05, gain: 0.07, at: i * 0.045 })) },
  },
  thud: {
    hover: (c, o, t) => noise(c, o, t, 0.03, 0.22, 2400),
    click: (c, o, t) => {
      noise(c, o, t, 0.035, 0.5, 1800)
      tone(c, o, t, { type: 'sine', from: 190, to: 62, length: 0.16, gain: 0.7 })
      tone(c, o, t, { type: 'triangle', from: 380, to: 240, length: 0.07, gain: 0.16 })
    },
    open: (c, o, t) => { noise(c, o, t, 0.12, 0.2, 900); tone(c, o, t, { type: 'sine', from: 90, to: 130, length: 0.2, gain: 0.4, attack: 0.03 }) },
    close: (c, o, t) => { noise(c, o, t, 0.08, 0.16, 700); tone(c, o, t, { type: 'sine', from: 130, to: 70, length: 0.16, gain: 0.35 }) },
  },
}

let lastHoverAt = 0
let lastClickAt = 0
/** Set while the Classic set plays its sample through the audio manager, so the manager does not route it back here. */
let playingClassic = false
export function isPlayingClassicSample(): boolean {
  return playingClassic
}

export function playMenuSound(style: MenuSoundId, event: MenuSoundEvent): void {
  if (style === 'off') return
  const manager = useAudioManager.getState()
  if (manager.muted || manager.volume <= 0) return
  if (event === 'hover') {
    // Sweeping across the grid should tick, not buzz.
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    if (now - lastHoverAt < 45) return
    lastHoverAt = now
  }
  if (event === 'click') {
    // One click, one sound, however many handlers asked for it.
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    if (now - lastClickAt < 70) return
    lastClickAt = now
  }
  if (style === 'classic') {
    playingClassic = true
    try {
      manager.play(event === 'hover' ? 'buttonHover' : event === 'click' ? 'buttonClick' : event === 'open' ? 'panelOpen' : 'panelClose')
    } finally {
      playingClassic = false
    }
    return
  }
  const ctx = audio()
  if (!ctx) return
  const master = ctx.createGain()
  master.gain.value = Math.min(1, manager.volume) * 0.6
  master.connect(ctx.destination)
  RECIPES[style][event](ctx, master, ctx.currentTime + 0.005)
  window.setTimeout(() => { try { master.disconnect() } catch { /* already gone */ } }, 900)
}
