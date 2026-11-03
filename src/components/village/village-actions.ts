// ░▒▓ VILLAGE ACTIONS — focus, camera hand-off and keys for engine agents ▓▒░
//
// Focusing an agent = slice focus + InputManager `agent-focus` + the village camera rig framing
// that agent next to the 2D session panel. Leaving focus (Esc, a canvas click, the close button)
// restores the exact camera pose from before, so third-person / orbit / noclip resume seamlessly.

import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, type InputState } from '../../lib/input-manager'
import { selectNextAgentForN } from '../../store/slices/agentEngineSlice'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { getPlayerAvatarPose, markThirdPersonCameraRestored, requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import { showNotice } from '../forge/GlobalNotice'
import { findNearestStation, type Vec3 } from '../../lib/village/village-layout'

export const VILLAGE_SESSION_LAYER = 'village-session'
export const VILLAGE_PICKER_LAYER = 'village-picker'
/** Walk this close (meters, ground plane) to an agent to get the "E talk" hint. */
export const VILLAGE_TALK_RADIUS = 3.4
/** ...and within this height (the avatar stands on the ground; a noclip camera may fly above). */
export const VILLAGE_TALK_HEIGHT = 2.5

// ─── station registry (VillageWorld writes, proximity + camera rig read) ─────

export interface VillageStationPlacement {
  position: Vec3
  rotationY: number
  /** Where the avatar stands, terrain height included. */
  anchor: Vec3
}

let stations = new Map<string, VillageStationPlacement>()

export function setVillageStations(next: Map<string, VillageStationPlacement>): void {
  stations = next
}

export function getVillageStation(agentId: string): VillageStationPlacement | null {
  return stations.get(agentId) || null
}

export function getVillageAnchors(): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [id, station] of stations) out[id] = station.anchor
  return out
}

// ─── session panel geometry (shared by the panel CSS and the camera framing) ──

export interface SessionPanelGeometry {
  side: 'right' | 'bottom'
  /** Fraction of the viewport the panel covers (width for right, height for bottom). */
  fraction: number
  width: number
  height: number
  margin: number
}

export function getSessionPanelGeometry(viewportWidth: number, viewportHeight: number): SessionPanelGeometry {
  const margin = 12
  if (viewportWidth < 700) {
    const height = Math.round(Math.min(viewportHeight * 0.58, viewportHeight - 120))
    return { side: 'bottom', fraction: (height + margin) / Math.max(1, viewportHeight), width: viewportWidth - margin * 2, height, margin }
  }
  const width = Math.round(Math.min(520, Math.max(360, viewportWidth * 0.36)))
  return { side: 'right', fraction: (width + margin * 2) / Math.max(1, viewportWidth), width, height: viewportHeight - margin * 2, margin }
}

// ─── camera save / restore ──────────────────────────────────────────────────

let rigCamera: THREE.Camera | null = null
let savedPose: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null

export function registerVillageCamera(camera: THREE.Camera | null): void {
  rigCamera = camera
  if (!camera) savedPose = null
}

// Dev-only console helpers for debugging focus / camera hand-off: window.__oasisVillage.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisVillage = {
    camera: () => (rigCamera ? rigCamera.position.toArray().map(v => Number(v.toFixed(2))) : null),
    savedPose: () => (savedPose ? savedPose.position.toArray().map(v => Number(v.toFixed(2))) : null),
    stations: () => Object.fromEntries([...stations].map(([id, s]) => [id, s.anchor.map(v => Number(v.toFixed(2)))])),
    /** Put the player avatar 2.4 m in front of an agent's desk, facing it (the "walk up" shortcut). */
    teleportNear: (agentId: string) => {
      const station = stations.get(agentId)
      if (!station) return false
      const forward: Vec3 = [Math.sin(station.rotationY), 0, Math.cos(station.rotationY)]
      const position: Vec3 = [station.anchor[0] + forward[0] * 2.4, station.anchor[1], station.anchor[2] + forward[2] * 2.4]
      const yaw = station.rotationY + Math.PI
      requestPlayerAvatarTeleport({ position, yaw, forward: [Math.sin(yaw), 0, Math.cos(yaw)] })
      return true
    },
  }
}

function saveCameraPoseOnce(): void {
  if (savedPose || !rigCamera) return
  savedPose = { position: rigCamera.position.clone(), quaternion: rigCamera.quaternion.clone() }
}

export function restoreVillageCameraPose(): void {
  if (!savedPose || !rigCamera) {
    savedPose = null
    return
  }
  rigCamera.position.copy(savedPose.position)
  rigCamera.quaternion.copy(savedPose.quaternion)
  rigCamera.updateMatrixWorld()
  savedPose = null
  // Exactly the pose third-person left behind: tell PlayerAvatar to keep its own azimuth instead
  // of re-deriving it from the camera offset (that adds ~8° of shoulder bias per visit).
  if (useInputManager.getState().inputState === 'third-person') markThirdPersonCameraRestored()
}

export function discardVillageCameraPose(): void {
  savedPose = null
}

// ─── focus ──────────────────────────────────────────────────────────────────

export function isFocusInputState(state: InputState): boolean {
  return state === 'agent-focus' || state === 'ui-focused'
}

/** Placing an object or painting owns the pointer and the camera's way back: don't take over. */
export function isVillageFocusBlocked(state: InputState = useInputManager.getState().inputState): boolean {
  return state === 'placement' || state === 'paint'
}

export function focusVillageAgent(agentId: string): boolean {
  const store = useOasisStore.getState()
  if (!store.agentEngine.agents[agentId]) return false
  if (isVillageFocusBlocked()) {
    // enterAgentFocus would remember `placement` as the camera to return to (noclip after Esc).
    showNotice('Finish or cancel what you are placing first (Esc)', 'warn')
    return false
  }
  // One camera owner at a time: drop any world agent-window / picture zoom first.
  if (store.focusedAgentWindowId) store.focusAgentWindow(null)
  if (store.focusedImageId) store.focusImage(null)
  saveCameraPoseOnce()
  store.agentEngineDispatch({ type: 'focus', agentId })
  const input = useInputManager.getState()
  if (input.inputState !== 'agent-focus') input.enterAgentFocus()
  return true
}

/**
 * Hand input and camera back after the village focus ended, whoever ended it (Esc, a dismissed
 * agent, an observer that vanished on reconnect). Idempotent.
 */
export function releaseVillageFocusInput(): void {
  const input = useInputManager.getState()
  input.popUILayer(VILLAGE_SESSION_LAYER)
  const store = useOasisStore.getState()
  if (store.focusedAgentWindowId || store.focusedImageId) return // a world window owns agent-focus now
  const after = useInputManager.getState()
  if (isFocusInputState(after.inputState) && after._uiLayerStack.length === 0) after.returnToPrevious()
  // If another panel keeps the UI focused we still hand the camera back.
  restoreVillageCameraPose()
}

/** Back out of the session view: clears focus, returns the input state and restores the camera. */
export function leaveVillageFocus(): void {
  const store = useOasisStore.getState()
  if (store.agentEngine.focusedAgentId) store.agentEngineDispatch({ type: 'focus', agentId: null })
  releaseVillageFocusInput()
}

export function openVillagePicker(open = true): void {
  useOasisStore.getState().agentEngineDispatch({ type: 'picker', open })
}

// ─── proximity ──────────────────────────────────────────────────────────────

/** Avatar position in third-person / orbit, the camera in noclip. */
export function getVillageActorPosition(): Vec3 | null {
  const input = useInputManager.getState()
  const base = isFocusInputState(input.inputState) || input.inputState === 'placement' || input.inputState === 'paint'
    ? input._previousCameraState
    : input.inputState
  const camera = getCameraSnapshot()?.position || null
  if (base === 'noclip') return camera
  return getPlayerAvatarPose()?.position || camera
}

export function updateVillageProximity(): void {
  const store = useOasisStore.getState()
  const nearby = findNearestStation(getVillageActorPosition(), getVillageAnchors(), VILLAGE_TALK_RADIUS, VILLAGE_TALK_HEIGHT)
  if (nearby !== store.agentEngine.nearbyAgentId) store.agentEngineDispatch({ type: 'nearby', agentId: nearby })
}

// ─── keys ───────────────────────────────────────────────────────────────────

const NON_TEXT_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'file', 'button', 'image', 'reset', 'submit'])

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || Boolean(el.isContentEditable)
}

/**
 * Village keys, run in the window capture phase so they win over the generic world bindings
 * (N cycles world agent windows, E is noclip "down"). Returns true when the key was consumed.
 */
export function handleVillageKeyDown(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false
  if (isTypingTarget(event.target)) return false
  const village = useOasisStore.getState().agentEngine
  // Same gate as the world's own N key, plus the village session view itself (ui-focused while
  // its panel is open). Placement, paint and other panels keep their keys (E is noclip "down").
  const input = useInputManager.getState()
  const inSessionView = input.inputState === 'ui-focused' && Boolean(village.focusedAgentId)
  if (!input.can().enterFocuses && input.inputState !== 'agent-focus' && !inSessionView) return false
  if (event.code === 'KeyE') {
    const target = village.nearbyAgentId
    if (!target || village.focusedAgentId === target) return false
    focusVillageAgent(target)
    return true
  }
  if (event.code === 'KeyN' && !event.shiftKey) {
    if (!village.order.length) return false // nothing in the village: keep the world's own N binding
    const next = selectNextAgentForN(village)
    if (next) focusVillageAgent(next)
    return true
  }
  return false
}
