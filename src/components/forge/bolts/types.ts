// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT-BOLT TYPES — shared shape for every bolt design (firebolt / lightning
// / ice). One CombatBoltLayer dispatcher delegates to a per-design module,
// each implementing this contract.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type * as THREE from 'three'

/** Static, no-trailing collision target — same shape FireboltLayer uses. */
export interface CollisionTarget {
  id: string
  position: [number, number, number]
  radius: number
}

/** Result returned by the per-spell server endpoint (e.g. POST /api/profile/spells/firebolt). */
export interface SpellCastResponse {
  ok?: boolean
  error?: string
  progression?: unknown
  spell?: {
    id?: string
    cost?: number
    damage?: number
    speedMetersPerSecond?: number
    trial?: boolean
    locked?: boolean
  }
}

/** Result of an impact — drives XP award + hit marker logic. */
export interface BoltImpact {
  position: [number, number, number]
  target: CollisionTarget | null
}

/** Casting context passed into each design's spawn function. */
export interface BoltCastContext {
  origin: THREE.Vector3
  direction: THREE.Vector3
  speed: number
  damage: number
  /** Per-cast deterministic seed (cast-time epoch ms) for repeatable randomness. */
  seed: number
}

/** Spell identifier used by CombatBoltLayer for dispatch. */
export type CombatSpellId = 'firebolt' | 'lightning-bolt' | 'ice-bolt'

/** What the dispatcher receives from settings: which sub-design is armed. */
export type BoltDesignLetter = 'A' | 'B' | 'C' | 'D'
