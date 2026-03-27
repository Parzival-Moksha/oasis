// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THREE.JS DEEP DISPOSE — Nuclear VRAM cleanup
// ─═̷─═̷─ॐ─═̷─═̷─ Every texture, every geometry, every material ─═̷─═̷─ॐ─═̷─═̷─
//
// Without this, textures leak silently. GPU drivers don't report them.
// Materials get .dispose() but their .map, .normalMap, .emissiveMap don't.
// Over a 30-minute session: 500MB+ VRAM leak from orphaned textures.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'

/** All material properties that can hold a THREE.Texture */
const TEX_PROPS = [
  'map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap',
  'aoMap', 'bumpMap', 'displacementMap', 'alphaMap', 'envMap', 'lightMap',
] as const

/**
 * Deep-dispose a Three.js scene graph — geometries, materials, AND their textures.
 * Safe to call on null/undefined. Handles material arrays and SkinnedMesh skeletons.
 */
export function deepDispose(obj: THREE.Object3D | null | undefined): void {
  if (!obj) return

  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh

      // Geometry
      mesh.geometry?.dispose()

      // Materials (can be single or array)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of materials) {
        if (!mat) continue
        // Dispose all texture properties BEFORE disposing the material
        for (const prop of TEX_PROPS) {
          const tex = (mat as any)[prop] as THREE.Texture | null | undefined
          if (tex) tex.dispose()
        }
        mat.dispose()
      }
    }

    // SkinnedMesh skeleton — dispose bone textures if any
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = child as THREE.SkinnedMesh
      skinned.skeleton?.dispose()
    }
  })
}

/**
 * Dispose textures from a material traversal — for cases where the existing
 * dispose pattern already handles geometry/material but misses textures.
 * Call BEFORE mat.dispose().
 */
export function disposeTextures(mat: THREE.Material): void {
  for (const prop of TEX_PROPS) {
    const tex = (mat as any)[prop] as THREE.Texture | null | undefined
    if (tex) tex.dispose()
  }
}
