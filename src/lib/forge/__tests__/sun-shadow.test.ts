import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  shadowAmbientDim, shadowRadiusTexels, shadowRefreshDue, shadowTexelMetres, snapShadowCenter, sunDirection, sunShadowAmbientChunks, wantedShadowCenter,
  SUN_SHADOW_CENTER_STEP, SUN_SHADOW_DIM_UNIFORM, SUN_SHADOW_HALF_SIZE, SUN_SHADOW_LEAD, SUN_SHADOW_MAP_SIZES,
} from '../sun-shadow'

describe('sunDirection', () => {
  it('points from the scene to the light, unit length', () => {
    const d = sunDirection([-40, 50, -15])!
    expect(d.length()).toBeCloseTo(1, 10)
    expect(d.x).toBeLessThan(0)
    expect(d.y).toBeGreaterThan(0.7)
  })

  it('no light, a light at the origin, below the horizon or grazing it: no sun to cast with', () => {
    expect(sunDirection(null)).toBeNull()
    expect(sunDirection([0, 0, 0])).toBeNull()
    expect(sunDirection([10, -5, 3])).toBeNull()
    expect(sunDirection([-30, 1.5, -27])).toBeNull() // 2 degrees up
    expect(sunDirection([-30, 12, -27])).not.toBeNull() // 16 degrees up
  })
})

describe('snapShadowCenter', () => {
  const texel = (SUN_SHADOW_HALF_SIZE * 2) / SUN_SHADOW_MAP_SIZES.medium
  const sun = sunDirection([-40, 50, -15])!

  /** A point's place on the shadow map's texel grid, in texels. */
  function onMap(p: THREE.Vector3) {
    const view = new THREE.Matrix4().lookAt(sun, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).invert()
    const q = p.clone().applyMatrix4(view)
    return [q.x / texel, q.y / texel]
  }

  it('lands on a whole texel of the map and stays within one texel of what was asked', () => {
    for (const wanted of [new THREE.Vector3(3.337, 0, -7.211), new THREE.Vector3(-41.9, 2.5, 18.03), new THREE.Vector3(0.001, 0, 0.001)]) {
      const snapped = snapShadowCenter(wanted, sun, texel, new THREE.Vector3())
      const [u, v] = onMap(snapped)
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6)
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6)
      expect(snapped.distanceTo(wanted)).toBeLessThan(texel * 1.5)
    }
  })

  it('a camera creeping forward moves the map in whole texels or not at all', () => {
    const out = new THREE.Vector3()
    let previous = onMap(snapShadowCenter(new THREE.Vector3(0, 0, 0), sun, texel, out))
    let moves = 0
    for (let i = 1; i <= 200; i++) {
      const now = onMap(snapShadowCenter(new THREE.Vector3(i * 0.004, 0, i * 0.003), sun, texel, out))
      const du = now[0] - previous[0], dv = now[1] - previous[1]
      expect(Math.abs(du - Math.round(du))).toBeLessThan(1e-6)
      expect(Math.abs(dv - Math.round(dv))).toBeLessThan(1e-6)
      if (Math.round(du) !== 0 || Math.round(dv) !== 0) moves += 1
      previous = now
    }
    expect(moves).toBeGreaterThan(5)
    expect(moves).toBeLessThan(200)
  })

  it('works with the sun straight overhead', () => {
    const snapped = snapShadowCenter(new THREE.Vector3(5.01, 0, 5.02), new THREE.Vector3(0, 1, 0), texel, new THREE.Vector3())
    expect(Number.isFinite(snapped.x + snapped.y + snapped.z)).toBe(true)
    expect(snapped.distanceTo(new THREE.Vector3(5.01, 0, 5.02))).toBeLessThan(texel * 1.5)
  })
})

describe('shadowRefreshDue', () => {
  const still = { msSinceDraw: 6, recentred: false, moving: false }

  /** Redraws in one second at a frame rate. */
  function drawsIn1s(fps: number, input: { refresh: 'auto' | 'frame' | '60' | '30'; moving: boolean }) {
    let draws = 0, since = 0
    for (let frame = 0; frame < fps; frame++) {
      since += 1000 / fps
      if (shadowRefreshDue({ ...input, msSinceDraw: since, recentred: false })) { draws += 1; since = 0 }
    }
    return draws
  }

  it('auto: every frame while something moves (no stepping behind a walking body), 60 a second at rest', () => {
    expect(shadowRefreshDue({ refresh: 'auto', ...still, moving: true })).toBe(true)
    expect(shadowRefreshDue({ refresh: 'auto', ...still })).toBe(false)
    expect(drawsIn1s(165, { refresh: 'auto', moving: true })).toBe(165)
    const resting = drawsIn1s(165, { refresh: 'auto', moving: false })
    expect(resting).toBeGreaterThanOrEqual(50)
    expect(resting).toBeLessThanOrEqual(60)
  })

  it('every frame means every frame; 60 and 30 are caps, moving or not', () => {
    expect(drawsIn1s(165, { refresh: 'frame', moving: false })).toBe(165)
    for (const moving of [false, true]) {
      const sixty = drawsIn1s(165, { refresh: '60', moving })
      expect(sixty).toBeGreaterThanOrEqual(50)
      expect(sixty).toBeLessThanOrEqual(60)
      const thirty = drawsIn1s(165, { refresh: '30', moving })
      expect(thirty).toBeGreaterThanOrEqual(27)
      expect(thirty).toBeLessThanOrEqual(31)
    }
  })

  it('at a 60 Hz screen "60" and "auto" redraw on every frame, even when frames arrive a little early', () => {
    for (const refresh of ['auto', '60'] as const) {
      let draws = 0, since = 0
      for (let frame = 0; frame < 60; frame++) {
        since += frame % 2 ? 16.2 : 17.1
        if (shadowRefreshDue({ refresh, msSinceDraw: since, recentred: false, moving: false })) { draws += 1; since = 0 }
      }
      expect(draws).toBe(60)
    }
  })

  it('a map that moved on is redrawn at once, whatever the setting', () => {
    for (const refresh of ['auto', 'frame', '60', '30'] as const) {
      expect(shadowRefreshDue({ refresh, msSinceDraw: 1, recentred: true, moving: false })).toBe(true)
    }
  })
})

describe('quality, softness and strength', () => {
  it('each quality step halves the ground a texel covers: 6.3, 3.1, 1.6 cm', () => {
    expect([SUN_SHADOW_MAP_SIZES.low, SUN_SHADOW_MAP_SIZES.medium, SUN_SHADOW_MAP_SIZES.high].map(size => +(shadowTexelMetres(size) * 100).toFixed(1))).toEqual([6.3, 3.1, 1.6])
  })

  it('the same softness blurs the same width of ground at every quality, never under a texel', () => {
    for (const softness of [0.25, 0.5]) {
      const widths = Object.values(SUN_SHADOW_MAP_SIZES).map(size => shadowRadiusTexels(softness, size) * shadowTexelMetres(size))
      expect(widths[2]).toBeCloseTo(widths[1], 6)
    }
    for (const size of Object.values(SUN_SHADOW_MAP_SIZES)) {
      expect(shadowRadiusTexels(0, size)).toBeGreaterThanOrEqual(1)
      expect(shadowRadiusTexels(1, size)).toBeLessThanOrEqual(6)
      expect(shadowRadiusTexels(1, size)).toBeGreaterThan(shadowRadiusTexels(0, size))
    }
    expect(shadowRadiusTexels(Number.NaN, 2048)).toBe(shadowRadiusTexels(0.5, 2048))
  })

  it('strength 0 is three\'s plain shadow, 0.5 the look from before the setting, 1 nearly black', () => {
    expect(shadowAmbientDim(0)).toBe(0)
    expect(shadowAmbientDim(0.5)).toBeCloseTo(0.45, 10)
    expect(shadowAmbientDim(1)).toBeCloseTo(0.9, 10)
    expect(shadowAmbientDim(7)).toBeCloseTo(0.9, 10)
  })
})

describe('wantedShadowCenter', () => {
  it('sits ahead of the camera on the ground, on a coarse grid', () => {
    const c = wantedShadowCenter({ x: 1, z: 2 }, { x: 0, z: -3 }, new THREE.Vector3())
    expect(c.y).toBe(0)
    expect(Math.abs(c.x % SUN_SHADOW_CENTER_STEP)).toBe(0)
    expect(Math.abs(c.z % SUN_SHADOW_CENTER_STEP)).toBe(0)
    expect(Math.abs(c.z - (2 - SUN_SHADOW_LEAD))).toBeLessThanOrEqual(SUN_SHADOW_CENTER_STEP / 2)
  })

  it('does not move for a small turn or step, and a camera looking straight down centres on itself', () => {
    const a = wantedShadowCenter({ x: 0, z: 0 }, { x: 0, z: -1 }, new THREE.Vector3())
    const b = wantedShadowCenter({ x: 0.3, z: 0.2 }, { x: 0.05, z: -1 }, new THREE.Vector3())
    expect(b.equals(a)).toBe(true)
    const down = wantedShadowCenter({ x: 8.2, z: -3.9 }, { x: 0, z: 0 }, new THREE.Vector3())
    expect(down.toArray()).toEqual([8, 0, -4])
  })
})

describe('sunShadowAmbientChunks', () => {
  it('both pieces are wrapped so that a shader without a sun shadow map is untouched', () => {
    const { declare, apply } = sunShadowAmbientChunks()
    for (const chunk of [declare.trim(), apply.trim()]) {
      expect(chunk.startsWith('#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0')).toBe(true)
      expect(chunk.endsWith('#endif')).toBe(true)
    }
    expect(declare).toContain(`uniform float ${SUN_SHADOW_DIM_UNIFORM};`)
    // With the uniform at 0 (nobody set it) the ambient light is kept whole.
    expect(apply).toContain(`mix( 1.0 - ${SUN_SHADOW_DIM_UNIFORM}, 1.0, oasisSunLit )`)
    expect(apply).toContain('receiveShadow ?')
  })
})
