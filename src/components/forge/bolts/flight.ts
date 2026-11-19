// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// BOLT FLIGHT — the one projectile path every flying bolt shares (fire, lightning, ice).
//
// The world is still while a bolt flies, so where it will hit the world is known at the cast
// (aim.ts casts a ray into the real meshes, the terrain and the ground): the bolt carries that
// distance and explodes exactly there. Only things that move (village agents, PvP players) are
// tested while it flies, as spheres. A bolt that meets nothing fades out at its range: no
// explosion in the sky.
// Pure: no React, no scene. Tested in __tests__/flight.test.ts.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { CombatSpellId } from './types'

export type Vec3 = [number, number, number]

/** Something that moves and can be hit: a sphere around its chest. */
export interface ActorTarget {
  id: string
  center: Vec3
  radius: number
}

export interface FlyingBolt {
  id: string
  spell: CombatSpellId
  /** Design letter (A/B/C): which look renders it. */
  design: string
  origin: Vec3
  position: Vec3
  velocity: Vec3
  distance: number
  age: number
  ttl: number
  damage: number
  trailCarry: number
  /** Distance from origin to the world surface it will hit; null = nothing in range. */
  impactDistance: number | null
  /** World object (oasisObjectId) at that surface, if any. */
  impactObjectId: string | null
  /** Cast by this client (PvP: only the caster reports hits; its own capsule is never a target). */
  local: boolean
}

export interface BoltImpact {
  position: Vec3
  /** Object or actor id it hit; null for bare ground or terrain. */
  targetId: string | null
  actor: boolean
}

export interface BoltStep {
  /** The bolt after this frame, or null when it is gone. */
  bolt: FlyingBolt | null
  trail: Vec3[]
  impact: BoltImpact | null
}

export const BOLT_MAX_RANGE_M = 90
/** Extra life past the impact so a bolt never dies a frame short of its target. */
const TTL_SLACK_S = 0.15
/** An actor whose sphere holds the bolt's origin is the caster (or touching it): never a target. */
const OWN_CAPSULE_MARGIN_M = 0.35

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function len(a: Vec3): number { return Math.sqrt(dot(a, a)) }
function along(origin: Vec3, dir: Vec3, t: number): Vec3 { return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] }

export function normalize(v: Vec3): Vec3 {
  const l = len(v)
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, -1]
}

/** How long a bolt lives: long enough to reach its impact (or its range), never less than the old 1.75 s. */
export function boltTtlFor(speed: number, impactDistance: number | null): number {
  const reach = impactDistance ?? BOLT_MAX_RANGE_M
  return Math.max(1.75, reach / Math.max(1, speed) + TTL_SLACK_S)
}

export function createBolt(args: {
  id: string
  spell: CombatSpellId
  design: string
  origin: Vec3
  direction: Vec3
  speed: number
  damage: number
  impactDistance: number | null
  impactObjectId: string | null
  local: boolean
}): FlyingBolt {
  const dir = normalize(args.direction)
  return {
    id: args.id,
    spell: args.spell,
    design: args.design,
    origin: [...args.origin] as Vec3,
    position: [...args.origin] as Vec3,
    velocity: [dir[0] * args.speed, dir[1] * args.speed, dir[2] * args.speed],
    distance: 0,
    age: 0,
    ttl: boltTtlFor(args.speed, args.impactDistance),
    damage: args.damage,
    trailCarry: 0,
    impactDistance: args.impactDistance,
    impactObjectId: args.impactObjectId,
    local: args.local,
  }
}

/**
 * Where a segment first enters a sphere, as a distance along the segment from `start`, or null.
 * A segment that starts inside the sphere counts as entering at 0.
 */
export function segmentSphereEntry(start: Vec3, dir: Vec3, length: number, center: Vec3, radius: number): number | null {
  const oc = sub(start, center)
  const b = dot(oc, dir)
  const c = dot(oc, oc) - radius * radius
  if (c <= 0) return 0
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t >= 0 && t <= length ? t : null
}

/** Moves a bolt one frame: trail points, the impact if it reaches one, or its quiet end at its range. */
export function stepBolt(bolt: FlyingBolt, delta: number, actors: ActorTarget[], trailSpacingM: number): BoltStep {
  const speed = len(bolt.velocity)
  const dir = normalize(bolt.velocity)
  const stepLength = speed * Math.max(0, delta)
  const start = bolt.position
  const startDistance = bolt.distance

  // The nearest thing this step reaches: the known world surface, or a moving actor.
  let hitAt: number | null = null
  let impact: BoltImpact | null = null
  if (bolt.impactDistance !== null && startDistance + stepLength >= bolt.impactDistance) {
    hitAt = Math.max(0, bolt.impactDistance - startDistance)
    // Bolts fly straight, so the surface point is exactly origin + direction * impactDistance.
    impact = { position: along(bolt.origin, dir, bolt.impactDistance), targetId: bolt.impactObjectId, actor: false }
  }
  for (const actor of actors) {
    if (len(sub(bolt.origin, actor.center)) < actor.radius + OWN_CAPSULE_MARGIN_M) continue
    const t = segmentSphereEntry(start, dir, stepLength, actor.center, actor.radius)
    if (t !== null && (hitAt === null || t < hitAt)) {
      hitAt = t
      impact = { position: along(start, dir, t), targetId: actor.id, actor: true }
    }
  }

  const travelled = hitAt ?? stepLength
  const end = along(start, dir, travelled)

  // Trail points every `trailSpacingM` along the path, carried across frames.
  const trail: Vec3[] = []
  const carried = bolt.trailCarry + travelled
  const count = trailSpacingM > 0 ? Math.floor(carried / trailSpacingM) : 0
  for (let i = 0; i < count; i += 1) {
    const d = (trailSpacingM - bolt.trailCarry) + i * trailSpacingM
    if (d < 0 || d > travelled) continue
    trail.push(along(start, dir, d))
  }

  if (impact) return { bolt: null, trail, impact }

  const age = bolt.age + delta
  if (age >= bolt.ttl || bolt.distance + travelled >= BOLT_MAX_RANGE_M + 1) return { bolt: null, trail, impact: null }

  return {
    bolt: {
      ...bolt,
      age,
      position: end,
      distance: startDistance + travelled,
      trailCarry: trailSpacingM > 0 ? carried % trailSpacingM : 0,
    },
    trail,
    impact: null,
  }
}
