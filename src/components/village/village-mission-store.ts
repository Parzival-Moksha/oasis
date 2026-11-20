// ░▒▓ VILLAGE MISSION STORE — the missions the wall shows, which panel is within reach, the open reader ▓▒░
// One small external store (useSyncExternalStore). The list comes from GET /api/village/missions and
// is re-read every 30 s and when the window comes back, so a mission edited on disk shows up without F5.

import { carbonWallMissions, type CarbonMission } from '../../lib/village/carbon-missions'
import { findNearestStation, type Vec3 } from '../../lib/village/village-layout'
import { MISSION_READ_RADIUS, type Mission } from '../../lib/village/village-missions'
import { requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import { VILLAGE_TALK_HEIGHT } from './village-actions'

export const MISSION_REFRESH_MS = 30_000
export const VILLAGE_MISSION_LAYER = 'village-mission'

export type MissionReaderMode = 'side' | 'full'

export interface MissionStoreState {
  missions: Mission[]
  /** The panel within reach (its file), if no agent is nearer. */
  nearby: string | null
  reader: { file: string; mode: MissionReaderMode } | null
}

let state: MissionStoreState = { missions: [], nearby: null, reader: null }
const listeners = new Set<() => void>()

function set(patch: Partial<MissionStoreState>): void {
  state = { ...state, ...patch }
  listeners.forEach(listener => listener())
}

export function getMissionState(): MissionStoreState {
  return state
}

export function subscribeMissions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── the list ───────────────────────────────────────────────────────────────

let lastBody = ''
let inFlight: Promise<void> | null = null
/** The route refused (hosted, shared on the network): no point asking again. */
let refused = false

/** Re-read the folder. Nothing re-renders when nothing changed on disk. */
export function refreshMissions(): Promise<void> {
  if (inFlight) return inFlight
  if (refused) return Promise.resolve()
  inFlight = (async () => {
    try {
      // The wall shows the owner's missions (docs/questions); the agents' board is in Mindcraft's Silicon tab.
      const response = await fetch('/api/village/questions', { cache: 'no-store' })
      if (response.status === 403 || response.status === 404) refused = true
      if (!response.ok) return
      const body = await response.text()
      if (body === lastBody) return
      const data = JSON.parse(body) as { missions?: CarbonMission[] }
      if (!Array.isArray(data.missions)) return
      lastBody = body
      const missions = carbonWallMissions(data.missions)
      const reader = state.reader && missions.some(mission => mission.file === state.reader?.file) ? state.reader : null
      set({ missions, reader })
    } catch {
      // Offline or mid-reload: keep what we have, the next tick tries again.
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Poll while mounted: every 30 s, and right away when the window is looked at again. */
export function startMissionRefresh(): () => void {
  void refreshMissions()
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshMissions()
  }, MISSION_REFRESH_MS)
  const onBack = () => {
    if (document.visibilityState === 'visible') void refreshMissions()
  }
  window.addEventListener('focus', onBack)
  document.addEventListener('visibilitychange', onBack)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', onBack)
    document.removeEventListener('visibilitychange', onBack)
  }
}

// ─── panels in the world (VillageMissionWall writes, proximity reads) ───────

export interface MissionPanelPlacement {
  /** The panel's foot, terrain height included. */
  position: Vec3
  rotationY: number
}

let panels = new Map<string, MissionPanelPlacement>()

export function setMissionPanels(next: Map<string, MissionPanelPlacement>): void {
  panels = next
  if (state.nearby && !next.has(state.nearby)) set({ nearby: null })
}

/**
 * Called by the village's proximity tick with where the owner stands and how far the nearest agent
 * within reach is (null: none). True when a mission panel is nearer than that agent: the panel gets
 * the E / F keys and the prompt, the agent doesn't.
 */
export function updateMissionProximity(actor: Vec3 | null, agentDistance: number | null): boolean {
  let nearby: string | null = null
  if (actor && panels.size) {
    const anchors: Record<string, Vec3> = {}
    for (const [file, panel] of panels) anchors[file] = panel.position
    const file = findNearestStation(actor, anchors, MISSION_READ_RADIUS, VILLAGE_TALK_HEIGHT)
    if (file) {
      const at = anchors[file]
      const distance = Math.hypot(actor[0] - at[0], actor[2] - at[2])
      if (agentDistance === null || distance < agentDistance) nearby = file
    }
  }
  if (nearby !== state.nearby) set({ nearby })
  return nearby !== null
}

// ─── the reader ─────────────────────────────────────────────────────────────

export function openMissionReader(file: string, mode: MissionReaderMode): boolean {
  if (!state.missions.some(mission => mission.file === file)) return false
  set({ reader: { file, mode } })
  return true
}

export function closeMissionReader(): void {
  if (state.reader) set({ reader: null })
}

// ─── editing (the reader writes through the API, then re-reads) ─────────────

/** A text edit is open in the reader: Esc drops it first, then closes. */
let editing: (() => void) | null = null

export function setMissionEditing(cancel: (() => void) | null): void {
  editing = cancel
}

/** Esc: true when an edit was dropped instead of the reader closing. */
export function cancelMissionEditing(): boolean {
  if (!editing) return false
  const cancel = editing
  editing = null
  cancel()
  return true
}

async function write(method: 'PATCH' | 'POST' | 'PUT', body: unknown): Promise<{ ok: boolean; error?: string; file?: string }> {
  try {
    const response = await fetch('/api/village/missions', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({})) as { error?: string; file?: string }
    await refreshMissions()
    return response.ok ? { ok: true, file: data.file } : { ok: false, error: data.error || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface MissionPatch { state?: string; who?: string; doneWhen?: string; ease?: number; impact?: number; urgency?: number }

export const patchMission = (file: string, patch: MissionPatch, by = 'owner') => write('PATCH', { file, patch, by })
export const logMission = (file: string, text: string, who = 'owner') => write('POST', { file, text, who })
export const saveMissionText = (file: string, markdown: string, expected: string) => write('PUT', { file, markdown, expected })
export const createMission = (title: string, who = 'owner') => write('POST', { create: title, who })

export function toggleMissionReaderMode(): void {
  if (state.reader) set({ reader: { file: state.reader.file, mode: state.reader.mode === 'full' ? 'side' : 'full' } })
}

// Dev-only console helpers (playtests): window.__oasisMissions.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisMissions = {
    state: () => state,
    panels: () => Object.fromEntries([...panels].map(([file, panel]) => [file, panel.position.map(v => Number(v.toFixed(2)))])),
    refresh: () => refreshMissions(),
    /** Put the player avatar `meters` in front of a panel, facing it. */
    teleportNear: (file: string, meters = 1.4) => {
      const panel = panels.get(file)
      if (!panel) return false
      const forward: Vec3 = [Math.sin(panel.rotationY), 0, Math.cos(panel.rotationY)]
      const position: Vec3 = [panel.position[0] + forward[0] * meters, panel.position[1], panel.position[2] + forward[2] * meters]
      const yaw = panel.rotationY + Math.PI
      requestPlayerAvatarTeleport({ position, yaw, forward: [Math.sin(yaw), 0, Math.cos(yaw)] })
      return true
    },
    open: (file: string, mode: MissionReaderMode = 'side') => openMissionReader(file, mode),
    close: () => closeMissionReader(),
  }
}
