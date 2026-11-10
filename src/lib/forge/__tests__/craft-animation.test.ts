import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { applyCraftAnimation, CRAFT_ANIMATION_CHANNEL, isCraftAnimationType, type CraftAnimationBase } from '../craft-animation'
import type { CraftAnimation, CraftAnimationType } from '../../conjure/types'

const base: CraftAnimationBase = { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [1, 2, 3] }

function resting() {
  const o = new THREE.Object3D()
  o.position.set(base.position[0], base.position[1], base.position[2])
  o.rotation.set(base.rotation[0], base.rotation[1], base.rotation[2])
  o.scale.set(base.scale[0], base.scale[1], base.scale[2])
  return o
}

const read = (o: THREE.Object3D) => ({
  position: o.position.toArray(),
  rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
  scale: o.scale.toArray(),
})

describe('applyCraftAnimation', () => {
  // The compiler keeps this list complete: a new CraftAnimationType without a channel fails tsc.
  const kinds = Object.keys(CRAFT_ANIMATION_CHANNEL) as CraftAnimationType[]

  it('handles every animation kind, and each kind moves exactly its own channel', () => {
    expect([...kinds].sort()).toEqual(['bob', 'orbit', 'pulse', 'rotate', 'swing'])
    for (const type of kinds) {
      const o = resting()
      const before = read(o)
      expect(applyCraftAnimation(o, { type }, base, 0.7)).toBe(true)
      const after = read(o)
      for (const channel of ['position', 'rotation', 'scale'] as const) {
        const moved = after[channel].some((v, i) => Math.abs(v - before[channel][i]) > 1e-9)
        expect([type, channel, moved]).toEqual([type, channel, channel === CRAFT_ANIMATION_CHANNEL[type]])
      }
    }
  })

  it('an unknown kind writes nothing and says so', () => {
    const o = resting()
    expect(applyCraftAnimation(o, { type: 'wobble' } as unknown as CraftAnimation, base, 1)).toBe(false)
    expect(read(o)).toEqual(read(resting()))
    expect(isCraftAnimationType('wobble')).toBe(false)
    expect(isCraftAnimationType('bob')).toBe(true)
  })

  it('rotate turns about the chosen axis at `speed` radians a second', () => {
    const o = resting()
    applyCraftAnimation(o, { type: 'rotate', axis: 'x', speed: 2 }, base, 1.5)
    expect(read(o).rotation).toEqual([0.1 + 3, 0.2, 0.3])
  })

  it('bob, swing and pulse are sines around the resting transform', () => {
    const o = resting()
    applyCraftAnimation(o, { type: 'bob', amplitude: 2 }, base, Math.PI / 4)
    expect(o.position.y).toBeCloseTo(2 + 2, 10)
    applyCraftAnimation(o, { type: 'swing', axis: 'z', amplitude: 0.5 }, base, Math.PI / 4)
    expect(o.rotation.z).toBeCloseTo(0.3 + 0.5, 10)
    applyCraftAnimation(o, { type: 'pulse', amplitude: 1 }, base, Math.PI / 6)
    expect(o.scale.toArray().map(v => +v.toFixed(10))).toEqual([1.3, 2.6, 3.9])
  })

  it('orbit circles in the plane across its axis, `amplitude` away from the resting place', () => {
    for (const [axis, fixed] of [['y', 1], ['x', 0], ['z', 2]] as const) {
      const o = resting()
      applyCraftAnimation(o, { type: 'orbit', axis, amplitude: 4 }, base, 0.9)
      const p = o.position.toArray()
      expect(p[fixed]).toBe(base.position[fixed])
      expect(Math.hypot(...p.map((v, i) => v - base.position[i]))).toBeCloseTo(4, 10)
    }
  })

  it('the same time gives the same pose (no state between frames)', () => {
    const a = resting(), b = resting()
    applyCraftAnimation(a, { type: 'orbit' }, base, 12.5)
    applyCraftAnimation(b, { type: 'orbit' }, base, 3)
    applyCraftAnimation(b, { type: 'orbit' }, base, 12.5)
    expect(read(a)).toEqual(read(b))
  })
})
