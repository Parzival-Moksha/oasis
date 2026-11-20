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
  /**
   * Walking speed near the owner, who walks at 1.4 m/s by default (locomotion-set.ts; 3 with the old jog pace). A
   * brisk walk: the steps match the speed (stride-speed.ts), and a gap still closes, faster the bigger it is.
   */
  walkSpeed: 1.6,
  /** Catching up: the speed grows with the gap up to this (the owner sprints at 12 m/s). */
  runSpeed: 9,
  /** The gap (meters past stopDistance) at which it runs flat out. */
  runGap: 12,
  /** Further than this (a teleport, a portal): appear next to the owner instead of running a marathon. */
  teleportDistance: 45,
  /** Radians per second it turns at. */
  turnRate: 7,
  /** Close enough to the desk to count as back home. */
  arriveDistance: 0.12,
  /** Standing still, it only turns once the owner is this far off its nose (radians). */
  turnDeadband: 0.06,
} as const

/** home: at its desk. follow: beside the owner. visit: it came to the owner because it needs them. stage: it stands where a scene puts it (the Council). return: walking back to the desk. */
export type FollowMode = 'home' | 'follow' | 'visit' | 'stage' | 'return'
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
  /** A visit's spot in front of the owner (stepVisit), once it has one, and whether it is the held-back one. */
  hasGoal: boolean
  goalX: number
  goalZ: number
  goalHold: boolean
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
  return { mode: 'home', act: 'stand', x: home.x, z: home.z, yaw: home.yaw, asideX: 0, asideZ: 0, turning: false, hasGoal: false, goalX: 0, goalZ: 0, goalHold: false }
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
  if (state.mode === 'home' || state.mode === 'visit' || state.mode === 'stage') return RESULT
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

// ─── come to me when you need me ────────────────────────────────────────────
// An agent that needs the owner (a decision, finished work, stuck) walks from its desk to a spot in front
// of them and waits there, facing them. Several queue up side by side. While the owner is busy with someone
// else (another agent's panel, a full screen) it keeps a few metres back instead. When it is no longer
// needed it walks home (mode 'return'). Same walking, turning and stepping aside as following.

export const VISIT = {
  /** Where it waits: this far in front of the owner. */
  distance: 2.5,
  /** While the owner is busy with someone else: this far back. */
  holdDistance: 5.5,
  /** Agents waiting side by side stand this far apart. */
  spacing: 1.3,
  /** A spot is free when nobody else stands or is headed closer than this to it. */
  clearance: 1.1,
  /** Close enough to the spot to count as arrived. */
  arriveDistance: 0.1,
  /**
   * It came to be near the owner: when they move this much further off than where it waits, it comes along
   * (sooner than an agent that merely follows, which waits for 7 m), so its prompt stays within reach.
   */
  comeAlong: 2,
} as const

export interface VisitSpot {
  x: number
  z: number
}

/**
 * A free spot `distance` from the owner: straight ahead of them first, then alternately to their right and
 * left along an arc at that same distance, `VISIT.spacing` apart. Every spot is as near to the owner as the
 * first, so each waiting agent is within reach of the T / E / F prompt. `others`: where the other avatars
 * stand or are headed.
 */
export function pickVisitSpot(owner: FollowTarget, distance: number, others: readonly VisitSpot[] = []): VisitSpot {
  let fx = owner.forwardX ?? 0
  let fz = owner.forwardZ ?? 0
  const length = Math.hypot(fx, fz)
  if (length < 1e-4) {
    fx = 0
    fz = 1
  } else {
    fx /= length
    fz /= length
  }
  const facing = Math.atan2(fx, fz)
  // The angle between neighbours on the arc; never past the owner's sides and back.
  const stepAngle = Math.min(Math.PI / 3, VISIT.spacing / Math.max(0.5, distance))
  let spot: VisitSpot = { x: owner.x + fx * distance, z: owner.z + fz * distance }
  for (let n = 0; n < 9; n += 1) {
    const turn = (n % 2 === 1 ? (n + 1) / 2 : -n / 2) * stepAngle
    if (Math.abs(turn) > Math.PI * 0.8) break
    const angle = facing + turn
    spot = { x: owner.x + Math.sin(angle) * distance, z: owner.z + Math.cos(angle) * distance }
    const x = spot.x
    const z = spot.z
    if (others.every(other => Math.hypot(other.x - x, other.z - z) >= VISIT.clearance)) return spot
  }
  return spot
}

export interface VisitStepResult extends FollowStepResult {
  /** It reached its spot in front of the owner this step (not the held-back one): time to speak. */
  arrived: boolean
  /** It chose a new spot this step (state.goalX / goalZ). */
  picked: boolean
}

const VISIT_RESULT: VisitStepResult = { moved: false, turned: false, arrivedHome: false, arrived: false, picked: false }

function turnTo(state: FollowState, want: number, step: number, result: FollowStepResult): void {
  const yaw = turnToward(state.yaw, want, FOLLOW.turnRate * step)
  if (yaw !== state.yaw) {
    state.yaw = yaw
    result.turned = true
  }
}

/**
 * One frame of an agent that came to the owner (mode 'visit'). Changes `state` in place; the result object is
 * reused. `hold`: the owner is busy with someone else, so it waits further back. `pick(distance)` returns a
 * free spot that far in front of the owner (the caller knows where the others are).
 */
export function stepVisit(
  state: FollowState,
  target: FollowTarget | null,
  dt: number,
  frozen: boolean,
  hold: boolean,
  pick: (distance: number) => VisitSpot,
): VisitStepResult {
  const result = VISIT_RESULT
  result.moved = false
  result.turned = false
  result.arrivedHome = false
  result.arrived = false
  result.picked = false
  if (state.mode !== 'visit') return result
  if (frozen || !(dt > 0) || !target) {
    if (state.act !== 'stand') state.act = 'stand'
    return result
  }
  const step = Math.min(dt, 0.1)
  const dx = target.x - state.x
  const dz = target.z - state.z
  const distance = Math.hypot(dx, dz)

  if (state.act === 'stand') {
    if (distance < FOLLOW.asideDistance) {
      const aside = asideDirection(state, target)
      state.asideX = aside.x
      state.asideZ = aside.z
      state.act = 'aside'
    } else if (!state.hasGoal || state.goalHold !== hold || distance > (hold ? VISIT.holdDistance : VISIT.distance) + VISIT.comeAlong) {
      // First time, the owner became free or busy, or they walked off: (re)take a spot and go there.
      const spot = pick(hold ? VISIT.holdDistance : VISIT.distance)
      state.goalX = spot.x
      state.goalZ = spot.z
      state.goalHold = hold
      state.hasGoal = true
      state.act = 'walk'
      result.picked = true
    }
  }

  if (state.act === 'walk') {
    // The owner moved on while it was walking: the spot is stale.
    if (Math.hypot(target.x - state.goalX, target.z - state.goalZ) > (hold ? VISIT.holdDistance : VISIT.distance) + VISIT.comeAlong || state.goalHold !== hold) {
      const spot = pick(hold ? VISIT.holdDistance : VISIT.distance)
      state.goalX = spot.x
      state.goalZ = spot.z
      state.goalHold = hold
      result.picked = true
    }
    const gx = state.goalX - state.x
    const gz = state.goalZ - state.z
    const left = Math.hypot(gx, gz)
    const reach = followSpeed(left + FOLLOW.stopDistance) * step
    if (left <= Math.max(VISIT.arriveDistance, reach)) {
      if (left > 0) {
        state.x = state.goalX
        state.z = state.goalZ
        result.moved = true
      }
      state.act = 'stand'
      state.turning = true
      result.arrived = !hold
    } else {
      state.x += (gx / left) * reach
      state.z += (gz / left) * reach
      result.moved = true
      turnTo(state, Math.atan2(gx, gz), step, result)
      return result
    }
  }

  if (state.act === 'aside') {
    if (distance >= FOLLOW.asideClear) {
      state.act = 'stand'
      // It stays where the step aside took it.
      state.goalX = state.x
      state.goalZ = state.z
      result.picked = true
    } else {
      const reach = FOLLOW.walkSpeed * step
      state.x += state.asideX * reach
      state.z += state.asideZ * reach
      result.moved = true
      turnTo(state, Math.atan2(state.asideX, state.asideZ), step, result)
      return result
    }
  }

  // Standing: face the owner.
  if (distance > 1e-3) {
    const want = Math.atan2(dx, dz)
    const off = Math.abs(wrapAngle(want - state.yaw))
    if (off > FOLLOW.turnDeadband) state.turning = true
    else if (off < 1e-3) state.turning = false
    if (state.turning) turnTo(state, want, step, result)
  }
  return result
}

/** "Come to me when you need me": on for every agent unless the owner switched it off for that one. */
export function wantsCome(prefs: FollowPrefs, key: string): boolean {
  return prefs[key] !== false
}

/** The prefs with this agent's choice set; "on" is the default and is not stored. */
export function withComeChoice(prefs: FollowPrefs, key: string, on: boolean): FollowPrefs {
  const next = { ...prefs }
  if (on) delete next[key]
  else next[key] = false
  return next
}

// ─── on a stage (the Council) ───────────────────────────────────────────────
// The agent is told where to stand and where to look (village-council.ts): it walks to its mark
// (state.goalX / goalZ), then turns to face a point, and reports when it stands settled.

export interface StageStepResult extends FollowStepResult {
  /** On its mark and facing where it should: nothing left to do. */
  settled: boolean
}

const STAGE_RESULT: StageStepResult = { moved: false, turned: false, arrivedHome: false, settled: false }

/**
 * One frame of an agent on a stage (mode 'stage'). `speed`: metres a second for the walk (0: the usual pace,
 * faster from far away). `faceX`, `faceZ`: the point it looks at once it stands.
 */
export function stepStage(state: FollowState, dt: number, frozen: boolean, speed: number, faceX: number, faceZ: number): StageStepResult {
  const result = STAGE_RESULT
  result.moved = false
  result.turned = false
  result.arrivedHome = false
  result.settled = false
  if (state.mode !== 'stage' || !state.hasGoal) return result
  if (frozen || !(dt > 0)) {
    if (state.act !== 'stand') state.act = 'stand'
    return result
  }
  const step = Math.min(dt, 0.1)
  const gx = state.goalX - state.x
  const gz = state.goalZ - state.z
  const left = Math.hypot(gx, gz)
  if (left > 1e-4) {
    // A calm walk for a few steps; from further away (gathering from the desks) the pace of following.
    const pace = speed > 0 && left < 6 ? speed : followSpeed(left + FOLLOW.stopDistance)
    const reach = pace * step
    if (left <= reach) {
      state.x = state.goalX
      state.z = state.goalZ
      state.act = 'stand'
    } else {
      state.act = 'walk'
      state.x += (gx / left) * reach
      state.z += (gz / left) * reach
      turnTo(state, Math.atan2(gx, gz), step, result)
    }
    result.moved = true
    return result
  }
  if (state.act !== 'stand') state.act = 'stand'
  const fx = faceX - state.x
  const fz = faceZ - state.z
  if (Math.hypot(fx, fz) > 1e-3) {
    const want = Math.atan2(fx, fz)
    if (Math.abs(wrapAngle(want - state.yaw)) > 1e-3) {
      turnTo(state, want, step, result)
      return result
    }
  }
  result.settled = true
  return result
}

// ─── personal space: no two avatars on one spot ─────────────────────────────

export const SPACE = {
  /** Two avatars (agents, the owner) never stand closer than this. */
  min: 1.0,
  /** Stepping apart goes on to this distance, so they do not twitch at the limit. */
  clear: 1.2,
  /** Walking pace of the step apart. */
  speed: 1.8,
} as const

/**
 * Which way to step so that nobody stands on anybody: away from the nearest other avatar that is closer than
 * SPACE.min (SPACE.clear once it is already stepping). null: there is room. Standing exactly on someone, the
 * direction comes from `seed` (the agent's own number), so two agents on one spot go different ways.
 */
export function stepApart(self: VisitSpot, others: readonly VisitSpot[], stepping = false, seed = 0): VisitSpot | null {
  const limit = stepping ? SPACE.clear : SPACE.min
  let nearest: VisitSpot | null = null
  let nearestDistance: number = limit
  for (const other of others) {
    const distance = Math.hypot(other.x - self.x, other.z - self.z)
    if (distance < nearestDistance) {
      nearest = other
      nearestDistance = distance
    }
  }
  if (!nearest) return null
  if (nearestDistance < 1e-3) {
    const angle = (seed % 16) * (Math.PI / 8) + 0.4
    return { x: Math.sin(angle), z: Math.cos(angle) }
  }
  return { x: (self.x - nearest.x) / nearestDistance, z: (self.z - nearest.z) / nearestDistance }
}

// ─── the T / E / F prompt next to an agent that is away from its desk ───────

/**
 * An agent that walked away from its desk (it follows the owner, or came to them) and stands this close gets the
 * T / E / F keys whatever else is around. Without this a mission panel within its 2.3 m beat an agent standing
 * 2.5 m away, and the skill tree took the keys whenever the camera looked at one of its nodes: next to the
 * wall or the tree the owner could not open the agent beside him (2026-11-16).
 */
export const AWAY_PROMPT_RADIUS = 2.2

export function awayAgentWinsPrompt(away: boolean, distance: number | null): boolean {
  return away && distance !== null && distance <= AWAY_PROMPT_RADIUS
}
