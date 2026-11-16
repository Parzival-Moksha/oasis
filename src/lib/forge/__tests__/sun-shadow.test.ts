import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { shadowRefreshDue, snapShadowCenter, sunDirection, sunShadowAmbientChunk, wantedShadowCenter, SUN_SHADOW_CENTER_STEP, SUN_SHADOW_HALF_SIZE, SUN_SHADOW_LEAD, SUN_SHADOW_MAP_SIZE, SUN_SHADOW_WORLD_INTERVAL_MS } from '../sun-shadow'

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
  const texel = (SUN_SHADOW_HALF_SIZE * 2) / SUN_SHADOW_MAP_SIZE
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
  it('avatars only: 60 times a second, so a 165 Hz screen does not pay for it on every frame', () => {
    expect(shadowRefreshDue({ mode: 'avatars', msSinceDraw: 6, recentred: false })).toBe(false)
    expect(shadowRefreshDue({ mode: 'avatars', msSinceDraw: 6, recentred: true })).toBe(true)
    expect(shadowRefreshDue({ mode: 'avatars', msSinceDraw: 16.7, recentred: false })).toBe(true)
    let draws = 0, since = 0
    for (let frame = 0; frame < 165; frame++) {
      since += 1000 / 165
      if (shadowRefreshDue({ mode: 'avatars', msSinceDraw: since, recentred: false })) { draws += 1; since = 0 }
    }
    expect(draws).toBeGreaterThanOrEqual(50)
    expect(draws).toBeLessThanOrEqual(60)
  })

  it('the whole world: when the map moves on, otherwise 30 times a second, whatever the frame rate', () => {
    expect(shadowRefreshDue({ mode: 'all', msSinceDraw: 6, recentred: false })).toBe(false)
    expect(shadowRefreshDue({ mode: 'all', msSinceDraw: 6, recentred: true })).toBe(true)
    expect(shadowRefreshDue({ mode: 'all', msSinceDraw: SUN_SHADOW_WORLD_INTERVAL_MS, recentred: false })).toBe(true)
    for (const fps of [60, 165]) {
      let draws = 0, since = 0
      for (let frame = 0; frame < fps; frame++) {
        since += 1000 / fps
        if (shadowRefreshDue({ mode: 'all', msSinceDraw: since, recentred: false })) { draws += 1; since = 0 }
      }
      expect(draws).toBeGreaterThanOrEqual(27)
      expect(draws).toBeLessThanOrEqual(31)
    }
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

describe('sunShadowAmbientChunk', () => {
  it('is wrapped so that a shader without a sun shadow map is untouched', () => {
    const chunk = sunShadowAmbientChunk(0.45).trim()
    expect(chunk.startsWith('#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0')).toBe(true)
    expect(chunk.endsWith('#endif')).toBe(true)
    expect(chunk).toContain('mix( 0.550, 1.0, oasisSunLit )')
    expect(chunk).toContain('receiveShadow ?')
  })
})
