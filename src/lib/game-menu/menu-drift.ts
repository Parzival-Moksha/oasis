// The camera's slow drift behind the main menu, as plain maths (no three.js, no DOM).
//
// The whole move is one rigid rotation about a vertical axis through a pivot some metres ahead:
// the camera slides along a horizontal circle around the pivot and yaws by the same angle, so the
// pivot stays where it was on screen and the horizon never tilts. The angle is the only state.
//   - While the menu is open the angle follows `stepDrift`: about 1 m/s along the arc, eased in,
//     eased around at the ends of a half circle (a quarter each side of where it started) and
//     wherever a probe says the way ahead is blocked.
//   - When the menu closes the angle runs back to zero in under a second along the same arc, so
//     the way back is a way the camera has already been: nothing new can be in it.

export interface DriftConfig {
  /** Cruise speed along the arc, metres a second. */
  speed: number
  /** Time constant of every speed change, seconds: larger is softer. */
  ease: number
  /** How far the pivot is ahead of the character (or of the camera when there is no character). */
  pivotAhead: number
  /** The arc never bends around a pivot closer than this. */
  minRadius: number
  /** Largest turn to either side, radians (a quarter turn each way is the owner's half circle). */
  maxAngle: number
  /** Height the camera gently gains and loses along the way, metres. */
  bobHeight: number
  /** Arc metres for one full up-and-down of that bob. */
  bobLength: number
  /** The camera stays at least this far above the ground. */
  groundClearance: number
  /** Seconds for the way back when the menu closes. */
  returnSeconds: number
}

export const DRIFT: DriftConfig = {
  speed: 1,
  ease: 0.6,
  pivotAhead: 10,
  minRadius: 4,
  maxAngle: Math.PI / 2,
  bobHeight: 0.3,
  bobLength: 26,
  groundClearance: 0.6,
  returnSeconds: 0.9,
}

export interface DriftState {
  /** Signed distance travelled along the arc from the start, metres. */
  s: number
  /** Speed along the arc, metres a second (signed). */
  v: number
  /** Which way it is heading. */
  dir: 1 | -1
  /** The stretch of arc it may use. */
  min: number
  max: number
}

export function startDrift(radius: number, dir: 1 | -1, config: DriftConfig = DRIFT): DriftState {
  const reach = config.maxAngle * Math.max(radius, config.minRadius)
  return { s: 0, v: 0, dir, min: -reach, max: reach }
}

/** Distance it takes to turn around: where the heading flips, before the end of the allowed arc. */
function turnDistance(config: DriftConfig): number {
  return config.speed * config.ease * 1.5
}

/** One step of the drift. Speed changes are exponential eases, so there is never a jolt. */
export function stepDrift(state: DriftState, dt: number, config: DriftConfig = DRIFT): DriftState {
  if (!(dt > 0)) return state
  const step = Math.min(dt, 0.1)
  const turn = turnDistance(config)
  let dir = state.dir
  const room = state.max - state.min
  let target: number
  if (room < turn * 2) {
    // Boxed in: settle in the middle of what little room there is.
    const middle = (state.min + state.max) / 2
    target = Math.max(-config.speed, Math.min(config.speed, (middle - state.s) / config.ease)) * 0.5
  } else {
    if (dir === 1 && state.max - state.s < turn) dir = -1
    else if (dir === -1 && state.s - state.min < turn) dir = 1
    target = dir * config.speed
  }
  const v = state.v + (target - state.v) * (1 - Math.exp(-step / config.ease))
  let s = state.s + v * step
  let outV = v
  if (s > state.max) { s = state.max; outV = Math.min(0, v) }
  if (s < state.min) { s = state.min; outV = Math.max(0, v) }
  return { s, v: outV, dir, min: state.min, max: state.max }
}

/**
 * Something is in the way `ahead` metres along the heading (a wall, a tree): the allowed arc ends
 * short of it, so the drift eases to a stop and heads back the other way.
 */
export function blockDrift(state: DriftState, ahead: number, margin = 0.5): DriftState {
  const heading = state.v !== 0 ? Math.sign(state.v) : state.dir
  const limit = Math.max(0, ahead - margin)
  if (heading > 0) return { ...state, max: Math.min(state.max, state.s + limit) }
  return { ...state, min: Math.max(state.min, state.s - limit) }
}

export function driftAngle(s: number, radius: number, config: DriftConfig = DRIFT): number {
  return s / Math.max(radius, config.minRadius)
}

/** Height gained at arc distance `s`: zero at the start, never below it, at most `bobHeight`. */
export function driftBob(s: number, config: DriftConfig = DRIFT): number {
  return config.bobHeight * 0.5 * (1 - Math.cos((2 * Math.PI * s) / config.bobLength))
}

export interface Vec3Like { x: number; y: number; z: number }

/** A point turned by `angle` about the vertical axis through `pivot`. */
export function rotateAboutPivot(point: Vec3Like, pivot: Vec3Like, angle: number): Vec3Like {
  const dx = point.x - pivot.x
  const dz = point.z - pivot.z
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Same sense as THREE.Vector3.applyAxisAngle((0,1,0), angle).
  return { x: pivot.x + dx * cos + dz * sin, y: point.y, z: pivot.z - dx * sin + dz * cos }
}

/**
 * The pivot: `ahead` metres along the camera's view direction flattened to the ground plane,
 * measured from `from` (the character in third person, the camera otherwise). Looking straight
 * down has no flat direction, so the camera's own up-on-screen direction is the caller's fallback.
 */
export function driftPivot(from: Vec3Like, forward: Vec3Like, ahead: number): Vec3Like | null {
  const length = Math.hypot(forward.x, forward.z)
  if (length < 0.05) return null
  return { x: from.x + (forward.x / length) * ahead, y: from.y, z: from.z + (forward.z / length) * ahead }
}

export function horizontalDistance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** Ease for the way back: starts and ends at rest. */
export function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** How much of the drift is left `elapsed` seconds into the way back: 1 at the start, 0 at the end. */
export function returnRemainder(elapsed: number, config: DriftConfig = DRIFT): number {
  return 1 - easeInOutCubic(elapsed / config.returnSeconds)
}

/** Camera height kept above the ground under it. */
export function clearGround(y: number, groundY: number, config: DriftConfig = DRIFT): number {
  return Math.max(y, groundY + config.groundClearance)
}
