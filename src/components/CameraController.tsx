'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CAMERA CONTROLLER — ONE owner of all camera behavior
// ─═̷─═̷─ॐ─═̷─═̷─ The InputManager decides WHO owns input.
//                 The CameraController decides WHERE the camera goes. ─═̷─═̷─ॐ─═̷─═̷─
//
// Modes:
//   orbit       — drei OrbitControls (mounted always, enabled only in orbit)
//   noclip      — WASD + mouse look (pointer locked)
//   agent-focus — lerp to window, lock position + lookAt
//   third-person — handled by PlayerAvatar (CameraController yields)
//
// ONE useFrame runs the active mode. No fights. No races.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useRef, useContext, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useKeyboardControls } from '@react-three/drei'
import * as THREE from 'three'

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO LISTENER — singleton attached to camera for 3D spatial audio
// ═══════════════════════════════════════════════════════════════════════════
let _audioListener: THREE.AudioListener | null = null
export function getAudioListener(): THREE.AudioListener | null { return _audioListener }
import { useOasisStore } from '../store/oasisStore'
import { useInputManager, getInputCapabilities, consumeMouseLookDelta } from '../lib/input-manager'
import { setCameraSnapshot } from '../lib/camera-bridge'
import { deriveAvatarAnchoredWindowPlacement, resolveAgentWindowRenderScale } from '../lib/agent-avatar-utils'
import { getLiveObjectTransform } from '../lib/live-object-transforms'
import { SettingsContext, DragContext } from './scene-lib'

// ═══════════════════════════════════════════════════════════════════════════
// SPRINT STATE — shared with SprintParticles + PostProcessing
// ═══════════════════════════════════════════════════════════════════════════

export const sprintRef = { current: { intensity: 0, multiplier: 1 } }

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD CONTROLS — FPS/noclip key enum + mapping
// ═══════════════════════════════════════════════════════════════════════════

export enum FPSControls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
  up = 'up',
  down = 'down',
  sprint = 'sprint',
  slow = 'slow',
  dance = 'dance',
}

export const FPS_KEYBOARD_MAP = [
  { name: FPSControls.forward, keys: ['KeyW', 'ArrowUp'] },
  { name: FPSControls.backward, keys: ['KeyS', 'ArrowDown'] },
  { name: FPSControls.left, keys: ['KeyA', 'ArrowLeft'] },
  { name: FPSControls.right, keys: ['KeyD', 'ArrowRight'] },
  { name: FPSControls.up, keys: ['KeyQ'] },
  { name: FPSControls.down, keys: ['KeyE'] },
  { name: FPSControls.sprint, keys: ['ShiftLeft', 'ShiftRight'] },
  { name: FPSControls.slow, keys: ['Space'] },
  { name: FPSControls.dance, keys: ['KeyX'] },
]

const NOCLIP_SPRINT_MULT = 4
const NOCLIP_SLOW_MULT = 0.125

// ═══════════════════════════════════════════════════════════════════════════
// NOCLIP MODE — WASD movement + mouse look
// ═══════════════════════════════════════════════════════════════════════════

function useNoclipUpdate() {
  const [, getKeys] = useKeyboardControls<FPSControls>()
  const velocityRef = useRef(new THREE.Vector3())
  const multiplierRef = useRef(1)
  const baseFovRef = useRef(0)
  const elapsedRef = useRef(0)
  // Pre-allocated vectors — zero GC pressure in the game loop
  const directionRef = useRef(new THREE.Vector3())
  const cameraDirRef = useRef(new THREE.Vector3())
  const cameraRightRef = useRef(new THREE.Vector3())

  return (camera: THREE.PerspectiveCamera, delta: number, speed: number, settingsFov: number) => {
    // Always keep baseFov synced with settings (user can change FOV mid-flight)
    if (baseFovRef.current === 0 || Math.abs(baseFovRef.current - settingsFov) > 0.5) {
      baseFovRef.current = settingsFov
    }

    if (!getInputCapabilities().movement) {
      velocityRef.current.multiplyScalar(0.9)
      return
    }

    const { forward, backward, left, right, up, down, sprint, slow } = getKeys()

    // Speed multiplier ramp
    const targetMultiplier = sprint ? NOCLIP_SPRINT_MULT : slow ? NOCLIP_SLOW_MULT : 1
    const rampLerp = 1 - Math.exp(-3 * delta)
    multiplierRef.current += (targetMultiplier - multiplierRef.current) * rampLerp

    // Sprint state for VFX
    const m = multiplierRef.current
    sprintRef.current.multiplier = m
    sprintRef.current.intensity = m > 1.05 ? (m - 1) / (NOCLIP_SPRINT_MULT - 1) : m < 0.95 ? (m - 1) / (1 - NOCLIP_SLOW_MULT) : 0

    // Direction from camera orientation (pre-allocated, zero GC)
    const direction = directionRef.current.set(0, 0, 0)
    const cameraDir = cameraDirRef.current
    camera.getWorldDirection(cameraDir)
    cameraDir.normalize()
    const cameraRight = cameraRightRef.current.setFromMatrixColumn(camera.matrixWorld, 0).normalize()

    if (forward) direction.add(cameraDir)
    if (backward) direction.sub(cameraDir)
    if (right) direction.add(cameraRight)
    if (left) direction.sub(cameraRight)
    if (up) direction.y += 1
    if (down) direction.y -= 1
    direction.normalize()

    const effectiveSpeed = speed * multiplierRef.current
    const targetVelocity = direction.multiplyScalar(effectiveSpeed)
    velocityRef.current.lerp(targetVelocity, 1 - Math.exp(-5 * delta))
    camera.position.add(directionRef.current.copy(velocityRef.current).multiplyScalar(delta))

    // FOV ramp — sprint widens FOV relative to settings base
    const targetFov = baseFovRef.current + (multiplierRef.current - 1) * 5
    camera.fov += (targetFov - camera.fov) * rampLerp
    camera.updateProjectionMatrix()

    // Camera shake during sprint
    const si = Math.max(0, sprintRef.current.intensity)
    if (si > 0.05) {
      elapsedRef.current += delta
      const t = elapsedRef.current
      const shakeAmt = si * 0.018
      camera.position.x += Math.sin(t * 23.1) * Math.sin(t * 17.3) * shakeAmt
      camera.position.y += Math.sin(t * 19.7) * Math.cos(t * 13.8) * shakeAmt
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOUSE LOOK — raw mousemove for noclip camera rotation
// Uses Euler angles directly instead of PointerLockControls from drei
// ═══════════════════════════════════════════════════════════════════════════

function useMouseLook(sensitivity: number) {
  const eulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const initializedRef = useRef(false)
  const sensRef = useRef(sensitivity)
  sensRef.current = sensitivity

  return (camera: THREE.PerspectiveCamera) => {
    const input = useInputManager.getState()
    if (!input.pointerLocked || (input.inputState !== 'noclip' && input.inputState !== 'placement' && input.inputState !== 'paint')) {
      initializedRef.current = false
      return
    }

    if (!initializedRef.current) {
      eulerRef.current.setFromQuaternion(camera.quaternion)
      yawRef.current = eulerRef.current.y
      pitchRef.current = eulerRef.current.x
      initializedRef.current = true
    }

    const delta = consumeMouseLookDelta()
    if (delta.x === 0 && delta.y === 0) return

    const sens = sensRef.current * 0.002
    yawRef.current -= delta.x * sens
    pitchRef.current -= delta.y * sens
    pitchRef.current = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitchRef.current))
    eulerRef.current.set(pitchRef.current, yawRef.current, 0)
    camera.quaternion.setFromEuler(eulerRef.current)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT FOCUS — camera lerps to fill viewport with agent window
// ═══════════════════════════════════════════════════════════════════════════

function useAgentFocusUpdate() {
  const startPosRef = useRef<THREE.Vector3 | null>(null)
  const startTargetRef = useRef<THREE.Vector3 | null>(null)
  const goalPosRef = useRef<THREE.Vector3 | null>(null)
  const goalTargetRef = useRef<THREE.Vector3 | null>(null)
  const startTimeRef = useRef(0)
  const prevFocusedRef = useRef<string | null>(null)
  const savedCamPosRef = useRef<THREE.Vector3 | null>(null)
  const savedCamTargetRef = useRef<THREE.Vector3 | null>(null)
  const lockedPosRef = useRef<THREE.Vector3 | null>(null)
  const lockedTargetRef = useRef<THREE.Vector3 | null>(null)
  const DURATION = 1.2

  return (camera: THREE.PerspectiveCamera, focusedId: string | null, viewport: { aspect: number }) => {
    const store = useOasisStore.getState()
    const { placedAgentWindows, placedCatalogAssets, placedAgentAvatars, transforms } = store

    // Detect focus change
    if (focusedId !== prevFocusedRef.current) {
      prevFocusedRef.current = focusedId
      startTimeRef.current = performance.now() / 1000

      if (focusedId) {
        savedCamPosRef.current = camera.position.clone()
        savedCamTargetRef.current = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)

        // Look up the focused object — could be an agent window or an image
        const win = placedAgentWindows.find(w => w.id === focusedId)
        const img = !win ? placedCatalogAssets.find(a => a.id === focusedId && (a.imageUrl || a.videoUrl)) : null
        if (!win && !img) return

        const t = transforms[focusedId]
        const linkedAvatar = win
          ? (win.linkedAvatarId
              ? placedAgentAvatars.find(entry => entry.id === win.linkedAvatarId) || null
              : placedAgentAvatars.find(entry => entry.linkedWindowId === win.id) || null)
          : null
        const avatarTransform = linkedAvatar ? (getLiveObjectTransform(linkedAvatar.id) || transforms[linkedAvatar.id]) : undefined
        const derivedPlacement = win && linkedAvatar && win.anchorMode && win.anchorMode !== 'detached'
          ? deriveAvatarAnchoredWindowPlacement(win, linkedAvatar, avatarTransform, win.anchorMode, t)
          : null
        const pos = derivedPlacement?.position || t?.position || (win ? win.position : img!.position)
        const rot = derivedPlacement?.rotation || t?.rotation || (win ? win.rotation : img?.rotation || [0, 0, 0])

        const windowNormal = new THREE.Vector3(0, 0, 1)
        windowNormal.applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))

        let dist: number
        let focusOffset = new THREE.Vector3()
        if (win) {
          const renderScale = resolveAgentWindowRenderScale(win, t)
          const scaledWidth = (win.width || 800) * 0.02 * renderScale
          const scaledHeight = (win.height || 600) * 0.02 * renderScale
          const windowRight = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2])).normalize()
          const avatarPosition = avatarTransform?.position || linkedAvatar?.position
          const avatarDirection = avatarPosition
            ? new THREE.Vector3(
                avatarPosition[0] - pos[0],
                avatarPosition[1] - pos[1],
                avatarPosition[2] - pos[2],
              )
            : null
          const avatarSide = avatarDirection ? Math.sign(avatarDirection.dot(windowRight)) || -1 : 0
          const avatarFocusWidth = linkedAvatar ? Math.max(scaledHeight * 0.42, scaledWidth * 0.18) : 0
          const framedWidth = scaledWidth + avatarFocusWidth
          const fovRad = (camera.fov * Math.PI) / 180
          const hFov = 2 * Math.atan(Math.tan(fovRad / 2) * viewport.aspect)
          const targetFill = 0.9
          const distV = (scaledHeight / 2) / Math.tan(fovRad / 2) / targetFill
          const distH = (framedWidth / 2) / Math.tan(hFov / 2) / targetFill
          dist = Math.max(distV, distH)
          if (avatarSide !== 0) {
            focusOffset = windowRight.multiplyScalar(scaledWidth * 0.15 * avatarSide)
          }
        } else {
          // Image/video: placement.scale = base height in world units.
          // Transform override t?.scale = group scale multiplier from SelectableWrapper.
          // Actual world height = placement.scale * groupScale.
          const baseScale = img!.scale || 1  // CatalogPlacement.scale (1 for images, 2 for videos)
          const groupScale = typeof t?.scale === 'number' ? t.scale : Array.isArray(t?.scale) ? t.scale[1] : 1
          const worldHeight = baseScale * groupScale
          const estAspect = img!.videoUrl ? 16 / 9 : 1
          const worldWidth = worldHeight * estAspect

          const fovRad = (camera.fov * Math.PI) / 180
          const hFov = 2 * Math.atan(Math.tan(fovRad / 2) * viewport.aspect)
          // Distance to fill 85% on the limiting axis
          const distV = (worldHeight / 2) / Math.tan(fovRad / 2) / 0.85
          const distH = (worldWidth / 2) / Math.tan(hFov / 2) / 0.85
          dist = Math.max(distV, distH)
        }

        const windowCenter = new THREE.Vector3(pos[0], pos[1], pos[2])
        // Image/video group is elevated by h/2 (both renderers use position={[0, h/2, 0]})
        // h = placement.scale * groupScale
        if (img) {
          const baseScale = img.scale || 1
          const groupScale = typeof t?.scale === 'number' ? t.scale : Array.isArray(t?.scale) ? t.scale[1] : 1
          windowCenter.y += (baseScale * groupScale) / 2
        }
        windowCenter.add(focusOffset)
        const cameraGoal = windowCenter.clone().add(windowNormal.clone().multiplyScalar(dist))

        startPosRef.current = camera.position.clone()
        startTargetRef.current = savedCamTargetRef.current!.clone()
        goalPosRef.current = cameraGoal
        goalTargetRef.current = windowCenter
      } else if (savedCamPosRef.current) {
        startPosRef.current = camera.position.clone()
        startTargetRef.current = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)
        goalPosRef.current = savedCamPosRef.current
        goalTargetRef.current = savedCamTargetRef.current || new THREE.Vector3(0, 0, 0)
        savedCamPosRef.current = null
        savedCamTargetRef.current = null
        lockedPosRef.current = null
        lockedTargetRef.current = null
      }
    }

    // If no animation active, lock camera at last focused position (prevents drift)
    if (!goalPosRef.current || !startPosRef.current || !goalTargetRef.current || !startTargetRef.current) {
      if (focusedId && lockedPosRef.current && lockedTargetRef.current) {
        camera.position.copy(lockedPosRef.current)
        camera.lookAt(lockedTargetRef.current)
      }
      return
    }
    const now = performance.now() / 1000
    const t = Math.min(1, (now - startTimeRef.current) / DURATION)
    const ease = 1 - Math.pow(1 - t, 3)

    camera.position.lerpVectors(startPosRef.current, goalPosRef.current, ease)
    const lookTarget = new THREE.Vector3().lerpVectors(startTargetRef.current, goalTargetRef.current, ease)
    camera.lookAt(lookTarget)

    if (t >= 1) {
      if (focusedId) {
        // Animation done while focused — save final position for locking
        lockedPosRef.current = goalPosRef.current.clone()
        lockedTargetRef.current = goalTargetRef.current.clone()
      }
      // Clear animation state — allows fresh animation on next focus change
      startPosRef.current = null
      startTargetRef.current = null
      goalPosRef.current = null
      goalTargetRef.current = null
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORBIT TARGET SPHERE — visual pivot point indicator
// ═══════════════════════════════════════════════════════════════════════════

function OrbitTargetSphere({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame(() => {
    if (!groupRef.current || !controlsRef.current) return
    const t = controlsRef.current.target
    groupRef.current.position.set(t.x, t.y, t.z)
  })
  return (
    <group ref={groupRef}>
      <mesh renderOrder={999}>
        <sphereGeometry args={[0.03, 16, 16]} />
        <meshStandardMaterial color="#d0d0e0" metalness={1.0} roughness={0.05} depthTest={false} />
      </mesh>
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CAMERA CONTROLLER — ONE useFrame to rule them all
// ═══════════════════════════════════════════════════════════════════════════

export function CameraController() {
  const { settings } = useContext(SettingsContext)
  const { isDragging } = useContext(DragContext)
  const inputState = useInputManager(s => s.inputState)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const focusedImageId = useOasisStore(s => s.focusedImageId)
  const orbitControlsRef = useRef<any>(null)
  const prevInputStateRef = useRef<string>(inputState)
  const { camera } = useThree()

  // ░▒▓ AUDIO LISTENER — attach to camera for 3D spatial audio ▓▒░
  useEffect(() => {
    if (_audioListener) return // Already created (HMR safe)
    const listener = new THREE.AudioListener()
    camera.add(listener)
    _audioListener = listener
    return () => {
      camera.remove(listener)
      _audioListener = null
    }
  }, [camera])

  // Mode-specific update functions (hooks, called unconditionally)
  const updateNoclip = useNoclipUpdate()
  const updateMouseLook = useMouseLook(settings.mouseSensitivity)
  const updateAgentFocus = useAgentFocusUpdate()

  // Click-to-lock pointer in noclip mode (replaces PointerLockControls from drei)
  // Also handles: clicking canvas while in ui-focused state to dismiss panels and re-lock
  useEffect(() => {
    const canvas = document.querySelector('#uploader-canvas') as HTMLCanvasElement
    if (!canvas) return
    const onClick = (e: MouseEvent) => {
      const state = useInputManager.getState()

      // ░▒▓ BUG FIX: Clicking canvas while ui-focused from noclip/TPS ▓▒░
      // If ui-focused (panel was open) and the click landed on the canvas (not a panel),
      // dismiss all UI layers and return to previous camera state.
      // The returnToPrevious() call will re-request pointer lock if returning to noclip/TPS.
      if (state.inputState === 'ui-focused') {
        const target = e.target as HTMLElement
        const isCanvas = target?.tagName === 'CANVAS' || target?.closest('#uploader-canvas')
        const isPanel = target?.closest('[data-ui-panel]')
        if (isCanvas && !isPanel) {
          // Clear all UI layers so returnToPrevious doesn't short-circuit
          const layers = [...state._uiLayerStack]
          for (const id of layers) {
            state.popUILayer(id)
          }
          // If popUILayer didn't already trigger returnToPrevious (empty stack case),
          // force it now
          if (useInputManager.getState().inputState === 'ui-focused') {
            state.returnToPrevious()
          }
          const nextState = useInputManager.getState()
          if (nextState.can().canLockPointer && !nextState.pointerLocked) {
            nextState.requestPointerLock()
          }
          return
        }
      }

      // Standard path: lock pointer in states that support it
      if (state.can().canLockPointer && !state.pointerLocked) {
        state.requestPointerLock()
      }
    }
    canvas.addEventListener('click', onClick)
    return () => canvas.removeEventListener('click', onClick)
  }, [])

  // The ONE useFrame — delta from R3F, NOT state.clock.getDelta() (which double-consumes)
  useFrame((state, frameDelta) => {
    const camera = state.camera as THREE.PerspectiveCamera
    const delta = Math.min(frameDelta, 0.1)
    setCameraSnapshot(camera)

    // Sync OrbitControls target when re-entering orbit from another mode
    // Without this, OrbitControls snaps to its stale internal target (the "camera snapping" bug)
    if (inputState === 'orbit' && prevInputStateRef.current !== 'orbit' && orbitControlsRef.current) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      const dist = camera.position.distanceTo(orbitControlsRef.current.target)
      orbitControlsRef.current.target.copy(camera.position).add(dir.multiplyScalar(Math.max(5, dist)))
      orbitControlsRef.current.update()
    }
    // ░▒▓ CRITICAL FIX: Reset prevFocusedRef when LEAVING agent-focus ▓▒░
    // Without this, prevFocusedRef stays stale and the 2nd focus attempt
    // sees focusedId === prevFocusedRef → no animation trigger.
    if (prevInputStateRef.current === 'agent-focus' && inputState !== 'agent-focus') {
      updateAgentFocus(camera, null, state.viewport)
    }
    prevInputStateRef.current = inputState

    switch (inputState) {
      case 'orbit':
        // OrbitControls handles itself — we just ensure it's enabled
        if (orbitControlsRef.current) {
          orbitControlsRef.current.enabled = !isDragging
        }
        // Apply settings FOV (orbit doesn't have sprint ramp)
        if (Math.abs(camera.fov - settings.fov) > 0.1) {
          camera.fov = settings.fov
          camera.updateProjectionMatrix()
        }
        break

      case 'noclip':
      case 'placement':
      case 'paint':
        // Disable OrbitControls so it doesn't fight
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        // Mouse look (only when pointer locked)
        updateMouseLook(camera)
        // WASD movement (noclip manages FOV internally for sprint ramp)
        updateNoclip(camera, delta, settings.moveSpeed, settings.fov)
        break

      case 'agent-focus':
        // Disable OrbitControls
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        // Camera lerp to agent window or image
        updateAgentFocus(camera, focusedAgentWindowId || focusedImageId, state.viewport)
        break

      case 'third-person':
        // PlayerAvatar owns the full TPS camera, including sprint FOV
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        break

      case 'ui-focused':
        // Freeze camera — nothing updates
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        break
    }
  })

  return (
    <>
      <OrbitControls
        ref={orbitControlsRef}
        enablePan={!isDragging}
        enableZoom={!isDragging}
        enableRotate={!isDragging}
        enableDamping={false}
        minDistance={0.3}
        maxDistance={500}
      />
      {/* Orbit target sphere — visual indicator of pivot point */}
      {inputState === 'orbit' && settings.showOrbitTarget && (
        <OrbitTargetSphere controlsRef={orbitControlsRef} />
      )}
    </>
  )
}
