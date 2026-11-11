// ░▒▓ CRAFT MERGE — the still, solid primitives of a crafted scene drawn as a few meshes ▓▒░
// A crafted scene is dozens of boxes, spheres and cylinders, each its own mesh: its own matrix
// update, culling test and draw call every frame. Most never move. This groups a scene's still,
// opaque primitives by material and bakes each group into one geometry (positions, normals and
// UVs already transformed, the primitive's colour as a vertex colour). The picture is the same:
// same triangles, same normals, same material values; only the number of meshes changes.
//
// Left as their own meshes (see `craftBatchKey`): animated primitives, see-through ones (their
// draw order matters), text, shader effects, mirrored or zero-size ones.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { CraftedPrimitive } from '../conjure/types'
import { canHaveTexture, computeAutoTiling, getCraftTexturePreset } from './craft-textures'

const SHADER_TYPES = new Set(['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora'])

/** A group smaller than this stays as plain meshes (nothing to gain from baking one primitive). */
export const CRAFT_BATCH_MIN = 2

function isVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v))
}

/** The texture preset a primitive really shows (same rule as the single-mesh renderer), or null. */
export function craftTexturePresetOf(primitive: CraftedPrimitive) {
  if (!primitive.texturePresetId || !canHaveTexture(primitive.type)) return null
  return getCraftTexturePreset(primitive.texturePresetId) ?? null
}

/** How many times the texture repeats across the primitive (same rule as the single-mesh renderer). */
export function craftTextureRepeatOf(primitive: CraftedPrimitive): number {
  const preset = craftTexturePresetOf(primitive)
  if (!preset) return 1
  if (primitive.textureRepeat) return primitive.textureRepeat
  return computeAutoTiling(primitive.scale, preset.naturalSizeMeters)
}

/** The material values a batch shares. Colour is not here: it rides on the vertices. */
export interface CraftBatchMaterial {
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  /** Texture preset id, or null. */
  texturePresetId: string | null
}

export function craftBatchMaterialOf(primitive: CraftedPrimitive): CraftBatchMaterial {
  const emissiveIntensity = primitive.emissiveIntensity ?? 0
  return {
    metalness: primitive.metalness ?? 0,
    roughness: primitive.roughness ?? 0.7,
    // A glow colour at intensity 0 adds nothing to the picture, so it does not split batches.
    emissive: emissiveIntensity === 0 ? '#000000' : (primitive.emissive || '#000000'),
    emissiveIntensity,
    texturePresetId: craftTexturePresetOf(primitive)?.id ?? null,
  }
}

/**
 * The batch a primitive can join, or null when it must stay its own mesh.
 * Two primitives with the same key look the same apart from colour, place and size.
 */
export function craftBatchKey(primitive: CraftedPrimitive): string | null {
  if (!primitive || typeof primitive !== 'object') return null
  if (primitive.type === 'text' || SHADER_TYPES.has(primitive.type)) return null
  if (primitive.animation) return null
  if (primitive.opacity !== undefined && primitive.opacity < 1) return null
  if (typeof primitive.color !== 'string' || primitive.color.length === 0) return null
  if (!isVec3(primitive.position) || !isVec3(primitive.scale)) return null
  if (primitive.rotation !== undefined && !isVec3(primitive.rotation)) return null
  // Mirrored (three flips the winding per mesh) or flat-to-nothing: not worth baking.
  if (!(primitive.scale[0] * primitive.scale[1] * primitive.scale[2] > 0)) return null
  if (primitive.scale.some(v => v < 0)) return null
  // An unknown texture preset shows the grey loading placeholder forever in the single-mesh path: leave it there.
  if (primitive.texturePresetId && canHaveTexture(primitive.type) && !getCraftTexturePreset(primitive.texturePresetId)) return null
  const m = craftBatchMaterialOf(primitive)
  return [m.metalness, m.roughness, m.emissive.toLowerCase(), m.emissiveIntensity, m.texturePresetId ?? ''].join('|')
}

export interface CraftBatchPlan {
  /** Groups of primitive indexes that render as one mesh each. */
  batches: Array<{ key: string; indexes: number[] }>
  /** Primitive indexes that render as before, one mesh each. */
  loose: number[]
}

export function planCraftBatches(objects: readonly CraftedPrimitive[]): CraftBatchPlan {
  const groups = new Map<string, number[]>()
  const loose: number[] = []
  objects.forEach((primitive, index) => {
    const key = craftBatchKey(primitive)
    if (key === null) {
      loose.push(index)
      return
    }
    const group = groups.get(key)
    if (group) group.push(index)
    else groups.set(key, [index])
  })
  const batches: CraftBatchPlan['batches'] = []
  for (const [key, indexes] of groups) {
    if (indexes.length < CRAFT_BATCH_MIN) loose.push(...indexes)
    else batches.push({ key, indexes })
  }
  loose.sort((a, b) => a - b)
  return { batches, loose }
}

// Same shapes as `PrimitiveGeometry` in CraftedSceneRenderer (an unknown type is a box there too).
const BASE_GEOMETRY = new Map<string, THREE.BufferGeometry>()
function baseGeometry(type: string): THREE.BufferGeometry {
  const cached = BASE_GEOMETRY.get(type)
  if (cached) return cached
  let geometry: THREE.BufferGeometry
  switch (type) {
    case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 32); break
    case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break
    case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break
    case 'torus': geometry = new THREE.TorusGeometry(0.4, 0.15, 16, 32); break
    case 'plane': geometry = new THREE.PlaneGeometry(1, 1); break
    case 'capsule': geometry = new THREE.CapsuleGeometry(0.3, 0.5, 8, 16); break
    default: geometry = new THREE.BoxGeometry(1, 1, 1)
  }
  geometry.computeBoundingBox()
  BASE_GEOMETRY.set(type, geometry)
  return geometry
}

/** The shared, never-disposed geometry of a primitive shape (for single meshes: one GPU buffer per shape, bounds ready for ray tests). */
export function craftBaseGeometry(type: string): THREE.BufferGeometry {
  return baseGeometry(type)
}

/**
 * Where each primitive sits inside a batch geometry, for ray tests: a ray is first tested against
 * each primitive's own box (in the primitive's unit space, so a long thin wall is a tight box,
 * not a huge sphere), and only the triangles of the primitives it enters are tested.
 */
export interface CraftBatchParts {
  /** World-of-the-batch → the primitive's unit space. */
  inverse: THREE.Matrix4[]
  /** The primitive's shape bounds in its unit space. */
  box: THREE.Box3[]
  /** Its triangles: a range of the batch's index buffer. */
  start: number[]
  count: number[]
}

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _quaternion = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()

/**
 * One geometry for a batch: every primitive's shape moved to its place, with its colour on the
 * vertices and its texture repeat folded into the UVs. The caller owns it (dispose when done).
 */
export function buildCraftBatchGeometry(primitives: readonly CraftedPrimitive[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const rayParts: CraftBatchParts = { inverse: [], box: [], start: [], count: [] }
  let indexAt = 0
  for (const primitive of primitives) {
    const base = baseGeometry(primitive.type)
    const part = base.clone()
    const rotation = primitive.rotation || [0, 0, 0]
    _position.set(primitive.position[0], primitive.position[1], primitive.position[2])
    _quaternion.setFromEuler(_euler.set(rotation[0], rotation[1], rotation[2]))
    _scale.set(primitive.scale[0], primitive.scale[1], primitive.scale[2])
    part.applyMatrix4(_matrix.compose(_position, _quaternion, _scale))
    rayParts.inverse.push(_matrix.clone().invert())
    rayParts.box.push(base.boundingBox!.clone().expandByScalar(1e-4))
    rayParts.start.push(indexAt)
    rayParts.count.push(base.index!.count)
    indexAt += base.index!.count

    const count = part.attributes.position.count
    _color.set('#ffffff').set(primitive.color)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = _color.r
      colors[i * 3 + 1] = _color.g
      colors[i * 3 + 2] = _color.b
    }
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const repeat = craftTextureRepeatOf(primitive)
    if (repeat !== 1) {
      const uv = part.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat, uv.getY(i) * repeat)
    }
    parts.push(part)
  }
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('craft-merge: the batch could not be merged')
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  merged.userData.craftParts = rayParts
  return merged
}

/** Off: three's own every-triangle test (for before/after measurements). */
let fastRaycast = true

const _sphere = new THREE.Sphere()
const _inverse = new THREE.Matrix4()
const _localRay = new THREE.Ray()
const _partRay = new THREE.Ray()

/**
 * `raycast` for a batch mesh. Same hits as three's own (it runs three's triangle test), but only
 * over the primitives whose box the ray enters. three's own test would walk every triangle of
 * the batch on every pointer move: a hover ray cost tens of milliseconds in a big world.
 */
export function raycastCraftBatch(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]): void {
  const geometry = this.geometry
  const parts = geometry.userData.craftParts as CraftBatchParts | undefined
  if (!parts || !fastRaycast) {
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
    return
  }
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere()
  _sphere.copy(geometry.boundingSphere!).applyMatrix4(this.matrixWorld)
  if (!raycaster.ray.intersectsSphere(_sphere)) return
  _localRay.copy(raycaster.ray).applyMatrix4(_inverse.copy(this.matrixWorld).invert())
  const range = geometry.drawRange
  const keepStart = range.start, keepCount = range.count
  try {
    for (let i = 0; i < parts.start.length; i++) {
      if (!_partRay.copy(_localRay).applyMatrix4(parts.inverse[i]).intersectsBox(parts.box[i])) continue
      range.start = parts.start[i]
      range.count = parts.count[i]
      THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
    }
  } finally {
    range.start = keepStart
    range.count = keepCount
  }
}

// ── On/off, for before/after measurements and as an escape hatch ────────────────────────────────

let mergeEnabled = true
const mergeListeners = new Set<() => void>()

export function isCraftMergeEnabled(): boolean {
  return mergeEnabled
}

export function setCraftMergeEnabled(enabled: boolean): void {
  if (enabled === mergeEnabled) return
  mergeEnabled = enabled
  mergeListeners.forEach(listener => listener())
}

export function subscribeCraftMerge(listener: () => void): () => void {
  mergeListeners.add(listener)
  return () => { mergeListeners.delete(listener) }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisCraftMerge = {
    enabled: () => mergeEnabled,
    setEnabled: (enabled: boolean) => setCraftMergeEnabled(enabled),
    setFastRaycast: (enabled: boolean) => { fastRaycast = enabled },
  }
}
