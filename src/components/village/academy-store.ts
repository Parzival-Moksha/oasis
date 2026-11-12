// ░▒▓ ACADEMY STORE — the skill tree's content, every trainee's progress, whose tree shows, the open node ▓▒░
// One small external store (useSyncExternalStore), like the mission wall's. Progress comes from
// GET /api/academy and is re-read every few seconds, so a skill Anorak verifies from his own session
// (a POST from his terminal) lights up on the tree without anyone touching the page.

import { useContext, useSyncExternalStore } from 'react'
import type { Vec3 } from '../../lib/village/village-layout'
import { villageAgentKey } from '../../lib/village/village-layout'
import {
  pickAcademyNode,
  type AcademyContent,
  type AcademySnapshot,
  type AcademyTraineeView,
  type AcademyUpdate,
} from '../../lib/village/village-academy'
import { getCameraSnapshot } from '../../lib/camera-bridge'
import { requestPlayerAvatarTeleport } from '../../lib/player-avatar-runtime'
import { useOasisStore } from '../../store/oasisStore'
import { SettingsContext } from '../scene-lib/contexts'

export const ACADEMY_REFRESH_MS = 2500
export const VILLAGE_ACADEMY_LAYER = 'village-academy'
const SELECTED_KEY = 'oasis-academy-trainee'

export interface AcademyStoreState {
  /** Skills, keys, levels: the same object until the content itself changes. */
  content: AcademyContent | null
  trainees: AcademyTraineeView[]
  /** Whose progress the tree shows (a trainee key), as last picked. */
  selected: string | null
  /** The node the owner looks at or stands by (a skill id). */
  nearby: string | null
  /** The node open in the reader. */
  reader: string | null
  /** Dev: switched off from the console (an A/B measurement in one page). */
  devOff: boolean
}

function storedSelection(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

let state: AcademyStoreState = { content: null, trainees: [], selected: storedSelection(), nearby: null, reader: null, devOff: false }
const listeners = new Set<() => void>()

function set(patch: Partial<AcademyStoreState>): void {
  state = { ...state, ...patch }
  listeners.forEach(listener => listener())
}

export function getAcademyState(): AcademyStoreState {
  return state
}

export function subscribeAcademy(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Config → Agents → Academy (on unless switched off). Off hides the tree and the stone look. */
export function useAcademyEnabled(): boolean {
  const { settings } = useContext(SettingsContext)
  const devOff = useSyncExternalStore(subscribeAcademy, () => state.devOff, () => false)
  return settings.villageAcademy !== false && !devOff
}

/** The trainee the tree shows: the one last picked, else the first one in training. */
export function selectedTrainee(current: AcademyStoreState = state): AcademyTraineeView | null {
  return current.trainees.find(trainee => trainee.key === current.selected)
    || current.trainees.find(trainee => trainee.training)
    || null
}

export function traineeByKey(key: string | null | undefined, current: AcademyStoreState = state): AcademyTraineeView | null {
  return key ? current.trainees.find(trainee => trainee.key === key) || null : null
}

export function selectAcademyTrainee(key: string | null): void {
  if (key === state.selected) return
  try {
    if (key) window.localStorage.setItem(SELECTED_KEY, key)
    else window.localStorage.removeItem(SELECTED_KEY)
  } catch { /* storage off */ }
  set({ selected: key })
}

// ─── the data ───────────────────────────────────────────────────────────────

let lastBody = ''
let lastContent = ''
let inFlight: Promise<void> | null = null
/** The route refused (hosted, shared on the network): no point asking again. */
let refused = false

function take(body: string): void {
  if (body === lastBody) {
    rekeyTrainees()
    return
  }
  const data = JSON.parse(body) as AcademySnapshot
  if (!Array.isArray(data.skills) || !Array.isArray(data.trainees)) return
  lastBody = body
  const contentText = JSON.stringify([data.skills, data.keys, data.levels, data.source])
  const content = contentText === lastContent && state.content ? state.content : { skills: data.skills, keys: data.keys, levels: data.levels, source: data.source }
  lastContent = contentText
  const reader = state.reader && content.skills.some(skill => skill.id === state.reader) ? state.reader : null
  set({ content, trainees: data.trainees, reader })
  rekeyTrainees()
}

export function refreshAcademy(): Promise<void> {
  if (inFlight) return inFlight
  if (refused) return Promise.resolve()
  inFlight = (async () => {
    try {
      const response = await fetch('/api/academy', { cache: 'no-store' })
      if (response.status === 403 || response.status === 404) refused = true
      if (!response.ok) return
      take(await response.text())
    } catch {
      // Offline or mid-reload: keep what we have, the next tick tries again.
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Poll while mounted: every few seconds, and right away when the window is looked at again. */
export function startAcademyRefresh(): () => void {
  void refreshAcademy()
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAcademy()
  }, ACADEMY_REFRESH_MS)
  const onBack = () => {
    if (document.visibilityState === 'visible') void refreshAcademy()
  }
  window.addEventListener('focus', onBack)
  document.addEventListener('visibilitychange', onBack)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', onBack)
    document.removeEventListener('visibilitychange', onBack)
  }
}

export async function postAcademy(update: AcademyUpdate): Promise<{ ok: boolean; error?: string; warning?: string }> {
  try {
    const response = await fetch('/api/academy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) })
    const data = await response.json().catch(() => ({})) as { error?: string; warning?: string }
    // A poll already on its way may have been answered before this write: wait for it, then read again.
    if (inFlight) await inFlight
    await refreshAcademy()
    return response.ok ? { ok: true, warning: data.warning } : { ok: false, error: data.error || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A trainee put in training before it had a session is kept under its agent id: move it once the session is known. */
const rekeyed = new Set<string>()
function rekeyTrainees(): void {
  const engine = useOasisStore.getState().agentEngine
  for (const id of engine.order) {
    const agent = engine.agents[id]
    if (!agent?.sessionId || agent.sessionId === agent.id || rekeyed.has(agent.id)) continue
    if (!state.trainees.some(trainee => trainee.key === agent.id)) continue
    rekeyed.add(agent.id)
    if (state.selected === agent.id) selectAcademyTrainee(agent.sessionId)
    const from = agent.id
    void postAcademy({ trainee: from, rekey: agent.sessionId }).then(result => { if (!result.ok) rekeyed.delete(from) })
  }
}

/** The trainee key of a village agent: its session, or its id until it has one. */
export function academyKeyOf(agent: { id: string; sessionId?: string | null }): string {
  return villageAgentKey(agent)
}

/** Put an agent in or out of training; in training, the tree turns to it. */
export async function setAgentTraining(agent: { id: string; name: string; sessionId?: string | null }, training: boolean): Promise<{ ok: boolean; error?: string }> {
  const key = academyKeyOf(agent)
  const result = await postAcademy({ trainee: key, name: agent.name, training })
  if (result.ok && training) selectAcademyTrainee(key)
  return result
}

// ─── nodes in the world (VillageAcademyTree writes, proximity reads) ────────

let nodes: Array<{ id: string; position: Vec3 }> = []
let treeFoot: { position: Vec3; rotationY: number } | null = null

export function setAcademyNodes(next: Array<{ id: string; position: Vec3 }>, foot: { position: Vec3; rotationY: number } | null): void {
  nodes = next
  treeFoot = foot
  if (state.nearby && !next.some(node => node.id === state.nearby)) set({ nearby: null })
}

/**
 * Called by the village's proximity tick with where the owner stands and how far the nearest agent
 * within reach is (null: none). True when a node is picked: the node gets the E key and the prompt.
 * A node under the crosshair wins over an agent standing by (Anorak walks beside the owner); a node
 * the owner merely stands at wins only when it is nearer than that agent.
 */
export function updateAcademyProximity(actor: Vec3 | null, agentDistance: number | null): boolean {
  let nearby: string | null = null
  if (actor && nodes.length) {
    const picked = pickAcademyNode({ actor, camera: getCameraSnapshot(), nodes })
    if (picked && (picked.looked || agentDistance === null || picked.distance < agentDistance)) nearby = picked.id
  }
  if (nearby !== state.nearby) set({ nearby })
  return nearby !== null
}

// ─── the reader ─────────────────────────────────────────────────────────────

export function openAcademyReader(skillId: string): boolean {
  if (!state.content?.skills.some(skill => skill.id === skillId)) return false
  set({ reader: skillId })
  return true
}

export function closeAcademyReader(): void {
  if (state.reader) set({ reader: null })
}

// Dev-only console helpers (playtests): window.__oasisAcademy.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisAcademy = {
    state: () => state,
    nodes: () => Object.fromEntries(nodes.map(node => [node.id, node.position.map(v => Number(v.toFixed(2)))])),
    foot: () => treeFoot,
    refresh: () => refreshAcademy(),
    /** Off and on again without touching the setting: `__oasisAcademy.setEnabled(false)`. */
    setEnabled: (on: boolean) => set({ devOff: !on }),
    select: (key: string | null) => selectAcademyTrainee(key),
    open: (skillId: string) => openAcademyReader(skillId),
    close: () => closeAcademyReader(),
    /** Stand `meters` in front of the tree, facing it. */
    teleportToTree: (meters = 6, side = 0) => {
      if (!treeFoot) return false
      const { position, rotationY } = treeFoot
      const forward: Vec3 = [Math.sin(rotationY), 0, Math.cos(rotationY)]
      const right: Vec3 = [Math.cos(rotationY), 0, -Math.sin(rotationY)]
      const at: Vec3 = [position[0] + forward[0] * meters + right[0] * side, position[1], position[2] + forward[2] * meters + right[2] * side]
      const yaw = rotationY + Math.PI
      requestPlayerAvatarTeleport({ position: at, yaw, forward: [Math.sin(yaw), 0, Math.cos(yaw)] })
      return true
    },
  }
}
