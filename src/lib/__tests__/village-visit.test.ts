import { describe, expect, it } from 'vitest'
import {
  FOLLOW,
  VISIT,
  createFollowState,
  parseFollowPrefs,
  pickVisitSpot,
  stepFollow,
  stepVisit,
  wantsCome,
  withComeChoice,
  type FollowState,
  type FollowTarget,
  type VisitSpot,
} from '../village/village-follow'

const HOME = { x: 0, z: -20, yaw: 0 }
const DT = 1 / 60
/** The owner at the origin, facing +Z. */
const OWNER: FollowTarget = { x: 0, z: 0, forwardX: 0, forwardZ: 1 }

function visitor(): FollowState {
  return { ...createFollowState(HOME), mode: 'visit' }
}

/** Run a visit for `seconds`; `others` are the spots the other agents hold. */
function run(state: FollowState, owner: FollowTarget | null, seconds: number, options: { hold?: boolean; frozen?: boolean; others?: VisitSpot[] } = {}) {
  let arrived = 0
  let moved = false
  let picks = 0
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    const result = stepVisit(state, owner, DT, Boolean(options.frozen), Boolean(options.hold), distance => pickVisitSpot(owner as FollowTarget, distance, options.others || []))
    if (result.arrived) arrived += 1
    if (result.picked) picks += 1
    moved = moved || result.moved
  }
  return { arrived, moved, picks }
}

const gap = (state: FollowState, owner: FollowTarget) => Math.hypot(owner.x - state.x, owner.z - state.z)

describe('a free spot in front of the owner', () => {
  it('is straight ahead of them, 2.5 m away, when nobody else is there', () => {
    const spot = pickVisitSpot(OWNER, VISIT.distance)
    expect(spot.x).toBeCloseTo(0, 5)
    expect(spot.z).toBeCloseTo(2.5, 5)
    // Facing +X: in front is +X.
    const east = pickVisitSpot({ x: 5, z: 5, forwardX: 1, forwardZ: 0 }, VISIT.distance)
    expect(east.x).toBeCloseTo(7.5, 5)
    expect(east.z).toBeCloseTo(5, 5)
  })

  it('lines several agents up side by side, never on top of each other', () => {
    const taken: VisitSpot[] = []
    for (let i = 0; i < 6; i += 1) taken.push(pickVisitSpot(OWNER, VISIT.distance, taken))
    for (let a = 0; a < taken.length; a += 1) {
      // All in front of the owner, in one row.
      expect(taken[a].z).toBeCloseTo(2.5, 5)
      for (let b = a + 1; b < taken.length; b += 1) {
        expect(Math.hypot(taken[a].x - taken[b].x, taken[a].z - taken[b].z)).toBeGreaterThanOrEqual(VISIT.spacing - 1e-6)
      }
    }
    // The first three: the middle, then one to each side.
    expect(taken.slice(0, 3).map(spot => Math.round(spot.x * 10) / 10).sort((a, b) => a - b)).toEqual([-1.3, 0, 1.3])
  })

  it('leaves the spot where a follower already stands', () => {
    const spot = pickVisitSpot(OWNER, VISIT.distance, [{ x: 0.2, z: 2.4 }])
    expect(Math.abs(spot.x)).toBeCloseTo(VISIT.spacing, 5)
  })

  it('works without knowing where the owner faces', () => {
    const spot = pickVisitSpot({ x: 1, z: 1 }, VISIT.distance)
    expect(Math.hypot(spot.x - 1, spot.z - 1)).toBeCloseTo(2.5, 5)
  })
})

describe('an agent that comes to the owner', () => {
  it('walks from its desk to 2.5 m in front of them, faces them, and says so once', () => {
    const state = visitor()
    const { arrived } = run(state, OWNER, 8)
    expect(arrived).toBe(1)
    expect(state.x).toBeCloseTo(0, 3)
    expect(state.z).toBeCloseTo(2.5, 3)
    expect(state.act).toBe('stand')
    // Facing the owner: looking back toward -Z, yaw = ±π.
    expect(Math.abs(state.yaw)).toBeCloseTo(Math.PI, 1)
  })

  it('then stands still: nothing moves while the owner stays', () => {
    const state = visitor()
    run(state, OWNER, 8)
    const after = run(state, OWNER, 2)
    expect(after).toEqual({ arrived: 0, moved: false, picks: 0 })
  })

  it('stays put when the owner turns around or strolls a few metres, and comes along when they walk off', () => {
    const state = visitor()
    run(state, OWNER, 8)
    expect(run(state, { ...OWNER, forwardZ: -1 }, 1).moved).toBe(false)
    expect(run(state, { ...OWNER, x: 3 }, 1).moved).toBe(false)
    const far = { x: 30, z: 0, forwardX: 0, forwardZ: 1 }
    const again = run(state, far, 8)
    expect(again.arrived).toBe(1)
    expect(gap(state, far)).toBeCloseTo(2.5, 2)
  })

  it('steps aside when the owner walks into it', () => {
    const state = visitor()
    run(state, OWNER, 8)
    const owner = { x: state.x + 0.2, z: state.z - 0.3, forwardX: 0, forwardZ: 1 }
    run(state, owner, 2)
    expect(gap(state, owner)).toBeGreaterThanOrEqual(FOLLOW.asideClear - 0.1)
    // And stays where the step took it instead of walking back into the owner's way.
    expect(run(state, owner, 1).moved).toBe(false)
  })

  it('waits a few metres back while the owner is busy with someone else, without announcing itself', () => {
    const state = visitor()
    const { arrived } = run(state, OWNER, 8, { hold: true })
    expect(arrived).toBe(0)
    expect(state.z).toBeCloseTo(VISIT.holdDistance, 2)
    // The owner is free again: it steps up and arrives.
    const up = run(state, OWNER, 4)
    expect(up.arrived).toBe(1)
    expect(state.z).toBeCloseTo(2.5, 2)
    // Busy again: back it goes.
    run(state, OWNER, 4, { hold: true })
    expect(state.z).toBeCloseTo(VISIT.holdDistance, 2)
  })

  it('takes the next free spot when one is taken, and does not move while frozen or without an owner', () => {
    const second = visitor()
    run(second, OWNER, 8, { others: [{ x: 0, z: 2.5 }] })
    expect(Math.abs(second.x)).toBeCloseTo(VISIT.spacing, 2)
    expect(second.z).toBeCloseTo(2.5, 2)
    const frozen = visitor()
    expect(run(frozen, OWNER, 1, { frozen: true }).moved).toBe(false)
    expect(run(visitor(), null, 1).moved).toBe(false)
  })

  it('is left alone by the follow step, and walks home once it is no longer needed', () => {
    const state = visitor()
    run(state, OWNER, 8)
    expect(stepFollow(state, OWNER, HOME, DT)).toMatchObject({ moved: false, turned: false })
    state.mode = 'return'
    let home = false
    for (let i = 0; i < 60 * 12 && !home; i += 1) home = stepFollow(state, OWNER, HOME, DT).arrivedHome
    expect(home).toBe(true)
    expect(state).toMatchObject({ mode: 'home', x: HOME.x, z: HOME.z, yaw: HOME.yaw })
  })
})

describe('the "Come to me" switch', () => {
  it('is on for every agent unless switched off, and stores only the offs', () => {
    expect(wantsCome({}, 's1')).toBe(true)
    let prefs = withComeChoice({}, 's1', false)
    expect(prefs).toEqual({ s1: false })
    expect(wantsCome(prefs, 's1')).toBe(false)
    expect(wantsCome(prefs, 's2')).toBe(true)
    prefs = withComeChoice(prefs, 's1', true)
    expect(prefs).toEqual({})
    expect(wantsCome(parseFollowPrefs('{"s3":false}'), 's3')).toBe(false)
  })
})
