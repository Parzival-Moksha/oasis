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

import { useRef, useContext } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, useKeyboardControls } from '@react-three/drei'
import * as THREE from 'three'
import { useOasisStore } from '../store/oasisStore'
import { useInputManager, getInputCapabilities, type InputState } from '../lib/input-manager'
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
}

export const FPS_KEYBOARD_MAP = [
  { name: FPSControls.forward, keys: ['KeyW', 'ArrowUp'] },
  { name: FPSControls.backward, keys: ['KeyS', 'ArrowDown'] },
  { name: FPSControls.left, keys: ['KeyA', 'ArrowLeft'] },
  { name: FPSControls.right, keys: ['KeyD', 'ArrowRight'] },
  { name: FPSControls.up, keys: ['KeyQ', 'Space'] },
  { name: FPSControls.down, keys: ['KeyE'] },
  { name: FPSControls.sprint, keys: ['ShiftLeft', 'ShiftRight'] },
  { name: FPSControls.slow, keys: ['ControlLeft', 'ControlRight', 'KeyC'] },
]

// ═══════════════════════════════════════════════════════════════════════════
// NOCLIP MODE — WASD movement + mouse look
// ═══════════════════════════════════════════════════════════════════════════

function useNoclipUpdate() {
  const [, getKeys] = useKeyboardControls<FPSControls>()
  const velocityRef = useRef(new THREE.Vector3())
  const multiplierRef = useRef(1)
  const baseFovRef = useRef(0)
  const elapsedRef = useRef(0)

  return (camera: THREE.PerspectiveCamera, delta: number, speed: number) => {
    if (!getInputCapabilities().movement) {
      // Decay velocity to zero when movement is blocked
      velocityRef.current.multiplyScalar(0.9)
      return
    }

    const { forward, backward, left, right, up, down, sprint, slow } = getKeys()

    // Speed multiplier ramp
    const targetMultiplier = sprint ? 4 : slow ? 0.25 : 1
    const rampLerp = 1 - Math.exp(-3 * delta)
    multiplierRef.current += (targetMultiplier - multiplierRef.current) * rampLerp

    // Sprint state for VFX
    const m = multiplierRef.current
    sprintRef.current.multiplier = m
    sprintRef.current.intensity = m > 1.05 ? (m - 1) / 3 : m < 0.95 ? (m - 1) / 0.75 : 0

    // Direction from camera orientation
    const direction = new THREE.Vector3()
    const cameraDir = new THREE.Vector3()
    camera.getWorldDirection(cameraDir)
    cameraDir.y = 0
    cameraDir.normalize()
    const cameraRight = new THREE.Vector3().crossVectors(cameraDir, new THREE.Vector3(0, 1, 0)).normalize()

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
    camera.position.add(velocityRef.current.clone().multiplyScalar(delta))

    // FOV ramp
    if (baseFovRef.current === 0) baseFovRef.current = camera.fov
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
  const initializedRef = useRef(false)

  // Listen for raw mouse movement when pointer is locked
  const deltaRef = useRef({ x: 0, y: 0 })

  if (typeof document !== 'undefined' && !initializedRef.current) {
    initializedRef.current = true
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!useInputManager.getState().pointerLocked) return
      deltaRef.current.x += e.movementX
      deltaRef.current.y += e.movementY
    })
  }

  return (camera: THREE.PerspectiveCamera) => {
    if (deltaRef.current.x === 0 && deltaRef.current.y === 0) return

    const sens = sensitivity * 0.002
    eulerRef.current.setFromQuaternion(camera.quaternion)
    eulerRef.current.y -= deltaRef.current.x * sens
    eulerRef.current.x -= deltaRef.current.y * sens
    eulerRef.current.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, eulerRef.current.x))
    camera.quaternion.setFromEuler(eulerRef.current)

    deltaRef.current.x = 0
    deltaRef.current.y = 0
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
  const DURATION = 1.2

  return (camera: THREE.PerspectiveCamera, focusedId: string | null, viewport: { aspect: number }) => {
    const placedAgentWindows = useOasisStore.getState().placedAgentWindows
    const transforms = useOasisStore.getState().transforms

    // Detect focus change
    if (focusedId !== prevFocusedRef.current) {
      prevFocusedRef.current = focusedId
      startTimeRef.current = performance.now() / 1000

      if (focusedId) {
        savedCamPosRef.current = camera.position.clone()
        savedCamTargetRef.current = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)

        const win = placedAgentWindows.find(w => w.id === focusedId)
        if (!win) return
        const t = transforms[win.id]
        const pos = t?.position || win.position
        const rot = t?.rotation || win.rotation

        const windowNormal = new THREE.Vector3(0, 0, 1)
        windowNormal.applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))

        const DIST_FACTOR = 8
        const groupScale = typeof t?.scale === 'number' ? t.scale : Array.isArray(t?.scale) ? t.scale[0] : win.scale
        const dist = DIST_FACTOR * groupScale * 1.8

        const windowCenter = new THREE.Vector3(pos[0], pos[1], pos[2])
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
      }
    }

    // Animate
    if (!goalPosRef.current || !startPosRef.current || !goalTargetRef.current || !startTargetRef.current) return
    const now = performance.now() / 1000
    const t = Math.min(1, (now - startTimeRef.current) / DURATION)
    const ease = 1 - Math.pow(1 - t, 3)

    camera.position.lerpVectors(startPosRef.current, goalPosRef.current, ease)
    const lookTarget = new THREE.Vector3().lerpVectors(startTargetRef.current, goalTargetRef.current, ease)
    camera.lookAt(lookTarget)

    if (t >= 1) {
      startPosRef.current = null
      startTargetRef.current = null
      if (focusedId) {
        camera.position.copy(goalPosRef.current)
        camera.lookAt(goalTargetRef.current)
      } else {
        goalPosRef.current = null
        goalTargetRef.current = null
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CAMERA CONTROLLER — ONE useFrame to rule them all
// ═══════════════════════════════════════════════════════════════════════════

export function CameraController() {
  const { settings } = useContext(SettingsContext)
  const { isDragging } = useContext(DragContext)
  const inputState = useInputManager(s => s.inputState)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  const orbitControlsRef = useRef<any>(null)

  // Mode-specific update functions (hooks, called unconditionally)
  const updateNoclip = useNoclipUpdate()
  const updateMouseLook = useMouseLook(settings.mouseSensitivity)
  const updateAgentFocus = useAgentFocusUpdate()

  // The ONE useFrame
  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera
    const delta = Math.min(state.clock.getDelta(), 0.1) // cap to prevent huge jumps

    switch (inputState) {
      case 'orbit':
        // OrbitControls handles itself — we just ensure it's enabled
        if (orbitControlsRef.current) {
          orbitControlsRef.current.enabled = !isDragging
        }
        break

      case 'noclip':
      case 'placement':
      case 'paint':
        // Disable OrbitControls so it doesn't fight
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        // Mouse look (only when pointer locked)
        updateMouseLook(camera)
        // WASD movement
        updateNoclip(camera, delta, settings.moveSpeed)
        break

      case 'agent-focus':
        // Disable OrbitControls
        if (orbitControlsRef.current) orbitControlsRef.current.enabled = false
        // Camera lerp to agent window
        updateAgentFocus(camera, focusedAgentWindowId, state.viewport)
        break

      case 'third-person':
        // PlayerAvatar owns the camera — we yield
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
      {/* OrbitControls mounted ALWAYS — enabled/disabled via ref in useFrame.
          No mount/unmount cycles. No cleanup races. No stale state. */}
      <OrbitControls
        ref={orbitControlsRef}
        enablePan={!isDragging}
        enableZoom={!isDragging}
        enableRotate={!isDragging}
        enableDamping={false}
        minDistance={0.3}
        maxDistance={500}
      />
    </>
  )
}
