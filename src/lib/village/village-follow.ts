// ░▒▓ VILLAGE FOLLOW — an agent that leaves its desk and walks beside the owner ▓▒░
// Pure math, no three.js. One call per frame per follower (stepFollow), no allocations: the state
// object is changed in place. Distances are on the ground plane; the caller adds terrain height.
//
// The rule (the owner's memo, 2026-11-12): further than 7 m it comes along and stops about 2.5 m
// away, facing you; closer than 1 m it steps aside; in between it stands and turns toward you.

export const FOLLOW = {
  /** Further than this from the owner: start walking after them. */
  startDistance: 7,
  /** Walking stops this far from the owner. */
  stopDistance: 2.5,
  /** Closer than this: step aside. */
  asideDistance: 1,
  /** Stepping aside ends this far away. */
  asideClear: 1.8,
  /** Walking speed near the owner; the owner runs at 3 m/s (PlayerAvatar TPS_BASE_SPEED). */
  walkSpeed: 3.4,
  /** Catching up: the speed grows with the gap up to this (the owner sprints at 12 m/s). */
  runSpeed: 9,
  /** The gap (meters past stopDistance) at which it runs flat out. */
  runGap: 14,
  /** Further than this (a teleport, a portal): appear next to the owner instead of running a marathon. */
  teleportDistance: 45,
  /** Radians per second it turns at. */
  turnRate: 7,
  /** Close enough to the desk to count as back home. */
  arriveDistance: 0.12,
  /** Standing still, it only turns once the owner is this far off its nose (radians). */
  turnDeadband: 0.06,
} as const

/** home: at its desk. follow: beside the owner. return: walking back to the desk. */
export type FollowMode = 'home' | 'follow' | 'return'
export type FollowAct = 'stand' | 'walk' | 'aside'

export interface FollowState {
  mode: FollowMode
  act: FollowAct
  /** Where the avatar stands (ground plane). */
  x: number
  z: number
  /** Facing: 0 = +Z, like a station's rotationY. */
  yaw: number
  /** Direction of the step aside, set when it starts. */
  asideX: number
  asideZ: number
  /** Standing and turning toward the owner (a turn, once begun, is finished). */
  turning: boolean
}

export interface FollowTarget {
  x: number
  z: number
  /** The owner's facing (unit, ground plane), if known: the step aside goes off their path. */
  forwardX?: number
  forwardZ?: number
}

export interface FollowHome {
  x: number
  z: number
  yaw: number
}

export interface FollowStepResult {
  /** Position changed this step. */
  moved: boolean
  /** Facing changed this step. */
  turned: boolean
  /** It reached its desk this step (mode is now 'home'). */
  arrivedHome: boolean
}

export function createFollowState(home: FollowHome): FollowState {
  return { mode: 'home', act: 'stand', x: home.x, z: home.z, yaw: home.yaw, asideX: 0, asideZ: 0, turning: false }
}

function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  else if (a < -Math.PI) a += Math.PI * 2
  return a
}

/** Turn `yaw` toward `target` by at most `maxStep` radians. */
export function turnToward(yaw: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - yaw)
  if (Math.abs(diff) <= maxStep) return wrapAngle(target)
  return wrapAngle(yaw + Math.sign(diff) * maxStep)
}

/** How fast it walks with `distance` between it and the owner: a walk nearby, a run to catch up. */
export function followSpeed(distance: number): number {
  const gap = Math.max(0, distance - FOLLOW.stopDistance)
  const t = Math.min(1, gap / FOLLOW.runGap)
  return FOLLOW.walkSpeed + (FOLLOW.runSpeed - FOLLOW.walkSpeed) * t * t
}

/**
 * Which way to step aside: off the owner's path (to the side it is already on), leaning away from them.
 * Without the owner's facing, or standing exactly on them: straight away, or to +X.
 */
export function asideDirection(state: Pick<FollowState, 'x' | 'z' | 'yaw'>, target: FollowTarget): { x: number; z: number } {
  let awayX = state.x - target.x
  let awayZ = state.z - target.z
  const awayLength = Math.hypot(awayX, awayZ)
  if (awayLength > 1e-4) {
    awayX /= awayLength
    awayZ /= awayLength
  } else {
    // Exactly on top of the owner: back off the way it came from (behind its own nose).
    awayX = -Math.sin(state.yaw)
    awayZ = -Math.cos(state.yaw)
  }
  const fx = target.forwardX ?? 0
  const fz = target.forwardZ ?? 0
  const forwardLength = Math.hypot(fx, fz)
  if (forwardLength < 1e-4) return { x: awayX, z: awayZ }
  // The owner's right-hand side (forward rotated -90° around Y), signed toward where the agent already is.
  let sideX = fz / forwardLength
  let sideZ = -fx / forwardLength
  if (sideX * awayX + sideZ * awayZ < 0) {
    sideX = -sideX
    sideZ = -sideZ
  }
  const x = sideX + awayX * 0.5
  const z = sideZ + awayZ * 0.5
  const length = Math.hypot(x, z) || 1
  return { x: x / length, z: z / length }
}

const RESULT: FollowStepResult = { moved: false, turned: false, arrivedHome: false }

/**
 * One frame. Changes `state` in place and returns what changed (the same result object every call:
 * read it before the next call). `frozen`: it stays put (the owner is talking to it, it is knocked out).
 */
export function stepFollow(
  state: FollowState,
  target: FollowTarget | null,
  home: FollowHome,
  dt: number,
  frozen = false,
): FollowStepResult {
  RESULT.moved = false
  RESULT.turned = false
  RESULT.arrivedHome = false
  if (state.mode === 'home') return RESULT
  if (frozen || !(dt > 0)) {
    if (state.act !== 'stand') state.act = 'stand'
    return RESULT
  }
  const step = Math.min(dt, 0.1)

  if (state.mode === 'return') {
    const dx = home.x - state.x
    const dz = home.z - state.z
    const distance = Math.hypot(dx, dz)
    const reach = followSpeed(distance + FOLLOW.stopDistance) * step
    if (distance <= Math.max(FOLLOW.arriveDistance, reach) || distance > FOLLOW.teleportDistance) {
      // At the desk: stand exactly where the station puts it, then face the plaza.
      if (state.x !== home.x || state.z !== home.z) {
        state.x = home.x
        state.z = home.z
        RESULT.moved = true
      }
      state.act = 'stand'
      const yaw = turnToward(state.yaw, home.yaw, FOLLOW.turnRate * step)
      if (yaw !== state.yaw) {
        state.yaw = yaw
        RESULT.turned = true
      }
      if (Math.abs(wrapAngle(home.yaw - state.yaw)) < 1e-3) {
        state.yaw = home.yaw
        state.mode = 'home'
        RESULT.arrivedHome = true
      }
      return RESULT
    }
    state.act = 'walk'
    state.x += (dx / distance) * reach
    state.z += (dz / distance) * reach
    RESULT.moved = true
    const yaw = turnToward(state.yaw, Math.atan2(dx, dz), FOLLOW.turnRate * step)
    if (yaw !== state.yaw) {
      state.yaw = yaw
      RESULT.turned = true
    }
    return RESULT
  }

  // mode === 'follow'
  if (!target) {
    if (state.act !== 'stand') state.act = 'stand'
    return RESULT
  }
  const dx = target.x - state.x
  const dz = target.z - state.z
  const distance = Math.hypot(dx, dz)

  if (distance > FOLLOW.teleportDistance) {
    // The owner jumped far away (a teleport): stand where a walk would have ended.
    const ux = distance > 0 ? dx / distance : 0
    const uz = distance > 0 ? dz / distance : 1
    state.x = target.x - ux * FOLLOW.stopDistance
    state.z = target.z - uz * FOLLOW.stopDistance
    state.yaw = Math.atan2(ux, uz)
    state.act = 'stand'
    RESULT.moved = true
    RESULT.turned = true
    return RESULT
  }

  if (state.act === 'stand') {
    if (distance > FOLLOW.startDistance) state.act = 'walk'
    else if (distance < FOLLOW.asideDistance) {
      const aside = asideDirection(state, target)
      state.asideX = aside.x
      state.asideZ = aside.z
      state.act = 'aside'
    }
  }

  if (state.act === 'walk') {
    if (distance <= FOLLOW.stopDistance) {
      state.act = 'stand'
    } else {
      const reach = Math.min(followSpeed(distance) * step, distance - FOLLOW.stopDistance)
      state.x += (dx / distance) * reach
      state.z += (dz / distance) * reach
      RESULT.moved = true
      const yaw = turnToward(state.yaw, Math.atan2(dx, dz), FOLLOW.turnRate * step)
      if (yaw !== state.yaw) {
        state.yaw = yaw
        RESULT.turned = true
      }
      return RESULT
    }
  }

  if (state.act === 'aside') {
    if (distance >= FOLLOW.asideClear) {
      state.act = 'stand'
    } else {
      const reach = FOLLOW.walkSpeed * step
      state.x += state.asideX * reach
      state.z += state.asideZ * reach
      RESULT.moved = true
      const yaw = turnToward(state.yaw, Math.atan2(state.asideX, state.asideZ), FOLLOW.turnRate * step)
      if (yaw !== state.yaw) {
        state.yaw = yaw
        RESULT.turned = true
      }
      return RESULT
    }
  }

  // Standing: turn toward the owner. A small deadband keeps it from twitching; a turn, once begun, is finished.
  if (distance > 1e-3) {
    const want = Math.atan2(dx, dz)
    const off = Math.abs(wrapAngle(want - state.yaw))
    if (off > FOLLOW.turnDeadband) state.turning = true
    else if (off < 1e-3) state.turning = false
    if (state.turning) {
      const yaw = turnToward(state.yaw, want, FOLLOW.turnRate * step)
      if (yaw !== state.yaw) {
        state.yaw = yaw
        RESULT.turned = true
      }
    }
  }
  return RESULT
}

// ─── the switch: who follows (remembered per session in this browser) ────────

/** Only Anorak follows unless the owner says otherwise. */
export const FOLLOW_DEFAULT = /anorak/i

export type FollowPrefs = Record<string, boolean>

export function followDefault(name: string | null | undefined): boolean {
  return FOLLOW_DEFAULT.test(name || '')
}

/** Does this agent follow? The owner's choice for its session, else the default for its name. */
export function wantsFollow(prefs: FollowPrefs, key: string, name: string | null | undefined): boolean {
  const choice = prefs[key]
  return typeof choice === 'boolean' ? choice : followDefault(name)
}

/** The prefs with this agent's choice set; a choice equal to the default is not stored. */
export function withFollowChoice(prefs: FollowPrefs, key: string, name: string | null | undefined, on: boolean): FollowPrefs {
  const next = { ...prefs }
  if (on === followDefault(name)) delete next[key]
  else next[key] = on
  return next
}

export function parseFollowPrefs(raw: string | null | undefined): FollowPrefs {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: FollowPrefs = {}
    for (const [key, value] of Object.entries(parsed)) if (typeof value === 'boolean') out[key] = value
    return out
  } catch {
    return {}
  }
}
