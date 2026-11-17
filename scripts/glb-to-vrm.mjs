// Turn a rigged humanoid GLB (Tripo or Meshy, Mixamo-style bone names) into a VRM 1.0 file that the
// Oasis can use as an avatar: the village's idle, walk and gesture clips are retargeted through the
// VRM humanoid, so a plain rigged GLB would only stand frozen.
//
//   node scripts/glb-to-vrm.mjs <in.glb> <out.vrm> [--name Hacker] [--height 1.75] [--texture 1024] [--author "…"]
//
// What it does:
//   1. Shrinks the textures (sharp) so a 40 MB generation becomes a few MB.
//   2. Puts the character upright on the ground, facing +Z (VRM 1.0), `--height` metres tall, by
//      wrapping the scene in one root node (nothing is re-skinned).
//   3. Makes the rest pose a T-pose: an A-pose rig has its upper arms turned until they lie along
//      the shoulders' line. VRM animation assumes a T-pose at rest; with an A-pose every clip's arms
//      would hang 40 degrees too low.
//   4. Writes the VRMC_vrm extension: meta and the humanoid bone map.
// What it cannot give: a face. A generated mesh has no blend shapes, so no visemes and no blink.

import { readFileSync, writeFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress, prune, dedup } from '@gltf-transform/functions'
import sharp from 'sharp'
import * as THREE from 'three'

const args = process.argv.slice(2)
const [input, output] = args
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
if (!input || !output) { console.error('usage: glb-to-vrm.mjs <in.glb> <out.vrm> [--name N] [--height 1.75] [--texture 1024] [--author A]'); process.exit(1) }
const NAME = opt('name', 'Avatar')
const HEIGHT = Number(opt('height', '1.75'))
const TEXTURE = Number(opt('texture', '1024'))
const AUTHOR = opt('author', 'Generated for the Oasis')

// VRM humanoid bone → the names rigs use for it (lower-cased, prefixes and separators stripped).
const BONES = {
  hips: ['hips', 'hip', 'pelvis'],
  spine: ['spine', 'spine01', 'waist'],
  chest: ['spine1', 'spine02', 'chest'],
  upperChest: ['spine2', 'spine03', 'upperchest'],
  neck: ['neck'],
  head: ['head'],
  leftShoulder: ['leftshoulder', 'lclavicle', 'lshoulder'],
  leftUpperArm: ['leftarm', 'lupperarm', 'leftupperarm'],
  leftLowerArm: ['leftforearm', 'lforearm', 'leftlowerarm'],
  leftHand: ['lefthand', 'lhand'],
  rightShoulder: ['rightshoulder', 'rclavicle', 'rshoulder'],
  rightUpperArm: ['rightarm', 'rupperarm', 'rightupperarm'],
  rightLowerArm: ['rightforearm', 'rforearm', 'rightlowerarm'],
  rightHand: ['righthand', 'rhand'],
  leftUpperLeg: ['leftupleg', 'lthigh', 'leftupperleg'],
  leftLowerLeg: ['leftleg', 'lcalf', 'leftlowerleg'],
  leftFoot: ['leftfoot', 'lfoot'],
  leftToes: ['lefttoebase', 'ltoe', 'lefttoes'],
  rightUpperLeg: ['rightupleg', 'rthigh', 'rightupperleg'],
  rightLowerLeg: ['rightleg', 'rcalf', 'rightlowerleg'],
  rightFoot: ['rightfoot', 'rfoot'],
  rightToes: ['righttoebase', 'rtoe', 'righttoes'],
}
const REQUIRED = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
const bare = name => String(name || '').toLowerCase().replace(/^mixamorig\d*[:_]?/, '').replace(/[^a-z0-9]/g, '')

// ── 1. textures ───────────────────────────────────────────────────────────────────────────────
const io = new NodeIO()
const document = await io.read(input)
await document.transform(
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 86, resize: [TEXTURE, TEXTURE] }),
)
const glb = await io.writeBinary(document)

// ── read the GLB's JSON chunk ─────────────────────────────────────────────────────────────────
const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
const jsonLength = view.getUint32(12, true)
const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
const binStart = 20 + jsonLength
const bin = glb.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true))

const nodes = json.nodes
const parentOf = new Map()
nodes.forEach((node, index) => (node.children || []).forEach(child => parentOf.set(child, index)))
const local = index => {
  const n = nodes[index]
  if (n.matrix) return new THREE.Matrix4().fromArray(n.matrix)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation || [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale || [1, 1, 1])),
  )
}
const world = index => {
  const m = local(index)
  const parent = parentOf.get(index)
  return parent === undefined ? m : world(parent).multiply(m)
}
const worldPos = index => new THREE.Vector3().setFromMatrixPosition(world(index))

// ── bone map ─────────────────────────────────────────────────────────────────────────────────
const joints = new Set((json.skins || []).flatMap(skin => skin.joints))
const human = {}
for (const [bone, names] of Object.entries(BONES)) {
  const index = nodes.findIndex((node, i) => joints.has(i) && names.includes(bare(node.name)))
  if (index >= 0) human[bone] = index
}
const missing = REQUIRED.filter(bone => human[bone] === undefined)
if (missing.length) {
  console.error('missing bones:', missing.join(', '))
  console.error('joint names:', [...joints].map(i => nodes[i].name).join(', '))
  process.exit(2)
}

// ── 2. upright, facing +Z, on the ground, HEIGHT tall ─────────────────────────────────────────
// The character's own axes, from its skeleton: up (hips to head) and its left (right arm to left arm).
const up = worldPos(human.head).sub(worldPos(human.hips)).normalize()
const left = worldPos(human.leftUpperArm).sub(worldPos(human.rightUpperArm))
left.addScaledVector(up, -left.dot(up)).normalize()
const forward = new THREE.Vector3().crossVectors(left, up).normalize() // left × up = forward for a right-handed, +Z-facing figure
const basis = new THREE.Matrix4().makeBasis(left, up, forward) // character axes → world
const align = new THREE.Quaternion().setFromRotationMatrix(basis).invert() // world → x left, y up, z forward

// Size and ground from the mesh itself (bind-pose vertex bounds through each mesh node's world matrix).
const box = new THREE.Box3()
nodes.forEach((node, index) => {
  if (node.mesh === undefined) return
  const matrix = node.skin !== undefined ? new THREE.Matrix4() : world(index) // a skinned mesh's vertices are already in skeleton space
  for (const primitive of json.meshes[node.mesh].primitives) {
    const accessor = json.accessors[primitive.attributes.POSITION]
    if (!accessor.min || !accessor.max) continue
    for (const x of [accessor.min[0], accessor.max[0]]) for (const y of [accessor.min[1], accessor.max[1]]) for (const z of [accessor.min[2], accessor.max[2]]) {
      box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix).applyQuaternion(align))
    }
  }
})
const tall = box.max.y - box.min.y
const scale = tall > 1e-6 ? HEIGHT / tall : 1
const centreX = (box.min.x + box.max.x) / 2
const centreZ = (box.min.z + box.max.z) / 2
const rootIndex = nodes.length
const scene = json.scenes[json.scene ?? 0]
nodes.push({
  name: `${NAME}_Root`,
  children: scene.nodes.slice(),
  rotation: align.toArray(),
  scale: [scale, scale, scale],
  translation: [-centreX * scale, -box.min.y * scale, -centreZ * scale],
})
scene.nodes = [rootIndex]
;(nodes[rootIndex].children).forEach(child => parentOf.set(child, rootIndex))

const ankleBefore = Math.min(worldPos(human.leftFoot).y, worldPos(human.rightFoot).y)

// ── 3. T-pose at rest ────────────────────────────────────────────────────────────────────────
// Turn each limb segment (in world space, about its own joint) to where the T-pose has it: arms straight out
// to the sides, legs straight down. Parents first, so a child is measured after its parent has moved.
let turned = 0
const down = new THREE.Vector3(0, -1, 0)
const SEGMENTS = [
  ['left upper arm', human.leftUpperArm, human.leftLowerArm, new THREE.Vector3(1, 0, 0)], // after step 2 the character's left is world +x
  ['left forearm', human.leftLowerArm, human.leftHand, new THREE.Vector3(1, 0, 0)],
  ['right upper arm', human.rightUpperArm, human.rightLowerArm, new THREE.Vector3(-1, 0, 0)],
  ['right forearm', human.rightLowerArm, human.rightHand, new THREE.Vector3(-1, 0, 0)],
  ['left thigh', human.leftUpperLeg, human.leftLowerLeg, down],
  ['left shin', human.leftLowerLeg, human.leftFoot, down],
  ['right thigh', human.rightUpperLeg, human.rightLowerLeg, down],
  ['right shin', human.rightLowerLeg, human.rightFoot, down],
]
for (const [label, joint, child, to] of SEGMENTS) {
  const from = worldPos(child).sub(worldPos(joint)).normalize()
  const angle = from.angleTo(to)
  if (angle < THREE.MathUtils.degToRad(0.75)) continue
  const turn = new THREE.Quaternion().setFromUnitVectors(from, to)
  // new world rotation = turn * old world rotation; convert back to the bone's local rotation.
  const parentWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(world(parentOf.get(joint))))
  const oldWorld = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(world(joint)))
  const nextLocal = parentWorld.clone().invert().multiply(turn).multiply(oldWorld).normalize()
  const node = nodes[joint]
  if (node.matrix) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    new THREE.Matrix4().fromArray(node.matrix).decompose(p, q, sc)
    delete node.matrix
    node.translation = p.toArray(); node.scale = sc.toArray()
  }
  node.rotation = nextLocal.toArray()
  turned += 1
  console.log(`  ${label} turned ${THREE.MathUtils.radToDeg(angle).toFixed(1)}° to the T-pose`)
}
// Straightening the legs can lift or lower the soles: put the lower foot back on the ground.
const ankleAfter = Math.min(worldPos(human.leftFoot).y, worldPos(human.rightFoot).y)
nodes[rootIndex].translation[1] += ankleBefore - ankleAfter

// ── 4. the VRM extension ─────────────────────────────────────────────────────────────────────
json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'VRMC_vrm'])]
json.extensions = {
  ...(json.extensions || {}),
  VRMC_vrm: {
    specVersion: '1.0',
    meta: {
      name: NAME,
      version: '1',
      authors: [AUTHOR],
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      avatarPermission: 'onlyAuthor',
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      commercialUsage: 'personalNonProfit',
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
      creditNotation: 'unnecessary',
      allowRedistribution: false,
      modification: 'allowModification',
    },
    humanoid: { humanBones: Object.fromEntries(Object.entries(human).map(([bone, node]) => [bone, { node }])) },
    expressions: { preset: {} },
  },
}

// ── write ────────────────────────────────────────────────────────────────────────────────────
const pad = (bytes, fill) => { const extra = (4 - (bytes.length % 4)) % 4; if (!extra) return bytes; const out = new Uint8Array(bytes.length + extra).fill(fill); out.set(bytes); return out }
const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20)
const binBytes = pad(bin, 0)
const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length
const out = new Uint8Array(total)
const dv = new DataView(out.buffer)
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true)
dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20)
dv.setUint32(20 + jsonBytes.length, binBytes.length, true); dv.setUint32(24 + jsonBytes.length, 0x004e4942, true); out.set(binBytes, 28 + jsonBytes.length)
writeFileSync(output, out)

const triangles = json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + (p.indices !== undefined ? json.accessors[p.indices].count / 3 : 0), 0), 0)
console.log(`${output}: ${(total / 1048576).toFixed(1)} MB (from ${(readFileSync(input).length / 1048576).toFixed(1)} MB), ${Math.round(triangles)} triangles, ${Object.keys(human).length} humanoid bones, ${joints.size} joints, scale ×${scale.toFixed(3)} to ${HEIGHT} m, limb segments turned: ${turned}`)
console.log('  morph targets (for visemes):', json.meshes.some(mesh => mesh.primitives.some(p => p.targets?.length)) ? 'yes' : 'none: the mouth will not move')
