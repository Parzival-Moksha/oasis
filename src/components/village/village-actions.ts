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
import { villageKeyAction } from '../../lib/village/village-keys'
import { getVillageSoundDebug } from './village-sound'

export const VILLAGE_SESSION_LAYER = 'village-session'
export const VILLAGE_PICKER_LAYER = 'village-picker'
/** Walk this close (meters, ground plane) to an agent to get the "T talk" hint. */
export const VILLAGE_TALK_RADIUS = 3.4
/** ...and within this height (the avatar stands on the ground; a noclip camera may fly above). */
export const VILLAGE_TALK_HEIGHT = 2.5
/** Stand this close to the plaza center (the summoning circle) for E to open the picker. */
export const VILLAGE_PLAZA_RADIUS = 2.4

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

// ─── helpers (subagent minis; VillageSubagentMinis writes, proximity + E + HUD read) ──

/** Stand this close to a helper (a parent's subagent mini) for E to open its work. */
export const VILLAGE_MINI_RADIUS = 1.3

export interface VillageSubagentRef {
  agentId: string
  key: string
  description: string
}

/** World positions of every mini on screen, per parent agent. */
const minis = new Map<string, Array<VillageSubagentRef & { position: Vec3 }>>()
let nearbyMini: VillageSubagentRef | null = null
const nearbyMiniListeners = new Set<() => void>()

export function setVillageMinis(agentId: string, next: Array<VillageSubagentRef & { position: Vec3 }> | null): void {
  if (next && next.length) minis.set(agentId, next)
  else minis.delete(agentId)
}

/** Every mini on screen, with its world position (dev helpers, tests). */
export function getVillageMiniList(): Array<VillageSubagentRef & { position: Vec3 }> {
  return [...minis.values()].flat()
}

/** The helper within E's reach, if any (it wins E over its parent). */
export function getNearbyVillageMini(): VillageSubagentRef | null {
  return nearbyMini
}

export function subscribeNearbyVillageMini(listener: () => void): () => void {
  nearbyMiniListeners.add(listener)
  return () => { nearbyMiniListeners.delete(listener) }
}

function updateNearbyMini(actor: Vec3 | null): void {
  let best: VillageSubagentRef | null = null
  if (actor) {
    const anchors: Record<string, Vec3> = {}
    const refs = new Map<string, VillageSubagentRef>()
    for (const list of minis.values()) {
      for (const mini of list) {
        const id = `${mini.agentId}\u0001${mini.key}`
        anchors[id] = mini.position
        refs.set(id, mini)
      }
    }
    const id = findNearestStation(actor, anchors, VILLAGE_MINI_RADIUS, VILLAGE_TALK_HEIGHT)
    best = id ? refs.get(id) || null : null
  }
  if (best?.agentId === nearbyMini?.agentId && best?.key === nearbyMini?.key && best?.description === nearbyMini?.description) return
  nearbyMini = best
  nearbyMiniListeners.forEach(listener => listener())
}

/** Open the parent's panel on one helper's work (the panel offers "back" to the whole thread). */
export function focusVillageSubagent(agentId: string, key: string): boolean {
  if (!focusVillageAgent(agentId)) return false
  useOasisStore.getState().agentEngineDispatch({ type: 'subagent/focus', agentId, key })
  return true
}

// ─── plaza (the summoning circle; VillagePlaza writes, proximity + HUD read) ──

let plaza: Vec3 | null = null
let inPlaza = false
const plazaListeners = new Set<() => void>()

export function setVillagePlaza(center: Vec3 | null): void {
  plaza = center
}

export function isInVillagePlaza(): boolean {
  return inPlaza
}

export function subscribeVillagePlaza(listener: () => void): () => void {
  plazaListeners.add(listener)
  return () => { plazaListeners.delete(listener) }
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

// The owner drags the panel's left edge to make it wider; the width is remembered (this browser).
export const SESSION_PANEL_MIN_WIDTH = 360
const PANEL_WIDTH_KEY = 'oasis-village-panel-width'
let panelWidth: number | null | undefined
const panelWidthListeners = new Set<() => void>()

/** The widest the panel may get: the world keeps at least 300 px (and the left menus) beside it. */
export function sessionPanelMaxWidth(viewportWidth: number): number {
  return Math.max(SESSION_PANEL_MIN_WIDTH, Math.min(1400, viewportWidth - 300))
}

export function getSessionPanelWidth(): number | null {
  if (panelWidth === undefined) {
    let stored: number | null = null
    try {
      const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(PANEL_WIDTH_KEY)
      stored = raw && Number.isFinite(Number(raw)) ? Number(raw) : null
    } catch { /* storage off */ }
    panelWidth = stored
  }
  return panelWidth
}

/** null: back to the automatic width. */
export function setSessionPanelWidth(width: number | null): void {
  const next = width === null ? null : Math.round(Math.max(SESSION_PANEL_MIN_WIDTH, width))
  if (next === getSessionPanelWidth()) return
  panelWidth = next
  try {
    if (next === null) window.localStorage.removeItem(PANEL_WIDTH_KEY)
    else window.localStorage.setItem(PANEL_WIDTH_KEY, String(next))
  } catch { /* storage off */ }
  panelWidthListeners.forEach(listener => listener())
}

export function subscribeSessionPanelWidth(listener: () => void): () => void {
  panelWidthListeners.add(listener)
  return () => { panelWidthListeners.delete(listener) }
}

export function getSessionPanelGeometry(
  viewportWidth: number,
  viewportHeight: number,
  /** The width the owner dragged it to (default: the remembered one); ignored on phones. */
  preferredWidth: number | null = getSessionPanelWidth(),
): SessionPanelGeometry {
  const margin = 12
  if (viewportWidth < 700) {
    const height = Math.round(Math.min(viewportHeight * 0.58, viewportHeight - 120))
    return { side: 'bottom', fraction: (height + margin) / Math.max(1, viewportHeight), width: viewportWidth - margin * 2, height, margin }
  }
  const auto = Math.min(520, Math.max(SESSION_PANEL_MIN_WIDTH, viewportWidth * 0.36))
  const width = Math.round(preferredWidth === null
    ? auto
    : Math.min(sessionPanelMaxWidth(viewportWidth), Math.max(SESSION_PANEL_MIN_WIDTH, preferredWidth)))
  return { side: 'right', fraction: (width + margin * 2) / Math.max(1, viewportWidth), width, height: viewportHeight - margin * 2, margin }
}

// ─── camera save / restore ──────────────────────────────────────────────────

// ─── screen mode (F): the camera fills the view with the focused agent's desk window ─────

let screenAgentId: string | null = null
const screenListeners = new Set<() => void>()

export function getVillageScreen(): string | null {
  return screenAgentId
}

export function setVillageScreen(agentId: string | null): void {
  if (agentId === screenAgentId) return
  screenAgentId = agentId
  screenListeners.forEach(listener => listener())
}

export function subscribeVillageScreen(listener: () => void): () => void {
  screenListeners.add(listener)
  return () => { screenListeners.delete(listener) }
}

/** F while an agent is focused: zoom into its screen, or back out to the side panel. */
export function toggleVillageScreen(): boolean {
  const focused = useOasisStore.getState().agentEngine.focusedAgentId
  if (!focused) return false
  setVillageScreen(screenAgentId === focused ? null : focused)
  return true
}

// ─── voice (T / Ctrl+Space) and send (Enter on the screen): the mounted composer listens ─

const voiceListeners = new Set<() => void>()

export function subscribeVillageVoiceToggle(listener: () => void): () => void {
  voiceListeners.add(listener)
  return () => { voiceListeners.delete(listener) }
}

const sendListeners = new Set<() => void>()

export function subscribeVillageSend(listener: () => void): () => void {
  sendListeners.add(listener)
  return () => { sendListeners.delete(listener) }
}

/** Send what is in the focused agent's text box. False when no box is mounted. */
export function triggerVillageSend(): boolean {
  if (!sendListeners.size) return false
  sendListeners.forEach(listener => listener())
  return true
}

/** Start or stop live dictation into the focused agent's text box. False when no box is mounted. */
export function toggleVillageVoice(): boolean {
  if (!voiceListeners.size) return false
  voiceListeners.forEach(listener => listener())
  return true
}

/** The mounted box answers true when it stopped a running dictation. */
const voiceStopListeners = new Set<() => boolean>()

export function subscribeVillageVoiceStop(listener: () => boolean): () => void {
  voiceStopListeners.add(listener)
  return () => { voiceStopListeners.delete(listener) }
}

/** Stop the mic if it is on. True when it was. */
export function stopVillageVoice(): boolean {
  let stopped = false
  voiceStopListeners.forEach(listener => { if (listener()) stopped = true })
  return stopped
}

// T next to an agent: the talk window opens, and its box starts the mic as soon as it is mounted.
const VOICE_REQUEST_TTL_MS = 4000
let voiceRequest: { agentId: string; at: number } | null = null

export function requestVillageVoiceOnOpen(agentId: string | null): void {
  voiceRequest = agentId ? { agentId, at: Date.now() } : null
}

/** For the box that just mounted: should it start the mic? Answers true once. */
export function takeVillageVoiceRequest(agentId: string): boolean {
  const request = voiceRequest
  if (!request || request.agentId !== agentId) return false
  voiceRequest = null
  return Date.now() - request.at < VOICE_REQUEST_TTL_MS
}

/** T next to an agent: open its talk window with the mic on (E opens it without). */
export function talkToVillageAgent(agentId: string): boolean {
  requestVillageVoiceOnOpen(agentId)
  const focused = focusVillageAgent(agentId)
  if (!focused) requestVillageVoiceOnOpen(null)
  return focused
}

// ─── image viewer: pictures open full-screen in the Oasis (VillageImageViewer), not in a new tab ─────

export interface VillageViewerImage {
  url: string
  name: string
}

let viewer: { images: VillageViewerImage[]; index: number } | null = null
const viewerListeners = new Set<() => void>()

export function getVillageImageViewer(): { images: VillageViewerImage[]; index: number } | null {
  return viewer
}

export function subscribeVillageImageViewer(listener: () => void): () => void {
  viewerListeners.add(listener)
  return () => { viewerListeners.delete(listener) }
}

export function openVillageImages(images: VillageViewerImage[], index = 0): void {
  if (!images.length) return
  viewer = { images, index: Math.max(0, Math.min(images.length - 1, index)) }
  viewerListeners.forEach(listener => listener())
}

export function closeVillageImages(): void {
  if (!viewer) return
  viewer = null
  viewerListeners.forEach(listener => listener())
}

/** ← / → : the previous or next picture, wrapping around. */
export function stepVillageImages(delta: number): void {
  if (!viewer || viewer.images.length < 2) return
  const n = viewer.images.length
  viewer = { ...viewer, index: (viewer.index + delta + n) % n }
  viewerListeners.forEach(listener => listener())
}

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
    /** Put the player avatar `meters` (default 2.4) in front of an agent's desk, facing it (the "walk up" shortcut). */
    teleportNear: (agentId: string, meters = 2.4) => {
      const station = stations.get(agentId)
      if (!station) return false
      const forward: Vec3 = [Math.sin(station.rotationY), 0, Math.cos(station.rotationY)]
      const position: Vec3 = [station.anchor[0] + forward[0] * meters, station.anchor[1], station.anchor[2] + forward[2] * meters]
      const yaw = station.rotationY + Math.PI
      requestPlayerAvatarTeleport({ position, yaw, forward: [Math.sin(yaw), 0, Math.cos(yaw)] })
      return true
    },
    /** Put the player avatar in the middle of the summoning circle. */
    teleportToPlaza: () => {
      if (!plaza) return false
      requestPlayerAvatarTeleport({ position: plaza, yaw: 0, forward: [0, 0, 1] })
      return true
    },
    inPlaza: () => inPlaza,
    sound: () => getVillageSoundDebug(),
    /** The agent whose screen fills the view (F), or null. */
    screen: () => screenAgentId,
    toggleScreen: () => toggleVillageScreen(),
    /** Show one subagent's work alone in its parent's panel (key: its key in `subagents`); null agentId: the whole thread. */
    focusSubagent: (agentId: string | null, key?: string) => {
      useOasisStore.getState().agentEngineDispatch({ type: 'subagent/focus', agentId, key: key ?? null })
      if (agentId) focusVillageAgent(agentId)
    },
    /** The open picture viewer: index and count, or null. */
    viewer: () => (viewer ? { index: viewer.index, count: viewer.images.length } : null),
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
  setVillageScreen(null)
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

/**
 * Something else the owner can walk up to (the mission wall). Asked on every proximity tick with where
 * the owner stands and how far the agent within reach is (null: none); true means it is nearer and
 * takes the keys and the prompt, so no agent counts as nearby.
 */
let proximityRival: ((actor: Vec3 | null, agentDistance: number | null) => boolean) | null = null

export function setVillageProximityRival(rival: typeof proximityRival): void {
  proximityRival = rival
}

export function updateVillageProximity(): void {
  const store = useOasisStore.getState()
  const actor = getVillageActorPosition()
  const anchors = getVillageAnchors()
  let nearby = findNearestStation(actor, anchors, VILLAGE_TALK_RADIUS, VILLAGE_TALK_HEIGHT)
  if (proximityRival) {
    const at = nearby ? anchors[nearby] : null
    const agentDistance = actor && at ? Math.hypot(actor[0] - at[0], actor[2] - at[2]) : null
    // While an agent is open the wall stays quiet.
    if (proximityRival(store.agentEngine.focusedAgentId ? null : actor, agentDistance)) nearby = null
  }
  if (nearby !== store.agentEngine.nearbyAgentId) store.agentEngineDispatch({ type: 'nearby', agentId: nearby })
  updateNearbyMini(actor)
  // An agent within reach wins the E key; otherwise standing in the circle makes E summon.
  const nextInPlaza = !nearby && Boolean(plaza && findNearestStation(actor, { plaza }, VILLAGE_PLAZA_RADIUS, VILLAGE_TALK_HEIGHT))
  if (nextInPlaza !== inPlaza) {
    inPlaza = nextInPlaza
    plazaListeners.forEach(listener => listener())
  }
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
 * (N cycles world agent windows, E is noclip "down", T the rotate gizmo). Returns true when the
 * key was consumed. What each key means lives in village-keys.ts.
 */
export function handleVillageKeyDown(event: KeyboardEvent): boolean {
  // The image viewer has the keyboard (Esc, arrows) while it is open.
  if (viewer) return false
  const village = useOasisStore.getState().agentEngine
  const input = useInputManager.getState()
  // Same gate as the world's own N key, plus the village session view itself (ui-focused while its panel is open).
  const inSessionView = input.inputState === 'ui-focused' && Boolean(village.focusedAgentId)
  const action = villageKeyAction({
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    repeat: event.repeat,
    typing: isTypingTarget(event.target),
    focusedAgentId: village.focusedAgentId,
    nearbyAgentId: village.nearbyAgentId,
    worldKeysFree: input.can().enterFocuses || input.inputState === 'agent-focus' || inSessionView,
    inPlaza,
    agentCount: village.order.length,
  })
  // E next to a helper (a subagent mini) opens its work in the parent's panel; it wins over the parent.
  const mini = nearbyMini
  if (mini && event.code === 'KeyE' && (action === 'open' || (action === null && !event.ctrlKey && !event.metaKey && !event.altKey
    && !event.repeat && !isTypingTarget(event.target) && (input.can().enterFocuses || input.inputState === 'agent-focus' || inSessionView)))) {
    focusVillageSubagent(mini.agentId, mini.key)
    return true
  }
  switch (action) {
    case 'toggle-voice': return toggleVillageVoice()
    case 'toggle-screen': return toggleVillageScreen()
    // The box doesn't hold the keyboard until you click it: Enter sends what you dictated.
    case 'send': return triggerVillageSend()
    case 'escape':
      if (stopVillageVoice()) return true
      if (!screenAgentId) return false // the input manager's Esc leaves the agent
      setVillageScreen(null)
      return true
    case 'talk':
      if (village.nearbyAgentId) talkToVillageAgent(village.nearbyAgentId)
      return true
    case 'open':
      requestVillageVoiceOnOpen(null) // E is the quiet way in
      if (village.nearbyAgentId) focusVillageAgent(village.nearbyAgentId)
      return true
    case 'screen': // F next to an agent: open it straight on its full screen
      requestVillageVoiceOnOpen(null)
      if (village.nearbyAgentId && focusVillageAgent(village.nearbyAgentId)) setVillageScreen(village.nearbyAgentId)
      return true
    case 'picker':
      openVillagePicker(true)
      return true
    case 'next': {
      const next = selectNextAgentForN(village)
      if (next) focusVillageAgent(next)
      return true
    }
    default:
      return false
  }
}
