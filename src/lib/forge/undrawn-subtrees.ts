// ░▒▓ UNDRAWN SUBTREES — skeletons are not part of the picture, so the renderer need not walk them ▓▒░
// Every frame three walks the whole scene looking for things to draw. A VRM body is ~140 nodes of
// which 2 or 3 are meshes; the rest are bones and rig nodes that never draw anything. Marking such
// a subtree `visible = false` makes that walk stop at its top. Nothing else changes: bones keep
// animating (matrix updates ignore `visible`), skinned meshes read their bones' matrices as before.
//
// If something is later attached under a hidden subtree (a hat on a head bone), the subtree is
// made visible again, so the attachment shows.

import type { Object3D } from 'three'

/** A node that never draws by itself: a bone, a group, a bare Object3D. */
function isPlainNode(object: Object3D): boolean {
  return (object as { isBone?: boolean }).isBone === true || object.type === 'Group' || object.type === 'Object3D'
}

function isUndrawn(object: Object3D): boolean {
  if (!isPlainNode(object)) return false
  for (const child of object.children) if (!isUndrawn(child)) return false
  return true
}

const HIDDEN_FLAG = '__oasisUndrawnHidden'

/**
 * Hides every topmost subtree under `root` that holds nothing drawable. `root` itself is never
 * hidden, nor is a node that was already invisible (someone else owns that). Returns how many
 * nodes the renderer's walk no longer visits.
 */
export function hideUndrawnSubtrees(root: Object3D): number {
  let skipped = 0
  const visit = (object: Object3D) => {
    for (const child of object.children) {
      if (!child.visible) continue
      if (!isUndrawn(child)) {
        visit(child)
        continue
      }
      child.visible = false
      child.userData[HIDDEN_FLAG] = true
      const reveal = () => {
        if (!child.userData[HIDDEN_FLAG]) return
        child.userData[HIDDEN_FLAG] = false
        child.visible = true
      }
      child.traverse(node => {
        skipped += 1
        node.addEventListener('childadded' as never, reveal as never)
      })
    }
  }
  visit(root)
  return skipped
}

/**
 * Takes a subtree out of three's per-frame matrix pass. Only for nodes whose world matrices
 * nobody reads from the scene pass: three-vrm's normalized rig (~50 nodes a body) is driven by
 * the animation mixer through local rotations, and three-vrm asks for the one world position it
 * needs (the hips) with its own `updateWorldMatrix` call, which still works.
 */
export function skipMatrixPass(node: Object3D): void {
  node.updateMatrixWorld = () => {}
}
