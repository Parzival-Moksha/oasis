'use client'

// The camera behind the main menu. Lives inside the Canvas and costs nothing while the menu is
// closed (no frame callback is subscribed).
//
// Open: the input manager is in 'ui-focused', so nobody else moves the camera. This component
// remembers where it was ("home") and each frame writes home turned about a pivot ahead (see
// menu-drift.ts). Four times a second it looks 1.6 m along its way with one ray; a hit ends the
// allowed arc there.
// Closing: the same turn runs back to zero in 0.9 s. In third person the character is already
// under control again and writes the camera each frame; the leftover turn is laid on top of that,
// so the camera lands exactly on the character's own camera. In the free cameras nothing writes the
// camera, so it lands exactly on home, and only then does input come back.

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, type RootState } from '@react-three/fiber'
import { useFrameWhen } from '@/lib/use-frame-when'
import { useInputManager } from '@/lib/input-manager'
import { useOasisStore } from '@/store/oasisStore'
import { sampleTerrainHeightAt } from '@/lib/forge/terrain-brush'
import { useGameMenu } from '@/lib/game-menu/menu-store'
import {
  DRIFT,
  blockDrift,
  clearGround,
  driftAngle,
  driftBob,
  driftPivot,
  horizontalDistance,
  returnRemainder,
  startDrift,
  stepDrift,
  type DriftState,
} from '@/lib/game-menu/menu-drift'

const UP = new THREE.Vector3(0, 1, 0)
const PROBE_EVERY = 0.25
const PROBE_AHEAD = 1.6
/** In third person the camera sits about this far behind the character. */
const THIRD_PERSON_BACK = 5

interface Session {
  openCount: number
  homePos: THREE.Vector3
  homeQuat: THREE.Quaternion
  pivot: THREE.Vector3
  radius: number
  drift: DriftState
  probeIn: number
  /** Frames spent waiting for the camera to be left alone before taking "home". */
  settle: number
}

function isDrawn(object: THREE.Object3D): boolean {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh) return false
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
  if (!material || material.visible === false) return false
  if (material.transparent && material.opacity < 0.2) return false
  if (material.side === THREE.BackSide) return false // sky domes
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

export function GameMenuCameraDrift() {
  const phase = useGameMenu(s => s.phase)
  const sessionRef = useRef<Session | null>(null)
  const returnRef = useRef<{ elapsed: number; s0: number } | null>(null)
  const wroteRef = useRef(new THREE.Vector3(Number.NaN, 0, 0))
  const scratch = useRef({
    raycaster: new THREE.Raycaster(),
    yaw: new THREE.Quaternion(),
    basePos: new THREE.Vector3(),
    baseQuat: new THREE.Quaternion(),
    pivot: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    dir: new THREE.Vector3(),
  })

  const camera = useThree(s => s.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  /** Nobody else is moving the camera: put it back where the menu found it. */
  const snapHome = () => {
    const session = sessionRef.current
    if (!session || session.openCount <= 0 || session.drift.s === 0) return
    const cam = cameraRef.current
    if (cam.position.equals(wroteRef.current)) {
      cam.position.copy(session.homePos)
      cam.quaternion.copy(session.homeQuat)
      cam.updateMatrixWorld()
    }
    session.drift = { ...session.drift, s: 0, v: 0 }
    wroteRef.current.set(Number.NaN, 0, 0)
    returnRef.current = null
  }

  // The close finished without the way back (a hidden tab, the store's fallback timer).
  useEffect(() => {
    if (phase === 'closed') snapHome()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Another world: its camera is not ours to move. Forget the drift and close.
  useEffect(() => useOasisStore.subscribe((state, prev) => {
    if (state.activeWorldId === prev.activeWorldId) return
    const menu = useGameMenu.getState()
    if (menu.phase === 'closed') return
    if (sessionRef.current) sessionRef.current.drift = { ...sessionRef.current.drift, s: 0, v: 0 }
    wroteRef.current.set(Number.NaN, 0, 0)
    returnRef.current = null
    menu.closeMenu()
    menu.finishClose()
  }), [])

  /** Camera = base turned by the drift at arc distance `s` about the pivot, a little higher, above ground. */
  const writeCamera = (state: RootState, session: Session, base: { pos: THREE.Vector3; quat: THREE.Quaternion }, pivot: THREE.Vector3, s: number, bobScale: number) => {
    const tmp = scratch.current
    const angle = driftAngle(s, session.radius)
    tmp.yaw.setFromAxisAngle(UP, angle)
    const cam = state.camera
    cam.position.copy(base.pos).sub(pivot).applyQuaternion(tmp.yaw).add(pivot)
    cam.position.y = base.pos.y + driftBob(s) * bobScale
    if (s !== 0) {
      const ground = sampleTerrainHeightAt(useOasisStore.getState().terrainHeights, cam.position.x, cam.position.z)
      if (Number.isFinite(ground)) cam.position.y = clearGround(cam.position.y, ground)
    }
    cam.quaternion.copy(base.quat).premultiply(tmp.yaw)
    cam.updateMatrixWorld()
    wroteRef.current.copy(cam.position)
  }

  /** Is the way to arc distance `s + ahead` clear? Returns the free distance, or null when clear. */
  const probe = (state: RootState, session: Session, heading: number): number | null => {
    const tmp = scratch.current
    const next = session.drift.s + heading * PROBE_AHEAD
    tmp.from.copy(state.camera.position)
    tmp.yaw.setFromAxisAngle(UP, driftAngle(next, session.radius))
    tmp.to.copy(session.homePos).sub(session.pivot).applyQuaternion(tmp.yaw).add(session.pivot)
    tmp.to.y = tmp.from.y
    tmp.dir.copy(tmp.to).sub(tmp.from)
    const length = tmp.dir.length()
    if (length < 0.05) return null
    tmp.dir.divideScalar(length)
    tmp.raycaster.set(tmp.from, tmp.dir)
    tmp.raycaster.near = 0
    tmp.raycaster.far = length + 0.4
    const hits = tmp.raycaster.intersectObjects(state.scene.children, true)
    for (const hit of hits) if (isDrawn(hit.object)) return hit.distance
    // Ground rising in the way counts too.
    const ground = sampleTerrainHeightAt(useOasisStore.getState().terrainHeights, tmp.to.x, tmp.to.z)
    if (Number.isFinite(ground) && ground + DRIFT.groundClearance > tmp.from.y + 1.5) return length
    return null
  }

  useFrameWhen(phase === 'open', (state, rawDelta) => {
    const menu = useGameMenu.getState()
    if (menu.phase !== 'open') return
    let session = sessionRef.current
    if (!session || session.openCount !== menu.openCount) {
      // Take "home" once the camera has been left alone for two frames.
      const input = useInputManager.getState()
      if (input.inputState !== 'ui-focused') return
      const pending = sessionRef.current && sessionRef.current.openCount === -menu.openCount ? sessionRef.current : null
      if (!pending) {
        sessionRef.current = {
          openCount: -menu.openCount, homePos: new THREE.Vector3(), homeQuat: new THREE.Quaternion(), pivot: new THREE.Vector3(),
          radius: DRIFT.pivotAhead, drift: startDrift(DRIFT.pivotAhead, 1), probeIn: 0, settle: 1,
        }
        return
      }
      if (pending.settle < 2) { pending.settle += 1; return }
      const cam = state.camera
      const forward = cam.getWorldDirection(scratch.current.dir)
      const thirdPerson = input._previousCameraState === 'third-person'
      const ahead = DRIFT.pivotAhead + (thirdPerson ? THIRD_PERSON_BACK : 0)
      // Looking straight down there is no "ahead" on the ground: use the top of the screen instead.
      const flat = Math.hypot(forward.x, forward.z) >= 0.05 ? forward : scratch.current.to.set(0, 1, 0).applyQuaternion(cam.quaternion)
      const pivot = driftPivot(cam.position, flat, ahead) ?? { x: cam.position.x, y: cam.position.y, z: cam.position.z - ahead }
      pending.homePos.copy(cam.position)
      pending.homeQuat.copy(cam.quaternion)
      pending.pivot.set(pivot.x, pivot.y, pivot.z)
      pending.radius = Math.max(DRIFT.minRadius, horizontalDistance(cam.position, pivot))
      pending.openCount = menu.openCount
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
      pending.drift = startDrift(pending.radius, dir)
      session = pending
      // If the first metres that way are blocked, start the other way.
      const blocked = probe(state, session, dir)
      if (blocked !== null) {
        session.drift = blockDrift({ ...session.drift, v: dir * 0.001 }, blocked)
        session.drift = { ...session.drift, v: 0, dir: (dir === 1 ? -1 : 1) }
      }
      session.probeIn = PROBE_EVERY
      returnRef.current = null
    }
    if (!menu.prefs.drift) return
    const delta = Math.min(rawDelta, 0.1)
    session.drift = stepDrift(session.drift, delta)
    session.probeIn -= delta
    if (session.probeIn <= 0 && Math.abs(session.drift.v) > 0.05) {
      session.probeIn = PROBE_EVERY
      const blocked = probe(state, session, Math.sign(session.drift.v))
      if (blocked !== null) session.drift = blockDrift(session.drift, blocked)
    }
    writeCamera(state, session, { pos: session.homePos, quat: session.homeQuat }, session.pivot, session.drift.s, 1)
  })

  useFrameWhen(phase === 'returning', (state, rawDelta) => {
    const menu = useGameMenu.getState()
    if (menu.phase !== 'returning') return
    const session = sessionRef.current
    if (!session || session.openCount !== menu.openCount || session.drift.s === 0) {
      menu.finishClose()
      return
    }
    const ret = returnRef.current ?? (returnRef.current = { elapsed: 0, s0: session.drift.s })
    ret.elapsed += Math.min(rawDelta, 0.1)
    const left = returnRemainder(ret.elapsed)
    const tmp = scratch.current
    const cam = state.camera
    // Whoever owns the camera now (the character in third person) has written it this frame: that
    // is the base. If nobody has, the camera still holds what was written here last frame, and the
    // base is home.
    // Only third person writes the camera each frame from its own state; a free camera that was
    // nudged must not become the base, or the leftover turn would be applied on top of itself.
    const input = useInputManager.getState()
    const avatarOwns = input.inputState === 'third-person'
      || ((input.inputState === 'placement' || input.inputState === 'paint') && input._previousCameraState === 'third-person')
    const untouched = !avatarOwns || cam.position.equals(wroteRef.current)
    if (untouched) {
      tmp.basePos.copy(session.homePos)
      tmp.baseQuat.copy(session.homeQuat)
      tmp.pivot.copy(session.pivot)
    } else {
      tmp.basePos.copy(cam.position)
      tmp.baseQuat.copy(cam.quaternion)
      tmp.pivot.copy(session.pivot).add(tmp.basePos).sub(session.homePos)
    }
    if (left <= 0) {
      cam.position.copy(tmp.basePos)
      cam.quaternion.copy(tmp.baseQuat)
      cam.updateMatrixWorld()
      wroteRef.current.set(Number.NaN, 0, 0)
      session.drift = { ...session.drift, s: 0, v: 0 }
      returnRef.current = null
      menu.finishClose()
      return
    }
    writeCamera(state, session, { pos: tmp.basePos, quat: tmp.baseQuat }, tmp.pivot, ret.s0 * left, left)
  })

  return null
}
