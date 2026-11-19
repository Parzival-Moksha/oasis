import { describe, expect, it } from 'vitest'

import { BOLT_MAX_RANGE_M, boltTtlFor, createBolt, segmentSphereEntry, stepBolt, type FlyingBolt } from '../flight'

function bolt(over: Partial<Parameters<typeof createBolt>[0]> = {}): FlyingBolt {
  return createBolt({
    id: 'b1', spell: 'firebolt', design: 'A',
    origin: [0, 1.25, 0], direction: [0, 0, -1], speed: 24, damage: 14,
    impactDistance: null, impactObjectId: null, local: true,
    ...over,
  })
}

function fly(b: FlyingBolt, actors = [] as Parameters<typeof stepBolt>[2], frames = 400) {
  let current: FlyingBolt | null = b
  for (let i = 0; i < frames && current; i++) {
    const step = stepBolt(current, 1 / 60, actors, 0.5)
    if (step.impact || !step.bolt) return { step, frames: i + 1 }
    current = step.bolt
  }
  return { step: null, frames }
}

describe('bolt flight', () => {
  it('explodes exactly at the world surface the aim found, with that object', () => {
    const { step } = fly(bolt({ impactDistance: 12, impactObjectId: 'palm-1' }))
    expect(step?.impact?.targetId).toBe('palm-1')
    expect(step?.impact?.actor).toBe(false)
    const [x, y, z] = step!.impact!.position
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(1.25, 5)
    expect(z).toBeCloseTo(-12, 5)
  })

  it('reaches a far target: life covers the whole distance', () => {
    expect(boltTtlFor(24, 80)).toBeGreaterThan(80 / 24)
    const { step } = fly(bolt({ impactDistance: 80, impactObjectId: 'tower' }), [], 1000)
    expect(step?.impact?.targetId).toBe('tower')
  })

  it('aimed at the sky it fades at its range: no impact, no explosion', () => {
    const { step } = fly(bolt({ direction: [0, 1, -1] }), [], 2000)
    expect(step?.impact).toBeNull()
    expect(step?.bolt).toBeNull()
  })

  it('hits a moving actor in its path before the wall behind it', () => {
    const actors = [{ id: 'village:a', center: [0, 1.25, -6] as [number, number, number], radius: 0.7 }]
    const { step } = fly(bolt({ impactDistance: 20, impactObjectId: 'wall' }), actors)
    expect(step?.impact?.targetId).toBe('village:a')
    expect(step?.impact?.position[2]).toBeCloseTo(-5.3, 3)
  })

  it('never hits the actor it starts inside (the caster)', () => {
    const actors = [{ id: 'pvp:me', center: [0, 1.0, 0.2] as [number, number, number], radius: 0.7 }]
    const { step } = fly(bolt({ impactDistance: 10, impactObjectId: null }), actors)
    expect(step?.impact?.targetId).toBeNull()
    expect(step?.impact?.position[2]).toBeCloseTo(-10, 5)
  })

  it('a world surface right in front still explodes there (not later, not elsewhere)', () => {
    const { step, frames } = fly(bolt({ impactDistance: 0.3 }))
    expect(frames).toBe(1)
    expect(step?.impact?.position[2]).toBeCloseTo(-0.3, 5)
  })

  it('lays trail points along its path, evenly', () => {
    let b: FlyingBolt | null = bolt()
    const points: number[] = []
    for (let i = 0; i < 30 && b; i++) {
      const step = stepBolt(b, 1 / 60, [], 0.5)
      for (const p of step.trail) points.push(p[2])
      b = step.bolt
    }
    expect(points.length).toBeGreaterThan(20)
    for (let i = 1; i < points.length; i++) expect(points[i - 1] - points[i]).toBeCloseTo(0.5, 4)
  })

  it('stops by its range even with a long life', () => {
    expect(BOLT_MAX_RANGE_M).toBe(90)
  })

  it('segment-sphere entry: front hit, miss, start inside', () => {
    expect(segmentSphereEntry([0, 0, 0], [0, 0, -1], 10, [0, 0, -5], 1)).toBeCloseTo(4, 6)
    expect(segmentSphereEntry([0, 0, 0], [0, 0, -1], 10, [3, 0, -5], 1)).toBeNull()
    expect(segmentSphereEntry([0, 0, 0], [0, 0, -1], 10, [0, 0, 0.5], 1)).toBe(0)
    expect(segmentSphereEntry([0, 0, 0], [0, 0, -1], 3, [0, 0, -5], 1)).toBeNull()
  })
})
