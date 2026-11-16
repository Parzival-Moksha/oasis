// ░▒▓ THE COUNCIL — where everyone stands around the fire ▓▒░
// Pure geometry for the weekly meeting (docs/missions/council.md): the agents take fixed places on a circle
// around a point, facing it; the owner's place in the circle is left free; one at a time an agent steps
// forward toward the fire, speaks, and steps back. The walking is village-follow.ts (stepStage), the scene
// is run by components/village/village-council.ts.

export const COUNCIL = {
  /** The circle is at least this wide (a fire, and room to step forward). */
  minRadius: 3.2,
  /** Neighbours on the circle stand at least this far apart. */
  spacing: 1.7,
  /** A speaker steps this far toward the fire. */
  step: 1.3,
  /** Stepping forward and back is a calm walk (m/s); gathering from the desks is the usual pace. */
  walkSpeed: 1.5,
} as const

export interface CouncilPoint {
  x: number
  z: number
}

export interface CouncilPlace extends CouncilPoint {
  /** Facing the centre (0 = +Z, like a station's rotationY). */
  yaw: number
}

/** The radius for `count` agents (plus the owner's place when `withOwner`): what was asked for, but never crowded. */
export function councilRadius(count: number, withOwner: boolean, wanted?: number | null): number {
  const places = Math.max(1, count + (withOwner ? 1 : 0))
  const needed = (COUNCIL.spacing * places) / (2 * Math.PI)
  const asked = typeof wanted === 'number' && Number.isFinite(wanted) && wanted > 0 ? wanted : COUNCIL.minRadius
  return Math.max(asked, needed, 1.5)
}

/** The angle of a point as seen from the centre (0 = +Z, growing toward +X). */
export function councilAngle(center: CouncilPoint, point: CouncilPoint): number {
  return Math.atan2(point.x - center.x, point.z - center.z)
}

/**
 * A place for each of `count` agents on the circle, in order, each facing the centre. With `ownerAngle`
 * (where the owner stands, seen from the centre) the circle has one place more and that one stays free,
 * so the owner is part of the circle; the agents fill the rest evenly, clockwise from the owner's left.
 */
export function councilPlaces(count: number, center: CouncilPoint, radius: number, ownerAngle: number | null = null): CouncilPlace[] {
  const n = Math.max(0, Math.floor(count))
  const total = n + (ownerAngle === null ? 0 : 1)
  const places: CouncilPlace[] = []
  for (let i = 0; i < n; i += 1) {
    const angle = ownerAngle === null ? (2 * Math.PI * i) / Math.max(1, total) : ownerAngle + (2 * Math.PI * (i + 1)) / total
    const x = center.x + Math.sin(angle) * radius
    const z = center.z + Math.cos(angle) * radius
    places.push({ x, z, yaw: Math.atan2(center.x - x, center.z - z) })
  }
  return places
}

/** Where a speaker stands: `step` metres from its place toward the centre (never past it). */
export function councilFront(place: CouncilPoint, center: CouncilPoint, step: number = COUNCIL.step): CouncilPoint {
  const dx = center.x - place.x
  const dz = center.z - place.z
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-6) return { x: place.x, z: place.z }
  const reach = Math.min(Math.max(0, step), Math.max(0, distance - 0.8))
  return { x: place.x + (dx / distance) * reach, z: place.z + (dz / distance) * reach }
}

/** How long a clip takes to say: its own length at the player's rate. */
export function spokenSeconds(clipSeconds: number, playbackRate: number): number {
  if (!(clipSeconds > 0)) return 0
  return Math.round((clipSeconds / Math.max(0.25, playbackRate || 1)) * 100) / 100
}
