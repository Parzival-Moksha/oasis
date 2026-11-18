// ░▒▓ VILLAGE STAGE — a world where only a scene's cast shows (the Council's campfire world) ▓▒░
// The owner (2026-11-18): "I definitely want its own world… we enter the portal, and only those agents that we
// want at the council will be there. But the rest of the world should remain like this."
// A world whose name says "Council" is a stage: no desks, no plaza, no mission wall, no skill tree, no helpers,
// no agents, until a Council starts there. Then its cast comes out of the dark (a few metres behind each one's
// place on the circle) and walks in; when it ends they walk back out and are gone. Pure, so it can be tested.

import { STATION, type Vec3 } from './village-layout'

/** A world with "Council" in its name ("The Council", "Council fire") is a stage. */
export const STAGE_WORLD_NAME = /\bcouncil\b/i

export function isStageWorldName(name: string | null | undefined): boolean {
  return typeof name === 'string' && STAGE_WORLD_NAME.test(name)
}

export const STAGE = {
  /** How far behind its place on the circle a cast member appears (out of the fire's light). */
  arriveDistance: 6,
  /** After the Council ends: time to walk back out before the cast is gone. */
  leaveMs: 7000,
} as const

/** Where a cast member appears and which way it faces (the fire): `distance` straight out from its place. */
export function stageArrival(place: { x: number; z: number }, center: { x: number; z: number }, distance: number = STAGE.arriveDistance): { x: number; z: number; yaw: number } {
  let dx = place.x - center.x
  let dz = place.z - center.z
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) { dx = 0; dz = 1 } else { dx /= length; dz /= length }
  // Facing the fire: from the arrival spot towards the centre.
  return { x: place.x + dx * distance, z: place.z + dz * distance, yaw: Math.atan2(-dx, -dz) }
}

/**
 * A station (position + rotationY) whose avatar spot (STATION.avatar) is `anchor`, facing `yaw`: what a desk
 * station is in the village, without the desk.
 */
export function stationAtAnchor(anchor: Vec3, yaw: number): { position: Vec3; rotationY: number; anchor: Vec3 } {
  const [lx, , lz] = STATION.avatar
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return {
    position: [anchor[0] - (lx * c + lz * s), anchor[1], anchor[2] - (-lx * s + lz * c)],
    rotationY: yaw,
    anchor: [anchor[0], anchor[1], anchor[2]],
  }
}

// ─── the way in: through a gap between the seats ─────────────────────────────────────────────────

/** Something standing around the circle (a log, a stone): where it is and how far it reaches from there. */
export interface StageObstacle {
  x: number
  z: number
  /** Half its longest side, metres. */
  reach: number
}

/** Room a walking avatar needs on each side, metres. */
const AVATAR_HALF_WIDTH = 0.35

/** The angles (as seen from the centre) that each obstacle closes for someone walking straight in or out. */
export function blockedArcs(obstacles: readonly StageObstacle[], center: { x: number; z: number }): Array<{ angle: number; half: number }> {
  const arcs: Array<{ angle: number; half: number }> = []
  for (const obstacle of obstacles) {
    const r = Math.hypot(obstacle.x - center.x, obstacle.z - center.z)
    if (r < 0.5) continue
    const half = Math.asin(Math.min(1, (obstacle.reach + AVATAR_HALF_WIDTH) / r))
    arcs.push({ angle: Math.atan2(obstacle.x - center.x, obstacle.z - center.z), half })
  }
  return arcs
}

function angleGap(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

function isOpen(angle: number, arcs: ReadonlyArray<{ angle: number; half: number }>): boolean {
  return arcs.every(arc => angleGap(angle, arc.angle) > arc.half)
}

/**
 * The angle to walk in (and out) along for a place at `angle`: its own when nothing is in the way, else the
 * nearest open one (searched a degree at a time both ways). Its own when nothing is open at all.
 */
export function openAngle(angle: number, arcs: ReadonlyArray<{ angle: number; half: number }>): number {
  if (isOpen(angle, arcs)) return angle
  const step = Math.PI / 180
  for (let k = 1; k <= 180; k += 1) {
    if (isOpen(angle + k * step, arcs)) return angle + k * step
    if (isOpen(angle - k * step, arcs)) return angle - k * step
  }
  return angle
}

/**
 * A cast member's way onto the stage: `arrival` (where it appears, out in the dark), `door` (just inside the ring
 * of seats, on the open angle), then its place. Leaving is the same way back. Obstacles closer to the centre than
 * the place, or out beyond the arrival, are not in the way and are ignored.
 */
export function stageRoute(
  place: { x: number; z: number },
  center: { x: number; z: number },
  obstacles: readonly StageObstacle[],
  distance: number = STAGE.arriveDistance,
): { arrival: { x: number; z: number; yaw: number }; door: { x: number; z: number } | null; angle: number } {
  const placeR = Math.hypot(place.x - center.x, place.z - center.z)
  const own = Math.atan2(place.x - center.x, place.z - center.z)
  const outR = placeR + distance
  const crossing = obstacles.filter(o => {
    const r = Math.hypot(o.x - center.x, o.z - center.z)
    return r > placeR + 0.2 && r < outR - 0.2
  })
  const angle = openAngle(own, blockedArcs(crossing, center))
  const arrivalX = center.x + Math.sin(angle) * outR
  const arrivalZ = center.z + Math.cos(angle) * outR
  const arrival = { x: arrivalX, z: arrivalZ, yaw: Math.atan2(center.x - arrivalX, center.z - arrivalZ) }
  if (angleGap(angle, own) < 1e-6) return { arrival, door: null, angle }
  // Inside the ring, on the open angle: from there to its place is a step along the inside of the seats.
  const doorR = Math.max(placeR, Math.min(...crossing.map(o => Math.hypot(o.x - center.x, o.z - center.z) - o.reach)) - 0.3)
  return { arrival, door: { x: center.x + Math.sin(angle) * doorR, z: center.z + Math.cos(angle) * doorR }, angle }
}
