import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { isTwoPassTransparent, singlePassFlatTransparents } from '../render-hygiene'

const seeThrough = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide })

describe('singlePassFlatTransparents', () => {
  it('switches see-through double-sided rings, planes and discs to one pass', () => {
    const scene = new THREE.Scene()
    const meshes = [new THREE.RingGeometry(1, 2), new THREE.PlaneGeometry(1, 1), new THREE.CircleGeometry(1)].map(g => new THREE.Mesh(g, seeThrough()))
    scene.add(...meshes)
    expect(singlePassFlatTransparents(scene)).toBe(3)
    for (const mesh of meshes) expect(isTwoPassTransparent(mesh.material)).toBe(false)
    expect(singlePassFlatTransparents(scene)).toBe(0)
  })

  it('leaves closed shapes, solid materials and single-sided ones alone', () => {
    const scene = new THREE.Scene()
    const box = new THREE.Mesh(new THREE.BoxGeometry(), seeThrough())
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(), seeThrough())
    const solid = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const front = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }))
    scene.add(box, sphere, solid, front)
    expect(singlePassFlatTransparents(scene)).toBe(0)
    expect(box.material.forceSinglePass).toBe(false)
    expect(sphere.material.forceSinglePass).toBe(false)
  })

  it('a material shared by a ring and a box keeps two passes (the box needs them)', () => {
    const shared = seeThrough()
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.RingGeometry(1, 2), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared))
    expect(singlePassFlatTransparents(scene)).toBe(0)
    expect(shared.forceSinglePass).toBe(false)
  })

  it('one pass draws a flat see-through surface exactly as two passes do: three skips no state but the side', () => {
    // What three does with forceSinglePass: one draw with side DoubleSide, material never marked changed.
    const material = seeThrough()
    const before = material.version
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.RingGeometry(1, 2), material))
    singlePassFlatTransparents(scene)
    expect(material.side).toBe(THREE.DoubleSide)
    expect(material.version).toBe(before)
  })
})
