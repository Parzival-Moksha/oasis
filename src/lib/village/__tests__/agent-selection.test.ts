import { beforeEach, describe, expect, it } from 'vitest'
import {
  SELECTION_FX,
  clearSentGoal,
  clickVillageAgent,
  dealSelectionFx,
  getSelectedVillageAgent,
  getSentGoal,
  getSentGoalSeq,
  groundPoint,
  groundPointOnTerrain,
  isRightClick,
  sanitizeFxPrefs,
  selectVillageAgent,
  sendVillageAgentTo,
} from '../agent-selection'

describe('selection', () => {
  beforeEach(() => selectVillageAgent(null))

  it('the first click selects, the second click on the same agent opens it', () => {
    expect(clickVillageAgent('a')).toBe(false)
    expect(getSelectedVillageAgent()).toBe('a')
    expect(clickVillageAgent('a')).toBe(true)
    expect(clickVillageAgent('b')).toBe(false) // another agent: selection moves, nothing opens
    expect(getSelectedVillageAgent()).toBe('b')
  })
})

describe('effects', () => {
  it('deals a new agent one of the least-worn effects', () => {
    const all = SELECTION_FX.map(fx => fx.id)
    expect(all).toContain(dealSelectionFx({}, () => 0))
    // Everyone wears one except vortex and shield: the deal is one of those two.
    const prefs = { a: 'diamond', b: 'aura', c: 'sparkle', d: 'fire' } as const
    expect(dealSelectionFx(prefs, () => 0)).toBe('vortex')
    expect(dealSelectionFx(prefs, () => 0.99)).toBe('shield')
    expect(dealSelectionFx(prefs, () => 1)).toBe('shield') // a random of exactly 1 stays in range
  })

  it('spreads six agents over the six effects', () => {
    const prefs: Record<string, any> = {}
    let seed = 7
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < SELECTION_FX.length; i++) prefs[`agent${i}`] = dealSelectionFx(prefs, random)
    expect(new Set(Object.values(prefs)).size).toBe(SELECTION_FX.length)
  })

  it('drops saved picks it does not know', () => {
    expect(sanitizeFxPrefs({ a: 'fire', b: 'lasers', c: 3 })).toEqual({ a: 'fire' })
    expect(sanitizeFxPrefs(null)).toEqual({})
  })
})

describe('sending an agent', () => {
  it('remembers the goal, faces the way it walked, and gives every order a new number', () => {
    expect(getSentGoalSeq('a')).toBe(0)
    const first = sendVillageAgentTo('a', 10, 0, 0, 0)!
    expect(getSentGoal('a')).toBe(first)
    expect(first.faceX).toBeGreaterThan(first.x) // walked along +x, looks along +x
    expect(first.faceZ).toBeCloseTo(0, 9)
    const second = sendVillageAgentTo('a', 10, 5, 10, 0)!
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(second.seq).toBeGreaterThan(999_999)
    clearSentGoal('a')
    expect(getSentGoal('a')).toBeNull()
    expect(getSentGoalSeq('a')).toBe(0)
  })

  it('refuses a point that is not a number', () => {
    expect(sendVillageAgentTo('a', Number.NaN, 0, 0, 0)).toBeNull()
    expect(getSentGoal('a')).toBeNull()
  })
})

describe('the ground under a right-click', () => {
  const down = { ox: 0, oy: 10, oz: 0, dx: 0.6, dy: -0.8, dz: 0 }

  it('finds where the ray meets flat ground', () => {
    const p = groundPoint(down, 0)!
    expect(p.x).toBeCloseTo(7.5, 9)
    expect(p.z).toBeCloseTo(0, 9)
  })

  it('has no point when looking at the sky or past the horizon', () => {
    expect(groundPoint({ ...down, dy: 0.2 }, 0)).toBeNull()
    expect(groundPoint({ ...down, dy: -0.0001 }, 0)).toBeNull()
    expect(groundPoint({ ox: 0, oy: 10, oz: 0, dx: 0.9999, dy: -0.01, dz: 0 }, 0)).toBeNull() // a kilometre away
    expect(groundPoint(down, 20)).toBeNull() // the plane is above the camera
  })

  it('lands on a slope, not under it', () => {
    // Ground rises 0.2 m per metre along x.
    const p = groundPointOnTerrain(down, 0, x => x * 0.2)!
    // Exact answer: 10 - 0.8t = 0.2 * 0.6t  ->  t = 10 / 0.92
    const t = 10 / 0.92
    expect(p.x).toBeCloseTo(0.6 * t, 1)
    expect(p.y).toBeCloseTo(0.2 * p.x, 1)
  })

  it('tells a click from a drag', () => {
    expect(isRightClick(120, 2)).toBe(true)
    expect(isRightClick(120, 30)).toBe(false)
    expect(isRightClick(900, 0)).toBe(false)
  })
})
