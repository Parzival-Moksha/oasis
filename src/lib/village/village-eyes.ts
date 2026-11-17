// ░▒▓ VILLAGE EYES — where an agent's own camera sits and what it looks at ▓▒░
// Pure math, no three.js. VillageEyes.tsx renders the scene once from this pose when the owner sends the
// agent a message, and the engine attaches the picture to that message (packages/oasis-agent-engine, agent.js).

import type { Vec3 } from './village-layout'

/** The picture: wide, small enough to cost a few hundred tokens (800 x 450 is about 480). */
export const EYES_PICTURE = { width: 800, height: 450, fov: 100, quality: 0.72 }

const EYE_HEIGHT = 1.6
/** In front of the face and past the desk monitor, so neither its own head nor the monitor's back fills the picture. */
const EYE_FORWARD = 0.85
/** How far the head turns toward the owner. With the wide lens the owner stays in frame well past this. */
const MAX_TURN = (75 * Math.PI) / 180
const MAX_LOOK_UP = 0.35
const MAX_LOOK_DOWN = 0.45
/** With nobody to look at: a little down, toward the plaza floor. */
const REST_PITCH = -0.12
const OWNER_MIN = 1
const OWNER_MAX = 60

export interface EyesPose {
  position: Vec3
  target: Vec3
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
/** Angle difference folded into -PI .. PI. */
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

/**
 * @param station where the agent's avatar stands (anchor, terrain height included) and the desk's yaw; its
 *                local +Z faces the plaza
 * @param ownerHead the owner's head or camera, when known: the agent turns toward it, up to MAX_TURN
 */
export function computeEyesPose(station: { anchor: Vec3; rotationY: number }, ownerHead?: Vec3 | null): EyesPose {
  const forward = station.rotationY
  const position: Vec3 = [
    station.anchor[0] + Math.sin(forward) * EYE_FORWARD,
    station.anchor[1] + EYE_HEIGHT,
    station.anchor[2] + Math.cos(forward) * EYE_FORWARD,
  ]
  let yaw = forward
  let pitch = REST_PITCH
  if (ownerHead && ownerHead.every(Number.isFinite)) {
    const dx = ownerHead[0] - position[0]
    const dz = ownerHead[2] - position[2]
    const distance = Math.hypot(dx, dz)
    if (distance > OWNER_MIN && distance < OWNER_MAX) {
      yaw = forward + clamp(wrap(Math.atan2(dx, dz) - forward), -MAX_TURN, MAX_TURN)
      pitch = clamp(Math.atan2(ownerHead[1] - position[1], distance), -MAX_LOOK_DOWN, MAX_LOOK_UP)
    }
  }
  const reach = 5
  return {
    position,
    target: [
      position[0] + Math.sin(yaw) * Math.cos(pitch) * reach,
      position[1] + Math.sin(pitch) * reach,
      position[2] + Math.cos(yaw) * Math.cos(pitch) * reach,
    ],
  }
}

// ─── pictures on request (engine `view` command, scripts/me.mjs) ─────────────

/** Its own avatar from the front: upright, the whole body. */
export const LOOK_PICTURE = { width: 512, height: 640, fov: 40, quality: 0.82 }
/** What is around it: four of these, one per side. */
export const AROUND_PICTURE = { width: 640, height: 360, fov: 95, quality: 0.72 }

/**
 * The camera that looks at the agent's avatar from the front: a little to one side so a desk monitor is not in
 * the way, far enough for a tall body (2.7 m of height fit), and from above so a desk hides little of it.
 * `station`: where the avatar stands now (anchor) and which way it faces.
 */
export function computeLookPose(station: { anchor: Vec3; rotationY: number }): EyesPose {
  const forward: Vec3 = [Math.sin(station.rotationY), 0, Math.cos(station.rotationY)]
  const side: Vec3 = [Math.cos(station.rotationY), 0, -Math.sin(station.rotationY)]
  return {
    position: [
      station.anchor[0] + forward[0] * 3.4 + side[0] * 0.9,
      station.anchor[1] + 2.2,
      station.anchor[2] + forward[2] * 3.4 + side[2] * 0.9,
    ],
    target: [station.anchor[0], station.anchor[1] + 1.1, station.anchor[2]],
  }
}

export const AROUND_LABELS = ['ahead', 'right', 'behind', 'left'] as const

/** Four cameras at the avatar's head, each a step out in its own direction so its body is never in the picture. */
export function computeAroundPoses(station: { anchor: Vec3; rotationY: number }): Array<EyesPose & { label: (typeof AROUND_LABELS)[number] }> {
  return AROUND_LABELS.map((label, index) => {
    // The avatar faces +Z at rotationY 0 and its right hand is -X: each quarter turn to the right subtracts 90°.
    const yaw = station.rotationY - index * (Math.PI / 2)
    const dx = Math.sin(yaw)
    const dz = Math.cos(yaw)
    const position: Vec3 = [station.anchor[0] + dx * 0.6, station.anchor[1] + EYE_HEIGHT, station.anchor[2] + dz * 0.6]
    return { label, position, target: [position[0] + dx * 5, position[1] - 0.5, position[2] + dz * 5] }
  })
}
