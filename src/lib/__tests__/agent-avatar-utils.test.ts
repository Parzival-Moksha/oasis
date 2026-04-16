import { describe, expect, it } from 'vitest'

import {
  deriveHermesAvatarSpawn,
  resolveAgentWindowRenderScale,
  deriveWindowAvatarAnchor,
  deriveWindowAvatarScale,
  scalarFromTransformScale,
} from '../agent-avatar-utils'

describe('scalarFromTransformScale', () => {
  it('prefers numeric transform scales', () => {
    expect(scalarFromTransformScale(2, 1)).toBe(2)
    expect(scalarFromTransformScale([3, 3, 3], 1)).toBe(3)
  })

  it('falls back when transform scale is absent', () => {
    expect(scalarFromTransformScale(undefined, 1.5)).toBe(1.5)
  })
})

describe('deriveWindowAvatarAnchor', () => {
  it('places avatars to the left of an upright window', () => {
    const result = deriveWindowAvatarAnchor({
      position: [10, 2.5, 20],
      rotation: [0, 0, 0],
      width: 800,
      height: 600,
      scale: 1,
    })

    expect(result.position[0]).toBeLessThan(10)
    expect(result.position[2]).toBe(20)
    expect(result.position[1]).toBeCloseTo(0, 5)
    expect(result.rotation[1]).toBeCloseTo(Math.PI / 6, 5)
  })

  it('respects transform overrides when present', () => {
    const result = deriveWindowAvatarAnchor(
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        width: 800,
        height: 600,
        scale: 1,
      },
      {
        position: [4, 3, 5],
        rotation: [0, Math.PI / 2, 0],
        scale: 1.5,
      },
    )

    expect(result.position[0]).toBeCloseTo(4, 5)
    expect(result.position[2]).toBeGreaterThan(5)
    expect(result.position[1]).toBeCloseTo(0, 5)
    expect(result.rotation[1]).toBeCloseTo(Math.PI / 2 + Math.PI / 6, 5)
  })
})

describe('resolveAgentWindowRenderScale', () => {
  it('multiplies the window base scale by the transform override', () => {
    expect(resolveAgentWindowRenderScale({ position: [0, 0, 0], scale: 0.2 }, { scale: 1.5 })).toBeCloseTo(0.3, 5)
  })

  it('falls back cleanly when one side is absent', () => {
    expect(resolveAgentWindowRenderScale({ position: [0, 0, 0], scale: 0.2 })).toBeCloseTo(0.2, 5)
    expect(resolveAgentWindowRenderScale({ position: [0, 0, 0] }, { scale: 2 })).toBeCloseTo(2, 5)
  })
})

describe('deriveWindowAvatarScale', () => {
  it('sizes linked avatars to roughly fill the window height', () => {
    const scale = deriveWindowAvatarScale({
      position: [0, 2, 0],
      width: 800,
      height: 600,
      scale: 1,
    })

    expect(scale).toBeGreaterThan(4)
    expect(scale).toBeLessThan(6)
  })
})

describe('deriveHermesAvatarSpawn', () => {
  it('spawns Hermes in front of the camera and facing back toward it', () => {
    const result = deriveHermesAvatarSpawn({
      position: [1, 1.6, 2],
      forward: [0, 0, -1],
    })

    expect(result.position).toEqual([1, 0, -1.2000000000000002])
    expect(result.rotation[1]).toBeCloseTo(0, 5)
    expect(result.scale).toBeCloseTo(1.15, 5)
  })

  it('falls back to a sane default when there is no camera snapshot', () => {
    const result = deriveHermesAvatarSpawn(null)
    expect(result.position).toEqual([0, 0, 3.2])
    expect(result.rotation[1]).toBeCloseTo(Math.PI, 5)
    expect(result.scale).toBeCloseTo(1.15, 5)
  })
})
