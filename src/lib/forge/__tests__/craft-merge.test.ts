import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { buildCraftBatchGeometry, craftBatchKey, craftTextureRepeatOf, planCraftBatches, raycastCraftBatch } from '../craft-merge'
import type { CraftedPrimitive } from '../../conjure/types'

const prim = (over: Partial<CraftedPrimitive> = {}): CraftedPrimitive => ({
  type: 'box', position: [0, 0, 0], scale: [1, 1, 1], color: '#ff0000', ...over,
} as CraftedPrimitive)

describe('craftBatchKey: which primitives may be baked together', () => {
  it('a plain still solid primitive can; colour, place and size do not split a batch', () => {
    const a = craftBatchKey(prim())
    expect(a).not.toBeNull()
    expect(craftBatchKey(prim({ color: '#00ff00', position: [5, 1, 2], scale: [2, 3, 4], rotation: [0.1, 0.2, 0.3], type: 'sphere' }))).toBe(a)
  })

  it('material values split batches', () => {
    const base = craftBatchKey(prim())
    expect(craftBatchKey(prim({ metalness: 0.5 }))).not.toBe(base)
    expect(craftBatchKey(prim({ roughness: 0.2 }))).not.toBe(base)
    expect(craftBatchKey(prim({ emissive: '#ffffff', emissiveIntensity: 1 }))).not.toBe(base)
    expect(craftBatchKey(prim({ texturePresetId: 'stone' }))).not.toBe(base)
    // The defaults written out are the same material.
    expect(craftBatchKey(prim({ metalness: 0, roughness: 0.7, emissive: '#000000', emissiveIntensity: 0 }))).toBe(base)
    // A glow colour that is switched off (intensity 0, the default) is the same material.
    expect(craftBatchKey(prim({ emissive: '#ff00ff' }))).toBe(base)
    expect(craftBatchKey(prim({ emissive: '#ff00ff', emissiveIntensity: 0 }))).toBe(base)
    // An unknown preset keeps its single mesh (it shows the loading placeholder there).
    expect(craftBatchKey(prim({ texturePresetId: 'no-such-preset' }))).toBeNull()
  })

  it('animated, see-through, text, shader, mirrored, flat and malformed primitives stay their own mesh', () => {
    expect(craftBatchKey(prim({ animation: { type: 'bob' } }))).toBeNull()
    expect(craftBatchKey(prim({ opacity: 0.5 }))).toBeNull()
    expect(craftBatchKey(prim({ opacity: 1 }))).not.toBeNull()
    expect(craftBatchKey(prim({ type: 'text', text: 'hi' }))).toBeNull()
    for (const type of ['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora'] as const) {
      expect(craftBatchKey(prim({ type }))).toBeNull()
    }
    expect(craftBatchKey(prim({ scale: [-1, 1, 1] }))).toBeNull()
    expect(craftBatchKey(prim({ scale: [-1, -1, 1] }))).toBeNull()
    expect(craftBatchKey(prim({ scale: [1, 0, 1] }))).toBeNull()
    expect(craftBatchKey(prim({ color: undefined as unknown as string }))).toBeNull()
    expect(craftBatchKey(prim({ position: [0, Number.NaN, 0] }))).toBeNull()
    expect(craftBatchKey(prim({ rotation: [0, 0] as unknown as [number, number, number] }))).toBeNull()
  })
})

describe('planCraftBatches', () => {
  it('groups by material, keeps every primitive exactly once, and leaves singles loose', () => {
    const objects = [
      prim(),                                   // 0 batch A
      prim({ animation: { type: 'rotate' } }),  // 1 loose
      prim({ color: '#0000ff', type: 'cone' }), // 2 batch A
      prim({ roughness: 0.1 }),                 // 3 single → loose
      prim({ metalness: 1 }),                   // 4 batch B
      prim({ metalness: 1, type: 'sphere' }),   // 5 batch B
      prim({ opacity: 0.3 }),                   // 6 loose
    ]
    const plan = planCraftBatches(objects)
    expect(plan.batches.map(b => b.indexes)).toEqual([[0, 2], [4, 5]])
    expect(plan.loose).toEqual([1, 3, 6])
    const all = [...plan.loose, ...plan.batches.flatMap(b => b.indexes)].sort((a, b) => a - b)
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('an empty scene and a scene of one are all loose', () => {
    expect(planCraftBatches([])).toEqual({ batches: [], loose: [] })
    expect(planCraftBatches([prim()])).toEqual({ batches: [], loose: [0] })
  })
})

describe('buildCraftBatchGeometry: the baked mesh is the same triangles in the same places', () => {
  const primitives = [
    prim({ type: 'box', position: [1, 2, 3], rotation: [0.3, 0.7, -0.2], scale: [2, 0.5, 4], color: '#ff8800' }),
    prim({ type: 'sphere', position: [-4, 0, 1], scale: [1, 3, 1], color: '#3366cc' }),
    prim({ type: 'cylinder', position: [0, 5, 0], rotation: [Math.PI / 2, 0, 0], scale: [0.2, 6, 0.2], color: 'green' }),
  ]

  /** What three would draw for the primitive as its own mesh: vertices and normals in scene space. */
  function reference(primitive: CraftedPrimitive) {
    const geometry = primitive.type === 'sphere' ? new THREE.SphereGeometry(0.5, 32, 32)
      : primitive.type === 'cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
      : new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometry)
    mesh.position.set(...primitive.position)
    mesh.rotation.set(...(primitive.rotation || [0, 0, 0]))
    mesh.scale.set(...primitive.scale)
    mesh.updateMatrix()
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrix)
    const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = []
    const position = geometry.attributes.position, normal = geometry.attributes.normal
    for (let i = 0; i < position.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrix))
      normals.push(new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize())
    }
    return { points, normals, indexCount: geometry.index!.count, uv: geometry.attributes.uv }
  }

  it('has every vertex, normal, triangle and colour of each primitive', () => {
    const merged = buildCraftBatchGeometry(primitives)
    const refs = primitives.map(reference)
    expect(merged.attributes.position.count).toBe(refs.reduce((n, r) => n + r.points.length, 0))
    expect(merged.index!.count).toBe(refs.reduce((n, r) => n + r.indexCount, 0))
    let offset = 0
    const v = new THREE.Vector3()
    primitives.forEach((primitive, p) => {
      const ref = refs[p]
      const expectedColor = new THREE.Color(primitive.color)
      for (let i = 0; i < ref.points.length; i++) {
        v.fromBufferAttribute(merged.attributes.position, offset + i)
        expect(v.distanceTo(ref.points[i])).toBeLessThan(1e-5)
        v.fromBufferAttribute(merged.attributes.normal, offset + i)
        expect(v.distanceTo(ref.normals[i])).toBeLessThan(1e-5)
        expect(merged.attributes.color.getX(offset + i)).toBeCloseTo(expectedColor.r, 6)
        expect(merged.attributes.color.getY(offset + i)).toBeCloseTo(expectedColor.g, 6)
        expect(merged.attributes.color.getZ(offset + i)).toBeCloseTo(expectedColor.b, 6)
      }
      offset += ref.points.length
    })
    // Each primitive's triangles point at its own vertices.
    const firstBoxIndexMax = Math.max(...Array.from({ length: refs[0].indexCount }, (_, i) => merged.index!.getX(i)))
    expect(firstBoxIndexMax).toBeLessThan(refs[0].points.length)
    expect(merged.boundingSphere).not.toBeNull()
  })

  it('folds a texture repeat into the UVs, and leaves untextured UVs alone', () => {
    const textured = prim({ texturePresetId: 'stone', scale: [10, 1, 1] })
    const repeat = craftTextureRepeatOf(textured)
    expect(repeat).toBeGreaterThan(1)
    expect(craftTextureRepeatOf(prim({ texturePresetId: 'stone', textureRepeat: 3 }))).toBe(3)
    expect(craftTextureRepeatOf(prim())).toBe(1)
    const merged = buildCraftBatchGeometry([textured, prim({ texturePresetId: 'stone', textureRepeat: 3 })])
    const box = new THREE.BoxGeometry(1, 1, 1).attributes.uv
    for (let i = 0; i < box.count; i++) {
      expect(merged.attributes.uv.getX(i)).toBeCloseTo(box.getX(i) * repeat, 5)
      expect(merged.attributes.uv.getY(i)).toBeCloseTo(box.getY(i) * repeat, 5)
      expect(merged.attributes.uv.getX(box.count + i)).toBeCloseTo(box.getX(i) * 3, 5)
    }
    const plain = buildCraftBatchGeometry([prim(), prim()])
    for (let i = 0; i < box.count; i++) expect(plain.attributes.uv.getX(i)).toBe(box.getX(i))
  })

  it('an unknown shape is a box, as in the single-mesh renderer', () => {
    const merged = buildCraftBatchGeometry([prim({ type: 'pyramid' as CraftedPrimitive['type'] }), prim()])
    expect(merged.attributes.position.count).toBe(48)
  })
})

describe('raycastCraftBatch: same hits as three, without walking every triangle', () => {
  // A small town: 60 primitives of every shape, some long and thin, scattered and rotated.
  const types = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule'] as const
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const primitives = Array.from({ length: 60 }, (_, i) => prim({
    type: types[i % types.length],
    position: [rnd() * 40 - 20, rnd() * 6, rnd() * 40 - 20],
    rotation: [rnd() * 3, rnd() * 3, rnd() * 3],
    scale: i % 5 === 0 ? [12, 0.2, 0.3] : [0.5 + rnd() * 3, 0.5 + rnd() * 3, 0.5 + rnd() * 3],
  }))
  const geometry = buildCraftBatchGeometry(primitives)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }))
  mesh.position.set(3, 1, -2)
  mesh.rotation.y = 0.4
  mesh.updateMatrixWorld(true)

  const rays = Array.from({ length: 300 }, () => {
    const origin = new THREE.Vector3(rnd() * 80 - 40, 2 + rnd() * 20, rnd() * 80 - 40)
    const target = new THREE.Vector3(rnd() * 40 - 20, rnd() * 4, rnd() * 40 - 20)
    return new THREE.Raycaster(origin, target.sub(origin).normalize())
  })
  const summary = (hits: THREE.Intersection[]) => hits.map(h => h.distance.toFixed(4)).sort()

  it('finds exactly the hits three finds, for 300 rays through a 60-primitive batch', () => {
    let total = 0
    for (const raycaster of rays) {
      const reference: THREE.Intersection[] = []
      THREE.Mesh.prototype.raycast.call(mesh, raycaster, reference)
      const fast: THREE.Intersection[] = []
      raycastCraftBatch.call(mesh, raycaster, fast)
      expect(summary(fast)).toEqual(summary(reference))
      total += reference.length
    }
    expect(total).toBeGreaterThan(50) // the rays do hit things
  })

  it('leaves the draw range as it was, and tests far fewer triangles', () => {
    const tested = { fast: 0, reference: 0 }
    const original = THREE.Triangle.getInterpolation
    for (const raycaster of rays.slice(0, 40)) {
      const fast: THREE.Intersection[] = []
      raycastCraftBatch.call(mesh, raycaster, fast)
    }
    expect(geometry.drawRange.start).toBe(0)
    expect(geometry.drawRange.count).toBe(Infinity)
    expect(THREE.Triangle.getInterpolation).toBe(original)
    // Count triangle tests through the index reads each path makes.
    const index = geometry.index!
    const getX = index.getX.bind(index)
    let reads = 0
    index.getX = (i: number) => { reads += 1; return getX(i) }
    for (const raycaster of rays.slice(0, 40)) THREE.Mesh.prototype.raycast.call(mesh, raycaster, [])
    tested.reference = reads
    reads = 0
    for (const raycaster of rays.slice(0, 40)) raycastCraftBatch.call(mesh, raycaster, [])
    tested.fast = reads
    index.getX = getX
    expect(tested.fast).toBeLessThan(tested.reference / 5)
  })

  it('a batch without its part list falls back to three', () => {
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    plain.updateMatrixWorld(true)
    const hits: THREE.Intersection[] = []
    raycastCraftBatch.call(plain, new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)), hits)
    expect(hits.length).toBe(2)
  })
})
