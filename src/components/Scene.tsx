'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS - Main 3D Scene
// The canvas upon which worlds are built
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { Canvas, useFrame, ThreeEvent } from '@react-three/fiber'
import { OrbitControls, PointerLockControls, KeyboardControls, useKeyboardControls, Stars, Grid, Html, Line, TransformControls, Environment, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import { Suspense, useState, useRef, useContext, useEffect, useCallback, useTransition } from 'react'
import * as THREE from 'three'

// ═══════════════════════════════════════════════════════════════════════════════
// ─═̷─═̷─🌐─═̷─═̷─{ BASEPATH ASSET RESOLVER }─═̷─═̷─🌐─═̷─═̷─
// Next.js basePath doesn't auto-prefix public/ file references.
// THREE.DefaultLoadingManager intercepts ALL asset fetches before they fire.
// ═══════════════════════════════════════════════════════════════════════════════
const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
if (OASIS_BASE) {
  THREE.DefaultLoadingManager.setURLModifier((url: string) => {
    if (url.startsWith('/') && !url.startsWith(OASIS_BASE)) {
      return OASIS_BASE + url
    }
    return url
  })
}

import { useOasisStore } from '../store/oasisStore'

import type { OasisSettings } from './scene-lib'
import { defaultSettings, SKY_BACKGROUNDS } from './scene-lib'
import { SettingsContext, DragContext } from './scene-lib'
import { ForgeRealm } from './realms/ForgeRealm'
import PanoramaCapture from './forge/PanoramaCapture'
import { WizardConsole } from './forge/WizardConsole'
// AssetExplorerWindow deleted — functionality lives in WizardConsole
import { ObjectInspector } from './forge/ObjectInspector'
import { ActionLogButton, ActionLogPanel } from './forge/ActionLog'
import { ProfileButton } from './forge/ProfileButton'
import { OnboardingModal } from './forge/OnboardingModal'
import { MerlinPanel } from './forge/MerlinPanel'
import { AnorakPanel } from './forge/AnorakPanel'
import dynamic from 'next/dynamic'
const DevcraftPanel = dynamic(() => import('./forge/DevcraftPanel'), { ssr: false })
import { HelpPanel } from './forge/HelpPanel'
import { useWorldLoader } from './forge/WorldObjects'
import { completeQuest } from '@/lib/quests'

// ═══════════════════════════════════════════════════════════════════════════════
// ─═̷─═̷─🎮─═̷─═̷─{ QUAKE FPS CONTROLS - WASD + Q/E }─═̷─═̷─🎮─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

enum FPSControls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
  up = 'up',
  down = 'down',
  sprint = 'sprint',
  slow = 'slow',
}

const FPS_KEYBOARD_MAP = [
  { name: FPSControls.forward, keys: ['KeyW', 'ArrowUp'] },
  { name: FPSControls.backward, keys: ['KeyS', 'ArrowDown'] },
  { name: FPSControls.left, keys: ['KeyA', 'ArrowLeft'] },
  { name: FPSControls.right, keys: ['KeyD', 'ArrowRight'] },
  { name: FPSControls.up, keys: ['KeyQ', 'Space'] },
  { name: FPSControls.down, keys: ['KeyE'] },
  { name: FPSControls.sprint, keys: ['ShiftLeft', 'ShiftRight'] },
  { name: FPSControls.slow, keys: ['ControlLeft', 'ControlRight', 'KeyC'] },
]

// ─═̷─═̷─🕹️─═̷─═̷─{ FPS MOVEMENT COMPONENT }─═̷─═̷─🕹️─═̷─═̷─
// Smooth 1-second acceleration ramp via velocity lerp
// Sprint (Shift) = 4x speed, Slow (Ctrl/C) = 0.25x speed, smooth ramp + VFX

// Module-level ref: FPSMovement writes, PostProcessing + SprintParticles read
// intensity: 0 = normal, 1 = full sprint, negative = slowing
const sprintRef = { current: { intensity: 0, multiplier: 1 } }

function FPSMovement({ speed }: { speed: number }) {
  const [, getKeys] = useKeyboardControls<FPSControls>()
  const velocityRef = useRef(new THREE.Vector3())
  const multiplierRef = useRef(1)
  const baseFovRef = useRef(0)
  const elapsedRef = useRef(0)

  useFrame((state, delta) => {
    // ░▒▓ WASD BLOCKING — disable movement when typing in panels or focused on agent window ▓▒░
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null
    const isTyping = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'SELECT'
      || (activeEl as HTMLElement)?.isContentEditable
    if (isTyping || useOasisStore.getState().focusedAgentWindowId) return

    const { forward, backward, left, right, up, down, sprint, slow } = getKeys()

    // ── Speed multiplier ramp (~1s to full) ──────────────────────────
    const targetMultiplier = sprint ? 4 : slow ? 0.25 : 1
    const rampSpeed = 3 // 1 - e^(-3) ≈ 0.95 after 1s
    const rampLerp = 1 - Math.exp(-rampSpeed * delta)
    multiplierRef.current += (targetMultiplier - multiplierRef.current) * rampLerp

    // Publish sprint state for PostProcessing + particles
    const m = multiplierRef.current
    sprintRef.current.multiplier = m
    sprintRef.current.intensity = m > 1.05 ? (m - 1) / 3 : m < 0.95 ? (m - 1) / 0.75 : 0

    // ── Movement direction ───────────────────────────────────────────
    const direction = new THREE.Vector3()
    const camera = state.camera

    const cameraDir = new THREE.Vector3()
    camera.getWorldDirection(cameraDir)
    cameraDir.y = 0
    cameraDir.normalize()

    const cameraRight = new THREE.Vector3()
    cameraRight.crossVectors(cameraDir, new THREE.Vector3(0, 1, 0)).normalize()

    if (forward) direction.add(cameraDir)
    if (backward) direction.sub(cameraDir)
    if (right) direction.add(cameraRight)
    if (left) direction.sub(cameraRight)
    if (up) direction.y += 1
    if (down) direction.y -= 1

    direction.normalize()

    const effectiveSpeed = speed * multiplierRef.current
    const targetVelocity = direction.multiplyScalar(effectiveSpeed)

    // Lerp velocity for smooth ramp (~0.2s to 80% speed)
    const lerpFactor = 1 - Math.exp(-5 * delta)
    velocityRef.current.lerp(targetVelocity, lerpFactor)

    camera.position.add(velocityRef.current.clone().multiplyScalar(delta))

    // ── FOV ramp (wider = speed feel) ────────────────────────────────
    if (camera instanceof THREE.PerspectiveCamera) {
      if (baseFovRef.current === 0) baseFovRef.current = camera.fov
      const targetFov = baseFovRef.current + (multiplierRef.current - 1) * 5
      camera.fov += (targetFov - camera.fov) * rampLerp
      camera.updateProjectionMatrix()
    }

    // ── Camera shake (smooth sinusoidal, only during sprint) ─────────
    const si = Math.max(0, sprintRef.current.intensity)
    if (si > 0.05) {
      elapsedRef.current += delta
      const t = elapsedRef.current
      const shakeAmt = si * 0.018
      camera.position.x += Math.sin(t * 23.1) * Math.sin(t * 17.3) * shakeAmt
      camera.position.y += Math.sin(t * 19.7) * Math.cos(t * 13.8) * shakeAmt
    }
  })

  return null
}

// ─═̷─═̷─💨─═̷─═̷─{ SPRINT SPEED LINES }─═̷─═̷─💨─═̷─═̷─
// Instanced thin streaks that fly past the camera during sprint
const SPRINT_LINE_COUNT = 80

function SprintParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useRef(new THREE.Object3D())
  const particles = useRef<{ x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[]>([])

  // Init particle pool
  if (particles.current.length === 0) {
    particles.current = Array.from({ length: SPRINT_LINE_COUNT }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0,
    }))
  }

  useFrame((state, delta) => {
    const intensity = Math.max(0, sprintRef.current.intensity)
    const mesh = meshRef.current
    if (!mesh) return

    // Hide all when not sprinting
    if (intensity < 0.05) {
      mesh.visible = false
      return
    }
    mesh.visible = true

    const cam = state.camera
    const camDir = new THREE.Vector3()
    cam.getWorldDirection(camDir)

    const camRight = new THREE.Vector3()
    camRight.crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize()
    const camUp = new THREE.Vector3()
    camUp.crossVectors(camRight, camDir).normalize()

    particles.current.forEach((p, i) => {
      p.life -= delta

      if (p.life <= 0) {
        // Spawn in a ring around camera, biased to periphery
        const angle = Math.random() * Math.PI * 2
        const radius = 1.5 + Math.random() * 4
        const ahead = 8 + Math.random() * 12
        const spread = (Math.random() - 0.5) * 6

        p.x = cam.position.x + camDir.x * ahead + camRight.x * Math.cos(angle) * radius + camUp.x * (Math.sin(angle) * radius + spread)
        p.y = cam.position.y + camDir.y * ahead + camRight.y * Math.cos(angle) * radius + camUp.y * (Math.sin(angle) * radius + spread)
        p.z = cam.position.z + camDir.z * ahead + camRight.z * Math.cos(angle) * radius + camUp.z * (Math.sin(angle) * radius + spread)

        // Fly backward relative to camera
        const speed = 25 + Math.random() * 20
        p.vx = -camDir.x * speed
        p.vy = -camDir.y * speed
        p.vz = -camDir.z * speed
        p.life = 0.2 + Math.random() * 0.4
      }

      p.x += p.vx * delta
      p.y += p.vy * delta
      p.z += p.vz * delta

      dummy.current.position.set(p.x, p.y, p.z)
      dummy.current.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz)
      const streakLen = 0.3 + intensity * 1.2
      dummy.current.scale.set(0.012, 0.012, streakLen)
      dummy.current.updateMatrix()
      mesh.setMatrixAt(i, dummy.current.matrix)
    })

    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, SPRINT_LINE_COUNT]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.25} depthWrite={false} />
    </instancedMesh>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL — Forge-relevant controls only
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsContent() {
  const { settings, updateSetting } = useContext(SettingsContext)

  const toggles = [
    { key: 'bloomEnabled' as const, label: 'Bloom', category: 'Post-FX' },
    { key: 'vignetteEnabled' as const, label: 'Vignette', category: 'Post-FX' },
    { key: 'chromaticEnabled' as const, label: 'Chromatic Aberration', category: 'Post-FX' },
    { key: 'fpsCounterEnabled' as const, label: 'FPS Counter', category: 'UI' },
  ]

  const categories = ['Post-FX', 'UI']

  return (
    <div className="p-4 w-fit">
      <div className="text-xs text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2 whitespace-nowrap">
        <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
        Settings
      </div>

      {categories.map(category => (
        <div key={category} className="mb-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">{category}</div>

          {category !== 'UI' && toggles.filter(t => t.category === category).map(toggle => (
            <label key={toggle.key} className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
              <div
                onClick={() => updateSetting(toggle.key, !settings[toggle.key])}
                className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
                  settings[toggle.key] ? 'bg-purple-600 shadow-lg shadow-purple-500/30' : 'bg-gray-700'
                }`}
              >
                <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
                  settings[toggle.key] ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </div>
              <span className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">{toggle.label}</span>
            </label>
          ))}

          {/* UI-specific settings */}
          {category === 'UI' && (
            <>
              {toggles.filter(t => t.category === 'UI').map(toggle => (
                <label key={toggle.key} className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
                  <div
                    onClick={() => updateSetting(toggle.key, !settings[toggle.key])}
                    className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
                      settings[toggle.key] ? 'bg-purple-600 shadow-lg shadow-purple-500/30' : 'bg-gray-700'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
                      settings[toggle.key] ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </div>
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">{toggle.label}</span>
                </label>
              ))}

              {/* FPS Font Size */}
              <div className="py-1.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">FPS Font Size</span>
                  <span className="text-xs text-purple-400 font-mono">{settings.fpsCounterFontSize}px</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={settings.fpsCounterFontSize}
                  onChange={(e) => updateSetting('fpsCounterFontSize', parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              {/* Panel Opacity — custom div slider, native range unreliable in portals on Windows */}
              <div className="py-1.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-300">Menu Opacity</span>
                  <span className="text-xs text-purple-400 font-mono">{Math.round(settings.uiOpacity * 100)}%</span>
                </div>
                <div
                  className="w-full h-4 rounded-full bg-gray-700 cursor-pointer relative select-none"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const update = (clientX: number) => {
                      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
                      const v = Math.round((0.1 + pct * 0.9) * 20) / 20
                      updateSetting('uiOpacity', v)
                    }
                    update(e.clientX)
                    const onMove = (ev: MouseEvent) => update(ev.clientX)
                    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                  }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-purple-500/60"
                    style={{ width: `${((settings.uiOpacity - 0.1) / 0.9) * 100}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-purple-400 border-2 border-purple-300 shadow-md"
                    style={{ left: `calc(${((settings.uiOpacity - 0.1) / 0.9) * 100}% - 6px)` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ))}

      {/* ─═̷─═̷─🎮─═̷─═̷─ CAMERA CONTROLS ─═̷─═̷─🎮─═̷─═̷─ */}
      <div className="mb-2">
        <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Camera Controls</div>
        <select
          value={settings.controlMode}
          onChange={(e) => updateSetting('controlMode', e.target.value as 'orbit' | 'noclip' | 'third-person')}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-300 hover:border-purple-500 focus:border-purple-500 focus:outline-none transition-colors mb-2"
        >
          <option value="orbit">Orbit (Classic)</option>
          <option value="noclip">Noclip (fly)</option>
          <option value="third-person">Third Person (Avatar)</option>
        </select>

        {settings.controlMode === 'orbit' && (
          <label className="flex items-center gap-2 mt-1 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showOrbitTarget}
              onChange={(e) => updateSetting('showOrbitTarget', e.target.checked)}
              className="accent-purple-500"
            />
            <span className="text-sm text-gray-300">Show orbit pivot point</span>
          </label>
        )}

        {(settings.controlMode === 'noclip' || settings.controlMode === 'third-person') && (
          <>
            <div className="py-1.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Mouse Sensitivity</span>
                <span className="text-xs text-purple-400 font-mono">{settings.mouseSensitivity.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={settings.mouseSensitivity * 10}
                onChange={(e) => updateSetting('mouseSensitivity', parseInt(e.target.value) / 10)}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
              />
            </div>

            <div className="py-1.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">Move Speed</span>
                <span className="text-xs text-purple-400 font-mono">{settings.moveSpeed}</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={settings.moveSpeed}
                onChange={(e) => updateSetting('moveSpeed', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
              />
            </div>

            <div className="text-[10px] text-gray-500 mt-2">
              {settings.controlMode === 'noclip'
                ? 'Click canvas to lock pointer · WASD to move · Q/E up/down · ESC to unlock'
                : 'Click canvas to lock pointer · WASD to move avatar · Mouse to orbit camera · ESC to unlock'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKY BACKGROUND — procedural stars or HDRI panorama
// ═══════════════════════════════════════════════════════════════════════════════

function SkyBackgroundInner({ backgroundId }: { backgroundId: string }) {
  const skyConfig = SKY_BACKGROUNDS.find(s => s.id === backgroundId) || SKY_BACKGROUNDS[0]

  // drei built-in preset (CDN-hosted HDR) — sets both background AND environment (IBL)
  if ('preset' in skyConfig && skyConfig.preset) {
    return (
      <Environment
        preset={skyConfig.preset as any}
        background
        backgroundBlurriness={0}
        backgroundIntensity={1}
      />
    )
  }

  // Procedural stars — no IBL environment
  if (!skyConfig.path) {
    return <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={0.3} />
  }

  // Local HDRI file — sets both background AND environment (IBL)
  return (
    <Environment
      files={`${OASIS_BASE}${skyConfig.path}`}
      background
      backgroundBlurriness={0}
      backgroundIntensity={1}
    />
  )
}

// Wrapper: keeps old sky visible until new one loads (no black flash)
function SkyBackground({ backgroundId }: { backgroundId: string }) {
  const [activeId, setActiveId] = useState(backgroundId)
  const [isPending, startTransition] = useTransition()
  useEffect(() => {
    startTransition(() => setActiveId(backgroundId))
  }, [backgroundId])
  return <SkyBackgroundInner backgroundId={activeId} />
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORBIT TARGET GIZMO — metallic armillary sphere pivot point
// ═══════════════════════════════════════════════════════════════════════════════

function makeRingPoints(radius: number, segments: number, plane: 'xz' | 'xy' | 'yz'): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2
    const c = Math.cos(theta) * radius
    const s = Math.sin(theta) * radius
    if (plane === 'xz') pts.push([c, 0, s])
    else if (plane === 'xy') pts.push([c, s, 0])
    else pts.push([0, c, s])
  }
  return pts
}

const RING_XZ = makeRingPoints(0.18, 48, 'xz')
const RING_XY = makeRingPoints(0.18, 48, 'xy')
const RING_YZ = makeRingPoints(0.18, 48, 'yz')
const AXIS_LEN = 0.25

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
        <meshStandardMaterial
          color="#d0d0e0"
          metalness={1.0}
          roughness={0.05}
          depthTest={false}
        />
      </mesh>

      <Line points={RING_XZ} color="#c0c0d0" lineWidth={1.5} transparent opacity={0.5} />
      <Line points={RING_XY} color="#c0c0d0" lineWidth={1.0} transparent opacity={0.3} />
      <Line points={RING_YZ} color="#c0c0d0" lineWidth={1.0} transparent opacity={0.3} />

      <Line points={[[-AXIS_LEN, 0, 0], [AXIS_LEN, 0, 0]]} color="#ef4444" lineWidth={1.0} transparent opacity={0.45} />
      <Line points={[[0, -AXIS_LEN, 0], [0, AXIS_LEN, 0]]} color="#22c55e" lineWidth={1.0} transparent opacity={0.45} />
      <Line points={[[0, 0, -AXIS_LEN], [0, 0, AXIS_LEN]]} color="#3b82f6" lineWidth={1.0} transparent opacity={0.45} />
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA LERP — Smooth transition to a target position when selecting objects
// ░▒▓ Set cameraLookAt in the store → camera glides there over 1500ms ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function CameraLerp({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const cameraLookAt = useOasisStore(s => s.cameraLookAt)
  const setCameraLookAt = useOasisStore(s => s.setCameraLookAt)
  const targetRef = useRef<THREE.Vector3 | null>(null)
  const startRef = useRef<THREE.Vector3 | null>(null)
  const startTimeRef = useRef(0)
  const DURATION = 1.5 // seconds

  useEffect(() => {
    if (!cameraLookAt || !controlsRef.current) return
    const controls = controlsRef.current
    startRef.current = controls.target.clone()
    targetRef.current = new THREE.Vector3(...cameraLookAt)
    startTimeRef.current = performance.now() / 1000
    // Clear from store immediately so it's a one-shot trigger
    setCameraLookAt(null)
  }, [cameraLookAt, controlsRef, setCameraLookAt])

  useFrame((state) => {
    if (!targetRef.current || !startRef.current || !controlsRef.current) return
    const elapsed = state.clock.elapsedTime - startTimeRef.current
    // Fix: use wall clock delta since startTimeRef is wall time
    const now = performance.now() / 1000
    const t = Math.min(1, (now - startTimeRef.current) / DURATION)
    // Smooth ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3)
    controlsRef.current.target.lerpVectors(startRef.current, targetRef.current, ease)
    if (t >= 1) {
      targetRef.current = null
      startRef.current = null
    }
  })

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT WINDOW FOCUS — Camera flies to fill viewport with selected 3D window
// ░▒▓ Enter = focus, ESC = unfocus. Camera position + lookAt both lerped. ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function AgentWindowFocus() {
  const focusedId = useOasisStore(s => s.focusedAgentWindowId)
  const placedAgentWindows = useOasisStore(s => s.placedAgentWindows)
  const transforms = useOasisStore(s => s.transforms)

  // Lerp state
  const startPosRef = useRef<THREE.Vector3 | null>(null)
  const startTargetRef = useRef<THREE.Vector3 | null>(null)
  const goalPosRef = useRef<THREE.Vector3 | null>(null)
  const goalTargetRef = useRef<THREE.Vector3 | null>(null)
  const startTimeRef = useRef(0)
  const prevFocusedRef = useRef<string | null>(null)
  const savedCamPosRef = useRef<THREE.Vector3 | null>(null)
  const savedCamTargetRef = useRef<THREE.Vector3 | null>(null)
  const DURATION = 1.2 // seconds

  useFrame((state) => {
    const camera = state.camera as THREE.PerspectiveCamera

    // Detect focus change
    if (focusedId !== prevFocusedRef.current) {
      prevFocusedRef.current = focusedId
      startTimeRef.current = performance.now() / 1000

      if (focusedId) {
        // ░▒▓ Release pointer lock so browser cursor can interact with Html content ▓▒░
        if (typeof document !== 'undefined' && document.pointerLockElement) {
          document.exitPointerLock()
        }

        // Save current camera state for ESC return
        savedCamPosRef.current = camera.position.clone()
        savedCamTargetRef.current = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)

        // Find the window
        const win = placedAgentWindows.find(w => w.id === focusedId)
        if (!win) return
        const t = transforms[win.id]
        const pos = t?.position || win.position
        const rot = t?.rotation || win.rotation

        // Calculate camera position: offset along window's local -Z (normal pointing toward viewer)
        const windowNormal = new THREE.Vector3(0, 0, 1)
        const euler = new THREE.Euler(rot[0], rot[1], rot[2])
        windowNormal.applyEuler(euler)

        // Distance to fill ~90% of viewport with the Html content
        // Html uses distanceFactor={8}: at distance=8, HTML renders 1:1 pixels.
        // We want the window to fill the viewport, so we compute the distance
        // where the HTML's projected size matches ~90% of the screen.
        const DIST_FACTOR = 8
        const groupScale = typeof t?.scale === 'number' ? t.scale : Array.isArray(t?.scale) ? t.scale[0] : win.scale
        const fovRad = (camera.fov * Math.PI) / 180
        const aspect = state.viewport.aspect
        // With distanceFactor=8, at d=8 the HTML is 1:1 pixels.
        // For the window to fill ~90% of viewport, we need more distance.
        // Empirical: 1.8× distanceFactor gives the right framing.
        const dist = DIST_FACTOR * groupScale * 1.8

        const windowCenter = new THREE.Vector3(pos[0], pos[1], pos[2])
        const cameraGoal = windowCenter.clone().add(windowNormal.clone().multiplyScalar(dist))

        startPosRef.current = camera.position.clone()
        startTargetRef.current = savedCamTargetRef.current!.clone()
        goalPosRef.current = cameraGoal
        goalTargetRef.current = windowCenter
      } else if (savedCamPosRef.current) {
        // Unfocusing — return to saved position
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
    const ease = 1 - Math.pow(1 - t, 3) // ease-out cubic

    camera.position.lerpVectors(startPosRef.current, goalPosRef.current, ease)
    const lookTarget = new THREE.Vector3().lerpVectors(startTargetRef.current, goalTargetRef.current, ease)
    camera.lookAt(lookTarget)

    if (t >= 1) {
      // Animation complete — clear lerp refs but keep focus state
      startPosRef.current = null
      startTargetRef.current = null
      // Keep goalPosRef/goalTargetRef so camera stays locked
      if (focusedId) {
        // Keep camera locked on the window
        camera.position.copy(goalPosRef.current)
        camera.lookAt(goalTargetRef.current)
      } else {
        goalPosRef.current = null
        goalTargetRef.current = null
      }
    }
  })

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-PROCESSING EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

function PostProcessing() {
  const { settings } = useContext(SettingsContext)
  const [sprintActive, setSprintActive] = useState(false)
  const chromaticRef = useRef<any>(null)
  const vignetteRef = useRef<any>(null)

  useFrame(() => {
    const si = Math.max(0, sprintRef.current.intensity)
    const isActive = si > 0.05
    if (isActive !== sprintActive) setSprintActive(isActive)

    // Imperatively update effect uniforms — no re-renders needed
    if (chromaticRef.current) {
      const base = settings.chromaticEnabled ? 0.003 : 0
      const boost = si * 0.012
      const val = base + boost
      // Assign new Vector2 — offset may not be a Vector2 in all postprocessing versions
      chromaticRef.current.offset = new THREE.Vector2(val, val)
    }
    if (vignetteRef.current) {
      const baseDarkness = settings.vignetteEnabled ? 0.7 : 0
      const boost = si * 0.4
      const target = baseDarkness + boost
      const u = vignetteRef.current.uniforms?.get?.('darkness')
      if (u) u.value = target
      else if ('darkness' in vignetteRef.current) (vignetteRef.current as any).darkness = target
    }
  })

  const hasEffects = settings.bloomEnabled || settings.vignetteEnabled || settings.chromaticEnabled || sprintActive
  if (!hasEffects) return null

  return (
    <EffectComposer>
      <Bloom
        intensity={settings.bloomEnabled ? 0.4 : 0}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.4}
      />
      <Vignette
        ref={vignetteRef}
        offset={0.3}
        darkness={settings.vignetteEnabled ? 0.7 : 0}
        blendFunction={BlendFunction.NORMAL}
      />
      <ChromaticAberration
        ref={chromaticRef}
        offset={settings.chromaticEnabled ? [0.003, 0.003] as any : [0, 0] as any}
        radialModulation
        modulationOffset={0.5}
      />
    </EffectComposer>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FPS COUNTER
// ═══════════════════════════════════════════════════════════════════════════════

const fpsRef = { current: 60 }
const frameTimesRef = { current: [] as number[] }

function FPSTracker() {
  useFrame(() => {
    const now = performance.now()
    const frameTimes = frameTimesRef.current

    frameTimes.push(now)

    while (frameTimes.length > 60) {
      frameTimes.shift()
    }

    if (frameTimes.length >= 2) {
      const elapsed = frameTimes[frameTimes.length - 1] - frameTimes[0]
      if (elapsed > 0) {
        fpsRef.current = Math.round((frameTimes.length - 1) / (elapsed / 1000))
      }
    }
  })

  return null
}

function FPSDisplay({ enabled, fontSize }: { enabled: boolean; fontSize: number }) {
  const [fps, setFps] = useState(60)

  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(() => {
      setFps(fpsRef.current)
    }, 200)

    return () => clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  const color = fps >= 55 ? '#22c55e' : fps >= 30 ? '#facc15' : '#ef4444'

  return (
    <div
      className="fixed top-4 right-4 z-[100] font-mono font-bold pointer-events-none select-none"
      style={{
        fontSize: `${fontSize}px`,
        color,
        textShadow: `0 0 10px ${color}40, 0 2px 4px rgba(0,0,0,0.5)`,
      }}
    >
      {fps} FPS
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUEST TRACKER — subscribes to store, auto-completes onboarding quests
// ═══════════════════════════════════════════════════════════════════════════════

function useQuestTracker() {
  useEffect(() => {
    const unsub = useOasisStore.subscribe((state, prev) => {
      // Quest: Place an object
      if (state.placedCatalogAssets.length > prev.placedCatalogAssets.length) {
        completeQuest('place-object')
      }
      // Quest: Select & inspect an object
      if (state.inspectedObjectId && !prev.inspectedObjectId) {
        completeQuest('select-object')
      }
      // Quest: Add a light
      if (state.worldLights.length > prev.worldLights.length) {
        completeQuest('add-light')
      }
      // Quest: Change sky background
      if (state.worldSkyBackground !== prev.worldSkyBackground && prev.worldSkyBackground) {
        completeQuest('set-sky')
      }
      // Quest: Change ground preset
      if (state.groundPresetId !== prev.groundPresetId && prev.groundPresetId !== undefined) {
        completeQuest('set-ground')
      }
    })
    return unsub
  }, [])
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVCRAFT MINI BAR — shows when DevCraft is minimized but a mission is running
// ═══════════════════════════════════════════════════════════════════════════════

function DevcraftMiniBar({ onExpand }: { onExpand: () => void }) {
  const [mission, setMission] = useState<{ name: string; startedAt: string; isPaused: boolean; pausedAt: string | null; totalPausedMs: number; actualSeconds: number; targetSeconds: number | null; horizon: string | null } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [pos, setPos] = useState({ x: 0, y: 0 }) // 0,0 = centered (default)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      setPos({
        x: dragRef.current.origX + (e.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (e.clientY - dragRef.current.startY),
      })
    }
    const onUp = () => { setDragging(false); dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/missions?status=wip&limit=1')
        if (!res.ok) return
        const data = await res.json()
        const wip = Array.isArray(data) ? data[0] : null
        setMission(wip)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!mission?.startedAt) return
    const tick = () => {
      const accumulated = mission.actualSeconds || 0
      if (mission.isPaused) {
        // When paused, show accumulated + time before pause
        const preP = mission.pausedAt
          ? Math.floor((new Date(mission.pausedAt).getTime() - new Date(mission.startedAt).getTime() - (mission.totalPausedMs || 0)) / 1000)
          : 0
        setElapsed(accumulated + Math.max(0, preP))
      } else {
        const currentMs = Date.now() - new Date(mission.startedAt).getTime() - (mission.totalPausedMs || 0)
        setElapsed(accumulated + Math.max(0, Math.floor(currentMs / 1000)))
      }
    }
    tick()
    if (mission.isPaused) return // Don't tick when paused, but DO set the elapsed
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [mission])

  if (!mission) return null

  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  const progress = mission.targetSeconds ? Math.min(100, (elapsed / mission.targetSeconds) * 100) : null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: pos.y === 0 ? 8 : undefined,
        top: pos.y !== 0 ? pos.y : undefined,
        left: pos.x === 0 ? '50%' : pos.x,
        transform: pos.x === 0 && pos.y === 0 ? 'translateX(-50%)' : undefined,
        zIndex: 9990,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 16px',
        background: 'rgba(0,0,0,0.9)',
        border: '1px solid rgba(0,255,65,0.3)',
        borderRadius: 10,
        cursor: dragging ? 'grabbing' : 'grab',
        fontFamily: 'monospace',
        fontSize: 13,
        boxShadow: '0 0 15px rgba(0,255,65,0.1)',
        userSelect: 'none',
      }}
      onMouseDown={e => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
        setPos({ x: rect.left, y: rect.top })
        setDragging(true)
      }}
      onMouseUp={e => {
        if (dragRef.current) {
          const dx = Math.abs(e.clientX - dragRef.current.startX)
          const dy = Math.abs(e.clientY - dragRef.current.startY)
          if (dx < 5 && dy < 5) onExpand() // Click (no drag) → expand
        }
      }}
    >
      <span style={{ color: '#00ff41', fontWeight: 700, textShadow: '0 0 8px #00ff41' }}>{timeStr}</span>
      {progress !== null && (
        <div style={{ width: 120, height: 6, background: '#111', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, progress))}%`, height: '100%', background: progress > 90 ? '#ff4040' : '#00ff41', transition: 'width 1s' }} />
        </div>
      )}
      <span style={{ color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mission.name}
      </span>
      {mission.isPaused && <span style={{ color: '#ff9900', fontSize: 11 }}>⏸</span>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SCENE
// ═══════════════════════════════════════════════════════════════════════════════

export default function Scene() {
  // Local mode: always admin, never anonymous. Auth is optional.
  const isAdmin = true
  const [isDragging, setIsDragging] = useState(false)

  // ─═̷─═̷─⚔️─═̷─═̷─{ QUEST TRACKER — auto-detect onboarding actions }─═̷─═̷─⚔️─═̷─═̷─
  useQuestTracker()

  // ─═̷─═̷─💾─═̷─═̷─{ SETTINGS PERSISTENCE }─═̷─═̷─💾─═̷─═̷─
  const [settings, setSettings] = useState<OasisSettings>(() => {
    if (typeof window !== 'undefined') {
      // Clean up Parzival-era key — start fresh with Oasis defaults
      if (localStorage.getItem('uploader-settings')) localStorage.removeItem('uploader-settings')
      const saved = localStorage.getItem('oasis-settings')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          return { ...defaultSettings, ...parsed }
        } catch {
          return defaultSettings
        }
      }
    }
    return defaultSettings
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('oasis-settings', JSON.stringify(settings))
    }
  }, [settings])

  const selectObject = useOasisStore(s => s.selectObject)
  const inspectedObjectId = useOasisStore(s => s.inspectedObjectId)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const worldSkyBackground = useOasisStore(s => s.worldSkyBackground)
  const focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)

  // ─═̷─═̷─🌍─═̷─═̷─{ WORLD LOADER — ensures conjured assets + world state loaded }─═̷─═̷─🌍─═̷─═̷─
  useWorldLoader()

  const isViewMode = useOasisStore(s => s.isViewMode)
  const isViewModeEditable = useOasisStore(s => s.isViewModeEditable)
  // Hide editing tools when viewing read-only worlds (but show for public_edit)
  // Anonymous users NEVER get edit tools, even on public_edit worlds
  const hideEditTools = isViewMode && !isViewModeEditable

  // ─═̷─═̷─✨─═̷─═̷─{ WIZARD CONSOLE + ASSET EXPLORER STATE }─═̷─═̷─✨─═̷─═̷─
  const [wizardOpen, setWizardOpen] = useState(true)
  // Asset Explorer removed — merged into WizardConsole
  const [actionLogOpen, setActionLogOpen] = useState(false)
  const [merlinOpen, setMerlinOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [claudeCodeOpen, setClaudeCodeOpen] = useState(false)
  const [devcraftOpen, setDevcraftOpen] = useState(false)

  const orbitControlsRef = useRef<any>(null)

  const updateSetting = <K extends keyof OasisSettings>(key: K, value: OasisSettings[K]) => {
    // Auto-exit pointer lock when switching to orbit mode (from fps or third-person)
    if (key === 'controlMode' && value === 'orbit' && document.pointerLockElement) {
      document.exitPointerLock()
    }
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  // ─═̷─═̷─🎮─═̷─═̷─{ CAMERA MODE HOTKEY: Ctrl+Alt+C cycles orbit→fps→third-person }─═̷─═̷─🎮─═̷─═̷─
  useEffect(() => {
    const MODES: Array<'orbit' | 'noclip' | 'third-person'> = ['orbit', 'noclip', 'third-person']
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyC') {
        e.preventDefault()
        setSettings(prev => {
          const idx = MODES.indexOf(prev.controlMode)
          const next = MODES[(idx + 1) % MODES.length]
          // Auto-exit pointer lock when switching away from fps/third-person
          if (next === 'orbit' && document.pointerLockElement) {
            document.exitPointerLock()
          }
          return { ...prev, controlMode: next }
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─═̷─═̷─🎯─═̷─═̷─{ FPS POINTER LOCK STATE + RIGHT-CLICK UNLOCK }─═̷─═̷─🎯─═̷─═̷─
  const [pointerLocked, setPointerLocked] = useState(false)

  useEffect(() => {
    const onPointerLockChange = () => setPointerLocked(!!document.pointerLockElement)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2 && document.pointerLockElement) {
        e.preventDefault()
        document.exitPointerLock()
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target?.closest('#uploader-canvas') || target?.tagName === 'CANVAS') {
        e.preventDefault()
      }
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('contextmenu', onContextMenu)
    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // ─═̷─═̷─🎮─═̷─═̷─{ CANVAS }─═̷─═̷─🎮─═̷─═̷─
  const CanvasContent = (
    <Canvas
      id="uploader-canvas"
      camera={{ position: [12, 10, 12], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        if (document.pointerLockElement) return  // Noclip/TPS mode — click locks pointer, not deselects
        selectObject(null)
      }}
    >
        <color attach="background" args={['#030303']} />

        <SkyBackground backgroundId={worldSkyBackground} />

        {/* ─═̷─═̷─🎮─═̷─═̷─ CAMERA CONTROLS ─═̷─═̷─🎮─═̷─═̷─ */}
        {/* orbit: OrbitControls. fps: PointerLock + WASD. third-person: PlayerAvatar handles camera */}
        {settings.controlMode === 'orbit' && (
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
            {settings.showOrbitTarget && <OrbitTargetSphere controlsRef={orbitControlsRef} />}
            <CameraLerp controlsRef={orbitControlsRef} />
          </>
        )}
        {settings.controlMode === 'noclip' && (
          <>
            {/* ░▒▓ Suppress pointer lock when agent window is focused — need free cursor ▓▒░ */}
            {!focusedAgentWindowId && (
              <PointerLockControls
                selector="#uploader-canvas"
                pointerSpeed={settings.mouseSensitivity}
              />
            )}
            <FPSMovement speed={settings.moveSpeed} />
            <SprintParticles />
          </>
        )}
        {/* third-person: camera is driven by PlayerAvatar in ForgeRealm — no controls needed here */}

        {/* ░▒▓ AGENT WINDOW FOCUS — camera flies to fill viewport with 3D agent panel ▓▒░ */}
        <AgentWindowFocus />

        <Grid
          position={[0, 0, 0]}
          args={[50, 50]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1a1a2e"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#2a2a4e"
          fadeDistance={50}
          fadeStrength={1}
          infiniteGrid
        />

        {/* ─═̷─═̷─🌍─═̷─═̷─ THE FORGE ─═̷─═̷─🌍─═̷─═̷─ */}
        <Suspense fallback={null}>
          <ForgeRealm />
        </Suspense>

        {/* ─═̷─═̷─📸─═̷─═̷─ PANORAMA CAPTURE (Ctrl+Shift+P) ─═̷─═̷─📸─═̷─═̷─ */}
        <PanoramaCapture />

        <PostProcessing />
        <FPSTracker />
    </Canvas>
  )

  return (
    <SettingsContext.Provider value={{ settings, updateSetting }}>
    <DragContext.Provider value={{ isDragging, setIsDragging }}>
      <KeyboardControls map={FPS_KEYBOARD_MAP}>
        {CanvasContent}
      </KeyboardControls>

      {/* ─═̷─═̷─⚡ FPS DISPLAY ─═̷─═̷─⚡ */}
      <FPSDisplay enabled={settings.fpsCounterEnabled} fontSize={settings.fpsCounterFontSize} />

      {/* ─═̷─═̷─🎯 CROSSHAIR — Noclip mode only ─═̷─═̷─🎯 */}
      {settings.controlMode === 'noclip' && pointerLocked && (
        <div className="fixed inset-0 pointer-events-none z-[99] flex items-center justify-center">
          <div className="relative w-5 h-5">
            <div className="absolute top-1/2 left-0 w-full h-px bg-white/40" />
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/40" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white/60" />
          </div>
        </div>
      )}

      {/* ─═̷─═̷─🔮─═̷─═̷─ TOP-LEFT BUTTON BAR — Profile, Settings, Wizard, Action Log ─═̷─═̷─🔮─═̷─═̷─ */}
      <div className="fixed top-4 left-4 z-[200] flex items-start gap-2">
        <ProfileButton />
        <SettingsGear>
          <SettingsContent />
        </SettingsGear>
        {!hideEditTools && (
          <button
            onClick={() => {
              setWizardOpen(prev => {
                if (!prev) completeQuest('open-wizard')
                return !prev
              })
            }}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
            style={{
              background: wizardOpen ? 'rgba(249,115,22,0.4)' : 'rgba(0,0,0,0.6)',
              border: `1px solid ${wizardOpen ? 'rgba(249,115,22,0.6)' : 'rgba(255,255,255,0.15)'}`,
              color: wizardOpen ? '#F97316' : '#aaa',
              boxShadow: wizardOpen ? '0 0 12px rgba(249,115,22,0.3)' : 'none',
            }}
            title="Wizard Console"
          >
            ✨
          </button>
        )}
        {!hideEditTools && (
          <ActionLogButton
            onClick={() => setActionLogOpen(prev => !prev)}
            isOpen={actionLogOpen}
          />
        )}
        {!hideEditTools && (
          <button
            onClick={() => setMerlinOpen(prev => !prev)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
            style={{
              background: merlinOpen ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.6)',
              border: `1px solid ${merlinOpen ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
              color: merlinOpen ? '#A855F7' : '#aaa',
              boxShadow: merlinOpen ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
            }}
            title="Merlin — AI World Builder"
          >
            🧙
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setClaudeCodeOpen(prev => !prev)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
            style={{
              background: claudeCodeOpen ? 'rgba(56,189,248,0.3)' : 'rgba(0,0,0,0.6)',
              border: `1px solid ${claudeCodeOpen ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.15)'}`,
              color: claudeCodeOpen ? '#38BDF8' : '#aaa',
              boxShadow: claudeCodeOpen ? '0 0 12px rgba(56,189,248,0.3)' : 'none',
            }}
            title="Claude Code"
          >
            💻
          </button>
        )}
        <button
          onClick={() => setDevcraftOpen(prev => !prev)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: devcraftOpen ? 'rgba(16,185,129,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${devcraftOpen ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: devcraftOpen ? '#10B981' : '#aaa',
            boxShadow: devcraftOpen ? '0 0 12px rgba(16,185,129,0.3)' : 'none',
          }}
          title="DevCraft — Productivity Terminal"
        >
          ⚡
        </button>
        <button
          onClick={() => setFeedbackOpen(prev => !prev)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: feedbackOpen ? 'rgba(249,115,22,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${feedbackOpen ? 'rgba(249,115,22,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: feedbackOpen ? '#F97316' : '#aaa',
            boxShadow: feedbackOpen ? '0 0 12px rgba(249,115,22,0.3)' : 'none',
          }}
          title="Anorak — Bug Reports & Feature Requests"
        >
          🔮
        </button>
        <button
          onClick={() => setHelpOpen(prev => !prev)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: helpOpen ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${helpOpen ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: helpOpen ? '#A855F7' : '#aaa',
            boxShadow: helpOpen ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
          }}
          title="Help — Controls, Guide & Glossary"
        >
          ❓
        </button>
      </div>

      {/* ✨ Wizard Console — hidden in view mode */}
      {!hideEditTools && (
        <WizardConsole
          isOpen={wizardOpen}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {/* 🔍 Object Inspector — hidden in view mode */}
      {!hideEditTools && (
        <ObjectInspector
          isOpen={!!inspectedObjectId}
          onClose={() => setInspectedObject(null)}
        />
      )}

      {/* ⏪ Action Log */}
      <ActionLogPanel
        isOpen={actionLogOpen}
        onClose={() => setActionLogOpen(false)}
      />


      {/* 🧙 Merlin — AI World Builder — hidden in view mode */}
      {!hideEditTools && (
        <MerlinPanel
          isOpen={merlinOpen}
          onClose={() => setMerlinOpen(false)}
        />
      )}

      {/* 💻 Anorak — Claude Code Agent — admin only */}
      {isAdmin && (
        <AnorakPanel
          isOpen={claudeCodeOpen}
          onClose={() => setClaudeCodeOpen(false)}
        />
      )}

      {/* ⚡ DevCraft — Productivity Terminal */}
      {devcraftOpen ? (
        <div
          style={{
            position: 'fixed',
            top: 40, left: 40, bottom: 40, right: 40,
            zIndex: 9998,
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 0 40px rgba(0,255,65,0.15), 0 8px 32px rgba(0,0,0,0.5)',
            border: '1px solid rgba(0,255,65,0.2)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <DevcraftPanel onClose={() => setDevcraftOpen(false)} />
        </div>
      ) : (
        <DevcraftMiniBar onExpand={() => setDevcraftOpen(true)} />
      )}

      {/* 🔮 Feedback — disabled in local mode (legacy from b7_oasis SaaS) */}

      {/* ❓ Help Panel — Controls, Guide, Glossary */}
      <HelpPanel
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {/* ░▒▓ LOADING OVERLAY ▓▒░ */}
      <OasisLoader />

      {/* ░▒▓ ONBOARDING — first-login identity setup (requires auth) ▓▒░ */}
      <OnboardingModal />

      {/* ░▒▓ ANONYMOUS CTA — conversion hook ▓▒░ */}
    </DragContext.Provider>
    </SettingsContext.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANONYMOUS CTA — "Sign up to build your own world" conversion banner
// ═══════════════════════════════════════════════════════════════════════════════

function AnonymousCTA() {
  const [dismissed, setDismissed] = useState(false)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)

  if (dismissed) return null

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-bottom-4 duration-700">
      <div
        className="flex items-center gap-4 px-6 py-3.5 rounded-2xl shadow-2xl"
        style={{
          background: 'rgba(8, 8, 20, 0.9)',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          boxShadow: '0 0 40px rgba(0,0,0,0.5), 0 0 20px rgba(168, 85, 247, 0.15)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex flex-col">
          <span className="text-sm text-gray-200 font-medium">
            {viewingWorldMeta?.name ? `You're exploring "${viewingWorldMeta.name}"` : "You're exploring the Oasis"}
          </span>
          <span className="text-xs text-gray-500">
            Sign up free to build your own 3D world
          </span>
        </div>
        <a
          href="/login"
          className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 hover:shadow-lg flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
            boxShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
          }}
        >
          Start Building
        </a>
        <button
          onClick={() => setDismissed(true)}
          className="text-gray-600 hover:text-gray-400 transition-colors text-xs ml-1"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS GEAR — replaces the old hamburger MenuSystem
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsGear({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        if ((e.target as HTMLElement)?.tagName === 'CANVAS') return
        const target = e.target as HTMLElement
        if (target.closest('[data-menu-portal]')) return
        if (target.closest('[class*="fixed"]')) return
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
        style={{
          background: isOpen ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.6)',
          border: `1px solid ${isOpen ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.15)'}`,
          color: isOpen ? '#A855F7' : '#aaa',
          boxShadow: isOpen ? '0 0 12px rgba(168,85,247,0.3)' : 'none',
        }}
        title="Settings"
      >
        ⚙️
      </button>

      {isOpen && (
        <div
          className="absolute top-0 left-12 backdrop-blur-sm border border-gray-800 rounded-xl shadow-2xl animate-in slide-in-from-left-2 duration-200"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            boxShadow: '0 0 40px rgba(0,0,0,0.5), 0 0 20px rgba(168, 85, 247, 0.1)',
            maxHeight: '85vh',
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// OASIS LOADER — "channeling bytes" with REAL data units
// ═══════════════════════════════════════════════════════════════════════════════

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`
}

function OasisLoader() {
  const { progress, active, loaded, total } = useProgress()
  const [show, setShow] = useState(true)
  const hasCompletedFirstLoad = useRef(false)

  const [byteInfo, setByteInfo] = useState({ loaded: 0, total: 0, speed: 0 })

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origOpen = XMLHttpRequest.prototype.open as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origSend = XMLHttpRequest.prototype.send as any
    const activeXhr = new Map<XMLHttpRequest, { loaded: number; total: number }>()
    let prevLoaded = 0
    let prevTime = performance.now()
    let smoothSpeed = 0
    let rafId = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XMLHttpRequest.prototype.open = function(this: any, ...args: any[]) {
      const url = String(args[1] || '')
      if (/\.(glb|gltf|hdr|exr|bin|jpg|png|ktx2)(\?|$)/i.test(url)) {
        this._oasisTrack = true
      }
      return origOpen.apply(this, args)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XMLHttpRequest.prototype.send = function(this: any, ...args: any[]) {
      if (this._oasisTrack) {
        activeXhr.set(this, { loaded: 0, total: 0 })
        this.addEventListener('progress', (e: ProgressEvent) => {
          if (e.lengthComputable) {
            activeXhr.set(this, { loaded: e.loaded, total: e.total })
          }
        })
        const cleanup = () => activeXhr.delete(this)
        this.addEventListener('loadend', cleanup)
        this.addEventListener('error', cleanup)
        this.addEventListener('abort', cleanup)
      }
      return origSend.apply(this, args)
    }

    const tick = () => {
      let tLoaded = 0
      let tTotal = 0
      activeXhr.forEach(({ loaded: l, total: t }) => { tLoaded += l; tTotal += t })

      const now = performance.now()
      const dt = (now - prevTime) / 1000
      if (dt >= 0.2) {
        const instantSpeed = Math.max(0, (tLoaded - prevLoaded) / dt)
        smoothSpeed = smoothSpeed * 0.6 + instantSpeed * 0.4
        prevLoaded = tLoaded
        prevTime = now
      }

      setByteInfo({ loaded: tLoaded, total: tTotal, speed: smoothSpeed })
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      XMLHttpRequest.prototype.open = origOpen
      XMLHttpRequest.prototype.send = origSend
      cancelAnimationFrame(rafId)
    }
  }, [])

  useEffect(() => {
    if (!active && progress === 100) {
      const timer = setTimeout(() => {
        setShow(false)
        hasCompletedFirstLoad.current = true
      }, 800)
      return () => clearTimeout(timer)
    }
    if (active && !hasCompletedFirstLoad.current) setShow(true)
  }, [active, progress])

  if (!show) return null

  const hasByteData = byteInfo.total > 0

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 20px',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        borderRadius: '8px',
        border: '1px solid rgba(168, 85, 247, 0.25)',
        zIndex: 9998,
        transition: 'opacity 0.6s ease',
        opacity: active ? 1 : 0,
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: '#A855F7', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        channeling bytes
      </span>

      <div style={{
        width: '120px', height: '3px', background: 'rgba(168,85,247,0.2)',
        borderRadius: '2px', overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={{
          width: `${progress}%`, height: '100%',
          background: 'linear-gradient(90deg, #A855F7, #06B6D4)',
          transition: 'width 0.3s ease',
          borderRadius: '2px',
        }} />
      </div>

      <div style={{
        color: '#666', fontSize: '11px', fontFamily: 'monospace',
        display: 'flex', gap: '6px', alignItems: 'center', whiteSpace: 'nowrap',
      }}>
        {hasByteData ? (
          <>
            <span style={{ color: '#888' }}>
              {formatBytes(byteInfo.loaded)} / {formatBytes(byteInfo.total)}
            </span>
            {byteInfo.speed > 1024 && (
              <>
                <span style={{ color: '#444' }}>|</span>
                <span style={{ color: '#06B6D4' }}>{formatSpeed(byteInfo.speed)}</span>
              </>
            )}
          </>
        ) : (
          <span>{loaded}/{total} | {Math.round(progress)}%</span>
        )}
      </div>
    </div>
  )
}
