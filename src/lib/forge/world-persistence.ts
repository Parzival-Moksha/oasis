// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD PERSISTENCE — Memory that outlasts the session AND the origin
// ─═̷─═̷─ॐ─═̷─═̷─ What the world remembers, forever ─═̷─═̷─ॐ─═̷─═̷─
//
// v2: File-based, Minecraft-style. One JSON per world on disk.
// No more localStorage origin-lock. Worlds survive machine migrations.
// Browser calls API routes → server reads/writes data/worlds/*.json
//
// Types are shared between client + server (world-server.ts re-exports).
// All functions are async (network boundary between browser & fs).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { CraftedScene, CatalogPlacement, ObjectBehavior, WorldLight } from '../conjure/types'
import type { GroundPreset } from './ground-textures'
import type { TerrainParams } from './terrain-generator'

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD STATE — the serializable snapshot of everything in a single Forge world
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorldState {
  version: 1
  terrain: TerrainParams | null
  /** Ground texture preset ID ('none', 'grass', 'sand', etc.) — the base/default ground */
  groundPresetId?: string
  /** Sparse tile map: "x,z" → presetId. Painted tiles override the base ground. */
  groundTiles?: Record<string, string>
  craftedScenes: CraftedScene[]
  /** IDs of conjured assets placed in this world (GLBs live server-side, but placement is per-world) */
  conjuredAssetIds: string[]
  /** Pre-made catalog assets placed in this world */
  catalogPlacements?: CatalogPlacement[]
  /** Transform overrides: objectId -> { position, rotation, scale } */
  transforms: Record<string, {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number] | number
  }>
  /** Object behaviors: movement presets, animations, visibility, custom names */
  behaviors?: Record<string, ObjectBehavior>
  /** Placeable light sources — per-world, fully user-controlled */
  lights?: WorldLight[]
  /** Sky background preset ID — per-world (not global) */
  skyBackgroundId?: string
  /** User-generated ground presets (custom textures from Imagine) */
  customGroundPresets?: GroundPreset[]
  savedAt: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD REGISTRY — The library of all worlds ever conjured
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorldMeta {
  id: string
  name: string
  icon: string          // emoji icon for the world
  visibility: 'private' | 'public' | 'unlisted' | 'public_edit'
  createdAt: string
  lastSavedAt: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// API BASE — respects Next.js basePath (/oasis in prod)
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/worlds`
  : '/api/worlds'

const DEFAULT_WORLD_ID = 'forge-default'

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE WORLD ID — still localStorage (per-browser preference, not world data)
// ═══════════════════════════════════════════════════════════════════════════════

export function getActiveWorldId(): string {
  if (typeof window === 'undefined') return DEFAULT_WORLD_ID
  return localStorage.getItem('oasis-active-world') || DEFAULT_WORLD_ID
}

export function setActiveWorldId(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('oasis-active-world', id)
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY — fetch from server
// ═══════════════════════════════════════════════════════════════════════════════

export async function getWorldRegistry(): Promise<WorldMeta[]> {
  try {
    const res = await fetch(API_BASE)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as WorldMeta[]
  } catch (err) {
    console.error('[WorldPersistence] Failed to fetch registry:', err)
    return []
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE / DELETE
// ═══════════════════════════════════════════════════════════════════════════════

export async function createWorld(name: string, icon = '🌍'): Promise<WorldMeta> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icon }),
  })
  if (!res.ok) throw new Error(`Create world failed: HTTP ${res.status}`)
  return await res.json() as WorldMeta
}

export async function deleteWorld(id: string): Promise<void> {
  if (id === DEFAULT_WORLD_ID) return
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) console.error(`[WorldPersistence] Delete failed: HTTP ${res.status}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE / LOAD — the heartbeat of world persistence
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveWorld(state: Omit<WorldState, 'version' | 'savedAt'>, worldId?: string): Promise<void> {
  const id = worldId || getActiveWorldId()
  try {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    console.error('[WorldPersistence] Failed to save:', err)
  }
}

export async function loadWorld(worldId?: string): Promise<WorldState | null> {
  const id = worldId || getActiveWorldId()
  try {
    const res = await fetch(`${API_BASE}/${id}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json() as WorldState
  } catch (err) {
    console.error('[WorldPersistence] Failed to load:', err)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD PUBLIC — view someone else's public world (read-only, no auth required)
// ═══════════════════════════════════════════════════════════════════════════════

export interface PublicWorldResult {
  state: WorldState
  meta: WorldMeta & { creator_name?: string; creator_avatar?: string }
}

export async function loadPublicWorld(worldId: string): Promise<PublicWorldResult | null> {
  try {
    const res = await fetch(`${API_BASE}/${worldId}/public`)
    if (!res.ok) return null
    return await res.json() as PublicWorldResult
  } catch (err) {
    console.error('[WorldPersistence] Failed to load public world:', err)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT — world sharing (Minecraft save style)
// ═══════════════════════════════════════════════════════════════════════════════

export async function exportWorld(id: string): Promise<string | null> {
  const [state, registry] = await Promise.all([
    loadWorld(id),
    getWorldRegistry(),
  ])
  if (!state) return null
  const meta = registry.find(w => w.id === id)
  return JSON.stringify({ meta, state }, null, 2)
}

export async function importWorld(json: string): Promise<WorldMeta | null> {
  try {
    const data = JSON.parse(json) as { meta?: WorldMeta; state: WorldState }
    if (!data.state || data.state.version !== 1) return null

    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        import: true,
        meta: data.meta,
        state: data.state,
      }),
    })
    if (!res.ok) throw new Error(`Import failed: HTTP ${res.status}`)
    return await res.json() as WorldMeta
  } catch (err) {
    console.error('[WorldPersistence] Import failed:', err)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBOUNCED SAVE — same pattern, now fires async PUT
// ═══════════════════════════════════════════════════════════════════════════════

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function debouncedSaveWorld(state: Omit<WorldState, 'version' | 'savedAt'>, delayMs = 1000): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveWorld(state) // fire-and-forget async
    saveTimer = null
  }, delayMs)
}

/** ░▒▓ Cancel any pending debounced save — MUST be called before world switch ▓▒░
 * Prevents stale saves from overwriting the new world's state (especially lights). */
export function cancelPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION — no-op now. localStorage worlds are origin-locked ghosts.
// Dev imports old worlds via console dump → importWorld().
// ═══════════════════════════════════════════════════════════════════════════════

export function migrateIfNeeded(): void {
  // v2: File-based persistence — no localStorage migration needed.
  // Active world ID still uses localStorage (browser preference).
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【P̸E̸R̸S̸I̸S̸T̸】▓▓▓▓
