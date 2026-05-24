'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS - Main 3D Scene
// The canvas upon which worlds are built
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, Stars, Grid, Environment, Html, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import React, { Suspense, useState, useRef, useContext, useEffect, useTransition, useCallback } from 'react'
import * as THREE from 'three'

// ═══════════════════════════════════════════════════════════════════════════════
// ─═̷─═̷─🌐─═̷─═̷─{ BASEPATH ASSET RESOLVER }─═̷─═̷─🌐─═̷─═̷─
// Next.js basePath doesn't auto-prefix public/ file references.
// THREE.DefaultLoadingManager intercepts ALL asset fetches before they fire.
// ═══════════════════════════════════════════════════════════════════════════════
const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const OPENCLAW_PANEL_OPEN_KEY = 'oasis-openclaw-panel-open'
if (OASIS_BASE) {
  THREE.DefaultLoadingManager.setURLModifier((url: string) => {
    if (url.startsWith('/') && !url.startsWith(OASIS_BASE)) {
      return OASIS_BASE + url
    }
    return url
  })
}

// Hook DefaultLoadingManager → React-subscribable world load state. Exposes
// progress to the loading bar UI and the portal transition gating logic.
import { installWorldLoadProgress } from '../lib/world-load-progress'
installWorldLoadProgress()

import { useOasisStore } from '../store/oasisStore'

import type { OasisSettings } from './scene-lib'
import { defaultSettings, SKY_BACKGROUNDS } from './scene-lib'
import { SettingsContext, DragContext } from './scene-lib'
import { ForgeRealm } from './realms/ForgeRealm'
import PanoramaCapture from './forge/PanoramaCapture'
import { ViewportScreenshotBridge } from './forge/ViewportScreenshotBridge'
import { WizardConsole, type WizardMode } from './forge/WizardConsole'
// AssetExplorerWindow deleted — functionality lives in WizardConsole
import { ObjectInspector } from './forge/ObjectInspector'
import { ObjectHtmlOverlay } from './forge/ObjectHtmlOverlay'
import { MindcraftMissionWindowBridge } from './forge/MindcraftMissionWindowBridge'
import { ActionLogPanel } from './forge/ActionLog'
import { ProfileButton } from './forge/ProfileButton'
import { MerlinPanel } from './forge/MerlinPanel'
import { AnorakPanel } from './forge/AnorakPanel'
import { CodexPanel } from './forge/CodexPanel'
import { AnorakProPanel } from './forge/AnorakProPanel'
import { HermesPanel } from './forge/HermesPanel'
import { OpenclawPanel, OPENCLAW_CONNECTED_KEY } from './forge/OpenclawPanel'
import { ParzivalPanel } from './forge/ParzivalPanel'
import { RealtimePanel } from './forge/RealtimePanel'
import { GeminiLivePanel } from './forge/GeminiLivePanel'
import { LipSyncLabPanel } from './forge/LipSyncLabPanel'
import dynamic from 'next/dynamic'
const DevcraftPanel = dynamic(() => import('./forge/DevcraftPanel'), { ssr: false })
import { HelpPanel } from './forge/HelpPanel'
import { ConsolePanel } from './forge/ConsolePanel'
import { useWorldLoader } from './forge/WorldObjects'
import { completeQuest } from '@/lib/quests'
import { useInputManager, useUILayer, getMouseLookDebugState, isPointerLocked } from '@/lib/input-manager'
import { getPlayerAvatarPose, requestPlayerAvatarTeleport, type PlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { QUEST_ZERO_WORLD_ID, ROOKIE_WIZARD_WORLD_ID } from '@/lib/portal-gates'
import { preloadPortalRevealRoll } from '@/lib/portal-transition-settings'
import { sampleTerrainHeightAt } from '@/lib/forge/terrain-brush'
import { CameraController as CameraControllerComponent, sprintRef, FPS_KEYBOARD_MAP } from './CameraController'
import { useAudioManager } from '@/lib/audio-manager'
import { writeBrowserStorage } from '@/lib/browser-storage'
import { runLocalStorageAgentCacheMigration } from '@/lib/localstorage-agent-cache-migration'
import { isProbablyMobileDevice } from '@/lib/mobile-controls'
import { useIsHostedOasis, useOasisCapabilities } from '@/lib/oasis-mode-client'
import { installTestHarness } from '@/lib/test-harness'
import { HOSTED_USER_LOCKED_SPELL_IDS, isHostedUserLockedSpell, type SpellId } from '@/lib/spellbook'
import { useWorldEvents } from '@/hooks/useWorldEvents'
import { AgentWindowPortals } from './forge/AgentWindowPortals'
import { requestPortalGateReveal } from './forge/PortalGateLayer'
import { PortalZeroCanonicalButton } from './forge/PortalZeroCanonicalButton'
import { PortalTransitionOverlay } from './forge/PortalTransitionOverlay'
import { WorldLoadingBar } from './forge/WorldLoadingBar'
import { TerrainBrushPanel } from './forge/TerrainBrushPanel'
import { SkyPanel } from './forge/SkyPanel'
import { LightsPanel } from './forge/LightsPanel'
import { PaintBrushPanel } from './forge/PaintBrushPanel'
import { Text3DPanel } from './forge/Text3DPanel'
import { CraftSpellTab } from './forge/spelltabs/CraftSpellTab'
import { GeneratePicSpellTab } from './forge/spelltabs/GeneratePicSpellTab'
import { GenerateMusicSpellTab } from './forge/spelltabs/GenerateMusicSpellTab'
import { GenerateVideoSpellTab } from './forge/spelltabs/GenerateVideoSpellTab'
import { WorldMenu } from './forge/WorldMenu'
import { PlaceMenu } from './forge/PlaceMenu'
import { GameMenuButton } from './forge/GameMenuButton'
import { useRailMenuExclusion } from '@/hooks/useRailMenuExclusion'
import { MobileOasisControls, useIsMobileOasis } from './forge/MobileOasisControls'
import { CombatBoltLayer } from './forge/CombatBoltLayer'
import { PlayerVitalsHud } from './forge/PlayerVitalsHud'
import { PvPOverlay } from './forge/PvPOverlay'
import { PlayerSpellbookPanel } from './forge/PlayerSpellbookPanel'
import { GlobalNotice, showNotice } from './forge/GlobalNotice'
import { ForkWelcomeModal } from './forge/ForkWelcomeModal'
import { UploadPanel } from './forge/UploadPanel'
import { QuestProgressTracker } from './forge/QuestProgressTracker'
import { QuestZeroNpcExclamation } from './forge/QuestZeroNpcExclamation'
import { ConfigMenu } from './forge/config/ConfigMenu'

const SHOW_LEGACY_DEVCRAFT_PANEL = false
const SHOW_LEGACY_PARZIVAL_PANEL = false

// ═══════════════════════════════════════════════════════════════════════════════
// ─═̷─═̷─🎮─═̷─═̷─{ QUAKE FPS CONTROLS - WASD + Q/E }─═̷─═̷─🎮─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

// FPS_KEYBOARD_MAP, sprintRef — imported from CameraController

// ─═̷─═̷─🎯─═̷─═̷─{ POINTER LOCK RAYCASTER OVERRIDE }─═̷─═̷─🎯─═̷─═̷─
// When pointer is locked (noclip/TPS), R3F's internal raycaster uses the stale mouse
// position from before lock was acquired. This forces raycasting from screen center (0,0)
// so selection/highlighting aligns with the crosshair, not an arbitrary offset.

function PointerLockRaycaster() {
  const get = useThree(s => s.get)
  const set = useThree(s => s.set)
  useEffect(() => {
    const currentEvents = get().events
    set({
      events: {
        ...currentEvents,
        compute: (event, state) => {
          // When pointer is locked, force raycasting from screen center (crosshair)
          if (document.pointerLockElement) {
            state.pointer.set(0, 0)
          } else {
            // Default R3F behavior — compute NDC from event offset
            state.pointer.set(
              (event.offsetX / state.size.width) * 2 - 1,
              -(event.offsetY / state.size.height) * 2 + 1
            )
          }
          state.raycaster.setFromCamera(state.pointer, state.camera)
        },
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run once on mount — get/set are stable refs
  return null
}

// ─═̷─═̷─🌅─═̷─═̷─{ PLAYABLE SCENE SIGNAL }─═̷─═̷─🌅─═̷─═̷─
// Signals the splash only after world state has painted into the canvas.
function ScenePlayableSignal({ worldReady, worldId }: { worldReady: boolean; worldId: string }) {
  const dispatchedKeyRef = useRef<string | null>(null)
  const readyFrameCountRef = useRef(0)

  useEffect(() => {
    readyFrameCountRef.current = 0
  }, [worldId, worldReady])

  useFrame(() => {
    if (!worldReady) return
    if (dispatchedKeyRef.current === worldId) return
    readyFrameCountRef.current += 1
    if (readyFrameCountRef.current < 2) return
    dispatchedKeyRef.current = worldId
    window.dispatchEvent(new CustomEvent('oasis:world-playable', {
      detail: { worldId },
    }))
  })

  return null
}

// ─═̷─═̷─💨─═̷─═̷─{ SPRINT SPEED LINES }─═̷─═̷─💨─═̷─═̷─
// Instanced thin streaks that fly past the camera during sprint
function isMouseLookDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const flagWindow = window as typeof window & { __OASIS_MOUSE_DEBUG__?: boolean }
  return flagWindow.__OASIS_MOUSE_DEBUG__ === true || localStorage.getItem('oasis-mouse-debug') === '1'
}

function MouseLookDebugOverlay() {
  const [enabled, setEnabled] = useState(false)
  const [debug, setDebug] = useState(() => getMouseLookDebugState())

  useEffect(() => {
    const sync = () => {
      setEnabled(isMouseLookDebugEnabled())
      setDebug(getMouseLookDebugState())
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.code !== 'KeyM') return
      event.preventDefault()
      const next = !isMouseLookDebugEnabled()
      const flagWindow = window as typeof window & { __OASIS_MOUSE_DEBUG__?: boolean }
      flagWindow.__OASIS_MOUSE_DEBUG__ = next
      writeBrowserStorage('oasis-mouse-debug', next ? '1' : '0')
      sync()
    }

    sync()
    window.addEventListener('keydown', onKeyDown)
    const interval = window.setInterval(sync, 120)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearInterval(interval)
    }
  }, [])

  if (!enabled) return null

  return (
    <div
      className="fixed bottom-4 left-4 z-[120] pointer-events-none rounded-lg border border-cyan-400/25 bg-black/70 px-3 py-2 text-[11px] font-mono text-cyan-100"
      style={{ minWidth: 270, backdropFilter: 'blur(6px)' }}
    >
      <div className="flex items-center justify-between gap-3 text-cyan-200">
        <span>mouse-look debug</span>
        <span className="text-cyan-100/60">Ctrl+Alt+M</span>
      </div>
      <div className="mt-1 text-cyan-100/80">
        mode: {debug.activeEventType} | queued: {debug.queuedSampleCount} | queueAge: {debug.lastQueueAgeMs.toFixed(1)}ms
      </div>
      <div className="text-cyan-100/80">
        pending: {debug.queuedDelta.x.toFixed(1)}, {debug.queuedDelta.y.toFixed(1)} | consumed: {debug.lastConsumedDelta.x.toFixed(1)}, {debug.lastConsumedDelta.y.toFixed(1)}
      </div>
      <div className="text-cyan-100/80">
        consumedSamples: {debug.lastConsumedSampleCount} | consumedAge: {debug.lastConsumedAgeMs.toFixed(1)}ms
      </div>
      <div className="text-cyan-100/80">
        dropped: {debug.droppedSampleCount} | droppedMag: {debug.droppedMagnitude.toFixed(1)}
      </div>
    </div>
  )
}

const SPRINT_LINE_COUNT = 80

function SprintParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useRef(new THREE.Object3D())
  const _camDir = useRef(new THREE.Vector3())
  const _camRight = useRef(new THREE.Vector3())
  const _camUp = useRef(new THREE.Vector3())
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
    const camDir = _camDir.current
    cam.getWorldDirection(camDir)

    const camRight = _camRight.current
    camRight.set(0, 1, 0)
    camRight.crossVectors(camDir, camRight).normalize()
    const camUp = _camUp.current
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

const SETTINGS_MENU_OPACITY_KEY = 'oasis-settings-menu-opacity'
const MOBILE_POSTFX_DEFAULTS_KEY = 'oasis-mobile-postfx-defaults-v1'

function getDeviceDefaultSettings(): OasisSettings {
  // Hosted Oasis: visitors aren't building, they're hanging out. The helper
  // grid is a builder tool. Default it off in hosted so the lobby looks
  // like a place instead of a development scene. Local devs keep the grid.
  const hostedDefaults: Partial<OasisSettings> =
    typeof window !== 'undefined'
    && (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_OASIS_MODE === 'hosted'
      || /(?:^|\.)04515\.xyz$/.test(window.location.hostname || ''))
    ? { showGrid: false }
    : {}

  if (typeof window === 'undefined' || !isProbablyMobileDevice()) {
    return { ...defaultSettings, ...hostedDefaults }
  }
  return {
    ...defaultSettings,
    bloomEnabled: false,
    vignetteEnabled: false,
    ...hostedDefaults,
  }
}

function readSettingsMenuOpacity(): number {
  if (typeof window === 'undefined') return 0.92
  const raw = window.localStorage.getItem(SETTINGS_MENU_OPACITY_KEY)
  const parsed = raw ? Number(raw) : 0.92
  return Number.isFinite(parsed) ? Math.max(0.5, Math.min(1, parsed)) : 0.92
}

function writeSettingsMenuOpacity(value: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SETTINGS_MENU_OPACITY_KEY, String(value))
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// SettingsContent + SoundSettings — REMOVED. The Config menu is now a tabbed
// game-style panel in src/components/forge/config/ConfigMenu.tsx.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SKY BACKGROUND — procedural stars or HDRI panorama
// ═══════════════════════════════════════════════════════════════════════════════

function SkyBackgroundInner({ backgroundId }: { backgroundId: string }) {
  const skyConfig = SKY_BACKGROUNDS.find(s => s.id === backgroundId) || SKY_BACKGROUNDS[0]

  // drei built-in preset (CDN-hosted HDR) — sets both background AND environment (IBL)
  // NOTE: CDN presets (forest, city, dawn, sunset) can fail if CDN is unreachable.
  // ErrorBoundary in SkyBackground catches this — falls back to procedural stars.
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

// Error boundary for sky loading failures (CDN down, missing HDR, etc.)
class SkyErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) { console.warn('[Sky] Failed to load sky background, falling back to stars:', error.message) }
  render() { return this.state.hasError ? this.fallback : this.props.children }
  get fallback() { return this.props.fallback }
}

// Wrapper: keeps old sky visible until new one loads (no black flash)
// SkyErrorBoundary catches CDN/file failures → falls back to procedural stars
function SkyBackground({ backgroundId }: { backgroundId: string }) {
  const [activeId, setActiveId] = useState(backgroundId)
  const [, startTransition] = useTransition()
  useEffect(() => {
    startTransition(() => setActiveId(backgroundId))
  }, [backgroundId])
  return (
    <SkyErrorBoundary fallback={<Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={0.3} />}>
      <SkyBackgroundInner backgroundId={activeId} />
    </SkyErrorBoundary>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORBIT TARGET GIZMO — metallic armillary sphere pivot point
// ═══════════════════════════════════════════════════════════════════════════════

// OrbitTargetSphere + CameraLerp + AgentWindowFocus + FPSMovement — all in CameraController.tsx

// ═══════════════════════════════════════════════════════════════════════════════
// MODE SWITCH LABEL — shows mode name on Ctrl+Alt+C with fade-out
// ═══════════════════════════════════════════════════════════════════════════════

const MODE_NAMES: Record<string, string> = {
  orbit: 'ORBIT',
  noclip: 'NOCLIP',
  'third-person': 'THIRD PERSON',
}

function ModeSwitchLabel() {
  const inputState = useInputManager(s => s.inputState)
  const [visible, setVisible] = useState(false)
  const [label, setLabel] = useState('')
  const prevState = useRef(inputState)

  useEffect(() => {
    if (inputState !== prevState.current) {
      prevState.current = inputState
      const name = MODE_NAMES[inputState]
      if (name) {
        setLabel(name)
        setVisible(true)
        const t = setTimeout(() => setVisible(false), 1500)
        return () => clearTimeout(t)
      }
    }
  }, [inputState])

  if (!visible) return null

  return (
    <div className="fixed inset-0 pointer-events-none z-[98] flex items-center justify-center">
      <div
        className="text-3xl font-black tracking-[0.3em] font-mono select-none"
        style={{
          color: 'rgba(255,255,255,0.7)',
          textShadow: '0 0 40px rgba(56,189,248,0.5), 0 0 80px rgba(56,189,248,0.2)',
          animation: 'modeFadeOut 1.5s ease-out forwards',
        }}
      >
        {label}
      </div>
      <style>{`
        @keyframes modeFadeOut {
          0% { opacity: 1; transform: scale(1.1); }
          30% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.95) translateY(-10px); }
        }
      `}</style>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST-PROCESSING EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

function PostProcessing() {
  const { settings } = useContext(SettingsContext)
  const sprintActiveRef = useRef(false)
  const [sprintActive, setSprintActive] = useState(false)
  const chromaticRef = useRef<any>(null)
  const vignetteRef = useRef<any>(null)
  const _offsetVec = useRef(new THREE.Vector2())
  // ─═̷─ Mobile devices choke on EffectComposer's extra render passes during
  // sprint (vignette darkness + chromatic offset boosts). On the user's
  // phone in particular the FPS drops 60 → 12 the moment Dash fires.
  // Suppress the sprint-induced boost on mobile so the dash dynamic-vignette
  // never spins up the postprocessing chain. Static vignette/chromatic stay
  // user-controllable via settings (toggling them on accepts the cost). ─═̷─
  const mobileOasis = useIsMobileOasis()

  useFrame(() => {
    const si = Math.max(0, sprintRef.current.intensity)
    const isActive = !mobileOasis && si > 0.05
    if (isActive !== sprintActiveRef.current) {
      sprintActiveRef.current = isActive
      setSprintActive(isActive)
    }

    // Imperatively update effect uniforms — no re-renders needed
    if (chromaticRef.current) {
      const base = settings.chromaticEnabled ? 0.003 : 0
      const boost = mobileOasis ? 0 : si * 0.012
      const val = base + boost
      chromaticRef.current.offset = _offsetVec.current.set(val, val)
    }
    if (vignetteRef.current) {
      const baseDarkness = settings.vignetteEnabled ? 0.7 : 0
      const boost = mobileOasis ? 0 : si * 0.4
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
        intensity={settings.bloomEnabled ? (settings.bloomIntensity ?? 0.4) : 0}
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

const FPS_SAMPLE_WINDOW_MS = 1000
const FPS_SAMPLE_LIMIT = 240
const FPS_STALE_AFTER_MS = 3000

let latestFps: number | null = null
let latestFpsSampleAt = 0
let frameTimes: number[] = []

function FPSTracker() {
  useFrame(() => {
    const now = performance.now()

    frameTimes.push(now)

    while (frameTimes.length > FPS_SAMPLE_LIMIT) {
      frameTimes.shift()
    }

    while (frameTimes.length > 2 && now - frameTimes[0] > FPS_SAMPLE_WINDOW_MS) {
      frameTimes.shift()
    }

    const sampleCount = frameTimes.length
    if (sampleCount >= 2) {
      const firstFrameAt = frameTimes[0]
      const lastFrameAt = frameTimes[sampleCount - 1]
      const elapsed = lastFrameAt - firstFrameAt
      if (elapsed > 0) latestFps = Math.round(((sampleCount - 1) * 1000) / elapsed)
    }

    latestFpsSampleAt = now
  })

  return null
}

function readLatestFps(): number | null {
  if (latestFps === null || typeof performance === 'undefined') return null
  return performance.now() - latestFpsSampleAt <= FPS_STALE_AFTER_MS ? latestFps : null
}

function FPSDisplay({ enabled, fontSize }: { enabled: boolean; fontSize: number }) {
  const [fps, setFps] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(() => {
      setFps(readLatestFps())
    }, 200)

    return () => clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  const color = fps === null ? '#94a3b8' : fps >= 55 ? '#22c55e' : fps >= 30 ? '#facc15' : '#ef4444'

  return (
    <div
      data-testid="oasis-fps-display"
      className="fixed top-4 right-4 z-[100] font-mono font-bold pointer-events-none select-none"
      style={{
        fontSize: `${fontSize}px`,
        color,
        textShadow: `0 0 10px ${color}40, 0 2px 4px rgba(0,0,0,0.5)`,
      }}
    >
      {fps === null ? '--' : fps} FPS
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
      // Quest: Select an object. After the gesture-pair change (single-click
      // selects, double-click inspects), new users who only single-click
      // would never complete this if it gated on inspectedObjectId.
      // selectedObjectId is the canonical "I picked something" signal.
      if (state.selectedObjectId && !prev.selectedObjectId) {
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
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNext = () => {
      if (cancelled) return
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const delay = hidden ? 60000 : mission ? 30000 : 15000
      timeoutId = setTimeout(() => { void poll() }, delay)
    }

    const poll = async () => {
      try {
        const res = await fetch('/api/missions?status=wip&limit=1')
        if (!res.ok) return
        const data = await res.json()
        const wip = Array.isArray(data) ? data[0] : null
        setMission(wip)
      } catch {}
      finally {
        scheduleNext()
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [mission])

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
  }, [mission?.startedAt, mission?.isPaused, mission?.pausedAt, mission?.totalPausedMs, mission?.actualSeconds])

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

type AgentLauncherMode = '2d' | '3d'
type QuickAgentType = 'hermes' | 'openclaw' | 'gemini' | 'merlin' | 'anorak' | 'codex' | 'anorak-pro' | 'realtime'

function GeminiAgentIcon() {
  return (
    <svg viewBox="0 0 65 65" aria-hidden="true" className="h-5 w-5">
      <defs>
        <linearGradient id="oasis-quick-gemini-gradient" x1="8" y1="54" x2="58" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset="0.25" stopColor="#34a853" />
          <stop offset="0.52" stopColor="#fbbc04" />
          <stop offset="0.76" stopColor="#ea4335" />
          <stop offset="1" stopColor="#a142f4" />
        </linearGradient>
      </defs>
      <path
        fill="url(#oasis-quick-gemini-gradient)"
        d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 0 0 1.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 0 0 5.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 0 0-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 0 0-2 5.906 1.485 1.485 0 0 1-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 0 0-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 0 0-5.905-2A1.485 1.485 0 0 1 0 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 0 0 5.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 0 0 1.999-5.905A1.485 1.485 0 0 1 32.447 0z"
      />
    </svg>
  )
}

function CodexAgentIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="h-5 w-5">
      <rect x="4" y="5" width="24" height="22" rx="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M11 12l-4 4 4 4M21 12l4 4-4 4M18.5 10.5l-5 11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 26h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

const QUICK_AGENT_ITEMS: Array<{
  type: QuickAgentType
  label: string
  icon: React.ReactNode
  accent: string
  shadow: string
  localOnly?: boolean
}> = [
  { type: 'hermes', label: 'Hermes', icon: '🧿', accent: '#FACC15', shadow: 'rgba(250,204,21,0.45)' },
  { type: 'openclaw', label: 'OpenClaw', icon: '🦾', accent: '#22D3EE', shadow: 'rgba(34,211,238,0.42)' },
  { type: 'gemini', label: 'Gemini', icon: <GeminiAgentIcon />, accent: '#67E8F9', shadow: 'rgba(103,232,249,0.36)' },
  { type: 'merlin', label: 'Merlin', icon: '🧙', accent: '#A855F7', shadow: 'rgba(168,85,247,0.36)', localOnly: true },
  { type: 'anorak', label: 'CC', icon: '💻', accent: '#38BDF8', shadow: 'rgba(56,189,248,0.34)', localOnly: true },
  { type: 'codex', label: 'Codex', icon: <CodexAgentIcon />, accent: '#34D399', shadow: 'rgba(52,211,153,0.34)', localOnly: true },
  { type: 'anorak-pro', label: 'Anorak Pro', icon: '🔮', accent: '#14B8A6', shadow: 'rgba(20,184,166,0.34)', localOnly: true },
  { type: 'realtime', label: 'Realtime', icon: '📡', accent: '#C084FC', shadow: 'rgba(192,132,252,0.34)' },
]

function AgentQuickLauncher({
  isOpen,
  mode,
  onToggle,
  onClose,
  onMode,
  onOpen2d,
  onPlace3d,
  canUseLocalAgents,
  hideRailButton = false,
}: {
  isOpen: boolean
  mode: AgentLauncherMode
  onToggle: () => void
  onClose: () => void
  onMode: (mode: AgentLauncherMode) => void
  onOpen2d: (agentType: QuickAgentType) => void
  onPlace3d: (agentType: QuickAgentType) => void
  canUseLocalAgents: boolean
  /** Hide the standalone rail button. Spellbook covers agent summoning now. */
  hideRailButton?: boolean
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useUILayer('agents-menu', isOpen)
  const playHover = () => useAudioManager.getState().play('buttonHover')
  const playClick = () => useAudioManager.getState().play('buttonClick')
  const handleMode = (nextMode: AgentLauncherMode) => {
    playClick()
    onMode(nextMode)
  }
  useRailMenuExclusion('agents', isOpen, onClose)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      const target = event.target as HTMLElement | null
      if (target && target.closest('[data-rail-menu="agents"]')) return
      onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  if (hideRailButton && !isOpen) return null

  return (
    <div ref={menuRef} className="relative select-none">
      {!hideRailButton && (
        <GameMenuButton
          onClick={() => { playClick(); onToggle() }}
          label="Agents"
          marker="AI"
          accent="#F472B6"
          active={isOpen}
          aria-label="Agents menu"
        />
      )}

      {isOpen && (
        <div
          data-rail-menu="agents"
          className="fixed left-[10.25rem] top-4 z-[260] max-h-[calc(100vh-2rem)] w-[260px] overflow-y-auto rounded-lg border border-white/10 bg-black/[0.92] p-3 shadow-[0_0_54px_rgba(0,0,0,0.65),0_0_38px_rgba(244,114,182,0.18)] backdrop-blur-md max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:w-auto max-[700px]:max-h-[calc(100vh-70px)] max-[700px]:p-2"
        >
          <div className="grid grid-cols-2 gap-2">
            {(['2d', '3d'] as const).map(option => (
              <button
                key={option}
                onClick={() => handleMode(option)}
                onMouseEnter={playHover}
                className="rounded-md border px-3 py-2 text-center text-[11px] font-black uppercase tracking-[0.18em] transition hover:scale-[1.03]"
                style={{
                  borderColor: mode === option ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.14)',
                  background: mode === option ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)',
                  color: mode === option ? '#fff' : 'rgba(255,255,255,0.66)',
                  boxShadow: mode === option ? '0 0 22px rgba(255,255,255,0.14)' : 'none',
                }}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            {QUICK_AGENT_ITEMS
              .filter(agent => !agent.localOnly || canUseLocalAgents)
              .map(agent => (
              <button
                key={agent.type}
                onClick={() => {
                  playClick()
                  if (mode === '2d') onOpen2d(agent.type)
                  else onPlace3d(agent.type)
                }}
                onMouseEnter={playHover}
                className="group relative flex min-h-[48px] w-full items-center gap-3 overflow-hidden rounded-lg border px-3 text-left transition hover:-translate-y-0.5 hover:scale-[1.015]"
                style={{
                  borderColor: `${agent.accent}66`,
                  background: `linear-gradient(105deg, ${agent.accent}22, rgba(255,255,255,0.05), rgba(236,72,153,0.12))`,
                  boxShadow: `0 0 24px ${agent.shadow}`,
                }}
              >
                <span className="absolute inset-0 opacity-0 transition group-hover:opacity-100" style={{ background: `radial-gradient(circle at 18% 40%, ${agent.accent}88, transparent 36%)` }} />
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-black/30 text-lg" style={{ borderColor: `${agent.accent}55`, color: agent.accent }}>
                  {agent.icon}
                </span>
                <span className="relative block min-w-0 flex-1 truncate text-[13px] font-black uppercase tracking-[0.18em] text-white">
                  {agent.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const ROOKIE_MERLIN_POSITION: [number, number, number] = [0, 0, 10.2]
const ROOKIE_MERLIN_INTERACTION_RADIUS = 2.75
const ROOKIE_MERLIN_AVATAR_ID = 'agent-avatar-merlin'
const ROOKIE_MERLIN_WINDOW_ID = 'agent-npc-rookie-merlin'
const ROOKIE_PORTAL_ZERO_GATE_ID = 'rookie-to-portal-zero'
const ROOKIE_QUEST_ZERO_GATE_ID = 'rookie-to-quest-zero'
const ONBOARDING_PLAYER_SPAWN: PlayerAvatarPose = {
  position: [0, 0, -17.6],
  yaw: 0,
  forward: [0, 0, 1],
}
const ONBOARDING_PRELOAD_ASSETS = [
  '/avatars/gallery/VIPE_Hero__2902.vrm',
  '/avatars/gallery/EYE_Diviner.vrm',
  '/avatars/gallery/EvilPendra.vrm',
]

function isOnboardingWorld(worldId: string): boolean {
  return worldId === ROOKIE_WIZARD_WORLD_ID || worldId === QUEST_ZERO_WORLD_ID
}

function scheduleIdleWork(work: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(work, { timeout: 1200 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const timeout = window.setTimeout(work, 350)
  return () => window.clearTimeout(timeout)
}

function preloadOnboardingResources() {
  void preloadPortalRevealRoll()
  for (const assetUrl of ONBOARDING_PRELOAD_ASSETS) {
    const url = OASIS_BASE && assetUrl.startsWith('/') ? `${OASIS_BASE}${assetUrl}` : assetUrl
    fetch(url, { cache: 'force-cache' }).catch(() => {})
  }
}

function frameOnboardingSpawnCamera(
  camera: THREE.Camera,
  terrainHeights: number[],
  pose: PlayerAvatarPose,
): void {
  const [x, , z] = pose.position
  const groundY = sampleTerrainHeightAt(terrainHeights, x, z)
  const position = new THREE.Vector3(x, groundY, z)
  const forward = new THREE.Vector3(pose.forward[0], 0, pose.forward[2]).normalize()
  const distance = 4.2
  const elevation = Math.PI / 4
  const horizontalDistance = Math.cos(elevation) * distance
  const cameraHeight = Math.sin(elevation) * distance + 1.85
  const cameraPosition = position.clone()
    .addScaledVector(forward, -horizontalDistance)
    .add(new THREE.Vector3(0, cameraHeight, 0))
  const lookTarget = position.clone()
    .addScaledVector(forward, 2.1)
    .add(new THREE.Vector3(0, 1.75, 0))

  camera.position.copy(cameraPosition)
  camera.lookAt(lookTarget)
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.updateProjectionMatrix()
  }
}

function OnboardingSpawnPrimer({ controlMode }: { controlMode: OasisSettings['controlMode'] }) {
  const { camera } = useThree()
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldReady = useOasisStore(s => s._worldReady)
  const terrainHeights = useOasisStore(s => s.terrainHeights)
  const appliedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!worldReady || !isOnboardingWorld(activeWorldId)) return
    const key = `${activeWorldId}:${controlMode}:${worldReady ? 1 : 0}`
    if (appliedKeyRef.current === key) return
    appliedKeyRef.current = key

    const pose: PlayerAvatarPose = {
      position: [
        ONBOARDING_PLAYER_SPAWN.position[0],
        ONBOARDING_PLAYER_SPAWN.position[1],
        ONBOARDING_PLAYER_SPAWN.position[2],
      ],
      yaw: ONBOARDING_PLAYER_SPAWN.yaw,
      forward: [
        ONBOARDING_PLAYER_SPAWN.forward[0],
        ONBOARDING_PLAYER_SPAWN.forward[1],
        ONBOARDING_PLAYER_SPAWN.forward[2],
      ],
    }
    requestPlayerAvatarTeleport(pose)
    if (controlMode !== 'third-person') return

    frameOnboardingSpawnCamera(camera, terrainHeights, pose)
    window.requestAnimationFrame(() => frameOnboardingSpawnCamera(camera, useOasisStore.getState().terrainHeights, pose))
    window.setTimeout(() => frameOnboardingSpawnCamera(camera, useOasisStore.getState().terrainHeights, pose), 120)
  }, [activeWorldId, camera, controlMode, terrainHeights, worldReady])

  return null
}

function isWorldTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function readRookieMerlinPosition(activeWorldId: string): [number, number, number] | null {
  if (activeWorldId !== ROOKIE_WIZARD_WORLD_ID) return null
  const state = useOasisStore.getState()
  const merlin = state.placedAgentAvatars.find(avatar => avatar.id === ROOKIE_MERLIN_AVATAR_ID)
    || state.placedAgentAvatars.find(avatar => avatar.agentType === 'merlin')
  if (!merlin) return null
  const transform = state.transforms[merlin.id]
  return transform?.position || merlin.position || null
}

function readRookieMerlinDistance(activeWorldId: string): number | null {
  const merlinPosition = readRookieMerlinPosition(activeWorldId)
  if (!merlinPosition) return null
  const pose = getPlayerAvatarPose()
  if (!pose) return null
  const dx = pose.position[0] - merlinPosition[0]
  const dz = pose.position[2] - merlinPosition[2]
  return Math.hypot(dx, dz)
}

function useRookieMerlinPresence(activeWorldId: string): { nearby: boolean; position: [number, number, number] } {
  const [nearby, setNearby] = useState(false)
  const [position, setPosition] = useState<[number, number, number]>(ROOKIE_MERLIN_POSITION)
  useEffect(() => {
    let cancelled = false
    const update = () => {
      if (cancelled) return
      const distance = readRookieMerlinDistance(activeWorldId)
      const merlinPosition = readRookieMerlinPosition(activeWorldId)
      if (merlinPosition) setPosition(merlinPosition)
      setNearby(distance !== null && distance <= ROOKIE_MERLIN_INTERACTION_RADIUS)
    }
    update()
    const interval = window.setInterval(update, 180)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeWorldId])
  return { nearby, position }
}

function RookieMerlinWorldPrompt() {
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const { nearby, position } = useRookieMerlinPresence(activeWorldId)
  if (!nearby) return null
  return (
    <group position={[position[0], position[1] + 3.05, position[2]]}>
      <Html transform sprite center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div className="rounded-md border border-amber-200/35 bg-black/75 px-3 py-2 text-center shadow-[0_0_22px_rgba(251,191,36,0.18)] backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100">Merlin</div>
          <div className="mt-1 flex gap-1.5 text-[10px] font-mono text-white/90">
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5">F Talk</span>
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5">Q Quest</span>
            <span className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5">P Portal</span>
          </div>
        </div>
      </Html>
    </group>
  )
}

function RookieMerlinInteractionOverlay({
  activeWorldId,
  onTalk,
  onQuest,
  onPortalZero,
}: {
  activeWorldId: string
  onTalk: () => void
  onQuest: () => void
  onPortalZero: () => void
}) {
  const { nearby } = useRookieMerlinPresence(activeWorldId)

  useEffect(() => {
    if (!nearby) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (isWorldTypingTarget(event.target)) return
      if (useInputManager.getState().hasActiveUILayer()) return
      if (event.code === 'KeyF') {
        event.preventDefault()
        onTalk()
      } else if (event.code === 'KeyQ') {
        event.preventDefault()
        onQuest()
      } else if (event.code === 'KeyP') {
        event.preventDefault()
        onPortalZero()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nearby, onPortalZero, onQuest, onTalk])

  if (!nearby) return null
  return (
    <div className="fixed bottom-5 right-5 z-[210] flex max-w-[min(380px,calc(100vw-32px))] flex-col gap-2 rounded-lg border border-amber-200/20 bg-slate-950/90 p-3 text-white shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-xl max-[700px]:bottom-4 max-[700px]:right-3 max-[700px]:left-3">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-100/85">Merlin awaits</div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onTalk} className="rounded-md border border-sky-300/25 bg-sky-400/10 px-2 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-sky-100 transition hover:bg-sky-400/20">
          F Talk
        </button>
        <button type="button" onClick={onQuest} className="rounded-md border border-violet-300/25 bg-violet-400/10 px-2 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-violet-100 transition hover:bg-violet-400/20">
          Q Quest
        </button>
        <button type="button" onClick={onPortalZero} className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-100 transition hover:bg-emerald-400/20">
          P Portal
        </button>
      </div>
    </div>
  )
}

export default function Scene() {
  const hostedMode = useIsHostedOasis()
  const capabilities = useOasisCapabilities()
  const mobileOasis = useIsMobileOasis()
  const isAdmin = capabilities.admin
  const canUseAgentPanels = capabilities.canUseAgentPanels
  const canUseLocalPanels = capabilities.canUseLocalPanels
  const canUseHermesPanel = canUseLocalPanels || hostedMode
  const canUseFullWizard = capabilities.canUseFullWizard
  const [isDragging, setIsDragging] = useState(false)
  useWorldEvents()

  // ─═̷─═̷─⚔️─═̷─═̷─{ QUEST TRACKER — auto-detect onboarding actions }─═̷─═̷─⚔️─═̷─═̷─
  useQuestTracker()

  // ─═̷─═̷─💾─═̷─═̷─{ SETTINGS PERSISTENCE }─═̷─═̷─💾─═̷─═̷─
  const [settings, setSettings] = useState<OasisSettings>(() => {
    const deviceDefaults = getDeviceDefaultSettings()
    if (typeof window !== 'undefined') {
      // Clean up Parzival-era key — start fresh with Oasis defaults
      if (localStorage.getItem('uploader-settings')) localStorage.removeItem('uploader-settings')
      const saved = localStorage.getItem('oasis-settings')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const next = { ...deviceDefaults, ...parsed }
          if (isProbablyMobileDevice() && localStorage.getItem(MOBILE_POSTFX_DEFAULTS_KEY) !== '1') {
            next.bloomEnabled = false
            next.vignetteEnabled = false
            localStorage.setItem(MOBILE_POSTFX_DEFAULTS_KEY, '1')
          }
          return next
        } catch {
          return deviceDefaults
        }
      }
    }
    return deviceDefaults
  })
  const controlModeRef = useRef(settings.controlMode)

  useEffect(() => {
    void runLocalStorageAgentCacheMigration()
  }, [])

  useEffect(() => scheduleIdleWork(preloadOnboardingResources), [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      writeBrowserStorage('oasis-settings', JSON.stringify(settings))
    }
    controlModeRef.current = settings.controlMode
  }, [settings])

  const selectObject = useOasisStore(s => s.selectObject)
  const selectedObjectId = useOasisStore(s => s.selectedObjectId)
  const inspectedObjectId = useOasisStore(s => s.inspectedObjectId)
  const setInspectedObject = useOasisStore(s => s.setInspectedObject)
  const worldSkyBackground = useOasisStore(s => s.worldSkyBackground)
  const _focusedAgentWindowId = useOasisStore(s => s.focusedAgentWindowId)
  // InputManager is THE authority for what controls are active
  const inputState = useInputManager(s => s.inputState)
  const isAgentFocused = inputState === 'agent-focus'

  // ─═̷─═̷─🌍─═̷─═̷─{ WORLD LOADER — ensures conjured assets + world state loaded }─═̷─═̷─🌍─═̷─═̷─
  useWorldLoader()

  const isViewMode = useOasisStore(s => s.isViewMode)
  const isViewModeEditable = useOasisStore(s => s.isViewModeEditable)
  const viewingWorldId = useOasisStore(s => s.viewingWorldId)
  const viewingWorldMeta = useOasisStore(s => s.viewingWorldMeta)
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const worldReady = useOasisStore(s => s._worldReady)
  const worldRegistry = useOasisStore(s => s.worldRegistry)
  const activeWorldMeta = worldRegistry.find(world => world.id === activeWorldId)
  const activeWorldCanWrite = Boolean(isAdmin || activeWorldMeta?.canWrite || (isViewMode && isViewModeEditable))
  const activeWorldWriteKnown = Boolean(activeWorldMeta) || isViewMode
  const readOnlyForcesRp1 = Boolean(activeWorldWriteKnown && !activeWorldCanWrite)
  const effectiveRp1Mode = settings.rp1Mode || readOnlyForcesRp1
  const playableWorldId = isViewMode ? (viewingWorldId || activeWorldId) : activeWorldId
  const playableWorldReady = isViewMode
    ? Boolean(viewingWorldMeta?.id || (isViewModeEditable && worldReady))
    : worldReady
  // Hide mutation surfaces unless the active world explicitly says this session can write.
  // Settings stays separate: camera/UI preferences are always available.
  const hideEditTools = Boolean(
    !activeWorldWriteKnown ||
    (activeWorldWriteKnown && !activeWorldCanWrite) ||
    effectiveRp1Mode,
  )
  const canShowWizardConsole = Boolean(!hideEditTools && canUseFullWizard)

  // ─═̷─═̷─✨─═̷─═̷─{ WIZARD CONSOLE + ASSET EXPLORER STATE }─═̷─═̷─✨─═̷─═̷─
  const [wizardOpen, setWizardOpen] = useState(false)
  const [pendingWizardTab, setPendingWizardTab] = useState<WizardMode | undefined>(undefined)
  // Asset Explorer removed — merged into WizardConsole
  const [actionLogOpen, setActionLogOpen] = useState(false)
  const [merlinOpen, setMerlinOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [claudeCodeOpen, setClaudeCodeOpen] = useState(false)
  const [codexOpen, setCodexOpen] = useState(false)
  const [anorakProOpen, setAnorakProOpen] = useState(false)
  const [devcraftOpen, setDevcraftOpen] = useState(false)
  const [hermesOpen, setHermesOpen] = useState(false)
  const [openclawOpen, setOpenclawOpen] = useState(false)
  const [geminiOpen, setGeminiOpen] = useState(false)
  const [agentLauncherOpen, setAgentLauncherOpen] = useState(false)
  const [agentLauncherMode, setAgentLauncherMode] = useState<AgentLauncherMode>('3d')
  const [spellbookOpen, setSpellbookOpen] = useState(false)
  const [realtimeOpen, setRealtimeOpen] = useState(false)
  const [lipSyncLabOpen, setLipSyncLabOpen] = useState(false)
  const [parzivalOpen, setParzivalOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [settingsMenuOpacity, setSettingsMenuOpacity] = useState(() => readSettingsMenuOpacity())
  // Standalone scene-panel state. WorldMenu fires CustomEvents to open these
  // instead of the full WizCon — sky/lights visitors only need their specific
  // selector, not the whole forge surface.
  const [skyPanelOpen, setSkyPanelOpen] = useState(false)
  const [lightsPanelOpen, setLightsPanelOpen] = useState(false)
  const focusRookieMerlinWindow = useCallback(() => {
    const store = useOasisStore.getState()
    const existing = store.placedAgentWindows.find(window => window.id === ROOKIE_MERLIN_WINDOW_ID)
    if (!existing) {
      store.addAgentWindow({
        id: ROOKIE_MERLIN_WINDOW_ID,
        agentType: 'npc',
        npcId: 'rookie-wizard-merlin',
        linkedAvatarId: ROOKIE_MERLIN_AVATAR_ID,
        anchorMode: 'next-to',
        position: [1.8, 2.35, 10.15],
        rotation: [0, Math.PI, 0],
        scale: 0.16,
        width: 470,
        height: 680,
        label: 'Merlin',
        renderMode: 'live-html',
        frameStyle: 'hologram',
        frameThickness: 5,
        windowOpacity: 0.92,
        windowBlur: 8,
      })
    }
    store.focusAgentWindow(ROOKIE_MERLIN_WINDOW_ID)
  }, [])

  useEffect(() => {
    if (!hostedMode || !worldReady || !activeWorldCanWrite || typeof window === 'undefined') return
    let openclawConnected = false
    try {
      openclawConnected = window.localStorage.getItem(OPENCLAW_CONNECTED_KEY) === '1'
    } catch {
      openclawConnected = false
    }
    if (!openclawConnected) return

    const store = useOasisStore.getState()
    if (store.placedAgentWindows.some(window => window.agentType === 'openclaw')) return

    const pose = getPlayerAvatarPose()
    const base = pose?.position || [0, 0, 0]
    const forward = pose?.forward || [0, 0, -1]
    const length = Math.hypot(forward[0], forward[2]) || 1
    const fx = forward[0] / length
    const fz = forward[2] / length
    const x = base[0] + fx * 5
    const z = base[2] + fz * 5
    const yawTowardPlayer = Math.atan2(base[0] - x, base[2] - z)

    store.addAgentWindow({
      id: `agent-openclaw-${Date.now()}`,
      agentType: 'openclaw',
      position: [x, 2.4, z],
      rotation: [0, yawTowardPlayer, 0],
      scale: 0.16,
      width: 750,
      height: 850,
      label: 'OpenClaw',
      renderMode: 'live-html',
      frameStyle: 'void',
      frameThickness: 7,
      windowOpacity: 0.92,
      windowBlur: 8,
    })
  }, [activeWorldCanWrite, activeWorldId, hostedMode, worldReady])

  const recordRookieQuestStep = useCallback((stepId: string) => {
    void fetch('/api/player/progression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete_step', questId: 'quest-zero', stepId }),
    })
      .then(response => response.json().catch(() => null))
      .then(data => {
        if (data?.progression) {
          window.dispatchEvent(new CustomEvent('oasis:player-progression', { detail: data.progression }))
        }
        if (data?.result?.xp) {
          window.dispatchEvent(new CustomEvent('oasis:xp-awarded', { detail: data.result.xp }))
        }
      })
      .catch(() => {})
  }, [])

  const startRookieTalk = useCallback(() => {
    useAudioManager.getState().play('buttonClick')
    focusRookieMerlinWindow()
    recordRookieQuestStep('meet-merlin')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('oasis:realtime-start-talking'))
    }, 80)
  }, [focusRookieMerlinWindow, recordRookieQuestStep])
  const startRookieQuest = useCallback(() => {
    useAudioManager.getState().play('buttonClick')
    void fetch('/api/player/progression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_quest', questId: 'quest-zero' }),
    }).catch(() => {})
    recordRookieQuestStep('meet-merlin')
    requestPortalGateReveal(ROOKIE_QUEST_ZERO_GATE_ID)
  }, [recordRookieQuestStep])
  const openPortalZeroGate = useCallback(() => {
    useAudioManager.getState().play('buttonClick')
    requestPortalGateReveal(ROOKIE_PORTAL_ZERO_GATE_ID)
  }, [])

  // WorldMenu's Scene buttons (sky/ground/lights) fire this custom event to
  // ask Scene to open WizCon. Legacy listener — kept so any other dispatcher
  // (deeplinks, future agents) still reaches WizCon.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const open = () => setWizardOpen(true)
    window.addEventListener('oasis:open-wizard', open)
    return () => window.removeEventListener('oasis:open-wizard', open)
  }, [])

  // New event hooks for the standalone Sky / Lights panels.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const openSky = () => setSkyPanelOpen(true)
    const openLights = () => setLightsPanelOpen(true)
    window.addEventListener('oasis:open-sky-panel', openSky)
    window.addEventListener('oasis:open-lights-panel', openLights)
    return () => {
      window.removeEventListener('oasis:open-sky-panel', openSky)
      window.removeEventListener('oasis:open-lights-panel', openLights)
    }
  }, [])

  useEffect(() => {
    if (!hostedMode) return
    if (typeof window === 'undefined') return
    try {
      setOpenclawOpen(window.localStorage.getItem(OPENCLAW_PANEL_OPEN_KEY) === '1')
    } catch {
      setOpenclawOpen(false)
    }
  }, [hostedMode])

  // Panel toggle with sound
  const togglePanel = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(prev => {
      useAudioManager.getState().play(prev ? 'panelClose' : 'panelOpen')
      return !prev
    })
  }
  const handleSettingsMenuOpacity = (opacity: number) => {
    const next = Math.max(0.5, Math.min(1, opacity))
    setSettingsMenuOpacity(next)
    writeSettingsMenuOpacity(next)
  }
  const toggleOpenclawPanel = () => {
    setOpenclawOpen(prev => {
      const next = !prev
      useAudioManager.getState().play(prev ? 'panelClose' : 'panelOpen')
      if (hostedMode && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(OPENCLAW_PANEL_OPEN_KEY, next ? '1' : '0')
        } catch {
          // Ignore storage failures; the button still works for this tab.
        }
      }
      return next
    })
  }
  const closeOpenclawPanel = () => {
    setOpenclawOpen(false)
    if (hostedMode && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(OPENCLAW_PANEL_OPEN_KEY, '0')
      } catch {
        // Ignore storage failures.
      }
    }
  }
  const openQuickAgentPanel = (agentType: QuickAgentType) => {
    if (agentType === 'hermes') setHermesOpen(true)
    else if (agentType === 'gemini') setGeminiOpen(true)
    else if (agentType === 'openclaw') setOpenclawOpen(true)
    else if (agentType === 'merlin') setMerlinOpen(true)
    else if (agentType === 'anorak') setClaudeCodeOpen(true)
    else if (agentType === 'codex') setCodexOpen(true)
    else if (agentType === 'anorak-pro') setAnorakProOpen(true)
    else if (agentType === 'realtime') setRealtimeOpen(true)
    setAgentLauncherOpen(false)
  }
  const placeQuickAgentWindow = (agentType: QuickAgentType) => {
    useAudioManager.getState().play('place')
    const label = QUICK_AGENT_ITEMS.find(agent => agent.type === agentType)?.label || agentType
    useOasisStore.getState().enterPlacementMode({
      type: 'agent',
      name: label,
      agentType,
      agentRenderMode: 'live-html',
    })
    setAgentLauncherOpen(false)
  }

  const handleSpellbookCast = (spellId: SpellId) => {
    const store = useOasisStore.getState()
    useAudioManager.getState().play('buttonClick')
    store.setSelectedSpellId(spellId)
    setSpellbookOpen(false)

    const isCombat = spellId === 'firebolt' || spellId === 'lightning-bolt' || spellId === 'ice-bolt'
    const hostedUserLocked = !canUseFullWizard && isHostedUserLockedSpell(spellId)

    if (hostedUserLocked) {
      showNotice('That spell is local/admin only for now', 'warn')
      return
    }

    // ─═̷─ Read-only world gate. When the player can't write to the active
    // world, every non-combat spell mutates state the world won't accept —
    // and worse, the spell's panel is unmounted by hideEditTools so it
    // would just look broken. Block at the spellbook level + flash a
    // notice instead. Combat still flows (visual-only, no world mutations).
    // Also short-circuits the elevation-brush-mode-without-panel leak: the
    // store side-effects don't run at all here. ─═̷─
    if (readOnlyForcesRp1 && !isCombat) {
      showNotice("You don't have write access to this world", 'warn')
      return
    }

    // ─═̷─ RP1 exit gate. RP1 hides every edit/creation panel via hideEditTools
    // (Scene.tsx ~line 1641: hideEditTools = ... || effectiveRp1Mode). If the
    // player is in RP1 and clicks a creation spell, WizCon / TerrainBrushPanel /
    // SkyPanel etc would all be invisible → spell appears to "do nothing /
    // throws you back to third person." Toggle RP1 off here for every
    // non-combat spell. Combat spells (firebolt/lightning/ice) need RP1 ON
    // so the LMB cast pipeline fires — those are handled below.
    if (!isCombat && settings.rp1Mode && !readOnlyForcesRp1) {
      updateSetting('rp1Mode', false)
    }

    // ─═̷─ Defer cross-component window events one tick so React's pending
    // re-render (from updateSetting/setSpellbookOpen above) commits first
    // and the listening panel — PlaceMenu, UploadPanel, WizardConsole — has
    // actually mounted before the event fires. Without this, exiting RP1
    // unmasks a panel via hideEditTools toggling, but the dispatchEvent
    // races ahead of the panel's useEffect registering its listener and
    // the event is lost. That's the "click does nothing" complaint.
    const dispatchNextTick = (event: Event) => {
      setTimeout(() => window.dispatchEvent(event), 0)
    }

    switch (spellId) {
      // ─═̷─ Combat: arm the spell + ensure RP1 is on so LMB casts.
      // ALSO clear any pending placement state — without this, the mobile
      // primary-action button stays on "Place" because placementPending
      // never cleared from the prior spell selection, and the FIRE button
      // never fires. Combat is a click-to-cast pipeline, not placement. ─═̷─
      case 'firebolt':
      case 'lightning-bolt':
      case 'ice-bolt':
        if (!settings.rp1Mode && !readOnlyForcesRp1) updateSetting('rp1Mode', true)
        store.cancelPlacement()
        return

      // ─═̷─ Recipe / catalog ─═̷─
      case 'catalog-place':
        dispatchNextTick(new CustomEvent('oasis:open-place-menu'))
        return

      // ─═̷─ Creative + world-root dedicated panels ─═̷─
      case 'brush-wand':
        store.setPaintBrushPanelOpen(true)
        return
      case 'sky-background':
        setSkyPanelOpen(true)
        return
      case 'ground-texture':
        store.setTerrainBrushPanelOpen(true)
        store.setTerrainBrushMode('texture')
        return
      case 'ground-elevation':
        store.setTerrainBrushPanelOpen(true)
        store.setTerrainBrushMode('sculpt')
        return
      case 'lights':
        setLightsPanelOpen(true)
        return
      case 'text-3d':
        store.setText3dPanelOpen(true)
        return

      // ─═̷─ Premium standalone spelltabs (Agent B builds these) ─═̷─
      case 'text-to-3d':
      case 'text-to-pic':
      case 'text-to-pic-building':
      case 'text-to-music':
      case 'text-to-video':
        dispatchNextTick(new CustomEvent('oasis:open-spelltab', { detail: { spellId } }))
        return

      // ─═̷─ Premium routed to WizCon directly ─═̷─
      case 'meshy-object':
      case 'meshy-character':
        setPendingWizardTab('conjure')
        setWizardOpen(true)
        return
      case 'portal-create':
        setPendingWizardTab('world')
        setWizardOpen(true)
        return

      // ─═̷─ Own media uploads ─═̷─
      case 'own-audio-upload':
        dispatchNextTick(new CustomEvent('oasis:open-upload-panel', { detail: { kind: 'audio' } }))
        return
      case 'own-video-upload':
        dispatchNextTick(new CustomEvent('oasis:open-upload-panel', { detail: { kind: 'video' } }))
        return
      case 'own-image-upload':
        dispatchNextTick(new CustomEvent('oasis:open-upload-panel', { detail: { kind: 'image' } }))
        return

      // ─═̷─ Agents ─═̷─
      case 'summon-djinn':
        placeQuickAgentWindow('merlin')
        return
      case 'summon-openclaw':
        placeQuickAgentWindow('openclaw')
        return
      case 'summon-hermes':
        placeQuickAgentWindow('hermes')
        return
      case 'summon-custom-npc':
      case 'summon-fighter-npc':
        setAgentLauncherMode('3d')
        setAgentLauncherOpen(true)
        return

      default:
        return
    }
  }

  const updateSetting = <K extends keyof OasisSettings>(key: K, value: OasisSettings[K]) => {
    // Sync InputManager when control mode changes
    if (key === 'controlMode') {
      useInputManager.getState().syncFromControlMode(value as 'orbit' | 'noclip' | 'third-person')
    }
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  // ─═̷─═̷─🎮─═̷─═̷─{ CAMERA MODE HOTKEY: C cycles orbit→noclip→third-person }─═̷─═̷─🎮─═̷─═̷─
  // ─═̷─ When the paint wand is armed, orbit is forbidden — the cycle is
  // ─═̷─ noclip ↔ third-person only, because orbit's "rotate around a fixed
  // ─═̷─ target" mode makes painting at a fixed distance nonsensical.
  useEffect(() => {
    const MODES_DEFAULT: Array<'orbit' | 'noclip' | 'third-person'> = ['orbit', 'noclip', 'third-person']
    const MODES_PAINT: Array<'orbit' | 'noclip' | 'third-person'> = ['noclip', 'third-person']
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type
        return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
      }
      return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      const plainWorldKey = !e.ctrlKey
        && !e.metaKey
        && !e.altKey
        && !e.shiftKey
        && e.code === 'KeyC'
        && !isTypingTarget(e.target)
        && !useInputManager.getState().hasActiveUILayer()
      if (plainWorldKey) {
        e.preventDefault()
        const painting = useOasisStore.getState().paintHeldActive
        const modes = painting ? MODES_PAINT : MODES_DEFAULT
        // If current mode isn't in the allowed set (e.g. orbit while painting),
        // jump straight to the first allowed mode instead of incrementing.
        const idx = modes.indexOf(controlModeRef.current)
        const next = idx === -1 ? modes[0] : modes[(idx + 1) % modes.length]
        controlModeRef.current = next
        useInputManager.getState().syncFromControlMode(next)
        useAudioManager.getState().play('modeSwitch')
        setSettings(prev => ({ ...prev, controlMode: next }))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─═̷─═̷─🪄─═̷─═̷─{ PAINT WAND: orbit → noclip auto-flip when armed }─═̷─═̷─🪄─═̷─═̷─
  // Subscribe to the paint-armed flag. When it flips on while we're in orbit,
  // switch to noclip so the wand actually works. Leaving paint mode does NOT
  // automatically restore orbit — the user is free to stay in noclip / TP.
  useEffect(() => {
    const unsubscribe = useOasisStore.subscribe(
      (state, prev) => {
        if (state.paintHeldActive && !prev?.paintHeldActive && controlModeRef.current === 'orbit') {
          controlModeRef.current = 'noclip'
          const input = useInputManager.getState()
          input.syncFromControlMode('noclip')
          input.requestPointerLock()
          setSettings(prev => ({ ...prev, controlMode: 'noclip' }))
        }
      },
    )
    return () => unsubscribe()
  }, [])

  const deleteSelectedObject = useCallback(() => {
    if (hideEditTools) return false

    const store = useOasisStore.getState()
    const id = store.selectedObjectId
    if (!id) return false

    const isPortal = store.portalGates.some(gate => gate.id === id)
    const isCatalog = store.placedCatalogAssets.some(asset => asset.id === id)
    const isCrafted = store.craftedScenes.some(scene => scene.id === id)
    const isConjured = store.worldConjuredAssetIds.includes(id)
    const isLight = store.worldLights.some(light => light.id === id)
    const isAgentWindow = store.placedAgentWindows.some(win => win.id === id)
    const isAgentAvatar = store.placedAgentAvatars.some(av => av.id === id)
    const isSpatialWeb = store.spatialWebObjects.some(object => object.id === id)
    const isPaintStroke = store.paintStrokes.some(stroke => stroke.id === id)
    const isText3D = store.text3dObjects.some(text => text.id === id)
    if (!isPortal && !isCatalog && !isCrafted && !isConjured && !isLight && !isAgentWindow && !isAgentAvatar && !isSpatialWeb && !isPaintStroke && !isText3D) return false

    if (isPortal) store.removePortalGate(id)
    else if (isCatalog) store.removeCatalogAsset(id)
    else if (isCrafted) store.removeCraftedScene(id)
    else if (isConjured) store.removeConjuredAssetFromWorld(id)
    else if (isLight) store.removeWorldLight(id)
    else if (isAgentWindow) store.removeAgentWindow(id)
    else if (isAgentAvatar) store.removeAgentAvatar(id)
    else if (isSpatialWeb) store.removeSpatialWebObject(id)
    else if (isPaintStroke) store.removePaintStroke(id)
    else if (isText3D) store.removeText3dObject(id)

    store.selectObject(null)
    store.setInspectedObject(null)
    useAudioManager.getState().play('delete')
    return true
  }, [hideEditTools])

  // ─═̷─═̷─🎯─═̷─═̷─{ POINTER LOCK — owned by InputManager }─═̷─═̷─🎯─═̷─═̷─
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type
        return !['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'].includes(type)
      }
      return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (event.code !== 'Delete' && event.code !== 'Backspace') return
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (isTypingTarget(event.target)) return
      if (!deleteSelectedObject()) return

      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', handleDeleteKey)
    return () => window.removeEventListener('keydown', handleDeleteKey)
  }, [deleteSelectedObject])

  const pointerLocked = useInputManager(s => s.pointerLocked)

  useEffect(() => {
    return useInputManager.getState().initGlobalListeners()
  }, [])

  // ─═̷─═̷─🔄─═̷─═̷─{ INITIAL SYNC — InputManager must match loaded settings on mount }─═̷─═̷─🔄─═̷─═̷─
  useEffect(() => {
    // Direct set (not syncFromControlMode) — don't auto-request pointer lock on page load
    const im = useInputManager.getState()
    const current = im.inputState
    if (current !== settings.controlMode) {
      useInputManager.setState({ inputState: settings.controlMode })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only on mount — settings.controlMode is the initial value from localStorage

  useEffect(() => {
    const im = useInputManager.getState()
    const current = im.inputState
    const isBaseCamera = current === 'orbit' || current === 'noclip' || current === 'third-person'
    if (isBaseCamera && current !== settings.controlMode) {
      useInputManager.setState({ inputState: settings.controlMode })
    }
  }, [inputState, settings.controlMode])

  // ─═̷─═̷─🧪─═̷─═̷─{ TEST HARNESS — Parzival's Hands }─═̷─═̷─🧪─═̷─═̷─
  useEffect(() => { installTestHarness() }, [])

  // ─═̷─═̷─🎮─═̷─═̷─{ CANVAS }─═̷─═̷─🎮─═̷─═̷─
  const CanvasContent = (
    <Canvas
      id="uploader-canvas"
      camera={{ position: [12, 10, 12], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true, stencil: true }}
      onCreated={({ gl }) => {
        // Initial startup is signaled by ScenePlayableSignal after
        // the world state is ready and the canvas has rendered that state.
        gl.domElement.addEventListener?.('webglcontextrestored', () => {
          window.dispatchEvent(new CustomEvent('oasis:world-playable', {
            detail: { worldId: useOasisStore.getState().activeWorldId },
          }))
        }, { once: true })
      }}
      onPointerMissed={() => {
        if (isPointerLocked()) return  // Noclip/TPS mode — click locks pointer, not deselects
        selectObject(null)
      }}
    >
        <color attach="background" args={['#07111a']} />

        <SkyBackground backgroundId={worldSkyBackground} />

        {/* ─═̷─═̷─🎮 CAMERA CONTROLLER — ONE owner, ONE useFrame, ZERO fights ─═̷─═̷─🎮 */}
        <CameraControllerComponent />
        <PointerLockRaycaster />
        <ScenePlayableSignal worldReady={playableWorldReady} worldId={playableWorldId} />
        <OnboardingSpawnPrimer controlMode={settings.controlMode} />
        {settings.controlMode === 'noclip' && <SprintParticles />}

        {settings.showGrid && !effectiveRp1Mode && (
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
        )}

        {/* ─═̷─═̷─🌍─═̷─═̷─ THE FORGE ─═̷─═̷─🌍─═̷─═̷─ */}
        <Suspense fallback={null}>
          <ForgeRealm />
          <RookieMerlinWorldPrompt />
        </Suspense>
        {/* ─═̷─═̷─⚔ Combat-bolt dispatcher — replaces the legacy FireboltLayer
            and routes to the 10 designs in src/components/forge/bolts/ based
            on settings.{spell}Design. Mounted only when RP1/exploration mode
            is active. ─═̷─═̷─⚔ */}
        <CombatBoltLayer enabled={effectiveRp1Mode} settings={settings} />
        <QuestZeroNpcExclamation activeWorldId={activeWorldId} />

        {/* ─═̷─═̷─📸─═̷─═̷─ PANORAMA CAPTURE (Ctrl+Shift+P) ─═̷─═̷─📸─═̷─═̷─ */}
        <PanoramaCapture />
        <ViewportScreenshotBridge />
        {!hostedMode && <PortalZeroCanonicalButton />}

        <PostProcessing />
        <FPSTracker />
    </Canvas>
  )

  return (
    <SettingsContext.Provider value={{ settings, effectiveRp1Mode, rp1Locked: readOnlyForcesRp1, updateSetting }}>
    <DragContext.Provider value={{ isDragging, setIsDragging }}>
      <KeyboardControls map={FPS_KEYBOARD_MAP}>
        {CanvasContent}
      </KeyboardControls>
      <MobileOasisControls
        enabled={mobileOasis && (settings.controlMode === 'noclip' || settings.controlMode === 'third-person')}
        spellControlsEnabled={effectiveRp1Mode}
        canDeleteSelected={Boolean(selectedObjectId && !hideEditTools)}
        onDeleteSelected={deleteSelectedObject}
      />
      <PlayerVitalsHud visible={effectiveRp1Mode} />
      <PvPOverlay visible={effectiveRp1Mode} />
      <PlayerSpellbookPanel
        visible
        isOpen={spellbookOpen}
        onOpenChange={setSpellbookOpen}
        onCastSpell={handleSpellbookCast}
        readOnly={readOnlyForcesRp1}
        lockedSpellIds={!canUseFullWizard ? HOSTED_USER_LOCKED_SPELL_IDS : []}
      />
      {!hideEditTools && <PlaceMenu />}
      <GlobalNotice />
      <ForkWelcomeModal />
      <QuestProgressTracker activeWorldId={activeWorldId} />

      {/* ─═̷─═̷─⚡ FPS DISPLAY ─═̷─═̷─⚡ */}
      <FPSDisplay enabled={settings.fpsCounterEnabled} fontSize={settings.fpsCounterFontSize} />

      {/* ─═̷─═̷─🎯 CROSSHAIR — Noclip + TPS when pointer locked (desktop) OR
          always on mobile in those modes, since mobile can't pointer-lock but
          still needs a center target indicator for SELECT / placement / cast. ─═̷─═̷─🎯 */}
      {(settings.controlMode === 'noclip' || settings.controlMode === 'third-person') && (pointerLocked || mobileOasis) && (
        <div className="fixed inset-0 pointer-events-none z-[99] flex items-center justify-center">
          <div className="relative w-5 h-5">
            <div className="absolute top-1/2 left-0 w-full h-px bg-white/40" />
            <div className="absolute left-1/2 top-0 h-full w-px bg-white/40" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white/60" />
          </div>
        </div>
      )}

      {/* ─═̷─═̷─🎮 MODE SWITCH LABEL ─═̷─═̷─🎮 */}
      <MouseLookDebugOverlay />
      <ModeSwitchLabel />
      <PortalTransitionOverlay />
      <WorldLoadingBar />
      <RookieMerlinInteractionOverlay
        activeWorldId={activeWorldId}
        onTalk={startRookieTalk}
        onQuest={startRookieQuest}
        onPortalZero={openPortalZeroGate}
      />

      {/* Main game rail */}
      <div className="fixed left-4 top-4 z-[190] flex flex-col gap-2 select-none max-[700px]:left-2 max-[700px]:top-2 max-[700px]:gap-1.5">
        <ProfileButton />

        {canShowWizardConsole && (
          <GameMenuButton
            label="Wizard"
            accent="#F97316"
            active={wizardOpen}
            aria-label={hostedMode ? 'World Console' : 'Wizard Console'}
            data-oasis-tooltip={hostedMode ? 'World Console' : 'Wizard Console'}
            className="oasis-tooltip"
            onClick={() => {
              useAudioManager.getState().play('buttonClick')
              setWizardOpen(prev => {
                if (!prev) completeQuest('open-wizard')
                return !prev
              })
            }}
          />
        )}

        <WorldMenu
          actionLogControl={canUseLocalPanels && !hideEditTools ? (
            <button
              type="button"
              onClick={() => togglePanel(setActionLogOpen)}
              className="group flex w-full items-center gap-3 rounded-md border border-amber-300/20 bg-black/30 px-3 py-2 text-left transition hover:border-amber-200/50 hover:bg-amber-300/10"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-300/25 bg-amber-300/10 text-[10px] font-black uppercase text-amber-100">
                LOG
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">Action Log</span>
                <span className="mt-0.5 block text-[9px] uppercase tracking-[0.1em] text-white/40">
                  {actionLogOpen ? 'open' : 'closed'}
                </span>
              </span>
            </button>
          ) : undefined}
        />

        <GameMenuButton
          label="Spells"
          marker="B"
          accent="#FBBF24"
          active={spellbookOpen}
          aria-label="Spells menu"
          data-oasis-tooltip="Spells"
          className="oasis-tooltip"
          onClick={() => {
            useAudioManager.getState().play(spellbookOpen ? 'panelClose' : 'panelOpen')
            setSpellbookOpen(open => !open)
          }}
        />

        {/* ─═̷─ AgentQuickLauncher rail button retired 2026-05-20.
            All agent summoning lives in the Spellbook now (B key,
            "Agents" page). Component kept mounted (open=false) so it
            can still be opened via legacy event listeners / deep links;
            its onToggle is wired to the spellbook handler instead. ─═̷─ */}
        <AgentQuickLauncher
          isOpen={agentLauncherOpen}
          mode={agentLauncherMode}
          onToggle={() => setAgentLauncherOpen(open => !open)}
          onClose={() => setAgentLauncherOpen(false)}
          onMode={mode => setAgentLauncherMode(mode)}
          onOpen2d={openQuickAgentPanel}
          onPlace3d={placeQuickAgentWindow}
          canUseLocalAgents={!hostedMode && canUseAgentPanels && !hideEditTools}
          hideRailButton
        />

        <SettingsMenu opacity={settingsMenuOpacity}>
          <ConfigMenu
            menuOpacity={settingsMenuOpacity}
            onMenuOpacityChange={handleSettingsMenuOpacity}
            consoleControl={(isAdmin || canUseLocalPanels) ? (
              <button
                type="button"
                onClick={() => togglePanel(setConsoleOpen)}
                className="group flex w-full items-center gap-3 rounded-md border border-amber-300/20 bg-black/30 px-3 py-2 text-left transition hover:border-amber-200/50 hover:bg-amber-300/10"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-300/25 bg-amber-300/10 text-[10px] font-black uppercase text-amber-100">
                  LOG
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-amber-100">Console</span>
                  <span className="mt-0.5 block text-[9px] uppercase tracking-[0.1em] text-white/40">
                    {consoleOpen ? 'open' : 'closed'}
                  </span>
                </span>
              </button>
            ) : undefined}
          />
        </SettingsMenu>

        <HelpMenu
          isOpen={helpOpen}
          onToggle={() => togglePanel(setHelpOpen)}
        />
      </div>

      {/* ✨ Wizard Console — hidden in view mode */}
      {canShowWizardConsole && (
        <WizardConsole
          isOpen={wizardOpen}
          initialTab={pendingWizardTab}
          onClose={() => { setWizardOpen(false); setPendingWizardTab(undefined) }}
          variant={canUseFullWizard ? 'local' : 'hosted'}
        />
      )}

      {/* 🔍 Object Inspector — hidden in view mode + during agent-focus (zoomon fills viewport) */}
      {!hideEditTools && (
        <ObjectInspector
          isOpen={!!inspectedObjectId && !isAgentFocused}
          onClose={() => setInspectedObject(null)}
        />
      )}

      {!hideEditTools && <TerrainBrushPanel />}
      {!hideEditTools && <SkyPanel isOpen={skyPanelOpen} onClose={() => setSkyPanelOpen(false)} />}
      {!hideEditTools && <LightsPanel isOpen={lightsPanelOpen} onClose={() => setLightsPanelOpen(false)} />}
      {!hideEditTools && <PaintBrushPanel />}
      {!hideEditTools && <Text3DPanel />}

      {/* ─═̷─═̷─✨ PREMIUM SPELLTABS — Standalone popups for cast spells ─═̷─═̷─✨
          Each spelltab listens for `oasis:open-spelltab` { spellId } and only opens
          for its own spell. Mounted ungated so the spellbook can cast from any
          mode. Mobile renders them as a top-right strip so the world center
          (where the user targets) stays unobstructed. ─═̷─═̷─ */}
      <CraftSpellTab />
      <GeneratePicSpellTab buildingMode={false} />
      <GeneratePicSpellTab buildingMode={true} />
      <GenerateMusicSpellTab />
      <GenerateVideoSpellTab />

      {/* 📋 Mindcraft 3D — Mission Window (outside Canvas, bridged via Zustand) */}
      {canUseLocalPanels && <MindcraftMissionWindowBridge />}

      {/* ⏪ Action Log */}
      {canUseLocalPanels && (
        <ActionLogPanel
          isOpen={actionLogOpen}
          onClose={() => setActionLogOpen(false)}
        />
      )}


      {/* 🧙 Merlin — AI World Builder — hidden in view mode */}
      {canUseAgentPanels && !hideEditTools && (
        <MerlinPanel
          isOpen={merlinOpen}
          onClose={() => setMerlinOpen(false)}
        />
      )}

      {/* 💻 Anorak — Claude Code Agent — admin only */}
      {canUseAgentPanels && (
        <AnorakPanel
          isOpen={claudeCodeOpen}
          onClose={() => setClaudeCodeOpen(false)}
        />
      )}
      {/* 🔮 Anorak Pro — Autonomous dev pipeline — admin only */}
      {canUseAgentPanels && (
        <CodexPanel
          isOpen={codexOpen}
          onClose={() => setCodexOpen(false)}
        />
      )}
      {canUseAgentPanels && (
        <AnorakProPanel
          isOpen={anorakProOpen}
          onClose={() => setAnorakProOpen(false)}
        />
      )}

      {/* 🧿 Parzival — Autonomous Brain */}
      {canUseHermesPanel && (
        <HermesPanel
          isOpen={hermesOpen}
          onClose={() => setHermesOpen(false)}
        />
      )}
      <OpenclawPanel
        isOpen={openclawOpen}
        onClose={closeOpenclawPanel}
      />
      <GeminiLivePanel
        isOpen={geminiOpen}
        onClose={() => setGeminiOpen(false)}
      />
      <RealtimePanel
        isOpen={realtimeOpen}
        onClose={() => setRealtimeOpen(false)}
      />
      {canUseLocalPanels && (
        <LipSyncLabPanel
          isOpen={lipSyncLabOpen}
          onClose={() => setLipSyncLabOpen(false)}
        />
      )}
      {SHOW_LEGACY_PARZIVAL_PANEL && canUseLocalPanels && (
        <ParzivalPanel
          isOpen={parzivalOpen}
          onClose={() => setParzivalOpen(false)}
        />
      )}

      {/* ⚡ DevCraft — Productivity Terminal */}
      {SHOW_LEGACY_DEVCRAFT_PANEL && canUseLocalPanels && (devcraftOpen ? (
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
      ))}

      {/* 🔮 Feedback — disabled in local mode (legacy from b7_oasis SaaS) */}

      {/* 📡 Console — Live Server Logs — admin only */}
      {(isAdmin || canUseLocalPanels) && (
        <ConsolePanel
          isOpen={consoleOpen}
          onClose={() => setConsoleOpen(false)}
        />
      )}

      {/* ❓ Help Panel — Controls, Guide, Glossary */}
      <HelpPanel
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      <ObjectHtmlOverlay />

      {/* EXIT RP1 — floating escape hatch when Ready Player 1 mode is active */}
      {effectiveRp1Mode && !readOnlyForcesRp1 && (
        <button
          onClick={() => updateSetting('rp1Mode', false)}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            padding: '6px 16px',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(20,184,166,0.4)',
            color: '#14b8a6',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.05em',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(20,184,166,0.2)'; e.currentTarget.style.borderColor = 'rgba(20,184,166,0.8)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.7)'; e.currentTarget.style.borderColor = 'rgba(20,184,166,0.4)' }}
        >
          EXIT RP1
        </button>
      )}

      {/* ░▒▓ LOADING OVERLAY — removed. WorldLoadingBar (subscribe via
          THREE.DefaultLoadingManager, mounted further up the tree) covers
          the same data with less visual noise and no double-counting.
          OasisLoader's useProgress() hook was reading the SAME aggregate
          and rendering a parallel "channeling bytes" pill, which is why
          both appeared simultaneously after a state-sync. ▓▒░ */}

      {/* ░▒▓ AGENT WINDOW PORTALS — offscreen DOM for 3D window textures ▓▒░ */}
      <AgentWindowPortals />

      {/* ░▒▓ IMAGE DROP ZONE — drag & drop images into the world ▓▒░ */}
      {canUseLocalPanels && !hideEditTools && <ImageDropZone />}

      {/* 📤 Upload Panel — focused mp3/mp4/image upload triggered from spellbook */}
      <UploadPanel />

      {/* OnboardingModal nuked — profile setup lives in ProfileButton */}

      {/* ░▒▓ ANONYMOUS CTA — conversion hook ▓▒░ */}
    </DragContext.Provider>
    </SettingsContext.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE DROP ZONE — drag & drop images into the Oasis world
// ░▒▓ Covers full viewport, uploads via /api/media/upload, places at camera target ▓▒░
// ═══════════════════════════════════════════════════════════════════════════════

function ImageDropZone() {
  const [dropping, setDropping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCountRef = useRef(0)

  useEffect(() => {
    // Screen-wide dragdrop is suppressed when UploadPanel is open — the panel's
    // own drop zone is the obvious visible target, so a stray drop here would
    // be a footgun.
    const isUploadPanelOpen = () => useInputManager.getState()._uiLayerStack.includes('upload-panel')

    // Document-level drag listeners — NO intercepting divs that block clicks
    const handleDragEnter = (e: DragEvent) => {
      if (isUploadPanelOpen()) return
      e.preventDefault()
      dragCountRef.current++
      if (e.dataTransfer?.types.includes('Files')) setDropping(true)
    }
    const handleDragLeave = (e: DragEvent) => {
      if (isUploadPanelOpen()) return
      e.preventDefault()
      dragCountRef.current--
      if (dragCountRef.current <= 0) { setDropping(false); dragCountRef.current = 0 }
    }
    const handleDragOver = (e: DragEvent) => {
      if (isUploadPanelOpen()) return
      e.preventDefault()
    }
    const handleDrop = async (e: DragEvent) => {
      if (isUploadPanelOpen()) return
      e.preventDefault()
      setDropping(false)
      dragCountRef.current = 0

      const mediaFiles = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
      if (mediaFiles.length === 0) return

      setUploading(true)
      const store = useOasisStore.getState()

      // Count existing media for offset calculation
      const existingMedia = store.placedCatalogAssets.filter(a => a.imageUrl || a.videoUrl).length

      for (let i = 0; i < mediaFiles.length; i++) {
        try {
          const formData = new FormData()
          formData.append('file', mediaFiles[i])
          const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
          if (!res.ok) { console.error('[Drop] Upload failed:', await res.text()); continue }
          const { url, name, mediaType } = await res.json()

          // Place media in a row, spaced 3 units apart on X axis
          const xOffset = (existingMedia + i) * 3
          if (mediaType === 'video') {
            store.placeVideoAt(name || mediaFiles[i].name, url, [xOffset, 0, 0])
          } else {
            store.placeImageAt(name || mediaFiles[i].name, url, [xOffset, 0, 0])
          }
        } catch (err) {
          console.error('[Drop] Error uploading:', err)
        }
      }
      setUploading(false)
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  return (
    <>
      {/* Visual overlay when dragging — pointer-events:none so it doesn't intercept */}
      {dropping && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm border-4 border-dashed border-sky-400/60 pointer-events-none">
          <div className="text-center">
            <div className="text-6xl mb-4">🖼️</div>
            <div className="text-sky-400 text-2xl font-bold tracking-wide">Drop media into the Oasis</div>
            <div className="text-white/50 text-sm mt-2">Images (PNG, JPG, WebP, GIF) + Videos (MP4, WebM) — up to 100MB</div>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[10001] bg-black/80 border border-sky-400/40 rounded-lg px-6 py-3 text-sky-400 text-sm pointer-events-none">
          Uploading media...
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANONYMOUS CTA — "Sign up to build your own world" conversion banner
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS MENU — game-HUD shell for the old settings content
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsMenu({ children, opacity }: { children: React.ReactNode; opacity: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useUILayer('settings-menu', isOpen)
  const playClick = () => useAudioManager.getState().play('buttonClick')
  const close = useCallback(() => setIsOpen(false), [])
  useRailMenuExclusion('settings', isOpen, close)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      // Also include the fixed-position menu body in the "inside" check —
      // it's a sibling of menuRef on desktop now (fixed-positioned), so a
      // straight `menuRef.contains` would miss clicks inside the menu.
      const target = event.target as HTMLElement | null
      if (target && target.closest('[data-rail-menu="settings"]')) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={menuRef} className="relative select-none">
      <GameMenuButton
        label="CONFIG"
        marker="SYS"
        accent="#A78BFA"
        active={isOpen}
        aria-label="Config menu"
        data-oasis-tooltip="Config"
        onClick={() => {
          playClick()
          setIsOpen(open => !open)
        }}
      />

      {isOpen && (
        <div
          data-ui-panel
          data-rail-menu="settings"
          className="fixed left-[10.25rem] top-4 z-[260] max-h-[calc(100vh-2rem)] w-[min(480px,calc(100vw-11.5rem))] overflow-hidden rounded-lg border border-white/10 bg-black/[0.92] font-mono text-white shadow-[0_0_54px_rgba(0,0,0,0.68),0_0_38px_rgba(167,139,250,0.18)] backdrop-blur-md max-[700px]:left-2 max-[700px]:right-2 max-[700px]:top-[58px] max-[700px]:w-auto max-[700px]:max-h-[calc(100vh-70px)]"
          style={{ opacity }}
          onMouseDown={event => event.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function HelpMenu({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const playClick = () => useAudioManager.getState().play('buttonClick')

  return (
    <div className="relative select-none">
      <GameMenuButton
        label="Help"
        marker="?"
        accent="#60A5FA"
        active={isOpen}
        aria-label="Help menu"
        data-oasis-tooltip="Help"
        onClick={() => {
          playClick()
          onToggle()
        }}
      />
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

const OASIS_LOADER_FIRST_LOAD_STALL_TIMEOUT_MS = 18000

function OasisLoader() {
  const { progress, active, loaded, total } = useProgress()
  const [show, setShow] = useState(true)
  const hasCompletedFirstLoad = useRef(false)

  const [byteInfo, setByteInfo] = useState({ loaded: 0, total: 0, speed: 0 })
  const normalizedProgress = Number.isFinite(progress)
    ? Math.max(0, Math.min(progress, 100))
    : total > 0 && loaded >= total
      ? 100
      : 0
  const hasByteData = byteInfo.total > 0
  const isSettled = normalizedProgress >= 100
    || (total > 0 && loaded >= total)
    || (hasByteData && byteInfo.loaded >= byteInfo.total)

  useEffect(() => {
    const origOpen = XMLHttpRequest.prototype.open as any
    const origSend = XMLHttpRequest.prototype.send as any
    const activeXhr = new Map<XMLHttpRequest, { loaded: number; total: number }>()
    let prevLoaded = 0
    let prevTime = performance.now()
    let smoothSpeed = 0
    let rafId = 0

    XMLHttpRequest.prototype.open = function(this: any, ...args: any[]) {
      const url = String(args[1] || '')
      if (/\.(glb|gltf|hdr|exr|bin|jpg|png|ktx2)(\?|$)/i.test(url)) {
        this._oasisTrack = true
      }
      return origOpen.apply(this, args)
    }

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
    if (typeof window === 'undefined') return
    const timer = window.setTimeout(() => {
      if (hasCompletedFirstLoad.current) return
      console.warn('[OasisLoader] First load timed out; hiding loader so the world remains usable.')
      hasCompletedFirstLoad.current = true
      setShow(false)
    }, OASIS_LOADER_FIRST_LOAD_STALL_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (isSettled) {
      const timer = setTimeout(() => {
        setShow(false)
        hasCompletedFirstLoad.current = true
      }, 800)
      return () => clearTimeout(timer)
    }
    if (active && !hasCompletedFirstLoad.current) setShow(true)
  }, [active, isSettled])

  if (!show) return null

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
          width: `${normalizedProgress}%`, height: '100%',
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
          <span>{loaded}/{total} | {Math.round(normalizedProgress)}%</span>
        )}
      </div>
    </div>
  )
}
