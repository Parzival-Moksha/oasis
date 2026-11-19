// Clips written in code instead of motion capture: Hipster's test of the owner's question "could the Hipster
// generate motion from a prompt?". Poses are set on the VRM normalized humanoid, where every bone's rest
// rotation is the identity and the axes are the world's (the character faces +Z, its left is +X), so a pose is
// "this segment points that way". Small sine motions on top make it alive. One clip so far: sitting and typing.

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

export const AUTHORED_CLIPS = [
  { id: 'authored-sit-type', label: 'Sit and type (code)' },
] as const

export function isAuthoredClip(id: string): boolean {
  return AUTHORED_CLIPS.some(clip => clip.id === id)
}

type V = [number, number, number]
const v = (a: V) => new THREE.Vector3(...a).normalize()

/** Rest directions of the segments in the normalized T-pose. */
const REST: Record<string, V> = {
  leftUpperArm: [1, 0, 0], leftLowerArm: [1, 0, 0], leftHand: [1, 0, 0],
  rightUpperArm: [-1, 0, 0], rightLowerArm: [-1, 0, 0], rightHand: [-1, 0, 0],
  leftUpperLeg: [0, -1, 0], leftLowerLeg: [0, -1, 0],
  rightUpperLeg: [0, -1, 0], rightLowerLeg: [0, -1, 0],
}

const PARENT: Record<string, string | null> = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  leftUpperArm: 'chest', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
  rightUpperArm: 'chest', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg',
  rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg',
}

/** World rotations of the sitting, typing pose at time t (seconds) in a 2-second loop. */
function sitTypePose(t: number): Record<string, THREE.Quaternion> {
  const w = 2 * Math.PI / 2 // one loop every 2 s
  const tapL = Math.sin(t * w * 4) * 0.05 // fingers on the keys: a quick alternate patter
  const tapR = Math.sin(t * w * 4 + Math.PI) * 0.05
  const breathe = Math.sin(t * w) * 0.015
  const look = Math.sin(t * w * 0.5) * 0.06 // eyes from one side of the screen to the other
  const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.16 + breathe)
  const dir = (bone: string, to: V) => new THREE.Quaternion().setFromUnitVectors(v(REST[bone]), v(to))
  const headTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), look)
  const headTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.32)
  return {
    hips: new THREE.Quaternion(),
    spine: lean.clone(),
    chest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.04)),
    upperChest: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06)),
    neck: lean.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06)),
    head: headTurn.multiply(headTilt),
    leftUpperArm: dir('leftUpperArm', [0.18, -0.88, 0.42]),
    rightUpperArm: dir('rightUpperArm', [-0.18, -0.88, 0.42]),
    leftLowerArm: dir('leftLowerArm', [-0.18, -0.12 + tapL, 1]),
    rightLowerArm: dir('rightLowerArm', [0.18, -0.12 + tapR, 1]),
    leftHand: dir('leftHand', [-0.1, -0.25 + tapL * 2, 1]),
    rightHand: dir('rightHand', [0.1, -0.25 + tapR * 2, 1]),
    leftUpperLeg: dir('leftUpperLeg', [0.06, -0.08, 1]),
    rightUpperLeg: dir('rightUpperLeg', [-0.06, -0.08, 1]),
    leftLowerLeg: dir('leftLowerLeg', [0.02, -1, 0.12]),
    rightLowerLeg: dir('rightLowerLeg', [-0.02, -1, 0.12]),
    leftFoot: new THREE.Quaternion(),
    rightFoot: new THREE.Quaternion(),
  }
}

/** Build the clip for one avatar (bone names differ between VRM files). */
export function buildAuthoredClip(id: string, vrm: VRM): THREE.AnimationClip | null {
  if (id !== 'authored-sit-type') return null
  const duration = 2
  const keys = 25
  const times = Array.from({ length: keys }, (_, i) => (i / (keys - 1)) * duration)
  const poses = times.map(t => sitTypePose(t))
  const vrm0 = (vrm.meta as { metaVersion?: string } | undefined)?.metaVersion === '0'
  const tracks: THREE.KeyframeTrack[] = []
  for (const bone of Object.keys(PARENT)) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    if (!node) continue
    const values: number[] = []
    for (const pose of poses) {
      // local = (world rotation of the nearest present parent)^-1 * world rotation of this bone
      let parent = PARENT[bone]
      while (parent && !vrm.humanoid.getNormalizedBoneNode(parent as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])) parent = PARENT[parent]
      const world = pose[bone] ?? new THREE.Quaternion()
      const local = parent ? (pose[parent] ?? new THREE.Quaternion()).clone().invert().multiply(world) : world.clone()
      if (vrm0) { local.x = -local.x; local.z = -local.z }
      values.push(local.x, local.y, local.z, local.w)
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  }
  // Hips down to chair height and a little back.
  const hips = vrm.humanoid.getNormalizedBoneNode('hips' as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
  const rest = (vrm.humanoid as unknown as { normalizedRestPose?: { hips?: { position?: number[] } } }).normalizedRestPose?.hips?.position
  if (hips && rest) {
    const sign = vrm0 ? -1 : 1
    const values: number[] = []
    for (let i = 0; i < keys; i++) values.push(rest[0], rest[1] * 0.56, rest[2] - sign * rest[1] * 0.12)
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, values))
  }
  return new THREE.AnimationClip(id, duration, tracks)
}
