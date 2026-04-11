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

import { useRef, useEffect, useState, useContext } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMUtils } from '@pixiv/three-vrm'
import { useInputManager, consumeMouseLookDelta } from '../../lib/input-manager'
import { AnimationController } from '../../lib/animation-state-machine'
import { useAudioManager } from '../../lib/audio-manager'
import { sprintRef } from '../CameraController'
import { SettingsContext } from '../scene-lib'
import { getPlayerSpellCasting, setPlayerAvatarPose, setPlayerSpellCasting, subscribePlayerSpellCasting } from '../../lib/player-avatar-runtime'
import { SPELL_CAST_ANIMATION_ID, SPELL_CAST_SOUND_URL } from '../../lib/spell-casting'

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
const CAMERA_DISTANCE = 4.2
const CAMERA_HEIGHT_OFFSET = 1.95
const CAMERA_SHOULDER_OFFSET = 0.82
const CAMERA_LOOK_AHEAD = 4
const CAMERA_LOOK_TARGET_HEIGHT = 2.15
const MIN_ELEVATION = -1.2 // Near ground level
const MAX_ELEVATION = 1.5  // Almost directly above

// TPS speed tiers: walk (space) → run (default) → sprint (shift)
// Hardcoded — independent of noclip settings.moveSpeed
const TPS_BASE_SPEED = 3.0      // Default WASD run speed (bumped 25%)
const TPS_SPRINT_MULT = 4       // Shift: 4x faster (12.0)
const TPS_WALK_MULT = 0.25      // Space: 4x slower (0.75)

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return angle
}

// Random dance clips for X key
const DANCE_CLIPS = ['breakdance', 'hip-hop', 'capoeira', 'moonwalk', 'shuffling', 'thriller', 'twist', 'twirl']

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function PlayerAvatar({
  url,
  controlMode,
  moveSpeed = 6,
  mouseSensitivity = 1,
}: PlayerAvatarProps) {
  const { settings } = useContext(SettingsContext)
  const inputState = useInputManager(s => s.inputState)
  const pointerLocked = useInputManager(s => s.pointerLocked)
  const isThirdPersonActive = inputState === 'third-person'
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)

  // ── Camera orbit state (third-person) ──────────────────────────────
  const cameraAzimuth = useRef(Math.PI) // Start behind avatar (facing +Z)
  const cameraElevation = useRef(0.3)   // Slightly above horizontal
  const wasThirdPersonActiveRef = useRef(false)

  // ── Movement state ─────────────────────────────────────────────────
  const positionRef = useRef(new THREE.Vector3(0, 0, 3))
  const velocityRef = useRef(new THREE.Vector3())
  const facingAngle = useRef(0) // Y rotation avatar faces
  const isMovingRef = useRef(false)
  // Pre-allocated temp vectors (avoid per-frame allocation)
  const _camFwd = useRef(new THREE.Vector3())
  const _camRt = useRef(new THREE.Vector3())
  const _moveDir = useRef(new THREE.Vector3())
  const _cameraOffset = useRef(new THREE.Vector3())
  const _lookTarget = useRef(new THREE.Vector3())
  const _tempVec = useRef(new THREE.Vector3())
  const _zeroVec = useRef(new THREE.Vector3())

  // ── Animation Controller (state machine) ──────────────────────────
  const animControllerRef = useRef<AnimationController | null>(null)
  const footstepTimerRef = useRef(0)
  const spellAudioRef = useRef<HTMLAudioElement | null>(null)
  const spellAnimationActiveRef = useRef(false)
  const [playerSpellCasting, setPlayerSpellCastingState] = useState(() => getPlayerSpellCasting())

  // ── IBL one-shot flag ──────────────────────────────────────────────
  const iblAppliedRef = useRef(false)

  // ── Keyboard input (from drei KeyboardControls wrapping Canvas) ────
  const [, getKeys] = useKeyboardControls()

  useEffect(() => {
    return subscribePlayerSpellCasting(() => {
      setPlayerSpellCastingState(getPlayerSpellCasting())
    })
  }, [])

  useEffect(() => {
    const audio = new Audio(SPELL_CAST_SOUND_URL)
    audio.loop = true
    audio.preload = 'auto'
    spellAudioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
      spellAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = spellAudioRef.current
    if (!audio) return
    if (playerSpellCasting) {
      void audio.play().catch(() => {})
      return
    }
    audio.pause()
    try {
      audio.currentTime = 0
    } catch {}
  }, [playerSpellCasting])

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
  // ANIMATION CONTROLLER — state machine for idle/walk/run transitions
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!vrm) return
    const controller = new AnimationController(vrm, {
      crossfadeDuration: 0.3,
      walkSpeedThreshold: 0.1,                          // below 0.1 = idle
      runSpeedThreshold: TPS_BASE_SPEED * 0.4,          // ~1.2 = walk→run
      sprintSpeedThreshold: TPS_BASE_SPEED * 2.5,       // ~7.5 = run→sprint
      runTimeScale: 0.7,                                // slow run animation for foot sync
      sprintTimeScale: 1.6,                             // fast sprint animation for foot sync
    })
    animControllerRef.current = controller
    return () => { controller.dispose(); animControllerRef.current = null }
  }, [vrm])

  useEffect(() => {
    return () => {
      setPlayerAvatarPose(null)
    }
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // POINTER LOCK — managed by InputManager
  // Click canvas → InputManager.requestPointerLock() (checks state)
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // MOUSE LOOK — raw mousemove for camera azimuth/elevation
  // ═══════════════════════════════════════════════════════════════════

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

    // ── Animation mixer first, THEN VRM (spring bones react to new pose) ──
    animControllerRef.current?.update(delta)
    v.update(delta)

    if (isThirdPersonActive && !wasThirdPersonActiveRef.current) {
      const entryOffset = _tempVec.current.copy(state.camera.position).sub(positionRef.current)
      const horizontalDistance = Math.hypot(entryOffset.x, entryOffset.z)
      if (horizontalDistance > 0.001 || Math.abs(entryOffset.y) > 0.001) {
        cameraAzimuth.current = normalizeAngle(Math.atan2(entryOffset.x, entryOffset.z))
        cameraElevation.current = Math.max(
          MIN_ELEVATION,
          Math.min(MAX_ELEVATION, Math.atan2(entryOffset.y - CAMERA_HEIGHT_OFFSET, Math.max(horizontalDistance, 0.0001)))
        )
      }
    }
    wasThirdPersonActiveRef.current = isThirdPersonActive

    if (isThirdPersonActive && pointerLocked) {
      const mouseDelta = consumeMouseLookDelta()
      if (mouseDelta.x !== 0 || mouseDelta.y !== 0) {
        const sens = mouseSensitivity * 0.003
        cameraAzimuth.current = normalizeAngle(cameraAzimuth.current - mouseDelta.x * sens)
        cameraElevation.current = Math.max(
          MIN_ELEVATION,
          Math.min(MAX_ELEVATION, cameraElevation.current + mouseDelta.y * sens)
        )
      }
    }

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
    // Zero velocity when not in TPS (prevents stale run animation on view switch)
    if (!isThirdPersonActive) {
      velocityRef.current.set(0, 0, 0)
      isMovingRef.current = false
    }

    if (isThirdPersonActive) {
      const keys = getKeys() as Record<string, boolean>
      const { forward, backward, left, right, sprint, slow } = keys

      // Speed modifier: shift=sprint (4x), space=walk (0.25x), default=run
      const speedMult = sprint ? TPS_SPRINT_MULT : slow ? TPS_WALK_MULT : 1
      const currentSpeed = TPS_BASE_SPEED * speedMult

      // Sprint VFX — same speed lines + chromatic aberration as noclip
      const targetIntensity = sprint ? (TPS_SPRINT_MULT - 1) / 3 : 0
      sprintRef.current.intensity += (targetIntensity - sprintRef.current.intensity) * (1 - Math.exp(-5 * delta))
      sprintRef.current.multiplier = speedMult

      // Camera forward direction (projected to XZ plane)
      const az = cameraAzimuth.current
      const camForward = _camFwd.current.set(-Math.sin(az), 0, -Math.cos(az))
      const camRight = _camRt.current.set(-camForward.z, 0, camForward.x) // perpendicular right

      // Movement direction relative to camera
      const moveDir = _moveDir.current.set(0, 0, 0)
      if (forward) moveDir.add(camForward)
      if (backward) moveDir.sub(camForward)
      if (right) moveDir.add(camRight)
      if (left) moveDir.sub(camRight)

      const wantsToMove = moveDir.lengthSq() > 0.001
      if (wantsToMove && getPlayerSpellCasting()) {
        setPlayerSpellCasting(false)
      }
      if (wantsToMove) {
        moveDir.normalize()
        const targetVelocity = _tempVec.current.copy(moveDir).multiplyScalar(currentSpeed)
        velocityRef.current.lerp(targetVelocity, 1 - Math.exp(-8 * delta))
        isMovingRef.current = true

        // Face movement direction (smooth rotation)
        const targetAngle = Math.atan2(moveDir.x, moveDir.z)
        let angleDiff = targetAngle - facingAngle.current
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
        facingAngle.current += angleDiff * Math.min(10 * delta, 1)
      } else {
        velocityRef.current.lerp(_zeroVec.current.set(0, 0, 0), 1 - Math.exp(-8 * delta))
        if (velocityRef.current.lengthSq() < 0.001) velocityRef.current.set(0, 0, 0)
        isMovingRef.current = velocityRef.current.lengthSq() > 0.01
      }

      // Apply velocity to position
      positionRef.current.add(_tempVec.current.copy(velocityRef.current).multiplyScalar(delta))

      // ── Position camera behind avatar using spherical coords ───
      const el = cameraElevation.current
      const dist = CAMERA_DISTANCE
      const offset = _cameraOffset.current.set(
        Math.sin(az) * Math.cos(el) * dist,
        Math.sin(el) * dist + CAMERA_HEIGHT_OFFSET,
        Math.cos(az) * Math.cos(el) * dist,
      )
      offset.addScaledVector(camRight, CAMERA_SHOULDER_OFFSET)

      const lookTarget = _lookTarget.current.copy(positionRef.current)
      lookTarget.addScaledVector(camForward, CAMERA_LOOK_AHEAD)
      lookTarget.y += CAMERA_LOOK_TARGET_HEIGHT

      state.camera.position.copy(positionRef.current).add(offset)
      state.camera.lookAt(lookTarget)

      // ── Sprint VFX: FOV ramp + camera shake (same feel as noclip) ──
      const si = Math.max(0, sprintRef.current.intensity)
      const cam = state.camera as THREE.PerspectiveCamera
      if (cam.isPerspectiveCamera) {
        const baseFov = settings.fov
        const targetFov = baseFov + si * 15  // sprint widens FOV
        cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-3 * delta))
        cam.updateProjectionMatrix()

        // Camera shake during sprint
        if (si > 0.05) {
          const t = state.clock.elapsedTime
          const shakeAmt = si * 0.018
          cam.position.x += Math.sin(t * 23.1) * Math.sin(t * 17.3) * shakeAmt
          cam.position.y += Math.sin(t * 19.7) * Math.cos(t * 13.1) * shakeAmt * 0.5
        }
      }
    }

    // ── Sync group transform to position ref ─────────────────────
    group.position.copy(positionRef.current)
    group.rotation.y = facingAngle.current
    setPlayerAvatarPose({
      position: [positionRef.current.x, positionRef.current.y, positionRef.current.z],
      yaw: facingAngle.current,
      forward: [Math.sin(facingAngle.current), 0, Math.cos(facingAngle.current)],
    })

    // ── Animation state machine — auto-transitions based on velocity ──
    if (animControllerRef.current) {
      const speed = velocityRef.current.length()
      animControllerRef.current.updateFromVelocity(speed)

      if (playerSpellCasting) {
        if (!spellAnimationActiveRef.current) {
          spellAnimationActiveRef.current = true
          animControllerRef.current.preloadClip(SPELL_CAST_ANIMATION_ID).then(ok => {
            if (ok && getPlayerSpellCasting()) {
              animControllerRef.current?.transitionTo('custom', SPELL_CAST_ANIMATION_ID)
            }
          })
        }
      } else if (spellAnimationActiveRef.current) {
        spellAnimationActiveRef.current = false
        if (speed < 0.05) {
          animControllerRef.current.transitionTo('idle')
        }
      }

      // ── X key = random dance ──
      if (isThirdPersonActive) {
        const { dance } = getKeys() as Record<string, boolean>
        if (dance && !playerSpellCasting && animControllerRef.current.state !== 'custom') {
          const randomDance = DANCE_CLIPS[Math.floor(Math.random() * DANCE_CLIPS.length)]
          animControllerRef.current.preloadClip(randomDance).then(ok => {
            if (ok) animControllerRef.current?.transitionTo('custom', randomDance)
          })
        }
      }

      // Footstep sounds — play at intervals when walking/running/sprinting
      const animState = animControllerRef.current.state
      if (animState === 'walk' || animState === 'run' || animState === 'sprint') {
        footstepTimerRef.current += delta
        const interval = animState === 'sprint' ? 0.25 : animState === 'run' ? 0.45 : 0.7
        if (footstepTimerRef.current >= interval) {
          footstepTimerRef.current = 0
          useAudioManager.getState().playFootstep()
        }
      } else {
        footstepTimerRef.current = 0
      }
    }
  })

  if (!vrm) return null

  return (
    <group ref={groupRef}>
      <primitive object={vrm.scene} scale={1} />
    </group>
  )
}
