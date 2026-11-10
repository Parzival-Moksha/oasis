import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { hideUndrawnSubtrees, skipMatrixPass } from '../undrawn-subtrees'

/** A small body: root → [skinned mesh, hips bone → spine bone → head bone, rig group → rig node]. */
function body() {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh()
  const hips = new THREE.Bone(), spine = new THREE.Bone(), head = new THREE.Bone()
  hips.add(spine); spine.add(head)
  const rig = new THREE.Object3D(), rigNode = new THREE.Object3D()
  rig.add(rigNode)
  root.add(mesh, hips, rig)
  return { root, mesh, hips, spine, head, rig, rigNode }
}

/** What three's render walk visits: it stops at an invisible node. */
function walked(root: THREE.Object3D): number {
  let n = 0
  const visit = (o: THREE.Object3D) => { if (!o.visible) return; n += 1; o.children.forEach(visit) }
  visit(root)
  return n
}

describe('hideUndrawnSubtrees', () => {
  it('hides the bone tree and the rig at their tops, never the meshes or the root', () => {
    const b = body()
    expect(walked(b.root)).toBe(7)
    expect(hideUndrawnSubtrees(b.root)).toBe(5)
    expect(b.hips.visible).toBe(false)
    expect(b.rig.visible).toBe(false)
    expect(b.spine.visible).toBe(true) // only the top is switched; the walk never gets here
    expect(b.mesh.visible).toBe(true)
    expect(b.root.visible).toBe(true)
    expect(walked(b.root)).toBe(2)
  })

  it('keeps a bone chain that carries something drawable, and hides the bare branches beside it', () => {
    const b = body()
    const hat = new THREE.Mesh()
    b.head.add(hat)
    const tail = new THREE.Bone()
    b.hips.add(tail)
    hideUndrawnSubtrees(b.root)
    expect([b.hips.visible, b.spine.visible, b.head.visible, hat.visible]).toEqual([true, true, true, true])
    expect(tail.visible).toBe(false)
  })

  it('lights, lines, points and sprites count as drawable', () => {
    for (const thing of [new THREE.PointLight(), new THREE.Line(), new THREE.Points(), new THREE.Sprite()]) {
      const b = body()
      b.head.add(thing)
      hideUndrawnSubtrees(b.root)
      expect(b.hips.visible).toBe(true)
    }
  })

  it('something attached later under a hidden subtree makes it visible again', () => {
    const b = body()
    hideUndrawnSubtrees(b.root)
    b.head.add(new THREE.Mesh())
    expect(b.hips.visible).toBe(true)
    expect(b.rig.visible).toBe(false)
  })

  it('leaves alone what was already invisible, and matrix updates still reach hidden bones', () => {
    const b = body()
    b.rig.visible = false
    hideUndrawnSubtrees(b.root)
    b.rig.add(new THREE.Mesh())
    expect(b.rig.visible).toBe(false) // not ours to reveal
    b.head.position.set(0, 2, 0)
    b.root.updateMatrixWorld(true)
    expect(b.head.matrixWorld.elements[13]).toBe(2)
  })

  it('a clone keeps the hidden tops', () => {
    const b = body()
    hideUndrawnSubtrees(b.root)
    const copy = b.root.clone(true)
    expect(walked(copy)).toBe(2)
  })
})

describe('skipMatrixPass', () => {
  it('the scene pass no longer reaches the subtree, but an explicit world-matrix request still does', () => {
    const scene = new THREE.Scene()
    const body = new THREE.Group()
    const rig = new THREE.Object3D(), hips = new THREE.Object3D()
    rig.add(hips); body.add(rig); scene.add(body)
    body.position.set(5, 0, 0)
    hips.position.set(0, 1, 0)
    skipMatrixPass(rig)
    scene.updateMatrixWorld(true)
    expect(hips.matrixWorld.elements[12]).toBe(0) // untouched by the pass
    // What three-vrm does for the hips each frame.
    const world = hips.getWorldPosition(new THREE.Vector3())
    expect(world.toArray()).toEqual([5, 1, 0])
    body.position.set(7, 0, 0)
    hips.position.set(0, 2, 0)
    expect(hips.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([7, 2, 0])
  })
})
