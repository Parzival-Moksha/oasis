'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS - Main 3D Scene
// The canvas upon which worlds are built
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, Stars, Grid, Html, TransformControls, Environment, useProgress } from '@react-three/drei'
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
import { ViewportScreenshotBridge } from './forge/ViewportScreenshotBridge'
import { WizardConsole } from './forge/WizardConsole'
// AssetExplorerWindow deleted — functionality lives in WizardConsole
import { ObjectInspector } from './forge/ObjectInspector'
import { MindcraftMissionWindowBridge } from './forge/MindcraftMissionWindowBridge'
import { ActionLogButton, ActionLogPanel } from './forge/ActionLog'
import { ProfileButton } from './forge/ProfileButton'
import { OnboardingModal } from './forge/OnboardingModal'
import { MerlinPanel } from './forge/MerlinPanel'
import { AnorakPanel } from './forge/AnorakPanel'
import { AnorakProPanel } from './forge/AnorakProPanel'
import { HermesPanel } from './forge/HermesPanel'
import { ParzivalPanel } from './forge/ParzivalPanel'
import dynamic from 'next/dynamic'
const DevcraftPanel = dynamic(() => import('./forge/DevcraftPanel'), { ssr: false })
import { HelpPanel } from './forge/HelpPanel'
import { ConsolePanel } from './forge/ConsolePanel'
import { useWorldLoader } from './forge/WorldObjects'
import { completeQuest } from '@/lib/quests'
import { useInputManager, getInputCapabilities, getMouseLookDebugState, isPointerLocked } from '@/lib/input-manager'
import { CameraController as CameraControllerComponent, sprintRef, FPSControls, FPS_KEYBOARD_MAP } from './CameraController'
import { useAudioManager, SOUND_OPTIONS, type SoundEvent } from '@/lib/audio-manager'
import { installTestHarness } from '@/lib/test-harness'
import { useWorldEvents } from '@/hooks/useWorldEvents'
import { AgentWindowPortals } from './forge/AgentWindowPortals'

// ═══════════════════════════════════════════════════════════════════════════════
// ─═̷─═̷─🎮─═̷─═̷─{ QUAKE FPS CONTROLS - WASD + Q/E }─═̷─═̷─🎮─═̷─═̷─
// ═══════════════════════════════════════════════════════════════════════════════

// FPSControls, FPS_KEYBOARD_MAP, sprintRef — imported from CameraController

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
      localStorage.setItem('oasis-mouse-debug', next ? '1' : '0')
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

function SettingsContent() {
  const { settings, updateSetting } = useContext(SettingsContext)

  const toggles = [
    { key: 'bloomEnabled' as const, label: 'Bloom', category: 'Post-FX' },
    { key: 'vignetteEnabled' as const, label: 'Vignette', category: 'Post-FX' },
    { key: 'chromaticEnabled' as const, label: 'Chromatic Aberration', category: 'Post-FX' },
    { key: 'fpsCounterEnabled' as const, label: 'FPS Counter', category: 'UI' },
    { key: 'showGrid' as const, label: 'Helper Grid', category: 'UI' },
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

          {/* Bloom intensity slider (only when bloom is enabled) */}
          {category === 'Post-FX' && settings.bloomEnabled && (
            <div className="px-1 py-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">Bloom Intensity</span>
                <span className="text-[10px] text-purple-400 font-mono">{(settings.bloomIntensity ?? 0.4).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="2.0"
                step="0.05"
                value={settings.bloomIntensity ?? 0.4}
                onChange={(e) => updateSetting('bloomIntensity', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>
          )}

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

              {/* Ready Player 1 Mode */}
              <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
                <div
                  onClick={() => updateSetting('rp1Mode', !settings.rp1Mode)}
                  className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
                    settings.rp1Mode ? 'bg-teal-600 shadow-lg shadow-teal-500/30' : 'bg-gray-700'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
                    settings.rp1Mode ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </div>
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Ready Player 1</span>
              </label>

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

        {/* ─═̷─═̷─📐─═̷─═̷─ FIELD OF VIEW ─═̷─═̷─📐─═̷─═̷─ */}
        <div className="py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Field of View</span>
            <span className="text-xs text-purple-400 font-mono">{settings.fov}°</span>
          </div>
          <input
            type="range"
            min="30"
            max="120"
            step="5"
            value={settings.fov}
            onChange={(e) => updateSetting('fov', parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
        </div>
      </div>

      <div className="mb-2 border-t border-white/10 pt-3">
        <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Agent Embodiment</div>

        <label className="flex items-center gap-3 py-1.5 cursor-pointer group hover:bg-white/5 rounded px-1 -mx-1 transition-colors">
          <div
            onClick={() => updateSetting('agentActionMode', settings.agentActionMode === 'embodied' ? 'instant' : 'embodied')}
            className={`w-10 h-5 rounded-full transition-all cursor-pointer relative flex-shrink-0 ${
              settings.agentActionMode === 'embodied' ? 'bg-cyan-600 shadow-lg shadow-cyan-500/30' : 'bg-gray-700'
            }`}
          >
            <div className={`w-4 h-4 rounded-full bg-white mt-0.5 transition-all ${
              settings.agentActionMode === 'embodied' ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-300 group-hover:text-white transition-colors whitespace-nowrap">Embodied Agent Actions</div>
            <div className="text-[10px] text-gray-500">
              {settings.agentActionMode === 'embodied'
                ? 'Agents walk, cast, and settle before manifestations visibly land.'
                : 'Agent world changes apply immediately without slow-mo staging.'}
            </div>
          </div>
        </label>

        <div className="py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Agent Walk Speed</span>
            <span className="text-xs text-cyan-300 font-mono">{settings.agentWalkSpeed.toFixed(1)} m/s</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="12"
            step="0.5"
            value={settings.agentWalkSpeed}
            onChange={(e) => updateSetting('agentWalkSpeed', parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
        </div>

        <div className="py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Conjure Duration</span>
            <span className="text-xs text-cyan-300 font-mono">{(settings.agentConjureDurationMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range"
            min="0"
            max="12000"
            step="250"
            value={settings.agentConjureDurationMs}
            onChange={(e) => updateSetting('agentConjureDurationMs', parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
        </div>

        <div className="py-1.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Screenshot Settle</span>
            <span className="text-xs text-cyan-300 font-mono">{settings.agentScreenshotSettleMs} ms</span>
          </div>
          <input
            type="range"
            min="0"
            max="2000"
            step="20"
            value={settings.agentScreenshotSettleMs}
            onChange={(e) => updateSetting('agentScreenshotSettleMs', parseInt(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />
        </div>
      </div>

      {/* ─═̷─═̷─🔊 SOUND SETTINGS ─═̷─═̷─🔊 */}
      <SoundSettings />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOUND SETTINGS — per-event sound selection + volume
// ═══════════════════════════════════════════════════════════════════════════════

function SoundSettings() {
  const { volume, muted, selections, setVolume, toggleMute, selectSound, preview } = useAudioManager()
  const [expanded, setExpanded] = useState(false)

  const EVENT_LABELS: Record<string, string> = {
    select: 'Select Object', deselect: 'Deselect', place: 'Place Object', delete: 'Delete Object',
    panelOpen: 'Panel Open', panelClose: 'Panel Close', buttonClick: 'Button Click', buttonHover: 'Button Hover',
    modeSwitch: 'Camera Mode', conjureStart: 'Conjure Start', conjureDone: 'Conjure Done',
    anorakDone: 'Anorak Done', notification: 'Notification', undo: 'Undo', redo: 'Redo',
    agentFocus: 'Agent Focus', agentUnfocus: 'Agent Unfocus', tilePaint: 'Tile Paint',
    error: 'Error',
    // footstep excluded — always cycles through all footstep sounds for variety
  }

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white transition-colors">
          <span>{expanded ? '▼' : '▸'}</span>
          <span>🔊 Sounds</span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={toggleMute} className="text-xs cursor-pointer px-1.5 py-0.5 rounded" style={{ background: muted ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)', color: muted ? '#ef4444' : '#22c55e' }}>
            {muted ? '🔇 Muted' : '🔊 On'}
          </button>
        </div>
      </div>

      {/* Volume slider */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-gray-500">Vol</span>
        <input type="range" min="0" max="100" value={Math.round(volume * 100)}
          onChange={e => setVolume(parseInt(e.target.value) / 100)}
          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
        />
        <span className="text-[10px] text-gray-400 font-mono w-8 text-right">{Math.round(volume * 100)}%</span>
      </div>

      {/* Per-event sound selection */}
      {expanded && (
        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {Object.entries(EVENT_LABELS).map(([event, label]) => {
            const options = (SOUND_OPTIONS as Record<string, Array<{ id: string; label: string }>>)[event]
            if (!options) return null
            return (
              <div key={event} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-gray-500 w-24 truncate flex-shrink-0">{label}</span>
                <select
                  value={(selections as Record<string, string>)[event] || options[0]?.id}
                  onChange={e => {
                    selectSound(event as SoundEvent, e.target.value)
                    preview(event as SoundEvent, e.target.value)
                  }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300 cursor-pointer outline-none text-[10px]"
                >
                  {options.map((opt: { id: string; label: string }) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button onClick={() => preview(event as SoundEvent, (selections as Record<string, string>)[event])}
                  className="text-gray-600 hover:text-sky-400 cursor-pointer text-[11px]" title="Preview">▶</button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

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
  const [isPending, startTransition] = useTransition()
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

  useFrame(() => {
    const si = Math.max(0, sprintRef.current.intensity)
    const isActive = si > 0.05
    if (isActive !== sprintActiveRef.current) {
      sprintActiveRef.current = isActive
      setSprintActive(isActive) // eslint-disable-line react-hooks/set-state-in-effect -- drives hasEffects conditional render
    }

    // Imperatively update effect uniforms — no re-renders needed
    if (chromaticRef.current) {
      const base = settings.chromaticEnabled ? 0.003 : 0
      const boost = si * 0.012
      const val = base + boost
      chromaticRef.current.offset = _offsetVec.current.set(val, val)
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

export default function Scene() {
  // Local mode: always admin, never anonymous. Auth is optional.
  const isAdmin = true
  const [isDragging, setIsDragging] = useState(false)
  useWorldEvents()

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
  // InputManager is THE authority for what controls are active
  const inputState = useInputManager(s => s.inputState)
  const isAgentFocused = inputState === 'agent-focus'

  // ─═̷─═̷─🌍─═̷─═̷─{ WORLD LOADER — ensures conjured assets + world state loaded }─═̷─═̷─🌍─═̷─═̷─
  useWorldLoader()

  const isViewMode = useOasisStore(s => s.isViewMode)
  const isViewModeEditable = useOasisStore(s => s.isViewModeEditable)
  // Hide editing tools when viewing read-only worlds (but show for public_edit)
  // Anonymous users NEVER get edit tools, even on public_edit worlds
  const hideEditTools = (isViewMode && !isViewModeEditable) || settings.rp1Mode

  // ─═̷─═̷─✨─═̷─═̷─{ WIZARD CONSOLE + ASSET EXPLORER STATE }─═̷─═̷─✨─═̷─═̷─
  const [wizardOpen, setWizardOpen] = useState(false)
  // Asset Explorer removed — merged into WizardConsole
  const [actionLogOpen, setActionLogOpen] = useState(false)
  const [merlinOpen, setMerlinOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [claudeCodeOpen, setClaudeCodeOpen] = useState(false)
  const [anorakProOpen, setAnorakProOpen] = useState(false)
  const [devcraftOpen, setDevcraftOpen] = useState(false)
  const [hermesOpen, setHermesOpen] = useState(false)
  const [parzivalOpen, setParzivalOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)

  // Panel toggle with sound
  const togglePanel = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(prev => {
      useAudioManager.getState().play(prev ? 'panelClose' : 'panelOpen')
      return !prev
    })
  }

  const updateSetting = <K extends keyof OasisSettings>(key: K, value: OasisSettings[K]) => {
    // Sync InputManager when control mode changes
    if (key === 'controlMode') {
      useInputManager.getState().syncFromControlMode(value as 'orbit' | 'noclip' | 'third-person')
    }
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  // ─═̷─═̷─🎮─═̷─═̷─{ CAMERA MODE HOTKEY: Ctrl+Alt+C cycles orbit→noclip→third-person }─═̷─═̷─🎮─═̷─═̷─
  useEffect(() => {
    const MODES: Array<'orbit' | 'noclip' | 'third-person'> = ['orbit', 'noclip', 'third-person']
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyC') {
        e.preventDefault()
        setSettings(prev => {
          const idx = MODES.indexOf(prev.controlMode)
          const next = MODES[(idx + 1) % MODES.length]
          useInputManager.getState().syncFromControlMode(next)
          useAudioManager.getState().play('modeSwitch')
          return { ...prev, controlMode: next }
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ─═̷─═̷─🎯─═̷─═̷─{ POINTER LOCK — owned by InputManager }─═̷─═̷─🎯─═̷─═̷─
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

  // ─═̷─═̷─🧪─═̷─═̷─{ TEST HARNESS — Parzival's Hands }─═̷─═̷─🧪─═̷─═̷─
  useEffect(() => { installTestHarness() }, [])

  // ─═̷─═̷─🎮─═̷─═̷─{ CANVAS }─═̷─═̷─🎮─═̷─═̷─
  const CanvasContent = (
    <Canvas
      id="uploader-canvas"
      camera={{ position: [12, 10, 12], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        if (isPointerLocked()) return  // Noclip/TPS mode — click locks pointer, not deselects
        selectObject(null)
      }}
    >
        <color attach="background" args={['#030303']} />

        <SkyBackground backgroundId={worldSkyBackground} />

        {/* ─═̷─═̷─🎮 CAMERA CONTROLLER — ONE owner, ONE useFrame, ZERO fights ─═̷─═̷─🎮 */}
        <CameraControllerComponent />
        <PointerLockRaycaster />
        {settings.controlMode === 'noclip' && <SprintParticles />}

        {settings.showGrid && !settings.rp1Mode && (
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
        </Suspense>

        {/* ─═̷─═̷─📸─═̷─═̷─ PANORAMA CAPTURE (Ctrl+Shift+P) ─═̷─═̷─📸─═̷─═̷─ */}
        <PanoramaCapture />
        <ViewportScreenshotBridge />

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

      {/* ─═̷─═̷─🎯 CROSSHAIR — Noclip + TPS when pointer locked ─═̷─═̷─🎯 */}
      {(settings.controlMode === 'noclip' || settings.controlMode === 'third-person') && pointerLocked && (
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
            onClick={() => togglePanel(setMerlinOpen)}
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
        {isAdmin && !hideEditTools && (
          <button
            onClick={() => togglePanel(setClaudeCodeOpen)}
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
        {isAdmin && !hideEditTools && (
          <button
            onClick={() => togglePanel(setAnorakProOpen)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
            style={{
              background: anorakProOpen ? 'rgba(20,184,166,0.3)' : 'rgba(0,0,0,0.6)',
              border: `1px solid ${anorakProOpen ? 'rgba(20,184,166,0.6)' : 'rgba(255,255,255,0.15)'}`,
              color: anorakProOpen ? '#14b8a6' : '#aaa',
              boxShadow: anorakProOpen ? '0 0 12px rgba(20,184,166,0.3)' : 'none',
            }}
            title="Anorak Pro"
          >
            🔮
          </button>
        )}
        {!hideEditTools && <button
          onClick={() => togglePanel(setDevcraftOpen)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: devcraftOpen ? 'rgba(16,185,129,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${devcraftOpen ? 'rgba(16,185,129,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: devcraftOpen ? '#10B981' : '#aaa',
            boxShadow: devcraftOpen ? '0 0 12px rgba(16,185,129,0.3)' : 'none',
          }}
          title="DevCraft — Productivity Terminal"
        >
          📅
        </button>}
        <button
          onClick={() => togglePanel(setHermesOpen)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: hermesOpen ? 'rgba(245,158,11,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${hermesOpen ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: hermesOpen ? '#F59E0B' : '#aaa',
            boxShadow: hermesOpen ? '0 0 12px rgba(245,158,11,0.3)' : 'none',
          }}
          title="Hermes - Remote Agent Chat"
        >
          ☤
        </button>
        <button
          onClick={() => togglePanel(setParzivalOpen)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: parzivalOpen ? 'rgba(192,132,252,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${parzivalOpen ? 'rgba(192,132,252,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: parzivalOpen ? '#C084FC' : '#aaa',
            boxShadow: parzivalOpen ? '0 0 12px rgba(192,132,252,0.3)' : 'none',
          }}
          title="Parzival — Autonomous Brain"
        >
          🧿
        </button>
        {isAdmin && <button
          onClick={() => togglePanel(setConsoleOpen)}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: consoleOpen ? 'rgba(245,158,11,0.3)' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${consoleOpen ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.15)'}`,
            color: consoleOpen ? '#F59E0B' : '#aaa',
            boxShadow: consoleOpen ? '0 0 12px rgba(245,158,11,0.3)' : 'none',
          }}
          title="Console — Live Server Logs"
        >
          📡
        </button>}
        <button
          onClick={() => togglePanel(setHelpOpen)}
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

      {/* 🔍 Object Inspector — hidden in view mode + during agent-focus (zoomon fills viewport) */}
      {!hideEditTools && (
        <ObjectInspector
          isOpen={!!inspectedObjectId && !isAgentFocused}
          onClose={() => setInspectedObject(null)}
        />
      )}

      {/* 📋 Mindcraft 3D — Mission Window (outside Canvas, bridged via Zustand) */}
      <MindcraftMissionWindowBridge />

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
      {/* 🔮 Anorak Pro — Autonomous dev pipeline — admin only */}
      {isAdmin && (
        <AnorakProPanel
          isOpen={anorakProOpen}
          onClose={() => setAnorakProOpen(false)}
        />
      )}

      {/* 🧿 Parzival — Autonomous Brain */}
      <HermesPanel
        isOpen={hermesOpen}
        onClose={() => setHermesOpen(false)}
      />
      <ParzivalPanel
        isOpen={parzivalOpen}
        onClose={() => setParzivalOpen(false)}
      />

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

      {/* 📡 Console — Live Server Logs — admin only */}
      {isAdmin && (
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

      {/* EXIT RP1 — floating escape hatch when Ready Player 1 mode is active */}
      {settings.rp1Mode && (
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
          title="Exit Ready Player 1 mode — restore editing tools"
        >
          EXIT RP1
        </button>
      )}

      {/* ░▒▓ LOADING OVERLAY ▓▒░ */}
      <OasisLoader />

      {/* ░▒▓ AGENT WINDOW PORTALS — offscreen DOM for 3D window textures ▓▒░ */}
      <AgentWindowPortals />

      {/* ░▒▓ IMAGE DROP ZONE — drag & drop images into the world ▓▒░ */}
      <ImageDropZone />

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
    // Document-level drag listeners — NO intercepting divs that block clicks
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCountRef.current++
      if (e.dataTransfer?.types.includes('Files')) setDropping(true)
    }
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCountRef.current--
      if (dragCountRef.current <= 0) { setDropping(false); dragCountRef.current = 0 }
    }
    const handleDragOver = (e: DragEvent) => { e.preventDefault() }
    const handleDrop = async (e: DragEvent) => {
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
          className="absolute top-0 left-12 backdrop-blur-sm border border-gray-800 rounded-xl shadow-2xl animate-in slide-in-from-left-2 duration-200 z-[250]"
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
          <span>{loaded}/{total} | {Math.round(normalizedProgress)}%</span>
        )}
      </div>
    </div>
  )
}
