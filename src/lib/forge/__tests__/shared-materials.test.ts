import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { SharedMaterials } from '../shared-materials'

describe('SharedMaterials', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const make = () => {
    const material = new THREE.MeshStandardMaterial()
    const dispose = vi.spyOn(material, 'dispose')
    return { material, dispose }
  }

  it('the same signature gives the same object; a different one a different object', () => {
    const shared = new SharedMaterials()
    const create = vi.fn(() => new THREE.MeshStandardMaterial())
    const a = shared.get('red', create)
    expect(shared.get('red', create)).toBe(a)
    expect(shared.get('blue', create)).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
    expect(shared.size).toBe(2)
  })

  it('is disposed a moment after its last user releases it, not before', () => {
    const shared = new SharedMaterials(1000)
    const { material, dispose } = make()
    shared.get('red', () => material)
    const releaseA = shared.retain('red')
    const releaseB = shared.retain('red')
    vi.advanceTimersByTime(5000)
    expect(dispose).not.toHaveBeenCalled()
    releaseA()
    vi.advanceTimersByTime(5000)
    expect(dispose).not.toHaveBeenCalled()
    releaseB()
    releaseB() // a second call of the same release is ignored
    vi.advanceTimersByTime(999)
    expect(dispose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(shared.size).toBe(0)
  })

  it('a remount inside the linger time gets the same object back and keeps it alive', () => {
    const shared = new SharedMaterials(1000)
    const { material, dispose } = make()
    const create = vi.fn(() => material)
    shared.get('red', create)
    const release = shared.retain('red')
    release()
    vi.advanceTimersByTime(500)
    expect(shared.get('red', create)).toBe(material)
    shared.retain('red')
    vi.advanceTimersByTime(5000)
    expect(dispose).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a material nobody ever retained is cleaned up too', () => {
    const shared = new SharedMaterials(1000)
    const { material, dispose } = make()
    shared.get('red', () => material)
    vi.advanceTimersByTime(1001)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(shared.size).toBe(0)
  })

  it('after disposal the signature makes a fresh material', () => {
    const shared = new SharedMaterials(1000)
    const first = shared.get('red', () => new THREE.MeshStandardMaterial())
    vi.advanceTimersByTime(1001)
    expect(shared.get('red', () => new THREE.MeshStandardMaterial())).not.toBe(first)
  })
})
