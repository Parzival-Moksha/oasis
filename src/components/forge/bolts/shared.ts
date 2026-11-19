// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT-BOLT SHARED — cast gating, ids, Quest Zero hit recording.
// Aim and targets live in aim.ts, flight in flight.ts.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { QUEST_ZERO_WORLD_ID } from '@/lib/portal-gates'
import { useAudioManager } from '@/lib/audio-manager'

// ─═̷─═̷─ⓘ─═̷─═̷─ CONSTANTS ─═̷─═̷─ⓘ─═̷─═̷─
export const BOLT_DEFAULT_COOLDOWN_MS = 170
export const BOLT_CAST_ANIMATION_MS = 620
export const BOLT_EXPLOSION_TTL_S = 0.82

// ─═̷─═̷─🎲 RNG / IDs ─═̷─═̷─🎲
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `bolt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Tiny deterministic PRNG (mulberry32). Each design that needs reproducible
 * geometry (thunderbolt forks, etc) gets one of these seeded from cast time.
 */
export function mulberry32(seedIn: number): () => number {
  let seed = seedIn >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─═̷─═̷─⏸ INPUT GATING — only cast when scene isn't busy ─═̷─═̷─⏸
export function canCastBolt(): boolean {
  const input = useInputManager.getState()
  const store = useOasisStore.getState()
  if (input.hasActiveUILayer()) return false
  if (input.inputState === 'agent-focus' || input.inputState === 'ui-focused') return false
  if (input.inputState === 'placement' || input.inputState === 'paint') return false
  if (store.placementPending || store.paintHeldActive) return false
  return true
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// ─═̷─═̷─🎯 QUEST-ZERO TARGET LABELLING — same regex FireboltLayer uses ─═̷─═̷─🎯
export function isQuestFireboltTarget(id: string): boolean {
  return /(^|-)quest-zero-fire-target-|training|dummy|target/i.test(id)
}

export function labelForFireboltTarget(id: string): string {
  const match = id.match(/quest-zero-fire-target-(\d+)/i)
  return match ? `Target ${match[1]} hit` : 'Hit'
}

// ─═̷─═̷─💎 XP / progression broadcast (mirrors FireboltLayer) ─═̷─═̷─💎
function emitXpAward(value: unknown) {
  if (value) window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: value }))
}

export function emitProgressionResultXp(result: unknown) {
  const record = result as {
    hitStep?: { xp?: unknown; completionXp?: unknown }
    achievement?: { xp?: unknown }
    unlockedSpell?: { xp?: unknown; achievements?: Array<{ xp?: unknown }> }
    unlockStep?: { xp?: unknown; completionXp?: unknown; completionAchievement?: { xp?: unknown } }
  } | null
  if (!record) return
  emitXpAward(record.hitStep?.xp)
  emitXpAward(record.hitStep?.completionXp)
  emitXpAward(record.achievement?.xp)
  emitXpAward(record.unlockedSpell?.xp)
  for (const achievement of record.unlockedSpell?.achievements || []) emitXpAward(achievement?.xp)
  emitXpAward(record.unlockStep?.xp)
  emitXpAward(record.unlockStep?.completionXp)
  emitXpAward(record.unlockStep?.completionAchievement?.xp)
}

/**
 * Quest-Zero hit recorder — POSTs to /api/player/progression, broadcasts
 * progression + toast + unlock side-effects. Verbatim port from FireboltLayer
 * so the firebolt-trial flow keeps working with every design (and lightning
 * /ice may later opt in).
 *
 * Pass `reported` (a Set ref) so duplicate hits on the same target don't
 * double-fire the API.
 */
export function recordQuestTargetHit(
  targetId: string,
  position: [number, number, number],
  reported: Set<string>,
) {
  const activeWorldId = useOasisStore.getState().activeWorldId
  window.dispatchEvent(new CustomEvent('oasis:firebolt-hit', { detail: { targetId, position, worldId: activeWorldId } }))
  if (activeWorldId !== QUEST_ZERO_WORLD_ID || !isQuestFireboltTarget(targetId)) return
  if (reported.has(targetId)) return
  reported.add(targetId)
  void fetch('/api/player/progression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'record_firebolt_target_hit',
      targetId,
      worldId: activeWorldId,
      position,
    }),
  })
    .then(response => response.json().catch(() => null))
    .then(data => {
      if (data?.progression) {
        window.dispatchEvent(new CustomEvent('oasis:player-progression', { detail: data.progression }))
      }
      if (data?.result?.hitCount) {
        window.dispatchEvent(new CustomEvent('oasis:quest-progress-toast', {
          detail: {
            title: labelForFireboltTarget(targetId),
            message: `${Math.min(3, data.result.hitCount)}/3 fire targets`,
            tone: 'fire',
          },
        }))
      }
      emitProgressionResultXp(data?.result)
      if (data?.result?.unlockedSpell?.newlyUnlocked || data?.result?.unlockStep?.completionXp) {
        useAudioManager.getState().play('objectiveAchieved')
        window.dispatchEvent(new CustomEvent('oasis:npc-exclaim', {
          detail: {
            npcId: 'quest-zero-fire-guardian',
            avatarId: 'agent-avatar-npc-fire-guardian',
            message: 'WELL DONE!',
            durationMs: 2400,
          },
        }))
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('oasis:realtime-disconnect-npc', {
            detail: {
              npcId: 'quest-zero-fire-guardian',
              reason: 'Fire Guardian trial complete. Voice line closed.',
            },
          }))
        }, 1800)
        window.dispatchEvent(new CustomEvent('oasis:quest-progress-toast', {
          detail: {
            title: 'Firebolt learned',
            message: 'Added to your spellbook',
            tone: 'quest',
          },
        }))
        window.dispatchEvent(new CustomEvent('oasis:spellbook-open', {
          detail: { spellId: 'firebolt' },
        }))
      }
    })
    .catch(() => {})
}
