import { describe, expect, it } from 'vitest'

import { AwayTracker, isAwayAfter } from '../away-mode'

const MIN = 60_000

describe('AwayTracker', () => {
  it('rests after the set minutes without input, and any input wakes it at once', () => {
    const t = new AwayTracker(0, 3)
    expect(t.tick(3 * MIN - 1).resting).toBe(false)
    expect(t.tick(3 * MIN)).toEqual({ resting: true, reason: 'idle' })
    expect(t.input(3 * MIN + 5)).toEqual({ resting: false, reason: null })
    expect(t.tick(6 * MIN).resting).toBe(false)
    expect(t.tick(6 * MIN + 5).resting).toBe(true)
  })

  it('a hidden or covered window rests at once, whatever the idle time', () => {
    const t = new AwayTracker(0, 3)
    expect(t.visibility(true, 1000)).toEqual({ resting: true, reason: 'hidden' })
  })

  it('switching back to the window after a moment counts as being there; after a long absence it waits for input', () => {
    const t = new AwayTracker(0, 3)
    t.visibility(true, 10_000)
    expect(t.visibility(false, 20_000).resting).toBe(false)
    const u = new AwayTracker(0, 3)
    u.visibility(true, 10_000)
    expect(u.visibility(false, 30 * MIN)).toEqual({ resting: true, reason: 'idle' })
    expect(u.input(30 * MIN + 1).resting).toBe(false)
  })

  it('F8 rests now and the next input wakes it, even while the timer has not run out', () => {
    const t = new AwayTracker(0, 3)
    expect(t.restNow(1000)).toEqual({ resting: true, reason: 'manual' })
    expect(t.tick(2000).resting).toBe(true)
    expect(t.input(3000).resting).toBe(false)
  })

  it('0 minutes never rests on idle; hidden and F8 still rest', () => {
    const t = new AwayTracker(0, 0)
    expect(t.tick(500 * MIN).resting).toBe(false)
    expect(t.visibility(true, 500 * MIN).resting).toBe(true)
    t.visibility(false, 500 * MIN + 1)
    expect(t.restNow(500 * MIN + 2).resting).toBe(true)
  })

  it('changing the minutes applies on the next tick', () => {
    const t = new AwayTracker(0, 10)
    expect(t.tick(4 * MIN).resting).toBe(false)
    t.setAfter(3)
    expect(t.tick(4 * MIN).resting).toBe(true)
  })

  it('returns the same state object while nothing changes (no re-render storm)', () => {
    const t = new AwayTracker(0, 3)
    const a = t.tick(1000)
    expect(t.tick(2000)).toBe(a)
    expect(t.input(2500)).toBe(a)
  })

  it('knows the menu choices', () => {
    for (const v of [0, 1, 3, 5, 10]) expect(isAwayAfter(v)).toBe(true)
    expect(isAwayAfter(2)).toBe(false)
  })
})
