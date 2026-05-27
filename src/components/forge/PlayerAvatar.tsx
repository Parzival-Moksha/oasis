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
import { getMobileInputSnapshot } from '../../lib/mobile-controls'
import { getLipSync } from '../../lib/lip-sync'
import { sprintRef } from '../CameraController'
import { SettingsContext } from '../scene-lib'
import {
  PLAYER_AVATAR_LIPSYNC_ID,
  getPlayerAvatarPose,
  getPlayerManaRecharging,
  getPlayerSpellCasting,
  requestPlayerAvatarTeleport,
  setPlayerAnimationState,
  setPlayerAvatarPose,
  setPlayerSpellCasting,
  subscribePlayerAvatarTeleport,
  subscribePlayerManaRecharging,
  subscribePlayerSpellCasting,
  type PlayerAvatarPose,
} from '../../lib/player-avatar-runtime'
import { MANA_RECHARGE_ANIMATION_ID, SPELL_CAST_ANIMATION_ID } from '../../lib/spell-casting'
import { PORTAL_REVEAL_ROLL_EVENT } from '../../lib/portal-transition-settings'
import { QUEST_ZERO_WORLD_ID, ROOKIE_WIZARD_WORLD_ID } from '../../lib/portal-gates'
import { sampleTerrainHeightAt } from '../../lib/forge/terrain-brush'
import { useOasisStore } from '../../store/oasisStore'

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
const TPS_MIN_CAMERA_DISTANCE = 1.2
const TPS_MAX_CAMERA_DISTANCE = 100
const TPS_ZOOM_CURVE = 1.35
const TPS_ZOOM_WHEEL_SENSITIVITY = 0.0012
const TPS_ZOOM_SMOOTHING = 10
const TPS_CLOSE_CAMERA_HEIGHT_OFFSET = 1.5
const TPS_CLOSE_SHOULDER_OFFSET = 0.32
const TPS_CLOSE_LOOK_AHEAD = 0.25
const TPS_CLOSE_LOOK_TARGET_HEIGHT = 1.45
const CAMERA_HEIGHT_OFFSET = 1.85
const CAMERA_SHOULDER_OFFSET = 0.58
const CAMERA_LOOK_AHEAD = 0.5
const CAMERA_LOOK_TARGET_HEIGHT = 1.75
const MIN_ELEVATION = -1.2 // Near ground level
const MAX_ELEVATION = 1.5  // Almost directly above
const PORTAL_ARRIVAL_TPS_CAMERA_ELEVATION = Math.PI / 4

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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

const PLAYER_EXPRESSION_ALIASES = {
  blink: ['blink', 'blink_l', 'blink_r'],
  aa: ['aa', 'a'],
  ih: ['ih', 'i'],
  ou: ['ou', 'u'],
  ee: ['ee', 'e'],
  oh: ['oh', 'o'],
  happy: ['happy', 'joy', 'fun'],
} as const

function setPlayerExpressionValue(
  expr: {
    setValue: (name: string, value: number) => void
    expressionMap?: Record<string, unknown>
  },
  aliases: readonly string[],
  value: number,
) {
  const expressionMap = expr.expressionMap
  const target = expressionMap
    ? aliases.find(name => Object.prototype.hasOwnProperty.call(expressionMap, name))
    : aliases[0]
  expr.setValue(target || aliases[0], value)
}

function smoothstep01(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function tpsZoomToDistance(zoom: number): number {
  const shaped = Math.pow(clamp01(zoom), TPS_ZOOM_CURVE)
  return TPS_MIN_CAMERA_DISTANCE * Math.pow(TPS_MAX_CAMERA_DISTANCE / TPS_MIN_CAMERA_DISTANCE, shaped)
}

function distanceToTpsZoom(distance: number): number {
  const clamped = Math.max(TPS_MIN_CAMERA_DISTANCE, Math.min(TPS_MAX_CAMERA_DISTANCE, distance))
  const normalized = Math.log(clamped / TPS_MIN_CAMERA_DISTANCE) / Math.log(TPS_MAX_CAMERA_DISTANCE / TPS_MIN_CAMERA_DISTANCE)
  return Math.pow(clamp01(normalized), 1 / TPS_ZOOM_CURVE)
}

const DEFAULT_TPS_CAMERA_ZOOM = distanceToTpsZoom(CAMERA_DISTANCE)

// Random dance clips for X key
const DANCE_CLIPS = ['breakdance', 'hip-hop', 'capoeira', 'moonwalk', 'shuffling', 'thriller', 'twist', 'twirl']

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function PlayerAvatar({
  url,
  controlMode: _controlMode,
  moveSpeed: _moveSpeed = 6,
  mouseSensitivity = 1,
}: PlayerAvatarProps) {
  const { settings } = useContext(SettingsContext)
  const inputState = useInputManager(s => s.inputState)
  const previousCameraState = useInputManager(s => s._previousCameraState)
  const pointerLocked = useInputManager(s => s.pointerLocked)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldReady = useOasisStore(s => s._worldReady)
  // ─═̷─ Third-person camera logic also runs during transient placement / paint
  // when the base camera was third-person — otherwise CameraController would
  // hijack and the player feels like they got teleported to noclip mid-spell.
  const isThirdPersonActive = inputState === 'third-person'
    || ((inputState === 'placement' || inputState === 'paint') && previousCameraState === 'third-person')
  const groupRef = useRef<THREE.Group>(null)
  const vrmRef = useRef<VRM | null>(null)
  const [vrm, setVrm] = useState<VRM | null>(null)
  const [avatarPoseReady, setAvatarPoseReady] = useState(false)

  // ── Camera orbit state (third-person) ──────────────────────────────
  const cameraAzimuth = useRef(Math.PI) // Start behind avatar (facing +Z)
  const cameraElevation = useRef(0.3)   // Slightly above horizontal
  const cameraZoomTarget = useRef(DEFAULT_TPS_CAMERA_ZOOM)
  const cameraZoom = useRef(DEFAULT_TPS_CAMERA_ZOOM)
  const wasThirdPersonActiveRef = useRef(false)
  // ─═̷─ When TPS yields to a frozen state ('ui-focused'), the camera position
  // stays exactly where PlayerAvatar last placed it. On return, re-deriving
  // azimuth/elevation from the camera-vs-avatar offset is lossy because the
  // baked-in shoulder shift biases atan2 — yielding a deterministic ~8° azimuth
  // drift + minor elevation drop on every menu close. Track whether the avatar
  // owned the camera continuously through the menu so we can skip that
  // reconstruction and trust the stored azimuth/elevation. ─═̷─
  const avatarOwnsCameraRef = useRef(false)
  const teleportCameraResetPendingRef = useRef(false)
  const movementSuppressedUntilReleaseRef = useRef(false)

  // ── Movement state ─────────────────────────────────────────────────
  const positionRef = useRef(new THREE.Vector3(0, 0, 3))
  const velocityRef = useRef(new THREE.Vector3())
  const facingAngle = useRef(0) // Y rotation avatar faces
  const isMovingRef = useRef(false)
  const terrainHeightsRef = useRef(terrainHeights)
  const defaultSpawnAppliedForWorldRef = useRef<string | null>(null)
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
  const spellAnimationActiveRef = useRef(false)
  const manaRechargeAnimationActiveRef = useRef(false)
  const portalRollTimeoutRef = useRef<number | null>(null)
  // Reveal-roll forward motion: avatar slides 3m in its facing direction during
  // the ual-roll clip so the roll reads as physical forward momentum.
  const rollMotionRef = useRef<{
    startPos: THREE.Vector3
    forward: THREE.Vector3
    distance: number
    startMs: number
    durationMs: number
  } | null>(null)
  const [playerSpellCasting, setPlayerSpellCastingState] = useState(() => getPlayerSpellCasting())
  const [playerManaRecharging, setPlayerManaRechargingState] = useState(() => getPlayerManaRecharging())

  // ── IBL one-shot flag ──────────────────────────────────────────────
  const appliedEnvRef = useRef<THREE.Texture | null>(null)

  // ── Keyboard input (from drei KeyboardControls wrapping Canvas) ────
  const [, getKeys] = useKeyboardControls()

  useEffect(() => {
    terrainHeightsRef.current = terrainHeights
  }, [terrainHeights])

  useEffect(() => {
    if (activeWorldId !== ROOKIE_WIZARD_WORLD_ID && activeWorldId !== QUEST_ZERO_WORLD_ID) {
      if (defaultSpawnAppliedForWorldRef.current === ROOKIE_WIZARD_WORLD_ID || defaultSpawnAppliedForWorldRef.current === QUEST_ZERO_WORLD_ID) {
        defaultSpawnAppliedForWorldRef.current = null
      }
      return
    }
    if (!worldReady) return
    if (defaultSpawnAppliedForWorldRef.current === activeWorldId) return
    defaultSpawnAppliedForWorldRef.current = activeWorldId
    if (activeWorldId === QUEST_ZERO_WORLD_ID) {
      requestPlayerAvatarTeleport({
        position: [0, 0, -17.6],
        yaw: 0,
        forward: [0, 0, 1],
      })
      return
    }
    requestPlayerAvatarTeleport({
      position: [0, 0, -17.6],
      yaw: 0,
      forward: [0, 0, 1],
    })
  }, [activeWorldId, worldReady])

  useEffect(() => {
    const applyZoomDelta = (delta: number) => {
      if (!Number.isFinite(delta) || delta === 0) return
      cameraZoomTarget.current = clamp01(cameraZoomTarget.current + delta)
    }

    const handleWheel = (event: WheelEvent) => {
      const input = useInputManager.getState()
      if (input.inputState !== 'third-person') return
      if (input.hasActiveUILayer()) return

      const target = event.target as HTMLElement | null
      if (target?.closest('[data-ui-panel]')) return

      const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1
      const wheelDelta = event.deltaY * deltaScale
      if (!Number.isFinite(wheelDelta) || wheelDelta === 0) return

      applyZoomDelta(wheelDelta * TPS_ZOOM_WHEEL_SENSITIVITY)
      event.preventDefault()
    }

    const handleMobileZoom = (event: Event) => {
      const input = useInputManager.getState()
      if (input.inputState !== 'third-person') return
      if (input.hasActiveUILayer()) return
      const detail = (event as CustomEvent<{ delta?: number }>).detail
      applyZoomDelta(detail?.delta ?? 0)
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('oasis:tps-zoom-delta', handleMobileZoom as EventListener)
    return () => {
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('oasis:tps-zoom-delta', handleMobileZoom as EventListener)
    }
  }, [])

  useEffect(() => {
    return subscribePlayerSpellCasting(() => {
      setPlayerSpellCastingState(getPlayerSpellCasting())
    })
  }, [])

  useEffect(() => {
    return subscribePlayerManaRecharging(() => {
      setPlayerManaRechargingState(getPlayerManaRecharging())
    })
  }, [])

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
    setAvatarPoseReady(false)
    setVrm(loadedVrm)
    appliedEnvRef.current = null
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
    controller.preloadClip('idle').then(ok => {
      if (animControllerRef.current !== controller) return
      if (ok) {
        controller.transitionTo('idle')
        controller.update(0)
        setAvatarPoseReady(true)
        return
      }
      const startedAt = performance.now()
      const waitForConstructorPreload = () => {
        if (animControllerRef.current !== controller) return
        if (controller.ready) {
          controller.transitionTo('idle')
          controller.update(0)
          setAvatarPoseReady(true)
          return
        }
        if (performance.now() - startedAt > 2400) {
          console.warn('[PlayerAvatar] Idle animation did not finish loading; revealing avatar fallback.')
          setAvatarPoseReady(true)
          return
        }
        requestAnimationFrame(waitForConstructorPreload)
      }
      requestAnimationFrame(waitForConstructorPreload)
    })
    return () => { controller.dispose(); animControllerRef.current = null }
  }, [vrm])

  useEffect(() => {
    const onPortalRevealRoll = () => {
      const controller = animControllerRef.current
      if (!controller) return
      if (controller.state === 'custom') return
      if (portalRollTimeoutRef.current) window.clearTimeout(portalRollTimeoutRef.current)
      controller.preloadClip('ual-roll').then(ok => {
        const currentController = animControllerRef.current
        if (!ok || !currentController) return
        const durationMs = Math.max(450, (currentController.getClipDuration('ual-roll') ?? 1.45) * 1000)
        velocityRef.current.set(0, 0, 0)
        isMovingRef.current = false
        // Capture spawn pose + facing direction; slide 3m forward over the roll
        // duration in useFrame. positionRef.current is the avatar's spawn after
        // the portal teleport; forward is yaw-derived (x = sin, z = cos).
        rollMotionRef.current = {
          startPos: positionRef.current.clone(),
          forward: new THREE.Vector3(Math.sin(facingAngle.current), 0, Math.cos(facingAngle.current)),
          distance: 3,
          startMs: performance.now(),
          durationMs,
        }
        currentController.transitionTo('custom', 'ual-roll', { loop: false })
        portalRollTimeoutRef.current = window.setTimeout(() => {
          rollMotionRef.current = null
          const nextController = animControllerRef.current
          if (!nextController || nextController.state !== 'custom') return
          nextController.transitionTo('idle')
        }, durationMs + 90)
      })
    }

    window.addEventListener(PORTAL_REVEAL_ROLL_EVENT, onPortalRevealRoll)
    return () => {
      window.removeEventListener(PORTAL_REVEAL_ROLL_EVENT, onPortalRevealRoll)
      if (portalRollTimeoutRef.current) window.clearTimeout(portalRollTimeoutRef.current)
      portalRollTimeoutRef.current = null
      rollMotionRef.current = null
    }
  }, [])

  useEffect(() => {
    const applyTeleportPose = (pose: PlayerAvatarPose) => {
      const [x, , z] = pose.position
      positionRef.current.set(x, sampleTerrainHeightAt(terrainHeightsRef.current, x, z), z)
      facingAngle.current = pose.yaw
      cameraAzimuth.current = normalizeAngle(pose.yaw + Math.PI)
      cameraElevation.current = PORTAL_ARRIVAL_TPS_CAMERA_ELEVATION
      cameraZoomTarget.current = DEFAULT_TPS_CAMERA_ZOOM
      cameraZoom.current = DEFAULT_TPS_CAMERA_ZOOM
      teleportCameraResetPendingRef.current = true
      movementSuppressedUntilReleaseRef.current = true
      velocityRef.current.set(0, 0, 0)
      isMovingRef.current = false
      if (groupRef.current) {
        groupRef.current.position.copy(positionRef.current)
        groupRef.current.rotation.y = facingAngle.current
      }
    }
    const latestPose = getPlayerAvatarPose()
    if (latestPose) applyTeleportPose(latestPose)
    return subscribePlayerAvatarTeleport(applyTeleportPose)
  }, [])

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
    if (state.scene.environment && appliedEnvRef.current !== state.scene.environment) {
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
      appliedEnvRef.current = state.scene.environment
    }

    // ── Animation mixer first, THEN VRM (spring bones react to new pose) ──
    animControllerRef.current?.update(delta)
    v.update(delta)

    if (isThirdPersonActive && !wasThirdPersonActiveRef.current) {
      if (teleportCameraResetPendingRef.current) {
        teleportCameraResetPendingRef.current = false
      } else if (!avatarOwnsCameraRef.current) {
        // ─═̷─ Re-anchor only when something else moved the camera while we were
        // away. If the only thing that happened was a 'ui-focused' interlude
        // (menu open/close), the camera position is byte-identical to the last
        // TPS frame, but reconstructing azimuth from offset.atan2 introduces a
        // shoulder-offset bias of ~atan(shoulder/dist) ≈ 8° per close. Skip it.
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
    } else if (isThirdPersonActive && teleportCameraResetPendingRef.current) {
      teleportCameraResetPendingRef.current = false
    }
    wasThirdPersonActiveRef.current = isThirdPersonActive
    // Ownership ledger: TPS-active sets the flag; 'ui-focused' (frozen camera)
    // leaves it alone, so we still trust avatar-stored azimuth on return; any
    // other state (orbit/noclip/agent-focus) clears it because that state drove
    // the camera somewhere new and we must re-derive on return.
    if (isThirdPersonActive) {
      avatarOwnsCameraRef.current = true
    } else if (inputState !== 'ui-focused') {
      avatarOwnsCameraRef.current = false
    }

    const mobile = getMobileInputSnapshot()

    if (isThirdPersonActive && (pointerLocked || mobile.lookActive)) {
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
      const lipCtrl = getLipSync(PLAYER_AVATAR_LIPSYNC_ID)
      const lipState = lipCtrl?.isActive ? lipCtrl.update() : null
      const blinkPhase = t % 4
      setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.blink, (blinkPhase > 3.7 && blinkPhase < 3.9) ? 1 : 0)
      const smileAmount = Math.sin(t * 0.3) * 0.15 + 0.1

      const clearLipVisemes = () => {
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.aa, 0)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ih, 0)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ou, 0)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ee, 0)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.oh, 0)
      }

      if (lipState && (lipState.aa > 0.01 || lipState.ih > 0.01 || lipState.ou > 0.01 || lipState.ee > 0.01 || lipState.oh > 0.01)) {
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.aa, lipState.aa)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ih, lipState.ih)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ou, lipState.ou)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.ee, lipState.ee)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.oh, lipState.oh)
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.happy, Math.max(0, smileAmount * 0.45))
      } else {
        clearLipVisemes()
        setPlayerExpressionValue(expr, PLAYER_EXPRESSION_ALIASES.happy, Math.max(0, smileAmount))
      }
    }

    // ── Third-person movement + camera ───────────────────────────
    // Zero velocity when not in TPS (prevents stale run animation on view switch)
    if (!isThirdPersonActive) {
      velocityRef.current.set(0, 0, 0)
      isMovingRef.current = false
    }

    if (isThirdPersonActive) {
      const keys = getKeys() as Record<string, boolean>
      let { forward, backward, left, right, sprint, slow } = keys
      let mobileMoveX = mobile.moveX
      let mobileMoveZ = mobile.moveZ
      let mobileSprint = mobile.sprint
      const staleMoveHeld = Boolean(forward || backward || left || right || Math.abs(mobileMoveX) > 0.03 || Math.abs(mobileMoveZ) > 0.03)
      if (movementSuppressedUntilReleaseRef.current) {
        if (staleMoveHeld) {
          forward = false
          backward = false
          left = false
          right = false
          sprint = false
          mobileMoveX = 0
          mobileMoveZ = 0
          mobileSprint = false
        } else {
          movementSuppressedUntilReleaseRef.current = false
        }
      }

      // Speed modifier: shift=sprint (4x), space=walk (0.25x), default=run
      const speedMult = sprint || mobileSprint ? TPS_SPRINT_MULT : slow ? TPS_WALK_MULT : 1
      const currentSpeed = TPS_BASE_SPEED * speedMult

      // Sprint VFX — same speed lines + chromatic aberration as noclip
      const targetIntensity = sprint || mobileSprint ? (TPS_SPRINT_MULT - 1) / 3 : 0
      sprintRef.current.intensity += (targetIntensity - sprintRef.current.intensity) * (1 - Math.exp(-5 * delta))
      sprintRef.current.multiplier = speedMult

      // Camera forward direction (projected to XZ plane)
      const az = cameraAzimuth.current
      const camForward = _camFwd.current.set(-Math.sin(az), 0, -Math.cos(az))
      const camRight = _camRt.current.set(-camForward.z, 0, camForward.x) // perpendicular right

      // Movement direction relative to camera
      const moveDir = _moveDir.current.set(0, 0, 0)
      const moveZ = (forward ? 1 : 0) - (backward ? 1 : 0) + mobileMoveZ
      const moveX = (right ? 1 : 0) - (left ? 1 : 0) + mobileMoveX
      moveDir.addScaledVector(camForward, moveZ)
      moveDir.addScaledVector(camRight, moveX)

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

      // Reveal-roll forward slide: avatar tweens 3m in facing direction over
      // the roll clip's duration. Eased so the slide feels natural (faster at
      // start, slower at end). Cleared automatically when the roll completes.
      const rm = rollMotionRef.current
      if (rm) {
        const elapsed = performance.now() - rm.startMs
        const t = Math.min(1, elapsed / Math.max(1, rm.durationMs))
        // easeOutCubic — most of the slide happens early, settles smoothly
        const ease = 1 - Math.pow(1 - t, 3)
        positionRef.current.x = rm.startPos.x + rm.forward.x * rm.distance * ease
        positionRef.current.z = rm.startPos.z + rm.forward.z * rm.distance * ease
        if (t >= 1) rollMotionRef.current = null
      }

      positionRef.current.y = sampleTerrainHeightAt(
        terrainHeightsRef.current,
        positionRef.current.x,
        positionRef.current.z,
      )

      // ── Position camera behind avatar using spherical coords ───
      cameraZoom.current += (cameraZoomTarget.current - cameraZoom.current) * (1 - Math.exp(-TPS_ZOOM_SMOOTHING * delta))
      const zoomFraming = smoothstep01(cameraZoom.current / DEFAULT_TPS_CAMERA_ZOOM)
      const el = cameraElevation.current
      const dist = tpsZoomToDistance(cameraZoom.current)
      const heightOffset = THREE.MathUtils.lerp(TPS_CLOSE_CAMERA_HEIGHT_OFFSET, CAMERA_HEIGHT_OFFSET, zoomFraming)
      const shoulderOffset = THREE.MathUtils.lerp(TPS_CLOSE_SHOULDER_OFFSET, CAMERA_SHOULDER_OFFSET, zoomFraming)
      const lookAhead = THREE.MathUtils.lerp(TPS_CLOSE_LOOK_AHEAD, CAMERA_LOOK_AHEAD, zoomFraming)
      const lookTargetHeight = THREE.MathUtils.lerp(TPS_CLOSE_LOOK_TARGET_HEIGHT, CAMERA_LOOK_TARGET_HEIGHT, zoomFraming)
      const offset = _cameraOffset.current.set(
        Math.sin(az) * Math.cos(el) * dist,
        Math.sin(el) * dist + heightOffset,
        Math.cos(az) * Math.cos(el) * dist,
      )
      offset.addScaledVector(camRight, shoulderOffset)

      const lookTarget = _lookTarget.current.copy(positionRef.current)
      lookTarget.addScaledVector(camRight, shoulderOffset)
      lookTarget.addScaledVector(camForward, lookAhead)
      lookTarget.y += lookTargetHeight

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

    if (!isThirdPersonActive) {
      positionRef.current.y = sampleTerrainHeightAt(
        terrainHeightsRef.current,
        positionRef.current.x,
        positionRef.current.z,
      )
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
          manaRechargeAnimationActiveRef.current = false
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

      // Mana recharge borrows the capoeira clip until we have a bespoke ritual animation.
      if (playerManaRecharging && !playerSpellCasting) {
        if (!manaRechargeAnimationActiveRef.current) {
          manaRechargeAnimationActiveRef.current = true
          animControllerRef.current.preloadClip(MANA_RECHARGE_ANIMATION_ID).then(ok => {
            if (ok && getPlayerManaRecharging() && !getPlayerSpellCasting()) {
              animControllerRef.current?.transitionTo('custom', MANA_RECHARGE_ANIMATION_ID)
            }
          })
        }
      } else if (manaRechargeAnimationActiveRef.current) {
        manaRechargeAnimationActiveRef.current = false
        if (speed < 0.05 && !playerSpellCasting) {
          animControllerRef.current.transitionTo('idle')
        }
      }

      // ── X key = random dance ──
      if (isThirdPersonActive) {
        const { dance } = getKeys() as Record<string, boolean>
        if (dance && !playerSpellCasting && !playerManaRecharging && animControllerRef.current.state !== 'custom') {
          const randomDance = DANCE_CLIPS[Math.floor(Math.random() * DANCE_CLIPS.length)]
          animControllerRef.current.preloadClip(randomDance).then(ok => {
            if (ok) animControllerRef.current?.transitionTo('custom', randomDance)
          })
        }
      }

      // Footstep sounds — play at intervals when walking/running/sprinting
      const animState = animControllerRef.current.state
      setPlayerAnimationState(animState === 'custom' && animControllerRef.current.customAnimationId
        ? `custom:${animControllerRef.current.customAnimationId}`
        : animState)
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
    <group ref={groupRef} visible={avatarPoseReady}>
      <primitive object={vrm.scene} scale={1} />
    </group>
  )
}
