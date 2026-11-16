// Hips movement for retargeted avatar animations, as plain maths.
//
// Every clip loader used to throw the hips' position track away, so an avatar's hips hung at
// T-pose height on every frame of every clip: the knees of an idle bend with nothing coming down,
// so the feet lift and slide; a breakdance floats; a dance turns on the spot. This module keeps
// that movement in a form any avatar can use:
//   1. `captureHipsDeltas`: the source clip's hips positions become offsets from the source rig's
//      rest pose, in world axes, measured in "hips heights" (so a tall and a short avatar both get
//      the right amount).
//   2. `detrendTravel`: the steady travel across the clip (a walk filmed walking forward, a dance
//      that ends a metre from where it began) is taken out so the loop closes, and handed back as
//      `travel` for whoever owns the character's position to apply. The sway and bounce stay.
//   3. `hipsTrackValues`: offsets become an absolute position track for one avatar's hips.

export interface HipsMotion {
  times: Float32Array
  /** xyz per key: offset from the rest pose in world axes, in units of the source rig's hips height. */
  deltas: Float32Array
  /** Net travel over the whole clip that was removed from `deltas`, in hips heights (x, z). */
  travel: { x: number; z: number }
  duration: number
}

/**
 * @param times       key times
 * @param positions   hips local positions, xyz per key (the clip's raw track)
 * @param restLocal   the hips' local position in the rig's rest pose
 * @param parentBasis the hips' parent's world rotation and scale as a column-major 3x3 (THREE.Matrix3.elements)
 * @param restHeight  the hips' world height in the rest pose, in the rig's world units
 */
export function captureHipsDeltas(
  times: ArrayLike<number>,
  positions: ArrayLike<number>,
  restLocal: readonly [number, number, number],
  parentBasis: ArrayLike<number>,
  restHeight: number,
): { times: Float32Array; deltas: Float32Array } | null {
  const keys = Math.min(times.length, Math.floor(positions.length / 3))
  if (keys < 1 || !(Math.abs(restHeight) > 1e-6)) return null
  const m = parentBasis
  const deltas = new Float32Array(keys * 3)
  for (let i = 0; i < keys; i++) {
    const x = positions[i * 3] - restLocal[0]
    const y = positions[i * 3 + 1] - restLocal[1]
    const z = positions[i * 3 + 2] - restLocal[2]
    const wx = (m[0] * x + m[3] * y + m[6] * z) / restHeight
    const wy = (m[1] * x + m[4] * y + m[7] * z) / restHeight
    const wz = (m[2] * x + m[5] * y + m[8] * z) / restHeight
    if (!Number.isFinite(wx + wy + wz)) return null
    deltas[i * 3] = wx
    deltas[i * 3 + 1] = wy
    deltas[i * 3 + 2] = wz
  }
  return { times: Float32Array.from({ length: keys }, (_, i) => times[i]), deltas }
}

/**
 * Take the steady sideways and forward travel out of the offsets, so the last key lines up with the
 * first and a looping clip does not jump. Height is left alone: a character that ends on the floor
 * ends on the floor.
 */
export function detrendTravel(times: ArrayLike<number>, deltas: Float32Array): { deltas: Float32Array; travel: { x: number; z: number } } {
  const keys = Math.min(times.length, Math.floor(deltas.length / 3))
  const out = Float32Array.from(deltas)
  if (keys < 2) return { deltas: out, travel: { x: 0, z: 0 } }
  const t0 = times[0]
  const span = times[keys - 1] - t0
  const travel = { x: deltas[(keys - 1) * 3] - deltas[0], z: deltas[(keys - 1) * 3 + 2] - deltas[2] }
  if (!(span > 0)) return { deltas: out, travel: { x: 0, z: 0 } }
  for (let i = 0; i < keys; i++) {
    const k = (times[i] - t0) / span
    out[i * 3] -= travel.x * k
    out[i * 3 + 2] -= travel.z * k
  }
  return { deltas: out, travel }
}

/**
 * Slide the whole clip sideways so it starts over the character's own spot. Some dances begin a
 * step away from the rig's origin; without this the body would glide there as the clip fades in.
 */
export function recenterStart(deltas: Float32Array): Float32Array {
  const out = Float32Array.from(deltas)
  if (out.length < 3) return out
  const x0 = out[0]
  const z0 = out[2]
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= x0
    out[i + 2] -= z0
  }
  return out
}

/**
 * The position track for one avatar: its own rest position plus the offsets scaled to its size.
 * VRM 0.x avatars face the other way round the vertical, so x and z flip (as for rotations).
 */
export function hipsTrackValues(
  deltas: Float32Array,
  avatarRest: readonly [number, number, number],
  avatarHipsHeight: number,
  flipXZ: boolean,
): Float32Array {
  const out = new Float32Array(deltas.length)
  const sign = flipXZ ? -1 : 1
  for (let i = 0; i < deltas.length; i += 3) {
    out[i] = avatarRest[0] + sign * deltas[i] * avatarHipsHeight
    out[i + 1] = avatarRest[1] + deltas[i + 1] * avatarHipsHeight
    out[i + 2] = avatarRest[2] + sign * deltas[i + 2] * avatarHipsHeight
  }
  return out
}

/** A clip's steady travel for one avatar, metres a second in the avatar's own axes (x right, z forward). */
export function travelVelocity(motion: Pick<HipsMotion, 'travel' | 'duration'>, avatarHipsHeight: number): { x: number; z: number } {
  if (!(motion.duration > 0)) return { x: 0, z: 0 }
  return {
    x: (motion.travel.x * avatarHipsHeight) / motion.duration,
    z: (motion.travel.z * avatarHipsHeight) / motion.duration,
  }
}

/**
 * Ground-plane offset of the hips from where the character "is", turned from the character's own
 * axes into world axes by its facing angle (a rotation about the vertical, as THREE's rotation.y).
 */
export function localToWorldXZ(x: number, z: number, facing: number): { x: number; z: number } {
  const cos = Math.cos(facing)
  const sin = Math.sin(facing)
  return { x: x * cos + z * sin, z: -x * sin + z * cos }
}
