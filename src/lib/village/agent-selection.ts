// Selecting an agent, the effect that shows which one is selected, and sending it somewhere.
// Plain state and maths (no three.js, no React): the layer in AgentSelectionLayer.tsx draws it.
//
//   - One agent can be selected at a time. A click on an agent selects it; a click on the agent
//     that is already selected opens it (what a click did before).
//   - The selected agent wears one effect. Each agent has its own, dealt at random the first time
//     and changed in its settings menu. Only the selected agent's effect exists in the scene.
//   - A right-click on the ground sends the selected agent there. It stays until it is sent
//     somewhere else or back to its desk (following you, or coming to you, still wins).

export type SelectionFxId = 'diamond' | 'aura' | 'sparkle' | 'fire' | 'vortex' | 'shield'

export const SELECTION_FX: Array<{ id: SelectionFxId; label: string; blurb: string }> = [
  { id: 'diamond', label: 'Diamond', blurb: 'A crystal turning above its head.' },
  { id: 'aura', label: 'Aura', blurb: 'A soft column of light around it.' },
  { id: 'sparkle', label: 'Sparkle', blurb: 'Motes circling it.' },
  { id: 'fire', label: 'Fire', blurb: 'A ring of flames at its feet.' },
  { id: 'vortex', label: 'Vortex', blurb: 'A spiral rising around it.' },
  { id: 'shield', label: 'Golden shield', blurb: 'A shimmering golden shell.' },
]

export function isSelectionFx(value: unknown): value is SelectionFxId {
  return SELECTION_FX.some(fx => fx.id === value)
}

// ── which effect each agent wears ─────────────────────────────────────────────────────────────

const FX_KEY = 'oasis.village.selectionFx.v1'
type FxPrefs = Record<string, SelectionFxId>

export function sanitizeFxPrefs(raw: unknown): FxPrefs {
  const out: FxPrefs = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key && isSelectionFx(value)) out[key] = value
  }
  return out
}

/** A new agent's effect: one of those the fewest agents already wear, picked at random among them. */
export function dealSelectionFx(prefs: FxPrefs, random: () => number = Math.random): SelectionFxId {
  const counts = new Map<SelectionFxId, number>(SELECTION_FX.map(fx => [fx.id, 0]))
  for (const fx of Object.values(prefs)) counts.set(fx, (counts.get(fx) ?? 0) + 1)
  const least = Math.min(...counts.values())
  const pool = SELECTION_FX.filter(fx => counts.get(fx.id) === least)
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id
}

let fxPrefs: FxPrefs | null = null
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version += 1
  listeners.forEach(fn => fn())
}

export function subscribeAgentSelection(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getAgentSelectionVersion(): number {
  return version
}

function loadFxPrefs(): FxPrefs {
  if (fxPrefs) return fxPrefs
  try { fxPrefs = sanitizeFxPrefs(JSON.parse(window.localStorage.getItem(FX_KEY) || '{}')) } catch { fxPrefs = {} }
  return fxPrefs
}

function saveFxPrefs(next: FxPrefs, announce: boolean) {
  fxPrefs = next
  try { window.localStorage.setItem(FX_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  if (announce) emit()
}

/** The effect this agent wears. The first time it is asked for, one is dealt and remembered. */
export function getAgentSelectionFx(agentKey: string): SelectionFxId {
  if (typeof window === 'undefined') return 'diamond'
  const prefs = loadFxPrefs()
  const have = prefs[agentKey]
  if (have) return have
  const dealt = dealSelectionFx(prefs)
  saveFxPrefs({ ...prefs, [agentKey]: dealt }, false)
  return dealt
}

export function setAgentSelectionFx(agentKey: string, fx: SelectionFxId): void {
  saveFxPrefs({ ...loadFxPrefs(), [agentKey]: fx }, true)
}

// ── who is selected ───────────────────────────────────────────────────────────────────────────

let selectedAgentId: string | null = null

export function getSelectedVillageAgent(): string | null {
  return selectedAgentId
}

export function selectVillageAgent(agentId: string | null): void {
  if (selectedAgentId === agentId) return
  selectedAgentId = agentId
  emit()
}

/**
 * A click on an agent's body or desk. Returns true when the agent was already selected: the caller
 * then opens it, as a click always did. The first click only selects.
 */
export function clickVillageAgent(agentId: string): boolean {
  if (selectedAgentId === agentId) return true
  selectVillageAgent(agentId)
  return false
}

// ── where an agent was sent ───────────────────────────────────────────────────────────────────

/** Same shape as a Council mark, so the station's "stand where the scene puts you" walk carries it. */
export interface SentGoal {
  x: number
  z: number
  faceX: number
  faceZ: number
  calm: boolean
  seq: number
}

const sentGoals = new Map<string, SentGoal>()
/** Far above any Council sequence number, so the two never look like the same mark. */
let sentSeq = 1_000_000

export function getSentGoal(agentId: string): SentGoal | null {
  return sentGoals.get(agentId) ?? null
}

/** 0 when the agent was not sent anywhere; otherwise a number that changes with every order. */
export function getSentGoalSeq(agentId: string): number {
  return sentGoals.get(agentId)?.seq ?? 0
}

/**
 * Send an agent to a point on the ground. It ends up looking the way it walked: `fromX`, `fromZ`
 * is where it stands now.
 */
export function sendVillageAgentTo(agentId: string, x: number, z: number, fromX: number, fromZ: number): SentGoal | null {
  if (!Number.isFinite(x + z + fromX + fromZ)) return null
  let dx = x - fromX
  let dz = z - fromZ
  const length = Math.hypot(dx, dz)
  if (length < 1e-3) { dx = 0; dz = 1 } else { dx /= length; dz /= length }
  sentSeq += 1
  const goal: SentGoal = { x, z, faceX: x + dx * 4, faceZ: z + dz * 4, calm: false, seq: sentSeq }
  sentGoals.set(agentId, goal)
  emit()
  return goal
}

/** Back to its desk. */
export function clearSentGoal(agentId: string): void {
  if (sentGoals.delete(agentId)) emit()
}

/** Another world: nobody keeps an order that was given for the last one. */
export function clearAllSentGoals(): void {
  if (sentGoals.size === 0) return
  sentGoals.clear()
  emit()
}

// ── the ground under a right-click ────────────────────────────────────────────────────────────

export interface Ray { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** Where a ray meets the horizontal plane at `planeY`, or null (looking up, or too far to be meant). */
export function groundPoint(ray: Ray, planeY: number, maxDistance = 120): { x: number; z: number } | null {
  if (!(ray.dy < -1e-4)) return null
  const t = (planeY - ray.oy) / ray.dy
  if (!(t > 0) || t > maxDistance) return null
  return { x: ray.ox + ray.dx * t, z: ray.oz + ray.dz * t }
}

/**
 * The point on uneven ground: start from the plane at a known height, then correct twice with the
 * ground's own height where the ray landed.
 */
export function groundPointOnTerrain(ray: Ray, startY: number, heightAt: (x: number, z: number) => number, maxDistance = 120): { x: number; y: number; z: number } | null {
  let y = startY
  let hit = groundPoint(ray, y, maxDistance)
  if (!hit) return null
  for (let i = 0; i < 2; i++) {
    const ground = heightAt(hit.x, hit.z)
    if (!Number.isFinite(ground)) break
    y = ground
    const next = groundPoint(ray, y, maxDistance)
    if (!next) break
    hit = next
  }
  return { x: hit.x, y, z: hit.z }
}

/** A right-click, not the start of a right-drag (the orbit camera pans with it). */
export function isRightClick(heldMs: number, movedPx: number): boolean {
  return heldMs <= 350 && movedPx <= 6
}
