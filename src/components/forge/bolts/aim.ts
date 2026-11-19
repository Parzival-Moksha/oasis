// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// COMBAT AIM — where a cast leaves from, where it goes, what it will hit. One function for
// every combat spell (bolts, lightning, ice, the machine gun) and every camera.
//
//   1. A ray from the camera through the crosshair meets the first real thing: a world
//      object's meshes (not a guessed sphere), a moving actor, the terrain or the ground.
//   2. The bolt leaves the hand in third person; in first person (third person zoomed in),
//      noclip and orbit it leaves just under the camera's centre. If the aimed point is not
//      in front of the hand (aiming at the ground at your feet, a wall at your shoulder),
//      it leaves from the camera too, so it can never fly back or up past the player.
//   3. A second ray from that origin to the aimed point catches anything in between.
// The old aim tested invisible spheres around each object (radius 0.9 x scale: a dune at
// scale 20 was an 18 m ball) — bolts flew at, and burst on, things nobody could see.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import * as THREE from 'three'

import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { hasTerrainRelief, sampleTerrainHeightAt } from '@/lib/forge/terrain-brush'
import { getLatestPlayers, getLocalSessionId, getPvpEnabled } from '@/lib/pvp-bridge'
import { getVillageAnchors } from '@/components/village/village-actions'
import { VILLAGE_TARGET_HEIGHT, VILLAGE_TARGET_PREFIX, VILLAGE_TARGET_RADIUS, canHitVillageAgent } from '@/lib/village/village-combat'

import { BOLT_MAX_RANGE_M, segmentSphereEntry, type ActorTarget, type Vec3 } from './flight'

export interface CombatAim {
  origin: THREE.Vector3
  direction: THREE.Vector3
  /** The point under the crosshair (or far along it when it meets nothing). */
  aimPoint: THREE.Vector3
  /** Distance from origin to the first world surface on the way; null when the shot meets nothing. */
  impactDistance: number | null
  impactObjectId: string | null
  /** Actor under the crosshair (lightning strikes use it). */
  aimedActor: ActorTarget | null
  fromHand: boolean
}

// ─═̷─ Moving targets ─═̷─
/** Village agents and PvP players, as chest spheres. `excludeLocal`: leave out this client's own capsule. */
export function collectActorTargets(excludeLocal = true): ActorTarget[] {
  const actors: ActorTarget[] = []
  if (getPvpEnabled()) {
    const localId = excludeLocal ? getLocalSessionId() : null
    for (const player of getLatestPlayers()) {
      if (!player.alive || player.sessionId === localId) continue
      actors.push({ id: `pvp:${player.sessionId}`, center: [player.position[0], player.position[1] + 0.7, player.position[2]], radius: 0.7 })
    }
  }
  const now = Date.now()
  for (const [agentId, anchor] of Object.entries(getVillageAnchors())) {
    if (!canHitVillageAgent(agentId, now)) continue
    actors.push({ id: `${VILLAGE_TARGET_PREFIX}${agentId}`, center: [anchor[0], anchor[1] + VILLAGE_TARGET_HEIGHT, anchor[2]], radius: VILLAGE_TARGET_RADIUS })
  }
  return actors
}

// ─═̷─ World meshes ─═̷─
interface MeshCache { scene: THREE.Object3D | null; at: number; meshes: THREE.Object3D[] }
const meshCache: MeshCache = { scene: null, at: 0, meshes: [] }
const MESH_CACHE_MS = 400

function isSolidMesh(object: THREE.Object3D): boolean {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return false
  if (mesh.userData?.oasisSelectionProxy) return false
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.some(m => m && m.visible !== false && !(m.transparent && m.opacity < 0.08))
}

/** Visible meshes of world objects (groups tagged userData.oasisObjectId). Skinned meshes are skipped: costly to ray-test. */
function worldMeshes(scene: THREE.Object3D): THREE.Object3D[] {
  const now = performance.now()
  if (meshCache.scene === scene && now - meshCache.at < MESH_CACHE_MS) return meshCache.meshes
  const meshes: THREE.Object3D[] = []
  const visit = (object: THREE.Object3D) => {
    if (!object.visible) return
    if (object.name === 'combat-bolt-layer') return
    if (object.userData?.oasisObjectId) {
      object.traverseVisible(child => { if (isSolidMesh(child)) meshes.push(child) })
      return
    }
    for (const child of object.children) visit(child)
  }
  visit(scene)
  meshCache.scene = scene
  meshCache.at = now
  meshCache.meshes = meshes
  return meshes
}

function objectIdOf(object: THREE.Object3D | null): string | null {
  for (let o = object; o; o = o.parent) {
    const id = o.userData?.oasisObjectId
    if (typeof id === 'string') return id
  }
  return null
}

function groundHeightAt(x: number, z: number): number {
  const heights = useOasisStore.getState().terrainHeights
  return heights && heights.length > 0 && hasTerrainRelief(heights) ? sampleTerrainHeightAt(heights, x, z) : 0
}

/** Distance along a ray to the ground or terrain, marching coarse then refining; null if none within maxDistance. */
export function rayGroundDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): number | null {
  const heightAt = (t: number) => origin.y + dir.y * t - groundHeightAt(origin.x + dir.x * t, origin.z + dir.z * t)
  const heights = useOasisStore.getState().terrainHeights
  if (!heights || heights.length === 0 || !hasTerrainRelief(heights)) {
    if (dir.y >= -1e-4) return null
    const t = -origin.y / dir.y
    return t >= 0 && t <= maxDistance ? t : null
  }
  if (heightAt(0) <= 0) return 0
  const step = 0.75
  let prev = 0
  for (let t = step; t <= maxDistance + step; t += step) {
    const tt = Math.min(t, maxDistance)
    if (heightAt(tt) <= 0) {
      let lo = prev
      let hi = tt
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2
        if (heightAt(mid) <= 0) hi = mid
        else lo = mid
      }
      return hi
    }
    prev = tt
    if (tt >= maxDistance) break
  }
  return null
}

const raycaster = new THREE.Raycaster()

interface RayHit { distance: number; objectId: string | null }

/** First solid thing along a ray: world meshes, then terrain/ground. */
function castWorld(scene: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number): RayHit | null {
  raycaster.set(origin, dir)
  raycaster.near = 0.05
  raycaster.far = maxDistance
  let best: RayHit | null = null
  const hits = raycaster.intersectObjects(worldMeshes(scene), false)
  if (hits.length > 0) best = { distance: hits[0].distance, objectId: objectIdOf(hits[0].object) }
  const ground = rayGroundDistance(origin, dir, best ? best.distance : maxDistance)
  if (ground !== null && (!best || ground < best.distance)) best = { distance: ground, objectId: null }
  return best
}

/** The first world surface along a given path (remote PvP bolts: their caster sent origin + direction). */
export function worldImpactAlong(scene: THREE.Object3D, origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = BOLT_MAX_RANGE_M): { distance: number; objectId: string | null } | null {
  return castWorld(scene, origin, direction.clone().normalize(), maxDistance)
}

function firstActorOnRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDistance: number, actors: ActorTarget[]): { actor: ActorTarget; distance: number } | null {
  const o: Vec3 = [origin.x, origin.y, origin.z]
  const d: Vec3 = [dir.x, dir.y, dir.z]
  let best: { actor: ActorTarget; distance: number } | null = null
  for (const actor of actors) {
    const t = segmentSphereEntry(o, d, maxDistance, actor.center, actor.radius)
    if (t !== null && t > 0.3 && (!best || t < best.distance)) best = { actor, distance: t }
  }
  return best
}

/** The camera is this close to the avatar's head: treat third person as first person. */
const FIRST_PERSON_CAMERA_DISTANCE_M = 1.7
/** The aimed point must be at least this far in front of the hand, or the shot leaves from the camera. */
const MIN_AHEAD_OF_HAND_M = 1.2

/**
 * Where a cast leaves from, for a target `aimDistance` along the crosshair: the hand in third
 * person, else (first person, noclip, orbit, or a target not in front of the hand) just under the
 * camera's centre. No raycasts: the machine gun calls it every round.
 */
export function castOrigin(camera: THREE.Camera, aimDistance: number): { origin: THREE.Vector3; fromHand: boolean } {
  const camPos = new THREE.Vector3()
  const camDir = new THREE.Vector3()
  camera.getWorldPosition(camPos)
  camera.getWorldDirection(camDir).normalize()
  const pose = getPlayerAvatarPose()
  if (pose && useInputManager.getState().inputState === 'third-person') {
    const [px, py, pz] = pose.position
    const head = new THREE.Vector3(px, py + 1.55, pz)
    if (camPos.distanceTo(head) > FIRST_PERSON_CAMERA_DISTANCE_M) {
      const forward = new THREE.Vector3(pose.forward[0], 0, pose.forward[2])
      if (forward.lengthSq() < 1e-6) forward.set(camDir.x, 0, camDir.z)
      forward.normalize()
      const poseRight = new THREE.Vector3(-forward.z, 0, forward.x)
      const hand = new THREE.Vector3(px, py + 1.25, pz).addScaledVector(forward, 0.45).addScaledVector(poseRight, 0.3)
      const handAlongView = hand.clone().sub(camPos).dot(camDir)
      if (aimDistance - handAlongView >= MIN_AHEAD_OF_HAND_M) return { origin: hand, fromHand: true }
    }
  }
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
  return { origin: camPos.addScaledVector(camDir, 0.55).addScaledVector(up, -0.14).addScaledVector(right, 0.1), fromHand: false }
}

export function resolveCombatAim(camera: THREE.Camera, scene: THREE.Object3D, maxDistance = BOLT_MAX_RANGE_M): CombatAim {
  camera.updateMatrixWorld()
  const camPos = new THREE.Vector3()
  const camDir = new THREE.Vector3()
  camera.getWorldPosition(camPos)
  camera.getWorldDirection(camDir).normalize()

  // 1. What the crosshair is on.
  const actors = collectActorTargets(true)
  const worldHit = castWorld(scene, camPos, camDir, maxDistance)
  const actorHit = firstActorOnRay(camPos, camDir, worldHit ? worldHit.distance : maxDistance, actors)
  const aimDistance = actorHit ? actorHit.distance : worldHit ? worldHit.distance : maxDistance
  const aimPoint = camPos.clone().addScaledVector(camDir, aimDistance)

  // 2. Where it leaves from.
  const { origin, fromHand } = castOrigin(camera, aimDistance)
  const toAim = aimPoint.clone().sub(origin)
  const reach = toAim.length()
  const direction = reach > 1e-4 ? toAim.divideScalar(reach) : camDir.clone()

  // 3. What it meets on its own path (the hand sees past corners the camera does not).
  let impactDistance: number | null = null
  let impactObjectId: string | null = null
  // Aimed at a wall: up to it. Aimed at an actor or the sky: all the way, so a dodging actor's wall still stops the bolt.
  const pathHit = castWorld(scene, origin, direction, worldHit && !actorHit ? reach + 0.25 : maxDistance)
  if (pathHit) {
    impactDistance = pathHit.distance
    impactObjectId = pathHit.objectId
  } else if (worldHit && !actorHit) {
    impactDistance = reach
    impactObjectId = worldHit.objectId
  }

  return { origin, direction, aimPoint, impactDistance, impactObjectId, aimedActor: actorHit?.actor ?? null, fromHand }
}

/** Ground point under an aim (lightning strikes from the sky land here). */
export function strikePointFor(aim: CombatAim): THREE.Vector3 {
  if (aim.aimedActor) {
    const [x, , z] = aim.aimedActor.center
    return new THREE.Vector3(x, groundHeightAt(x, z), z)
  }
  // The surface it hits (ground, a roof, a wall); aimed at the sky: the ground 8 m ahead.
  if (aim.impactDistance !== null) return aim.origin.clone().addScaledVector(aim.direction, aim.impactDistance)
  const flat = new THREE.Vector3(aim.direction.x, 0, aim.direction.z)
  if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1)
  const p = aim.origin.clone().addScaledVector(flat.normalize(), 8)
  return p.setY(groundHeightAt(p.x, p.z))
}
