// ░▒▓ VILLAGE ACTIONS — focus, camera hand-off and keys for engine agents ▓▒░
//
// Focusing an agent = slice focus + InputManager `agent-focus` + the village camera rig framing
// that agent next to the 2D session panel. Leaving focus (Esc, a canvas click, the close button)
// restores the exact camera pose from before, so third-person / orbit / noclip resume seamlessly.

import * as THREE from 'three'
import { useOasisStore } from '../../store/oasisStore'
import { useInputManager, type InputState } from '../../lib/input-manager'
import { selectNextAgentForN } from '../../store/slices/agentEngineSlice'
import { isStageWorldName } from '../../lib/village/village-stage'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { getPlayerAvatarPose, markThirdPersonCameraRestored, requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import { showNotice } from '../forge/GlobalNotice'
import { findNearestStation, stationLocalToWorld, type Vec3 } from '../../lib/village/village-layout'
import { villageKeyAction } from '../../lib/village/village-keys'
import { awayAgentWinsPrompt } from '../../lib/village/village-follow'
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

/**
 * Where everything stands (desks, agents away from them, helpers, the plaza, what else claims the keys), kept in
 * one record that outlives a hot reload. In development a reload of this file makes a new copy of the module
 * while timers and effects of the old copy can go on running (the proximity tick, a registration): with one
 * shared record both copies see the same places, so walking up to an agent still gives the T/E/F prompt after
 * a reload (the owner, 2026-11-17: "I go close to you and I don't have this little thing popping up").
 */
interface VillagePlaces {
  stations: Map<string, VillageStationPlacement>
  live: Map<string, VillageStationPlacement>
  avatars: Record<string, string>
  minis: Map<string, Array<VillageSubagentRef & { position: Vec3; local?: Vec3 }>>
  nearbyMini: VillageSubagentRef | null
  nearbyMiniListeners: Set<() => void>
  plaza: Vec3 | null
  inPlaza: boolean
  plazaListeners: Set<() => void>
  rival: ((actor: Vec3 | null, agentDistance: number | null) => boolean) | null
  rivals: Set<(actor: Vec3 | null, agentDistance: number | null) => boolean>
}

const places: VillagePlaces = (() => {
  const holder = globalThis as unknown as { __oasisVillagePlaces?: Partial<VillagePlaces> }
  const record = (holder.__oasisVillagePlaces ??= {})
  // Field by field: a record made by an older copy of this file may lack what a newer one added.
  record.stations ??= new Map()
  record.live ??= new Map()
  record.avatars ??= {}
  record.minis ??= new Map()
  record.nearbyMini ??= null
  record.nearbyMiniListeners ??= new Set()
  record.plaza ??= null
  record.inPlaza ??= false
  record.plazaListeners ??= new Set()
  record.rival ??= null
  record.rivals ??= new Set()
  return record as VillagePlaces
})()

export function setVillageStations(next: Map<string, VillageStationPlacement>): void {
  places.stations = next
}

/** Empties the desks, unless someone else registered theirs since `owner` (a remount registers before the old copy unmounts). */
export function clearVillageStations(owner: Map<string, VillageStationPlacement>): void {
  if (places.stations === owner) places.stations = new Map()
}

/**
 * Agents away from their desk (following the owner, village-follow.ts): where the avatar is right now,
 * as a station of its own (position and rotationY such that the station's avatar spot is the avatar).
 * VillageStation writes it every frame it moves, changing the same object in place.
 */
const liveStations = places.live

export function setVillageLiveStation(agentId: string, live: VillageStationPlacement | null): void {
  if (live) liveStations.set(agentId, live)
  else liveStations.delete(agentId)
}

/** Where the agent is: beside the owner when it follows, else its desk. Proximity, the camera and the eyes read this. */
export function getVillageStation(agentId: string): VillageStationPlacement | null {
  return liveStations.get(agentId) || places.stations.get(agentId) || null
}

/** The body each agent wears (VillageWorld writes it; the presence report to the engine reads it). */

export function setVillageAvatars(next: Record<string, string>): void {
  places.avatars = next
}

export function getVillageAvatar(agentId: string): string | null {
  return places.avatars[agentId] || null
}

/** The agent's desk, wherever the agent itself is. */
export function getVillageDesk(agentId: string): VillageStationPlacement | null {
  return places.stations.get(agentId) || null
}

export function getVillageAnchors(): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [id, station] of places.stations) out[id] = (liveStations.get(id) || station).anchor
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

/** World positions of every mini on screen, per parent agent (`local`: its place in the parent's station). */
const minis = places.minis
const nearbyMiniListeners = places.nearbyMiniListeners

export function setVillageMinis(agentId: string, next: Array<VillageSubagentRef & { position: Vec3; local?: Vec3 }> | null): void {
  if (next && next.length) minis.set(agentId, next)
  else minis.delete(agentId)
}

/** Every mini on screen, with its world position (dev helpers, tests). */
export function getVillageMiniList(): Array<VillageSubagentRef & { position: Vec3 }> {
  return [...minis.values()].flat().map(mini => ({ ...mini, position: miniPosition(mini) }))
}

/** A helper stands behind its parent: next to the owner too, when the parent follows them. */
function miniPosition(mini: VillageSubagentRef & { position: Vec3; local?: Vec3 }): Vec3 {
  const live = mini.local ? liveStations.get(mini.agentId) : null
  return live && mini.local ? stationLocalToWorld(live, mini.local) : mini.position
}

/** The helper within E's reach, if any (it wins E over its parent). */
export function getNearbyVillageMini(): VillageSubagentRef | null {
  return places.nearbyMini
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
        anchors[id] = miniPosition(mini)
        refs.set(id, mini)
      }
    }
    const id = findNearestStation(actor, anchors, VILLAGE_MINI_RADIUS, VILLAGE_TALK_HEIGHT)
    best = id ? refs.get(id) || null : null
  }
  const nearbyMini = places.nearbyMini
  if (best?.agentId === nearbyMini?.agentId && best?.key === nearbyMini?.key && best?.description === nearbyMini?.description) return
  places.nearbyMini = best
  nearbyMiniListeners.forEach(listener => listener())
}

/** Open the parent's panel on one helper's work (the panel offers "back" to the whole thread). */
export function focusVillageSubagent(agentId: string, key: string): boolean {
  if (!focusVillageAgent(agentId)) return false
  useOasisStore.getState().agentEngineDispatch({ type: 'subagent/focus', agentId, key })
  return true
}

// ─── plaza (the summoning circle; VillagePlaza writes, proximity + HUD read) ──

const plazaListeners = places.plazaListeners

export function setVillagePlaza(center: Vec3 | null): void {
  places.plaza = center
}

/** The plaza's centre in this world, when the village is mounted. */
export function getVillagePlaza(): Vec3 | null {
  return places.plaza
}

export function isInVillagePlaza(): boolean {
  return places.inPlaza
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
/** F next to an agent opened its screen straight from the world: one Esc goes all the way back out. */
let screenFromWorld = false
const screenListeners = new Set<() => void>()

export function getVillageScreen(): string | null {
  return screenAgentId
}

export function setVillageScreen(agentId: string | null): void {
  if (agentId === screenAgentId) return
  screenAgentId = agentId
  if (!agentId) screenFromWorld = false
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
  screenFromWorld = false // zoomed in from the side panel: Esc goes back to the panel
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

/** T opened this agent with the microphone on (asked a moment ago, not yet taken by its box). */
export function isVillageVoiceRequested(agentId: string): boolean {
  return Boolean(voiceRequest && voiceRequest.agentId === agentId && Date.now() - voiceRequest.at < VOICE_REQUEST_TTL_MS)
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
  /** A video plays in the same viewer (an agent sent it). */
  kind?: 'image' | 'video'
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
    stations: () => Object.fromEntries([...places.stations].map(([id, s]) => [id, s.anchor.map(v => Number(v.toFixed(2)))])),
    /** Put the player avatar `meters` (default 2.4) in front of an agent's desk, facing it (the "walk up" shortcut). */
    teleportNear: (agentId: string, meters = 2.4) => {
      const station = places.stations.get(agentId)
      if (!station) return false
      const forward: Vec3 = [Math.sin(station.rotationY), 0, Math.cos(station.rotationY)]
      const position: Vec3 = [station.anchor[0] + forward[0] * meters, station.anchor[1], station.anchor[2] + forward[2] * meters]
      const yaw = station.rotationY + Math.PI
      requestPlayerAvatarTeleport({ position, yaw, forward: [Math.sin(yaw), 0, Math.cos(yaw)] })
      return true
    },
    /** Put the player avatar in the middle of the summoning circle. */
    teleportToPlaza: () => {
      const plaza = places.plaza
      if (!plaza) return false
      requestPlayerAvatarTeleport({ position: plaza, yaw: 0, forward: [0, 0, 1] })
      return true
    },
    inPlaza: () => places.inPlaza,
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

export function setVillageProximityRival(rival: VillagePlaces['rival']): void {
  places.rival = rival
}

/** More things to walk up to (the Academy's skill tree): asked the same way, after the mission wall. */
type ProximityRival = (actor: Vec3 | null, agentDistance: number | null) => boolean
const moreProximityRivals = places.rivals

export function addVillageProximityRival(rival: ProximityRival): () => void {
  moreProximityRivals.add(rival)
  return () => { moreProximityRivals.delete(rival) }
}

export function updateVillageProximity(): void {
  const store = useOasisStore.getState()
  const actor = getVillageActorPosition()
  const anchors = getVillageAnchors()
  let nearby = findNearestStation(actor, anchors, VILLAGE_TALK_RADIUS, VILLAGE_TALK_HEIGHT)
  // An agent that walked up to the owner and stands close keeps the keys: the wall and the tree stay quiet
  // (as they do while an agent is open). Further off, whatever is nearer gets them, as before.
  const reached = nearby ? anchors[nearby] : null
  const reachedDistance = actor && reached ? Math.hypot(actor[0] - reached[0], actor[2] - reached[2]) : null
  const quiet = Boolean(store.agentEngine.focusedAgentId) || awayAgentWinsPrompt(Boolean(nearby && liveStations.has(nearby)), reachedDistance)
  const proximityRival = places.rival
  if (proximityRival) {
    const at = nearby ? anchors[nearby] : null
    const agentDistance = actor && at ? Math.hypot(actor[0] - at[0], actor[2] - at[2]) : null
    // While an agent is open the wall stays quiet.
    if (proximityRival(quiet ? null : actor, agentDistance)) nearby = null
  }
  if (moreProximityRivals.size) {
    const at = nearby ? anchors[nearby] : null
    const agentDistance = actor && at ? Math.hypot(actor[0] - at[0], actor[2] - at[2]) : null
    for (const rival of moreProximityRivals) {
      if (rival(quiet ? null : actor, agentDistance)) nearby = null
    }
  }
  if (nearby !== store.agentEngine.nearbyAgentId) store.agentEngineDispatch({ type: 'nearby', agentId: nearby })
  updateNearbyMini(actor)
  // An agent within reach wins the E key; otherwise standing in the circle makes E summon.
  const plaza = places.plaza
  const nextInPlaza = !nearby && Boolean(plaza && findNearestStation(actor, { plaza }, VILLAGE_PLAZA_RADIUS, VILLAGE_TALK_HEIGHT))
  if (nextInPlaza !== places.inPlaza) {
    places.inPlaza = nextInPlaza
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
function worldNameNow(): string | null {
  const state = useOasisStore.getState()
  const id = state.viewingWorldId || state.activeWorldId
  return state.worldRegistry.find(world => world.id === id)?.name ?? null
}

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
    inPlaza: places.inPlaza,
    agentCount: village.order.length,
  })
  // E next to a helper (a subagent mini) opens its work in the parent's panel; it wins over the parent.
  const mini = places.nearbyMini
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
      // Esc closes, it never stops the mic: voice typing goes on with the owner (the widget at the bottom left
      // shows it, with Send and Stop). T, the mic button or the widget stop it.
      if (!screenAgentId) return false // the input manager's Esc leaves the agent
      // Opened with F straight from the world: this Esc leaves the agent too (the input manager's, below).
      if (screenFromWorld) {
        setVillageScreen(null)
        return false
      }
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
      if (village.nearbyAgentId && focusVillageAgent(village.nearbyAgentId)) {
        setVillageScreen(village.nearbyAgentId)
        screenFromWorld = true
      }
      return true
    case 'picker':
      openVillagePicker(true)
      return true
    case 'next': {
      // On a stage (the Council's world) only the agents who are there have a place: N goes round them alone.
      const stage = isStageWorldName(worldNameNow())
      const next = selectNextAgentForN(stage ? { ...village, order: village.order.filter(id => places.stations.has(id)) } : village)
      if (next) focusVillageAgent(next)
      return true
    }
    default:
      return false
  }
}
