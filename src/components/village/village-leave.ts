// ░▒▓ VILLAGE LEAVE — dismissing an agent: the dialog, its leaving effect, its sound, then the process stops ▓▒░
// The owner (2026-11-19): "I dismiss an agent. They don't just randomly disappear." The panel's Dismiss button and
// the Delete key both come here. The effect (Settings > Agents > When an agent leaves) plays on its body first
// (VillageLeaveEffect.tsx); its process is stopped when the effect is over.
// Sounds are made on the spot with Web Audio (no files, nothing to download).

import { useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { getVillageLooks, leaveEffectMs, type LeaveEffect } from '../../lib/village/village-looks'
import { getAudioListener } from '../CameraController'
import { showNotice } from '../forge/GlobalNotice'
import { confirmVillage } from './VillageConfirm'
import { agentDisplayName } from './village-status'

export interface Leaving {
  effect: LeaveEffect
  /** performance.now() when it began. */
  at: number
}

const leaving = new Map<string, Leaving>()
const listeners = new Set<() => void>()
let version = 0

function changed(): void {
  version += 1
  listeners.forEach(listener => listener())
}

export function getVillageLeaving(agentId: string): Leaving | null {
  return leaving.get(agentId) ?? null
}

export function useVillageLeaving(agentId: string): Leaving | null {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => version, () => 0)
  return leaving.get(agentId) ?? null
}

/** Plays the effect on an agent's body (without stopping anything): for previews and tests. */
export function playVillageLeave(agentId: string, effect: LeaveEffect = getVillageLooks().leave): number {
  leaving.set(agentId, { effect, at: performance.now() })
  changed()
  if (getVillageLooks().leaveSound) playLeaveSound(effect)
  return leaveEffectMs(effect)
}

function endLeaving(agentId: string): void {
  if (leaving.delete(agentId)) changed()
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Dismiss: asks in the village's dialog, plays the leaving effect, then stops its process (owned agents) or stops
 * watching it (observed ones). Resolves true when it went.
 */
export async function dismissVillageAgent(agentId: string, onGone?: () => void): Promise<boolean> {
  const agent = useOasisStore.getState().agentEngine.agents[agentId]
  if (!agent || leaving.has(agentId)) return false
  const label = agentDisplayName(agent)
  const ok = await confirmVillage(agent.owned
    ? { title: `Dismiss ${label}?`, body: 'Its Claude Code process stops and it leaves the village. The session stays on disk: summon it again from the picker to resume.', confirm: 'Dismiss', danger: true }
    : { title: `Stop watching ${label}?`, body: 'It runs elsewhere; it only leaves this village.', confirm: 'Stop watching', danger: true })
  if (!ok) return false
  const ms = playVillageLeave(agentId)
  await new Promise(resolve => window.setTimeout(resolve, ms))
  const client = getAgentEngineClient()
  try {
    await (agent.owned ? client.kill(agentId) : client.unobserve(agentId))
    onGone?.()
    return true
  } catch (error) {
    showNotice(`${agent.owned ? 'Dismiss' : 'Unobserve'} failed: ${describeError(error)}`, 'error')
    return false
  } finally {
    endLeaving(agentId)
  }
}

// ─── sounds (synthesized) ─────────────────────────────────────────────────────────────────────────

function audioContext(): AudioContext | null {
  const context = getAudioListener()?.context as AudioContext | undefined
  return context && context.state === 'running' ? context : null
}

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** The sound of each leaving effect: a riser to a very high pitch (spin), a click and a falling hum (CRT), a poof. */
export function playLeaveSound(effect: LeaveEffect): void {
  const context = audioContext()
  if (!context) return
  const now = context.currentTime
  const out = context.createGain()
  out.gain.value = 0.18
  out.connect(context.destination)
  const stopAll = (nodes: AudioScheduledSourceNode[], at: number) => {
    nodes.forEach(node => node.stop(at))
    window.setTimeout(() => out.disconnect(), (at - now) * 1000 + 300)
  }
  if (effect === 'spin') {
    // Two detuned saws climbing from 110 Hz to about 7 kHz over 3 s, the last second fastest, then cut.
    const a = context.createOscillator()
    const b = context.createOscillator()
    a.type = 'sawtooth'
    b.type = 'sawtooth'
    b.detune.value = 18
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 6
    for (const osc of [a, b]) {
      osc.frequency.setValueAtTime(110, now)
      osc.frequency.exponentialRampToValueAtTime(420, now + 2)
      osc.frequency.exponentialRampToValueAtTime(7200, now + 3)
      osc.connect(filter)
    }
    filter.frequency.setValueAtTime(600, now)
    filter.frequency.exponentialRampToValueAtTime(2400, now + 2)
    filter.frequency.exponentialRampToValueAtTime(14000, now + 3)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.4)
    gain.gain.setValueAtTime(0.5, now + 2.6)
    gain.gain.exponentialRampToValueAtTime(1, now + 2.95)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.08)
    filter.connect(gain)
    gain.connect(out)
    a.start(now)
    b.start(now)
    stopAll([a, b], now + 3.1)
  } else if (effect === 'crt') {
    // The click of the switch, then a hum falling away as the line shrinks.
    const click = context.createBufferSource()
    click.buffer = noiseBuffer(context, 0.04)
    const clickGain = context.createGain()
    clickGain.gain.setValueAtTime(0.9, now)
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)
    click.connect(clickGain)
    clickGain.connect(out)
    const hum = context.createOscillator()
    hum.type = 'square'
    hum.frequency.setValueAtTime(1600, now)
    hum.frequency.exponentialRampToValueAtTime(60, now + 0.55)
    const humGain = context.createGain()
    humGain.gain.setValueAtTime(0.25, now)
    humGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1)
    hum.connect(humGain)
    humGain.connect(out)
    click.start(now)
    hum.start(now)
    stopAll([click, hum], now + 1.15)
  } else if (effect === 'poof') {
    // A burst of noise through a closing low-pass, and a soft thump under it.
    const puff = context.createBufferSource()
    puff.buffer = noiseBuffer(context, 0.7)
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(3200, now + 0.3)
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.9)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now + 0.28)
    gain.gain.exponentialRampToValueAtTime(1, now + 0.33)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
    puff.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    const thump = context.createOscillator()
    thump.frequency.setValueAtTime(140, now + 0.3)
    thump.frequency.exponentialRampToValueAtTime(45, now + 0.6)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.0001, now + 0.29)
    thumpGain.gain.exponentialRampToValueAtTime(0.8, now + 0.32)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62)
    thump.connect(thumpGain)
    thumpGain.connect(out)
    puff.start(now + 0.28)
    thump.start(now + 0.29)
    stopAll([puff, thump], now + 1)
  } else {
    // The fade: a soft falling shimmer.
    const tone = context.createOscillator()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(880, now)
    tone.frequency.exponentialRampToValueAtTime(220, now + 2)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.15)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2)
    tone.connect(gain)
    gain.connect(out)
    tone.start(now)
    stopAll([tone], now + 2.05)
  }
}
