// ░▒▓ VILLAGE SOUND — a short chime when an agent starts needing you, even from a background tab ▓▒░
// Browsers keep audio off until the page gets a click or key press, so the first gesture unlocks it
// (VillageController). Synthesized with WebAudio: no sound files to ship.

import type { EngineAgentStatus } from '../../lib/agent-engine-types'

const STORAGE_KEY = 'oasis.village.sound'

/** Rising for a decision, a soft fifth for finished work, falling for an error (the in-world colors). */
const CHIMES: Partial<Record<EngineAgentStatus, number[]>> = {
  'needs-decision': [660, 880],
  waiting: [523, 784],
  error: [392, 262],
}

let context: AudioContext | null = null
let enabled: boolean | null = null
let lastChime: { status: string; at: number; played: boolean } | null = null
const listeners = new Set<() => void>()

export function isVillageSoundOn(): boolean {
  if (enabled === null) {
    try {
      enabled = window.localStorage.getItem(STORAGE_KEY) !== 'off'
    } catch {
      enabled = true
    }
  }
  return enabled
}

export function setVillageSoundOn(on: boolean): void {
  enabled = on
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach(listener => listener())
}

export function subscribeVillageSound(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Call from a click or key press: creates or resumes the AudioContext so later chimes can play. */
export function unlockVillageAudio(): void {
  if (typeof window === 'undefined') return
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return
  if (!context) context = new Context()
  if (context.state === 'suspended') void context.resume().catch(() => {})
}

export function playVillageChime(status: EngineAgentStatus): boolean {
  const notes = CHIMES[status]
  const ctx = context
  const played = Boolean(notes && ctx && ctx.state === 'running' && isVillageSoundOn())
  lastChime = { status, at: Date.now(), played }
  if (!played || !notes || !ctx) return false
  const start = ctx.currentTime + 0.02
  notes.forEach((frequency, index) => {
    const at = start + index * 0.15
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.5)
  })
  return true
}

/** For window.__oasisVillage.sound() (dev): whether audio is unlocked and what chimed last. */
export function getVillageSoundDebug() {
  return { on: isVillageSoundOn(), audio: context?.state || 'locked', lastChime }
}
