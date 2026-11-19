// ░▒▓ RENDER HYGIENE — fixes three.js costs that no single component can see ▓▒░
// A see-through material drawn on both sides (transparent + DoubleSide) is drawn by three in two
// passes, back faces then front faces, and before each pass it marks the material as changed.
// So every frame, for every such mesh, three looks its shader program up again twice: about
// 0.1 ms each on this machine. One portal gate had 31 of them.
// For a flat shape (a plane, a ring, a disc) the two passes draw the same single surface, so one
// pass gives the same picture. Those are switched to a single pass. Closed shapes (boxes,
// spheres) keep the two passes: there the back faces must be drawn first to look right.

import type { Material, Object3D } from 'three'

const DOUBLE_SIDE = 2
const FLAT_GEOMETRIES = new Set(['PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'ShapeGeometry'])

type Drawable = Object3D & { isMesh?: boolean; geometry?: { type?: string }; material?: Material | Material[] }

/** A material three would draw in two passes, each time marking it changed. */
export function isTwoPassTransparent(material: Material): boolean {
  return material.transparent === true && material.side === DOUBLE_SIDE && material.forceSinglePass === false
}

/**
 * Switches see-through double-sided materials on flat meshes to a single pass. A material that
 * is also used by a closed shape is left alone. Returns how many materials it switched.
 */
export function singlePassFlatTransparents(root: Object3D): number {
  if (!enabled) return 0
  const flat = new Set<Material>()
  const closed = new Set<Material>()
  root.traverse(object => {
    const mesh = object as Drawable
    if (!mesh.isMesh || !mesh.material) return
    const isFlat = FLAT_GEOMETRIES.has(mesh.geometry?.type ?? '')
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!isTwoPassTransparent(material)) continue
      ;(isFlat ? flat : closed).add(material)
    }
  })
  let switched = 0
  for (const material of flat) {
    if (closed.has(material)) continue
    material.forceSinglePass = true
    material.userData.oasisSinglePass = true
    switched += 1
  }
  return switched
}

// ── On/off, for before/after measurements ────────────────────────────────────────────────────────

let enabled = true

/** Off: hands every switched material back to three's two passes. */
export function setRenderHygieneEnabled(next: boolean, root: Object3D | null): void {
  enabled = next
  if (next || !root) return
  root.traverse(object => {
    const material = (object as Drawable).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) {
      if (!m.userData.oasisSinglePass) continue
      m.forceSinglePass = false
      delete m.userData.oasisSinglePass
    }
  })
}
