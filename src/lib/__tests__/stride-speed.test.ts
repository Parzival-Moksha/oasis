import { describe, expect, it } from 'vitest'
import { pickGait, strideTimeScale } from '../forge/stride-speed'

// Measured on a 1.7 m avatar, free UAL1 pack (2026-11-20): walk 0.78 m/s, jog 2.37, sprint 3.82.
const natural = { walk: 0.78, run: 2.37 }

describe('pickGait', () => {
  it('walks at the default walking pace and jogs at the old 3 m/s', () => {
    expect(pickGait(1.4, null, natural)).toBe('walk')
    expect(pickGait(3.0, null, natural)).toBe('run')
  })
  it('sprints well past twice the jog (Shift)', () => {
    expect(pickGait(5.6, 'run', natural)).toBe('sprint')
    expect(pickGait(12, null, natural)).toBe('sprint')
  })
  it('holds the gait a little on the way down, so a speed on the line does not flicker', () => {
    const line = natural.walk * 2.0
    expect(pickGait(line, 'walk', natural)).toBe('walk')
    expect(pickGait(line, 'run', natural)).toBe('run')
  })
  it('leaves the choice to the caller while the walk is not measured', () => {
    expect(pickGait(2, null, { walk: null })).toBeNull()
  })
  it('guesses the jog from the walk until the jog is measured', () => {
    expect(pickGait(1.5, null, { walk: 0.78 })).toBe('walk')
    expect(pickGait(3, null, { walk: 0.78 })).toBe('run')
  })
})

describe('strideTimeScale', () => {
  it('plays the clip at real speed over its stride, within limits', () => {
    expect(strideTimeScale(1.56, 0.78)).toBeCloseTo(2, 5)
    expect(strideTimeScale(0.01, 0.78)).toBe(0.35)
    expect(strideTimeScale(50, 0.78)).toBe(3.2)
    expect(strideTimeScale(1, null, 2)).toBe(2)
  })
})
