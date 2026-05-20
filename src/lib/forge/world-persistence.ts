// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD PERSISTENCE — Memory that outlasts the session AND the origin
// ─═̷─═̷─ॐ─═̷─═̷─ What the world remembers, forever ─═̷─═̷─ॐ─═̷─═̷─
//
// Current model: browser calls API routes and the server reads/writes SQLite rows.
// Full WorldState lives in prisma/data/oasis.db (World.data), while export/import
// still uses portable JSON files.
//
// Types are shared between client + server (world-server.ts re-exports).
// All functions are async (network boundary between browser & API).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { CraftedScene, CatalogPlacement, ObjectBehavior, WorldLight } from '../conjure/types'
import type { GroundPreset } from './ground-textures'
import type { TerrainParams } from './terrain-generator'
import type { PortalGate } from '../portal-gates'
import type { AgentWindow, AgentAvatar } from '../../store/oasisStore'
import type { WorldWriteDecision } from './world-access'
import type { SpatialWebObject } from '../spatial-web'
import type { PaintStroke } from './paint-stroke'
import type { Text3DObject } from './text-3d-object'

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
  /** Editable 101x101 ground heightmap for terrain brush relief. */
  terrainHeights?: number[]
  craftedScenes: CraftedScene[]
  /** IDs of conjured assets placed in this world (GLBs live server-side, but placement is per-world) */
  conjuredAssetIds: string[]
  /** Pre-made catalog assets placed in this world */
  catalogPlacements?: CatalogPlacement[]
  /** Persistent teleport gates placed in this world */
  portalGates?: PortalGate[]
  /** Spatial website primitives: buttons, sliders, selectors, text, and output panels */
  spatialWebObjects?: SpatialWebObject[]
  /** Transform overrides: objectId -> { position, rotation, scale } — all fields optional for partial overrides */
  transforms: Record<string, {
    position?: [number, number, number]
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
  /** 3D agent windows placed in the world (Claude Code / Merlin / DevCraft panels) */
  agentWindows?: AgentWindow[]
  /** Embodied agent avatars placed in the world */
  agentAvatars?: AgentAvatar[]
  /** Paint strokes — wizardry tubes/ribbons drawn in 3-space */
  paintStrokes?: PaintStroke[]
  /** 3D text objects — extruded shiny words placed in 3-space */
  text3dObjects?: Text3DObject[]
  savedAt: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORLD REGISTRY — The library of all worlds ever conjured
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorldMeta {
  id: string
  userId?: string
  name: string
  icon: string          // emoji icon for the world
  visibility: 'private' | 'public' | 'unlisted' | 'unlisted_edit' | 'public_edit' | 'only-with-link' | 'ffa' | 'core' | 'template'
  canWrite?: boolean
  canEditSettings?: boolean
  writeDecision?: WorldWriteDecision
  creatorName?: string
  creatorAvatar?: string
  creator_name?: string
  creator_avatar?: string
  ownerName?: string
  ownerAvatar?: string
  ownerLevel?: number
  ownerAura?: number
  objectCount?: number
  visitCount?: number
  createdAt: string
  lastSavedAt: string
  /** PvP enabled in this world (room reads this on join). */
  pvpEnabled?: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// API BASE — respects Next.js basePath (/oasis in prod)
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/worlds`
  : '/api/worlds'

// Legacy placeholder ID until the real world registry loads.
// initWorlds() replaces it with the first actual SQLite-backed world if needed.
const DEFAULT_WORLD_ID = 'forge-default'

interface ActiveWorldServerState {
  worldId: string
  mode: 'local' | 'hosted'
  source: 'stored' | 'welcome' | 'registry'
  authoritative: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE WORLD ID — still localStorage (per-browser preference, not world data)
// ═══════════════════════════════════════════════════════════════════════════════

export function getActiveWorldId(): string {
  if (typeof window === 'undefined') return DEFAULT_WORLD_ID
  return localStorage.getItem('oasis-active-world') || DEFAULT_WORLD_ID
}

export function setActiveWorldId(id: string, options: { publish?: boolean } = {}): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('oasis-active-world', id)
  // ─═̷─ Reflect the active world in the URL so refresh + share-link land
  // in the same place. history.replaceState avoids a Next router re-render
  // (which would re-mount Scene); pure URL-bar update. Only does this for
  // a real world id, not the empty/default sentinel. ─═̷─
  if (id && id !== DEFAULT_WORLD_ID && typeof window.history?.replaceState === 'function') {
    const expectedPath = `/w/${encodeURIComponent(id)}`
    if (window.location.pathname !== expectedPath) {
      try { window.history.replaceState({}, '', expectedPath + window.location.search + window.location.hash) } catch { /* noop */ }
    }
  }
  if (!options.publish || !id || id === DEFAULT_WORLD_ID || typeof fetch !== 'function') return
  try {
    const request = fetch(`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/world-active`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId: id }),
    })
    if (request && typeof request.catch === 'function') {
      void request.catch(() => {})
    }
  } catch {
    // Active-world publication is best-effort; localStorage remains the local source.
  }
}

export async function getServerActiveWorld(): Promise<ActiveWorldServerState | null> {
  if (typeof window === 'undefined') return null
  try {
    const res = await fetch(`${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/world-active`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    const json = await res.json() as Partial<ActiveWorldServerState> & { ok?: boolean }
    if (!json.ok || typeof json.worldId !== 'string') return null
    return {
      worldId: json.worldId,
      mode: json.mode === 'hosted' ? 'hosted' : 'local',
      source: json.source === 'welcome' || json.source === 'registry' ? json.source : 'stored',
      authoritative: Boolean(json.authoritative),
    }
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRY — fetch from server
// ═══════════════════════════════════════════════════════════════════════════════

export async function getWorldRegistry(): Promise<WorldMeta[]> {
  try {
    const res = await fetch(API_BASE, { cache: 'no-store' })
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

export async function setWorldVisibility(id: string, visibility: WorldMeta['visibility']): Promise<WorldMeta['visibility'] | null> {
  try {
    const res = await fetch(`${API_BASE}/${id}/visibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as { visibility?: WorldMeta['visibility'] }
    return json.visibility || visibility
  } catch (err) {
    console.error('[WorldPersistence] Failed to set visibility:', err)
    return null
  }
}

export async function createWorld(
  name: string,
  icon = '🌍',
  options: { visibility?: WorldMeta['visibility'] } = {},
): Promise<WorldMeta> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, icon }),
  })
  if (!res.ok) throw new Error(`Create world failed: HTTP ${res.status}`)
  const meta = await res.json() as WorldMeta
  if (options.visibility && options.visibility !== meta.visibility) {
    const visibility = await setWorldVisibility(meta.id, options.visibility)
    if (visibility) return { ...meta, visibility }
  }
  return meta
}

export async function deleteWorld(id: string): Promise<void> {
  if (id === DEFAULT_WORLD_ID) return
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) console.error(`[WorldPersistence] Delete failed: HTTP ${res.status}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAVE / LOAD — the heartbeat of world persistence
// ═══════════════════════════════════════════════════════════════════════════════

export interface SaveWorldResponse {
  ok?: boolean
  saved?: boolean
  worldId?: string
  forkedFromWorldId?: string
}

export async function saveWorld(state: Omit<WorldState, 'version' | 'savedAt'>, worldId?: string): Promise<SaveWorldResponse | null> {
  const id = worldId || getActiveWorldId()
  try {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail ? ` ${detail.slice(0, 500)}` : ''}`)
    }
    const result = typeof res.json === 'function'
      ? await res.json().catch(() => null) as SaveWorldResponse | null
      : null
    if (result?.forkedFromWorldId && result.worldId) {
      setActiveWorldId(result.worldId, { publish: true })
      // ─═̷─ Fork welcome — dedicated modal event picked up by
      // ForkWelcomeModal in Scene.tsx. The lobby was a read-only template;
      // first mutation forked it into the player's private oasis. The modal
      // is more prominent than the regular notice toast because visitors
      // need to UNDERSTAND why they suddenly left the lobby (and why other
      // visitors aren't there anymore). ─═̷─
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('oasis:fork-welcome', {
          detail: {
            forkedFromWorldId: result.forkedFromWorldId,
            newWorldId: result.worldId,
          },
        }))
      }
    }
    return result
  } catch (err) {
    console.error('[WorldPersistence] Failed to save:', err)
    return null
  }
}

export async function loadWorld(worldId?: string): Promise<WorldState | null> {
  const id = worldId || getActiveWorldId()
  try {
    const res = await fetch(`${API_BASE}/${id}`, { cache: 'no-store' })
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
    const res = await fetch(`${API_BASE}/${worldId}/public`, { cache: 'no-store' })
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
let pendingSaveState: Omit<WorldState, 'version' | 'savedAt'> | null = null

export function debouncedSaveWorld(state: Omit<WorldState, 'version' | 'savedAt'>, delayMs = 1000): void {
  if (saveTimer) clearTimeout(saveTimer)
  pendingSaveState = state
  saveTimer = setTimeout(() => {
    const stateToSave = pendingSaveState
    pendingSaveState = null
    saveTimer = null
    if (stateToSave) {
      saveWorld(stateToSave) // fire-and-forget async
    }
  }, delayMs)
}

export async function flushPendingSaveWorld(worldId?: string): Promise<SaveWorldResponse | null> {
  if (!pendingSaveState) return null
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const stateToSave = pendingSaveState
  pendingSaveState = null
  return saveWorld(stateToSave, worldId)
}

/** ░▒▓ Cancel any pending debounced save — MUST be called before world switch ▓▒░
 * Prevents stale saves from overwriting the new world's state (especially lights). */
export function cancelPendingSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pendingSaveState = null
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION — no-op now. Old file/localStorage world formats are legacy.
// Dev imports old worlds via console dump → importWorld().
// ═══════════════════════════════════════════════════════════════════════════════

export function migrateIfNeeded(): void {
  // v2: File-based persistence — no localStorage migration needed.
  // Active world ID still uses localStorage (browser preference).
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【P̸E̸R̸S̸I̸S̸T̸】▓▓▓▓
