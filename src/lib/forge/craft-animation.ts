// ░▒▓ CRAFT ANIMATION — the per-frame math for an animated crafted primitive ▓▒░
// Pure: given the primitive's resting transform and a time, writes the animated transform.
// `CraftedSceneRenderer` calls it from a frame callback that exists only for animated primitives.

import type { CraftAnimation, CraftAnimationType } from '../conjure/types'

type Vec3 = readonly [number, number, number]

export interface CraftAnimationBase {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

/** What the animation writes to (a three.js Object3D fits). */
export interface CraftAnimationTarget {
  position: { set: (x: number, y: number, z: number) => unknown }
  rotation: { set: (x: number, y: number, z: number) => unknown }
  scale: { set: (x: number, y: number, z: number) => unknown }
}

/** Every animation kind, each with the one transform channel it drives. */
export const CRAFT_ANIMATION_CHANNEL: Record<CraftAnimationType, 'position' | 'rotation' | 'scale'> = {
  rotate: 'rotation',
  bob: 'position',
  pulse: 'scale',
  swing: 'rotation',
  orbit: 'position',
}

export function isCraftAnimationType(value: unknown): value is CraftAnimationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CRAFT_ANIMATION_CHANNEL, value)
}

/** Applies `anim` at time `t` (seconds). Returns false for an unknown kind (nothing written). */
export function applyCraftAnimation(target: CraftAnimationTarget, anim: CraftAnimation, base: CraftAnimationBase, t: number): boolean {
  const speed = anim.speed ?? 1
  const amp = anim.amplitude ?? 0.5
  const axisIdx = anim.axis === 'x' ? 0 : anim.axis === 'z' ? 2 : 1
  const basePos = base.position, baseRot = base.rotation, baseScale = base.scale

  switch (anim.type) {
    case 'rotate': {
      const rot = [baseRot[0], baseRot[1], baseRot[2]]
      rot[axisIdx] = baseRot[axisIdx] + t * speed
      target.rotation.set(rot[0], rot[1], rot[2])
      return true
    }
    case 'bob': {
      const pos = [basePos[0], basePos[1], basePos[2]]
      pos[axisIdx] = basePos[axisIdx] + Math.sin(t * speed * 2) * amp
      target.position.set(pos[0], pos[1], pos[2])
      return true
    }
    case 'pulse': {
      const pulseFactor = 1 + Math.sin(t * speed * 3) * amp * 0.3
      target.scale.set(baseScale[0] * pulseFactor, baseScale[1] * pulseFactor, baseScale[2] * pulseFactor)
      return true
    }
    case 'swing': {
      const swingRot = [baseRot[0], baseRot[1], baseRot[2]]
      swingRot[axisIdx] = baseRot[axisIdx] + Math.sin(t * speed * 2) * amp
      target.rotation.set(swingRot[0], swingRot[1], swingRot[2])
      return true
    }
    case 'orbit': {
      const orbitPos = [basePos[0], basePos[1], basePos[2]]
      if (axisIdx === 1) {
        orbitPos[0] = basePos[0] + Math.cos(t * speed) * amp
        orbitPos[2] = basePos[2] + Math.sin(t * speed) * amp
      } else if (axisIdx === 0) {
        orbitPos[1] = basePos[1] + Math.cos(t * speed) * amp
        orbitPos[2] = basePos[2] + Math.sin(t * speed) * amp
      } else {
        orbitPos[0] = basePos[0] + Math.cos(t * speed) * amp
        orbitPos[1] = basePos[1] + Math.sin(t * speed) * amp
      }
      target.position.set(orbitPos[0], orbitPos[1], orbitPos[2])
      return true
    }
    default:
      return false
  }
}
