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
