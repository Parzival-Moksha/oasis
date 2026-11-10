import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { StaticMatrixKeeper } from '../static-matrix'

/** A scene with one placed object: root group → inner group → two meshes. */
function world() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const inner = new THREE.Group()
  const a = new THREE.Mesh()
  const b = new THREE.Mesh()
  a.position.set(1, 0, 0)
  b.position.set(0, 2, 0)
  inner.add(a, b)
  root.add(inner)
  root.position.set(10, 0, 0)
  scene.add(root)
  return { scene, root, inner, a, b }
}

/** What happens each frame: the keeper's tick, then the renderer's matrix pass. */
function frame(keeper: StaticMatrixKeeper, scene: THREE.Scene, times = 1) {
  for (let i = 0; i < times; i++) {
    keeper.tick()
    scene.updateMatrixWorld()
  }
}

const worldX = (o: THREE.Object3D) => o.matrixWorld.elements[12]
const worldY = (o: THREE.Object3D) => o.matrixWorld.elements[13]
const sleeps = (o: THREE.Object3D) => Object.prototype.hasOwnProperty.call(o, 'updateMatrixWorld')

describe('StaticMatrixKeeper', () => {
  it('puts a still object to sleep with current matrices, and three then skips it', () => {
    const { scene, root, inner, a } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 2)
    expect(keeper.stats().asleep).toBe(0)
    frame(keeper, scene, 3)
    expect(keeper.stats()).toEqual({ roots: 1, asleep: 1, objectsAsleep: 4 })
    expect(worldX(a)).toBe(11)
    // Asleep: a frame no longer reaches the objects under the root.
    const innerUpdate = vi.spyOn(inner, 'updateMatrixWorld')
    const meshUpdate = vi.spyOn(a, 'updateMatrix')
    frame(keeper, scene, 5)
    expect(innerUpdate).not.toHaveBeenCalled()
    expect(meshUpdate).not.toHaveBeenCalled()
  })

  it('a move of the root shows in the very next frame, without waiting for a check', () => {
    const { scene, root, a } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    root.position.x = 50
    scene.updateMatrixWorld()
    expect(worldX(a)).toBe(51)
    expect(keeper.stats().asleep).toBe(0)
  })

  it('wakes when anything under the root moves, rotates or scales, and the move shows', () => {
    for (const change of [
      (o: THREE.Object3D) => { o.position.x += 5 },
      (o: THREE.Object3D) => { o.rotation.y = 1 },
      (o: THREE.Object3D) => { o.scale.setScalar(2) },
    ]) {
      const { scene, root, a } = world()
      const keeper = new StaticMatrixKeeper(1, 3)
      keeper.register(root)
      frame(keeper, scene, 6)
      expect(keeper.stats().asleep).toBe(1)
      const before = a.matrixWorld.clone()
      change(a)
      frame(keeper, scene)
      expect(keeper.stats().asleep).toBe(0)
      expect(a.matrixWorld.equals(before)).toBe(false)
      const expected = new THREE.Matrix4().compose(a.position, a.quaternion, a.scale).premultiply(a.parent!.matrixWorld)
      expect(a.matrixWorld.equals(expected)).toBe(true)
    }
  })

  it('wakes when the root itself is dragged, and sleeps again once it rests', () => {
    const { scene, root, a } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    for (let i = 0; i < 5; i++) {
      root.position.x += 1
      frame(keeper, scene)
      expect(worldX(a)).toBe(root.position.x + 1)
    }
    expect(keeper.stats().asleep).toBe(0)
    frame(keeper, scene, 4)
    expect(keeper.stats().asleep).toBe(1)
    expect(worldX(a)).toBe(16)
  })

  it('a sleeping object still follows a parent that moves, and stays asleep', () => {
    const { scene, root, a } = world()
    const parent = new THREE.Group()
    scene.add(parent)
    parent.add(root)
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    expect(keeper.stats().asleep).toBe(1)
    parent.position.y = 7
    scene.updateMatrixWorld()
    expect(worldY(a)).toBe(7)
    parent.position.y = 9
    scene.updateMatrixWorld()
    expect(worldY(a)).toBe(9)
    expect(keeper.stats().asleep).toBe(1)
  })

  it('wakes at once when a child is added anywhere under it, and the new child lands in the right place', () => {
    const { scene, root, inner, b } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    const ring = new THREE.Mesh()
    ring.position.set(0, 0, 3)
    inner.add(ring)
    // Woken by the add itself: no check has run yet.
    expect(keeper.stats().asleep).toBe(0)
    scene.updateMatrixWorld()
    expect(ring.matrixWorld.elements[12]).toBe(10)
    expect(ring.matrixWorld.elements[14]).toBe(3)
    frame(keeper, scene, 6)
    expect(keeper.stats().asleep).toBe(1)
    inner.remove(b)
    frame(keeper, scene)
    expect(keeper.stats().asleep).toBe(0)
  })

  it('wakes on an insert that bypasses add() (R3F insertBefore: parent set by hand, then the added event)', () => {
    const { scene, root, inner } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    const ring = new THREE.Mesh()
    ring.position.set(0, 4, 0)
    ring.parent = inner
    inner.children = [ring, ...inner.children]
    ring.dispatchEvent({ type: 'added' })
    expect(keeper.stats().asleep).toBe(0)
    scene.updateMatrixWorld()
    expect(worldY(ring)).toBe(4)
    expect(worldX(ring)).toBe(10)
  })

  it('a child list edited behind the back of three (no event) is still caught by the periodic full walk', () => {
    const { scene, root, inner } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    const stray = new THREE.Mesh()
    stray.position.set(0, 0, 6)
    stray.parent = inner
    inner.children.push(stray)
    frame(keeper, scene, 17)
    expect(stray.matrixWorld.elements[14]).toBe(6)
    expect(stray.matrixWorld.elements[12]).toBe(10)
  })

  it('sees a matrix written by hand on an object that manages its own matrix', () => {
    const { scene, root, a } = world()
    a.matrixAutoUpdate = false
    a.updateMatrix()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    expect(keeper.stats().asleep).toBe(1)
    a.matrix.makeTranslation(4, 0, 0)
    a.matrixWorldNeedsUpdate = true
    frame(keeper, scene)
    expect(keeper.stats().asleep).toBe(0)
    expect(worldX(a)).toBe(14)
  })

  it('an object that moves every frame never sleeps', () => {
    const { scene, root, a } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    for (let i = 0; i < 30; i++) {
      a.rotation.y += 0.01
      frame(keeper, scene)
      expect(keeper.stats().asleep).toBe(0)
    }
  })

  it('wake() from any descendant wakes at once; a hold keeps the root awake until released', () => {
    const { scene, root, a } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    frame(keeper, scene, 6)
    expect(sleeps(root)).toBe(true)
    keeper.wake(a)
    expect(keeper.stats().asleep).toBe(0)
    expect(sleeps(root)).toBe(false)
    const release = keeper.hold(root)
    frame(keeper, scene, 10)
    expect(keeper.stats().asleep).toBe(0)
    release()
    frame(keeper, scene, 4)
    expect(keeper.stats().asleep).toBe(1)
  })

  it('unregistering hands the subtree back to three', () => {
    const { scene, root } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    const stop = keeper.register(root)
    frame(keeper, scene, 6)
    stop()
    expect(sleeps(root)).toBe(false)
    expect(keeper.stats()).toEqual({ roots: 0, asleep: 0, objectsAsleep: 0 })
  })

  it('with a spread of 3, a change deep in a sleeping subtree is seen within 3 frames', () => {
    const scene = new THREE.Scene()
    const roots = Array.from({ length: 7 }, () => { const g = new THREE.Group(); g.add(new THREE.Mesh()); scene.add(g); return g })
    const keeper = new StaticMatrixKeeper(3, 2)
    for (const r of roots) keeper.register(r)
    frame(keeper, scene, 12)
    expect(keeper.stats().asleep).toBe(7)
    roots[5].children[0].position.x = 9
    frame(keeper, scene, 3)
    expect(keeper.stats().asleep).toBe(6)
    expect(roots[5].children[0].matrixWorld.elements[12]).toBe(9)
  })

  it('a second tick with the same frame stamp does nothing', () => {
    const { scene, root } = world()
    const keeper = new StaticMatrixKeeper(1, 3)
    keeper.register(root)
    for (let i = 0; i < 2; i++) { keeper.tick(1); keeper.tick(1); keeper.tick(1); scene.updateMatrixWorld() }
    expect(keeper.stats().asleep).toBe(0)
    keeper.tick(2); keeper.tick(3); keeper.tick(4)
    expect(keeper.stats().asleep).toBe(1)
  })
})
