import { describe, expect, it } from 'vitest'
import { clipForPose, holdSeconds, HOLD_MAX_S, HOLD_MIN_S, IDLE_POOLS, pickVariety } from '../village/agent-idles'

describe('agent idles', () => {
  it('talking is the talking clip, resting the plain idle', () => {
    expect(clipForPose('a', 'talking', 3, true)).toBe('ual-talking')
    expect(clipForPose('a', 'resting', 3, true)).toBeNull()
  })
  it('waiting and working pick from their own pools', () => {
    for (let r = 0; r < 20; r++) {
      expect(IDLE_POOLS.waiting).toContain(clipForPose('agent-1', 'waiting', r, true))
      expect(IDLE_POOLS.working).toContain(clipForPose('agent-1', 'working', r, true))
    }
  })
  it('never plays the same clip twice in a row, laps included', () => {
    for (const id of ['agent-1', 'agent-bd2e36be', 'x', 'Hipster']) {
      for (const pool of [IDLE_POOLS.waiting, IDLE_POOLS.working]) {
        for (let r = 0; r < 40; r++) expect(pickVariety(id, pool, r + 1)).not.toBe(pickVariety(id, pool, r))
      }
    }
  })
  it('goes through the whole pool', () => {
    const seen = new Set(Array.from({ length: 5 }, (_, r) => pickVariety('agent-7', IDLE_POOLS.waiting, r)))
    expect(seen.size).toBe(5)
  })
  it('agents differ from one another', () => {
    const firsts = new Set(Array.from({ length: 24 }, (_, i) => pickVariety(`agent-${i}`, IDLE_POOLS.waiting, 0)))
    expect(firsts.size).toBeGreaterThanOrEqual(4)
  })
  it('without variety: one clip per state', () => {
    expect(clipForPose('a', 'waiting', 0, false)).toBe(clipForPose('b', 'waiting', 9, false))
    expect(clipForPose('a', 'working', 0, false)).toBe('ual-phone')
  })
  it('hold lengths are per agent and in range', () => {
    const holds = Array.from({ length: 24 }, (_, i) => holdSeconds(`agent-${i}`))
    for (const h of holds) { expect(h).toBeGreaterThanOrEqual(HOLD_MIN_S); expect(h).toBeLessThanOrEqual(HOLD_MAX_S) }
    expect(new Set(holds.map(h => Math.round(h))).size).toBeGreaterThan(5)
  })
})
