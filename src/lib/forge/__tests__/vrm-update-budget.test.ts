import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  BackgroundStepper, refreshVrmView, vrmUpdateMode, vrmViewOf,
  VRM_ALWAYS_FULL_M, VRM_VIEW_MARGIN_M,
} from '../vrm-update-budget'

describe('vrmUpdateMode: who may drop to the background', () => {
  const hidden = { inView: false, distance: 20, speaking: false, onceClip: false }

  it('a body out of view and not close is in the background', () => {
    expect(vrmUpdateMode(hidden)).toBe('background')
  })

  it('anything in view keeps the full rate, however far', () => {
    expect(vrmUpdateMode({ ...hidden, inView: true })).toBe('full')
    expect(vrmUpdateMode({ ...hidden, inView: true, distance: 500 })).toBe('full')
  })

  it('a speaking body, a running once-clip, and a body right next to the camera keep the full rate out of view', () => {
    expect(vrmUpdateMode({ ...hidden, speaking: true })).toBe('full')
    expect(vrmUpdateMode({ ...hidden, onceClip: true })).toBe('full')
    expect(vrmUpdateMode({ ...hidden, distance: VRM_ALWAYS_FULL_M })).toBe('full')
    expect(vrmUpdateMode({ ...hidden, distance: VRM_ALWAYS_FULL_M + 0.01 })).toBe('background')
    expect(vrmUpdateMode({ ...hidden, distance: Number.NaN })).toBe('full')
  })
})

describe('BackgroundStepper', () => {
  it('hands out the collected time ten times a second, losing none of it', () => {
    const stepper = new BackgroundStepper(10)
    let advanced = 0, steps = 0
    for (let frame = 0; frame < 165; frame++) {
      const step = stepper.add(1 / 165)
      if (step > 0) { advanced += step; steps += 1 }
    }
    expect(steps).toBeGreaterThanOrEqual(9)
    expect(steps).toBeLessThanOrEqual(10)
    expect(advanced + stepper.take()).toBeCloseTo(1, 9)
    expect(stepper.take()).toBe(0)
  })

  it('a long frame is one step of its whole length', () => {
    const stepper = new BackgroundStepper(10)
    expect(stepper.add(0.5)).toBe(0.5)
    expect(stepper.add(0.01)).toBe(0)
  })
})

describe('the shared view', () => {
  function cameraAt(position: [number, number, number], lookAt: [number, number, number]) {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500)
    camera.position.set(...position)
    camera.lookAt(...lookAt)
    camera.updateMatrixWorld(true)
    return camera
  }

  it('a body in front is in view; one behind is not; distance is from the camera', () => {
    refreshVrmView(cameraAt([0, 1.6, 0], [0, 1.6, -10]), 1)
    expect(vrmViewOf(new THREE.Vector3(0, 1, -10), 1)).toEqual({ inView: true, distance: expect.closeTo(Math.hypot(0.6, 10), 6) })
    expect(vrmViewOf(new THREE.Vector3(0, 1, 30), 1).inView).toBe(false)
  })

  it('the margin brings a body just off the edge back in', () => {
    const camera = cameraAt([0, 0, 0], [0, 0, -1])
    refreshVrmView(camera, 2)
    // Horizontal half-angle of a 60° x 16:9 camera is about 45.7°: at z = -10 the edge is near x = 10.26.
    const edge = 10 * Math.tan(THREE.MathUtils.degToRad(30)) * (16 / 9)
    const radius = 1
    const justOutside = edge + (radius + VRM_VIEW_MARGIN_M) * 0.9
    const wellOutside = edge + (radius + VRM_VIEW_MARGIN_M) * 2
    expect(vrmViewOf(new THREE.Vector3(justOutside, 0, -10), radius).inView).toBe(true)
    expect(vrmViewOf(new THREE.Vector3(wellOutside, 0, -10), radius).inView).toBe(false)
  })

  it('is recomputed for a new frame stamp or camera, and reused within a frame', () => {
    const camera = cameraAt([0, 0, 0], [0, 0, -1])
    refreshVrmView(camera, 10)
    const target = new THREE.Vector3(0, 0, -10)
    expect(vrmViewOf(target, 1).inView).toBe(true)
    camera.lookAt(0, 0, 1)
    camera.updateMatrixWorld(true)
    refreshVrmView(camera, 10) // same frame: still the old view
    expect(vrmViewOf(target, 1).inView).toBe(true)
    refreshVrmView(camera, 11)
    expect(vrmViewOf(target, 1).inView).toBe(false)
  })
})
