// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT-BOLT SHARED — collision target gathering, mana/XP wiring, RP1 gate.
// Ported verbatim from FireboltLayer so every bolt design uses identical
// hit/cost/award semantics. DO NOT change the constants without checking
// recordFireboltTargetHit & ProfileFirebolt route — they're load-bearing.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'
import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { QUEST_ZERO_WORLD_ID } from '@/lib/portal-gates'
import { useAudioManager } from '@/lib/audio-manager'
import { getLatestPlayers, getLocalSessionId, getPvpEnabled } from '@/lib/pvp-bridge'
import type { CollisionTarget } from './types'

// ─═̷─═̷─ⓘ─═̷─═̷─ CONSTANTS — keep aligned with FireboltLayer ─═̷─═̷─ⓘ─═̷─═̷─
export const BOLT_DEFAULT_TTL_S = 1.75
export const BOLT_DEFAULT_COOLDOWN_MS = 170
export const BOLT_ARMING_DISTANCE_M = 1.35
export const BOLT_GROUND_ARMING_DISTANCE_M = 3.4
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

// ─═̷─═̷─📍 POSITION/SCALE RESOLUTION — same as FireboltLayer ─═̷─═̷─📍
function resolvePosition(
  id: string,
  fallback: [number, number, number] | undefined,
  transforms: Record<string, { position?: [number, number, number] } | undefined>,
): [number, number, number] | null {
  return transforms[id]?.position || fallback || null
}

function resolveScale(
  id: string,
  fallback: number | undefined,
  transforms: Record<string, { scale?: number | [number, number, number] } | undefined>,
): number {
  const scale = transforms[id]?.scale
  if (typeof scale === 'number') return scale
  if (Array.isArray(scale)) return Math.max(scale[0] || 1, scale[1] || 1, scale[2] || 1)
  return fallback || 1
}

export function collectCollisionTargets(): CollisionTarget[] {
  const state = useOasisStore.getState()
  const transforms = state.transforms
  const targets: CollisionTarget[] = []

  for (const asset of state.conjuredAssets) {
    if (!state.worldConjuredAssetIds.includes(asset.id)) continue
    const position = resolvePosition(asset.id, asset.position, transforms)
    if (!position) continue
    const scale = resolveScale(asset.id, asset.scale, transforms)
    targets.push({ id: asset.id, position, radius: Math.max(0.75, scale * 0.9) })
  }

  for (const asset of state.placedCatalogAssets) {
    const position = resolvePosition(asset.id, asset.position, transforms)
    if (!position) continue
    const scale = resolveScale(asset.id, asset.scale, transforms)
    targets.push({ id: asset.id, position, radius: Math.max(0.75, scale * 0.9) })
  }

  for (const scene of state.craftedScenes) {
    const position = resolvePosition(scene.id, scene.position, transforms)
    if (!position) continue
    targets.push({
      id: scene.id,
      position,
      radius: Math.max(1.4, 1.6 + Math.sqrt(scene.objects.length) * 0.28),
    })
  }

  for (const text of state.text3dObjects) {
    const position = resolvePosition(text.id, text.position, transforms)
    if (!position) continue
    targets.push({ id: text.id, position, radius: Math.max(0.9, text.size * 1.8) })
  }

  // ─═̷─ PvP: add peer-player capsules so bolts can hit other wizards. ─═̷─
  // Only in PvP-enabled worlds, only OTHER players (not self), only ALIVE.
  // The id prefix `pvp:` lets CombatBoltLayer route the hit to sendPvpReportHit
  // instead of quest progression / firebolt-hit events.
  if (getPvpEnabled()) {
    const localSessionId = getLocalSessionId()
    for (const player of getLatestPlayers()) {
      if (!player.alive) continue
      if (player.sessionId === localSessionId) continue
      // Wizard hitbox: a ~0.6m capsule centered on the avatar's chest
      // (~1.2m above their foot position). Slightly generous to feel fair
      // on shaky home wifi; cheating clients are blocked server-side anyway.
      targets.push({
        id: `pvp:${player.sessionId}`,
        position: [player.position[0], player.position[1], player.position[2]],
        radius: 0.7,
      })
    }
  }

  return targets
}

// ─═̷─═̷─📐 GEOMETRY HIT HELPERS ─═̷─═̷─📐
export function segmentSphereHit(
  start: THREE.Vector3,
  end: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const segment = end.clone().sub(start)
  const lengthSq = segment.lengthSq()
  if (lengthSq <= 0) return null
  const t = THREE.MathUtils.clamp(center.clone().sub(start).dot(segment) / lengthSq, 0, 1)
  const closest = start.clone().addScaledVector(segment, t)
  return closest.distanceTo(center) <= radius ? closest : null
}

export function groundHit(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 | null {
  if (start.y < 0.05 && end.y < 0.05) return null
  if (start.y >= 0.05 && end.y <= 0.05) {
    const t = start.y / Math.max(0.0001, start.y - end.y)
    return start.clone().lerp(end, THREE.MathUtils.clamp(t, 0, 1))
  }
  return null
}

export function armedSegment(
  start: THREE.Vector3,
  end: THREE.Vector3,
  previousDistance: number,
  nextDistance: number,
  armingDistance = BOLT_ARMING_DISTANCE_M,
): { start: THREE.Vector3; end: THREE.Vector3 } | null {
  if (nextDistance < armingDistance) return null
  if (previousDistance >= armingDistance) return { start, end }
  const segmentDistance = nextDistance - previousDistance
  if (segmentDistance <= 0) return null
  const t = THREE.MathUtils.clamp((armingDistance - previousDistance) / segmentDistance, 0, 1)
  return { start: start.clone().lerp(end, t), end }
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

// ─═̷─═̷─🎤 ORIGIN PROBE — same camera/avatar logic FireboltLayer uses ─═̷─═̷─🎤
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'

export function resolveCastOriginAndDirection(camera: THREE.Camera): {
  origin: THREE.Vector3
  direction: THREE.Vector3
} {
  const origin = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()

  camera.getWorldDirection(direction).normalize()
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()

  const pose = getPlayerAvatarPose()
  const isThirdPerson = Boolean(pose && useInputManager.getState().inputState === 'third-person')
  if (isThirdPerson) {
    direction.y = THREE.MathUtils.clamp(direction.y, -0.04, 0.32)
    direction.normalize()
  }
  if (pose && isThirdPerson) {
    const [px, py, pz] = pose.position
    const [fx, , fz] = pose.forward
    const poseForward = new THREE.Vector3(fx, 0, fz).normalize()
    const poseRight = new THREE.Vector3(poseForward.z, 0, -poseForward.x).normalize()
    origin.set(px, py + 1.22, pz)
      .addScaledVector(poseForward, 0.62)
      .addScaledVector(poseRight, 0.28)
  } else {
    camera.getWorldPosition(origin)
    origin
      .addScaledVector(direction, 0.86)
      .addScaledVector(right, 0.24)
      .addScaledVector(up, -0.16)
  }

  return { origin, direction }
}

/**
 * Ray-cast the player's aim down to the ground plane (y=0). Used by the
 * Thunderbolt (D) design to telegraph its strike point and place its trunk.
 * Returns null if the aim is parallel-or-up.
 */
export function aimedGroundPoint(camera: THREE.Camera, maxDistance = 30): THREE.Vector3 | null {
  const { origin, direction } = resolveCastOriginAndDirection(camera)
  if (Math.abs(direction.y) < 1e-3 || direction.y >= 0) {
    // Aim is upward or parallel — pick a point in front at 8m and drop to y=0.
    const forward = direction.clone()
    forward.y = 0
    forward.normalize()
    return origin.clone().addScaledVector(forward, 8).setY(0)
  }
  const t = -origin.y / direction.y
  if (t < 0 || t > maxDistance) return null
  return origin.clone().addScaledVector(direction, t).setY(0)
}
