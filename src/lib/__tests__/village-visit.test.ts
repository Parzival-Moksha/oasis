import { describe, expect, it } from 'vitest'
import {
  AWAY_PROMPT_RADIUS,
  FOLLOW,
  SPACE,
  VISIT,
  awayAgentWinsPrompt,
  createFollowState,
  parseFollowPrefs,
  pickVisitSpot,
  stepApart,
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

  it('puts several agents side by side on an arc, each as near to the owner as the first, never on top of each other', () => {
    const taken: VisitSpot[] = []
    for (let i = 0; i < 6; i += 1) taken.push(pickVisitSpot(OWNER, VISIT.distance, taken))
    for (let a = 0; a < taken.length; a += 1) {
      // Every one 2.5 m from the owner: within reach of the T / E / F prompt (3.4 m), which a straight row was not.
      expect(Math.hypot(taken[a].x, taken[a].z)).toBeCloseTo(2.5, 5)
      for (let b = a + 1; b < taken.length; b += 1) {
        expect(Math.hypot(taken[a].x - taken[b].x, taken[a].z - taken[b].z)).toBeGreaterThanOrEqual(VISIT.clearance)
      }
    }
    // The first three: straight ahead, then one to each side, all in front of the owner.
    expect(taken[0].x).toBeCloseTo(0, 5)
    expect(Math.sign(taken[1].x)).toBe(-Math.sign(taken[2].x))
    for (const spot of taken.slice(0, 5)) expect(spot.z).toBeGreaterThan(0)
  })

  it('leaves the spot where a follower, or an agent at its desk, already stands', () => {
    const spot = pickVisitSpot(OWNER, VISIT.distance, [{ x: 0.2, z: 2.4 }])
    expect(Math.hypot(spot.x - 0.2, spot.z - 2.4)).toBeGreaterThanOrEqual(VISIT.clearance)
    expect(Math.hypot(spot.x, spot.z)).toBeCloseTo(2.5, 5)
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
    // A couple of steps to the side: it stays. (Two metres further off than where it waits, and it comes along.)
    expect(run(state, { ...OWNER, x: 1.5 }, 1).moved).toBe(false)
    const strolled = { ...OWNER, x: 5 }
    expect(run(state, strolled, 6).arrived).toBe(1)
    expect(gap(state, strolled)).toBeCloseTo(2.5, 2)
    run(state, OWNER, 6)
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
    expect(Math.hypot(second.x, second.z - 2.5)).toBeGreaterThanOrEqual(VISIT.clearance)
    expect(Math.hypot(second.x, second.z)).toBeCloseTo(2.5, 2)
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

describe('personal space: no two avatars on one spot', () => {
  it('says nothing when there is room', () => {
    expect(stepApart({ x: 0, z: 0 }, [{ x: 1.5, z: 0 }, { x: 0, z: -2 }])).toBeNull()
    expect(stepApart({ x: 0, z: 0 }, [])).toBeNull()
  })

  it('steps away from whoever is too close, the owner or another agent', () => {
    const away = stepApart({ x: 0, z: 0 }, [{ x: 3, z: 0 }, { x: 0.4, z: 0 }])
    expect(away).toEqual({ x: -1, z: 0 })
  })

  it('two agents on exactly the same spot go different ways', () => {
    const a = stepApart({ x: 2, z: 2 }, [{ x: 2, z: 2 }], false, 7)
    const b = stepApart({ x: 2, z: 2 }, [{ x: 2, z: 2 }], false, 8)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(Math.hypot((a as VisitSpot).x, (a as VisitSpot).z)).toBeCloseTo(1, 5)
    expect(Math.hypot((a as VisitSpot).x - (b as VisitSpot).x, (a as VisitSpot).z - (b as VisitSpot).z)).toBeGreaterThan(0.1)
  })

  it('walked out step by step, two agents sent to one spot end up at least a metre apart', () => {
    const a = { x: 5, z: 5 }
    const b = { x: 5, z: 5 }
    let steppingA = false
    let steppingB = false
    for (let i = 0; i < 600; i += 1) {
      const pushA = stepApart(a, [b], steppingA, 3)
      const pushB = stepApart(b, [a], steppingB, 4)
      steppingA = pushA !== null
      steppingB = pushB !== null
      if (pushA) { a.x += pushA.x * SPACE.speed * DT; a.z += pushA.z * SPACE.speed * DT }
      if (pushB) { b.x += pushB.x * SPACE.speed * DT; b.z += pushB.z * SPACE.speed * DT }
    }
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(SPACE.min)
    expect(steppingA || steppingB).toBe(false)
    // Not flung apart either.
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(SPACE.clear + 0.2)
  })

  it('a waiting spot on the arc is never inside that distance of another', () => {
    const taken: VisitSpot[] = []
    for (let i = 0; i < 7; i += 1) taken.push(pickVisitSpot(OWNER, VISIT.distance, taken))
    for (let i = 0; i < taken.length; i += 1) {
      const others = taken.filter((_, j) => j !== i)
      expect(stepApart(taken[i], [...others, { x: OWNER.x, z: OWNER.z }])).toBeNull()
    }
  })
})

describe('the T / E / F prompt next to an agent that walked away from its desk', () => {
  it('a close walked-up agent keeps the keys whatever else is near; one at its desk, or further off, shares as before', () => {
    // Anorak following stands 2.5 m away: the owner steps toward him and the keys are his.
    expect(awayAgentWinsPrompt(true, 1.5)).toBe(true)
    expect(awayAgentWinsPrompt(true, AWAY_PROMPT_RADIUS)).toBe(true)
    // At his stopping distance a mission panel or a skill node that is nearer may still be opened.
    expect(awayAgentWinsPrompt(true, FOLLOW.stopDistance)).toBe(false)
    // An agent at its desk never silences the wall behind it.
    expect(awayAgentWinsPrompt(false, 0.5)).toBe(false)
    expect(awayAgentWinsPrompt(true, null)).toBe(false)
  })

  it('every waiting spot is inside the reach of the prompt', () => {
    const TALK_RADIUS = 3.4
    const taken: VisitSpot[] = []
    for (let i = 0; i < 9; i += 1) taken.push(pickVisitSpot(OWNER, VISIT.distance, taken))
    for (const spot of taken) expect(Math.hypot(spot.x - OWNER.x, spot.z - OWNER.z)).toBeLessThan(TALK_RADIUS)
  })
})
