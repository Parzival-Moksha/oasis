import { describe, expect, it } from 'vitest'
import {
  FOLLOW,
  asideDirection,
  createFollowState,
  followDefault,
  followSpeed,
  parseFollowPrefs,
  stepFollow,
  turnToward,
  wantsFollow,
  withFollowChoice,
  type FollowState,
  type FollowTarget,
} from '../village/village-follow'

const HOME = { x: 0, z: 0, yaw: 0 }
const DT = 1 / 60

function follower(x = 0, z = 0): FollowState {
  return { ...createFollowState(HOME), mode: 'follow', x, z }
}

function run(state: FollowState, target: FollowTarget | null, seconds: number, frozen = false) {
  let moved = false
  let arrived = false
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    const result = stepFollow(state, target, HOME, DT, frozen)
    moved = moved || result.moved
    arrived = arrived || result.arrivedHome
  }
  return { moved, arrived }
}

const distance = (state: FollowState, target: FollowTarget) => Math.hypot(target.x - state.x, target.z - state.z)

describe('village follow', () => {
  it('stays at the desk while its mode is home', () => {
    const state = createFollowState(HOME)
    const { moved } = run(state, { x: 30, z: 0 }, 2)
    expect(moved).toBe(false)
    expect(state).toMatchObject({ x: 0, z: 0, yaw: 0, act: 'stand' })
  })

  it('walks to about 2.5 m when the owner is further than 7 m, then faces them', () => {
    const state = follower()
    const owner = { x: 10, z: 0 }
    run(state, owner, 6)
    expect(distance(state, owner)).toBeCloseTo(FOLLOW.stopDistance, 1)
    expect(state.act).toBe('stand')
    // Facing +X: yaw = atan2(dx, dz) = π/2.
    expect(state.yaw).toBeCloseTo(Math.PI / 2, 1)
  })

  it('stands between 1 m and 7 m and only turns toward the owner', () => {
    const state = follower()
    const owner = { x: -4, z: 0 }
    const { moved } = run(state, owner, 2)
    expect(moved).toBe(false)
    expect(state.x).toBe(0)
    expect(state.z).toBe(0)
    expect(state.yaw).toBeCloseTo(-Math.PI / 2, 1)
  })

  it('does not start walking until the gap passes 7 m, and then walks all the way in', () => {
    const state = follower()
    run(state, { x: 6.9, z: 0 }, 1)
    expect(state.x).toBe(0)
    const owner = { x: 7.2, z: 0 }
    stepFollow(state, owner, HOME, DT)
    expect(state.act).toBe('walk')
    run(state, owner, 4)
    expect(distance(state, owner)).toBeCloseTo(FOLLOW.stopDistance, 1)
  })

  it('steps aside when the owner comes closer than 1 m, off their path', () => {
    const state = follower(0.3, 0.5)
    // The owner walks along +Z through the agent.
    const owner = { x: 0, z: 0, forwardX: 0, forwardZ: 1 }
    stepFollow(state, owner, HOME, DT)
    expect(state.act).toBe('aside')
    run(state, owner, 2)
    expect(state.act).toBe('stand')
    expect(distance(state, owner)).toBeGreaterThanOrEqual(FOLLOW.asideClear - 0.1)
    // It went to the side it was already on (+X), not straight down the owner's path.
    expect(state.x).toBeGreaterThan(1)
  })

  it('steps aside without knowing where the owner faces, and when standing exactly on them', () => {
    expect(asideDirection({ x: 1, z: 0, yaw: 0 }, { x: 0, z: 0 })).toEqual({ x: 1, z: 0 })
    const onTop = asideDirection({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0 })
    expect(Math.hypot(onTop.x, onTop.z)).toBeCloseTo(1, 5)
    const state = follower(2, 2)
    const owner = { x: 2, z: 2 }
    run(state, owner, 2)
    expect(distance(state, owner)).toBeGreaterThanOrEqual(FOLLOW.asideClear - 0.1)
  })

  it('keeps up with a running owner and catches a sprinting one after they stop', () => {
    const state = follower()
    const owner = { x: 8, z: 0 }
    // 10 s at the owner's run speed (3 m/s).
    for (let i = 0; i < 600; i += 1) {
      owner.x += 3 * DT
      stepFollow(state, owner, HOME, DT)
    }
    expect(distance(state, owner)).toBeLessThan(FOLLOW.startDistance + 1)
    expect(followSpeed(FOLLOW.stopDistance)).toBeCloseTo(FOLLOW.walkSpeed, 5)
    expect(followSpeed(100)).toBeCloseTo(FOLLOW.runSpeed, 5)
  })

  it('appears next to the owner after a teleport', () => {
    const state = follower()
    const owner = { x: 200, z: 0 }
    const result = stepFollow(state, owner, HOME, DT)
    expect(result.moved).toBe(true)
    expect(distance(state, owner)).toBeCloseTo(FOLLOW.stopDistance, 5)
  })

  it('stays put while frozen (the owner talks to it) and without an owner to follow', () => {
    const state = follower()
    expect(run(state, { x: 20, z: 0 }, 1, true).moved).toBe(false)
    expect(run(state, null, 1).moved).toBe(false)
    expect(state.act).toBe('stand')
  })

  it('walks back to its desk, turns to face the plaza and is home again', () => {
    const state = follower(12, 5)
    state.yaw = 2
    state.mode = 'return'
    const { arrived } = run(state, { x: 12, z: 5 }, 8)
    expect(arrived).toBe(true)
    expect(state).toMatchObject({ mode: 'home', x: 0, z: 0, yaw: 0, act: 'stand' })
  })

  it('turns by the shortest way and never past the target', () => {
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 5)
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05, 5)
    expect(turnToward(0, 1, 0.1)).toBeCloseTo(0.1, 5)
  })

  it('reports nothing changed while it stands facing the owner (the caller writes no transform)', () => {
    const state = follower()
    const owner = { x: 0, z: 3 }
    run(state, owner, 1)
    const result = stepFollow(state, owner, HOME, DT)
    expect(result).toEqual({ moved: false, turned: false, arrivedHome: false })
  })
})

describe('follow switch', () => {
  it('is on by default for Anorak only', () => {
    expect(followDefault('Anorak')).toBe(true)
    expect(followDefault('anorak pro')).toBe(true)
    expect(followDefault('Academy')).toBe(false)
    expect(followDefault(null)).toBe(false)
  })

  it('remembers the owner’s choice per session and stores only what differs from the default', () => {
    let prefs = withFollowChoice({}, 's1', 'Anorak', false)
    expect(prefs).toEqual({ s1: false })
    expect(wantsFollow(prefs, 's1', 'Anorak')).toBe(false)
    prefs = withFollowChoice(prefs, 's1', 'Anorak', true)
    expect(prefs).toEqual({})
    prefs = withFollowChoice(prefs, 's2', 'Debugger', true)
    expect(wantsFollow(prefs, 's2', 'Debugger')).toBe(true)
    expect(wantsFollow(prefs, 's3', 'Debugger')).toBe(false)
  })

  it('reads stored prefs and ignores junk', () => {
    expect(parseFollowPrefs('{"a":true,"b":"yes","c":false}')).toEqual({ a: true, c: false })
    expect(parseFollowPrefs('not json')).toEqual({})
    expect(parseFollowPrefs('[1]')).toEqual({})
    expect(parseFollowPrefs(null)).toEqual({})
  })
})
