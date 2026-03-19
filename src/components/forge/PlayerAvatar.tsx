'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PLAYER AVATAR — YOUR body in the Oasis
// ─═̷─═̷─ॐ─═̷─═̷─ Not a world object. Not deletable. YOU. ─═̷─═̷─ॐ─═̷─═̷─
//
// Three modes:
//   orbit:       decorative, stands idle at last position (visible but passive)
//   fps:         hidden (you ARE the camera, no body to see)
//   third-person: WASD moves avatar, camera orbits behind, mouse controls direction
//
// Uses same VRM loading + Mixamo retargeting pipeline as VRMCatalogRenderer.
// NOT stored in world data — per-user, ephemeral, always present.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useEffect, useState, useCallback } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import { loadAnimationClip, retargetClipForVRM } from '../../lib/forge/animation-library'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface PlayerAvatarProps {
  url: string
  controlMode: 'orbit' | 'noclip' | 'third-person'
  moveSpeed?: number
  mouseSensitivity?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_DELTA = 0.05
const CAMERA_DISTANCE = 5
const CAMERA_HEIGHT_OFFSET = 1.5 // Look at chest height
const MIN_ELEVATION = -1.2 // Near ground level
const MAX_ELEVATION = 1.5  // Almost directly above

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function PlayerAvatar({
  url,
  controlMode,
  moveSpeed = 6,
  mouseSensitivity = 1,
}: PlayerAvatarProps) {
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)

  // ── Camera orbit state (third-person) ──────────────────────────────
  const cameraAzimuth = useRef(Math.PI) // Start behind avatar (facing +Z)
  const cameraElevation = useRef(0.3)   // Slightly above horizontal

  // ── Movement state ─────────────────────────────────────────────────
  const positionRef = useRef(new THREE.Vector3(0, 0, 3))
  const velocityRef = useRef(new THREE.Vector3())
  const facingAngle = useRef(0) // Y rotation avatar faces
  const isMovingRef = useRef(false)

  // ── Animation state ────────────────────────────────────────────────
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = useRef<THREE.AnimationAction | null>(null)
  const activeAnimRef = useRef<'idle' | 'run' | 'none'>('none')
  const [idleClip, setIdleClip] = useState<THREE.AnimationClip | null>(null)
  const [runClip, setRunClip] = useState<THREE.AnimationClip | null>(null)

  // ── IBL one-shot flag ──────────────────────────────────────────────
  const iblAppliedRef = useRef(false)

  // ── Keyboard input (from drei KeyboardControls wrapping Canvas) ────
  const [, getKeys] = useKeyboardControls()

  // ═══════════════════════════════════════════════════════════════════
  // VRM LOADING — same pipeline as VRMCatalogRenderer
  // ═══════════════════════════════════════════════════════════════════

  const vrmUrl = url + '#vrm-player'
  const gltf = useLoader(GLTFLoader, vrmUrl, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })

  useEffect(() => {
    const loadedVrm = gltf.userData.vrm as VRM | undefined
    if (!loadedVrm) {
      console.warn('[PlayerAvatar] No VRM data in', url)
      return
    }

    VRMUtils.rotateVRM0(loadedVrm)

    // Material fixes — MToon GI, MeshBasic→Standard swap, shadows
    loadedVrm.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          const m = mat as unknown as Record<string, unknown>
          if ('giEqualizationFactor' in m) m.giEqualizationFactor = 0.9
          if (mat.type === 'MeshBasicMaterial') {
            const basic = mat as THREE.MeshBasicMaterial
            mesh.material = new THREE.MeshStandardMaterial({
              color: basic.color, map: basic.map,
              transparent: basic.transparent, opacity: basic.opacity,
              side: basic.side, roughness: 0.8, metalness: 0.0,
              envMapIntensity: 1.5,
            })
            continue
          }
          if ('envMapIntensity' in m) {
            ;(mat as THREE.MeshStandardMaterial).envMapIntensity = 1.5
          }
          mat.needsUpdate = true
        }
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })

    vrmRef.current = loadedVrm
    setVrm(loadedVrm)
    iblAppliedRef.current = false
    console.log(`[PlayerAvatar] Loaded: ${url.split('/').pop()}`)
  }, [gltf, url])

  // ═══════════════════════════════════════════════════════════════════
  // ANIMATION SETUP — idle + run from Mixamo library
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!vrm) return
    const mixer = new THREE.AnimationMixer(vrm.scene)
    mixerRef.current = mixer
    return () => { mixer.stopAllAction(); mixerRef.current = null }
  }, [vrm])

  useEffect(() => {
    if (!vrm) return
    loadAnimationClip('idle').then(clip => {
      if (clip) setIdleClip(retargetClipForVRM(clip, vrm, 'player-idle'))
    })
    loadAnimationClip('run').then(clip => {
      if (clip) setRunClip(retargetClipForVRM(clip, vrm, 'player-run'))
    })
  }, [vrm])

  // ═══════════════════════════════════════════════════════════════════
  // POINTER LOCK — manual management for third-person mode
  // Click canvas to lock, Esc/right-click to unlock
  // (Noclip mode uses PointerLockControls from drei — separate system)
  // ═══════════════════════════════════════════════════════════════════

  const onCanvasClick = useCallback(() => {
    if (controlMode !== 'third-person') return
    if (document.pointerLockElement) return
    const canvas = document.querySelector('#uploader-canvas') as HTMLCanvasElement
    if (canvas) canvas.requestPointerLock()
  }, [controlMode])

  useEffect(() => {
    const canvas = document.querySelector('#uploader-canvas') as HTMLCanvasElement
    if (!canvas) return
    canvas.addEventListener('click', onCanvasClick)
    return () => canvas.removeEventListener('click', onCanvasClick)
  }, [onCanvasClick])

  // ═══════════════════════════════════════════════════════════════════
  // MOUSE LOOK — raw mousemove for camera azimuth/elevation
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return
      if (controlMode !== 'third-person') return
      const sens = mouseSensitivity * 0.003
      cameraAzimuth.current -= e.movementX * sens
      cameraElevation.current += e.movementY * sens
      cameraElevation.current = Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, cameraElevation.current))
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [controlMode, mouseSensitivity])

  // ═══════════════════════════════════════════════════════════════════
  // THE FRAME LOOP — movement, camera, animation, VRM update
  // ═══════════════════════════════════════════════════════════════════

  useFrame((state, rawDelta) => {
    const group = groupRef.current
    const v = vrmRef.current
    if (!group || !v) return

    const delta = Math.min(rawDelta, MAX_DELTA)

    // ── IBL one-shot — swap MToon/Basic → Standard so IBL works ──
    if (!iblAppliedRef.current && state.scene.environment) {
      v.scene.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return
        const mesh = child as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const newMats = mats.map(mat => {
          const m = mat as any
          // MToonMaterial or MeshBasicMaterial can't handle IBL — swap to Standard
          if (m.type === 'MToonMaterial' || m.type === 'MeshBasicMaterial' || m.isMToonMaterial) {
            const std = new THREE.MeshStandardMaterial({
              map: m.map || m.uniforms?.map?.value || null,
              normalMap: m.normalMap || m.uniforms?.normalMap?.value || null,
              emissiveMap: m.emissiveMap || m.uniforms?.emissiveMap?.value || null,
              emissive: m.emissive || new THREE.Color(0x000000),
              color: m.color || new THREE.Color(0xffffff),
              roughness: 0.8,
              metalness: 0.0,
              envMap: state.scene.environment,
              envMapIntensity: 1.2,
              side: m.side ?? THREE.FrontSide,
              transparent: m.transparent ?? false,
              opacity: m.opacity ?? 1,
              alphaTest: m.alphaTest ?? 0,
            })
            std.needsUpdate = true
            mat.dispose()
            return std
          }
          // Standard/Physical — just set envMap
          if ('envMap' in m) { m.envMap = state.scene.environment; m.envMapIntensity = 1.2; m.needsUpdate = true }
          return mat
        })
        mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0]
      })
      iblAppliedRef.current = true
    }

    // ── VRM systems (spring bones, expressions) ──────────────────
    v.update(delta)
    mixerRef.current?.update(delta)

    // ── Blink + subtle smile ─────────────────────────────────────
    const t = state.clock.elapsedTime
    const expr = v.expressionManager
    if (expr) {
      const blinkPhase = t % 4
      expr.setValue('blink', (blinkPhase > 3.7 && blinkPhase < 3.9) ? 1 : 0)
      const smileAmount = Math.sin(t * 0.3) * 0.15 + 0.1
      expr.setValue('happy', Math.max(0, smileAmount))
    }

    // ── Third-person movement + camera ───────────────────────────
    if (controlMode === 'third-person') {
      const keys = getKeys() as Record<string, boolean>
      const { forward, backward, left, right } = keys

      // Camera forward direction (projected to XZ plane)
      const az = cameraAzimuth.current
      const camForward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az))
      const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x) // perpendicular right

      // Movement direction relative to camera
      const moveDir = new THREE.Vector3()
      if (forward) moveDir.add(camForward)
      if (backward) moveDir.sub(camForward)
      if (right) moveDir.add(camRight)
      if (left) moveDir.sub(camRight)

      const wantsToMove = moveDir.lengthSq() > 0.001
      if (wantsToMove) {
        moveDir.normalize()
        const targetVelocity = moveDir.clone().multiplyScalar(moveSpeed)
        velocityRef.current.lerp(targetVelocity, 1 - Math.exp(-8 * delta))
        isMovingRef.current = true

        // Face movement direction (smooth rotation)
        const targetAngle = Math.atan2(moveDir.x, moveDir.z)
        let angleDiff = targetAngle - facingAngle.current
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
        facingAngle.current += angleDiff * Math.min(10 * delta, 1)
      } else {
        velocityRef.current.lerp(new THREE.Vector3(), 1 - Math.exp(-8 * delta))
        if (velocityRef.current.lengthSq() < 0.001) velocityRef.current.set(0, 0, 0)
        isMovingRef.current = velocityRef.current.lengthSq() > 0.01
      }

      // Apply velocity to position
      positionRef.current.add(velocityRef.current.clone().multiplyScalar(delta))

      // ── Position camera behind avatar using spherical coords ───
      const el = cameraElevation.current
      const dist = CAMERA_DISTANCE
      const offset = new THREE.Vector3(
        Math.sin(az) * Math.cos(el) * dist,
        Math.sin(el) * dist + CAMERA_HEIGHT_OFFSET,
        Math.cos(az) * Math.cos(el) * dist,
      )

      const lookTarget = positionRef.current.clone()
      lookTarget.y += CAMERA_HEIGHT_OFFSET

      state.camera.position.copy(positionRef.current).add(offset)
      state.camera.lookAt(lookTarget)
    }

    // ── Sync group transform to position ref ─────────────────────
    group.position.copy(positionRef.current)
    group.rotation.y = facingAngle.current

    // ── Animation FSM (runs every frame, acts only on state change) ──
    const targetAnim = isMovingRef.current && runClip ? 'run' : idleClip ? 'idle' : 'none'
    if (targetAnim !== activeAnimRef.current && mixerRef.current) {
      if (currentActionRef.current) currentActionRef.current.fadeOut(0.3)
      const clip = targetAnim === 'run' ? runClip : idleClip
      if (clip) {
        const action = mixerRef.current.clipAction(clip)
        action.setLoop(THREE.LoopRepeat, Infinity)
        action.reset().fadeIn(0.3).play()
        currentActionRef.current = action
      }
      activeAnimRef.current = targetAnim
    }
  })

  if (!vrm) return null

  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} scale={1} />
    </group>
  )
}
