// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS MCP TOOLS — The 35-tool arsenal for world-aware agents
// ─═̷─═̷─ॐ─═̷─═̷─ Any agent can see, build, and navigate ─═̷─═̷─ॐ─═̷─═̷─
//
// Pure functions: take args, return results. No HTTP coupling.
// Used by: /api/oasis-tools (REST), tools/oasis-mcp (stdio), Merlin route.
//
// SERVER-ONLY — never import from client code.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import 'server-only'

import { prisma } from '../db'
import { ASSET_CATALOG } from '@/components/scene-lib/constants'
import type { WorldState } from '../forge/world-persistence'
import type { CatalogPlacement, CraftedScene, WorldLight } from '../conjure/types'
import type { ConjuredAsset, PostProcessAction, ProviderName } from '../conjure/types'
import { getAllAssets, getAssetById, updateAsset } from '../conjure/registry'
import { emitWorldEvent } from './world-events'
import { readWorldPlayerContext } from '../world-runtime-context'
import { resolveAgentAvatarUrl } from '../agent-avatar-catalog'
import { readBrowserActiveWorldId } from '../browser-active-world'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG_MAP = new Map(ASSET_CATALOG.map(a => [a.id, a]))
const INTERNAL_OASIS_BASE_URL = process.env.OASIS_URL || 'http://127.0.0.1:4516'
// Inherit userId from env so MCP-created worlds match the browser's userId filter.
// Falls back to 'local-user' for fresh installs without ADMIN_USER_ID.
const LOCAL_USER_ID = process.env.ADMIN_USER_ID || 'local-user'

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function parseVec3Like(v: unknown): [number, number, number] | null {
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = v.map(Number)
    if ([x, y, z].some(n => !Number.isFinite(n))) return null
    return [x, y, z]
  }

  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed) && parsed.length >= 3) {
      const [x, y, z] = parsed.map(Number)
      if ([x, y, z].some(n => !Number.isFinite(n))) return null
      return [x, y, z]
    }
  } catch {
    // Fall through to scalar parsing.
  }

  const parts = trimmed
    .replace(/^[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]$/, '')
    .split(/[,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length < 3) return null
  const [x, y, z] = parts.slice(0, 3).map(Number)
  if ([x, y, z].some(n => !Number.isFinite(n))) return null
  return [x, y, z]
}

function validPos(v: unknown): [number, number, number] | null {
  return parseVec3Like(v)
}

function validStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function validNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function validBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const trimmed = v.trim().toLowerCase()
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false
  }
  return fallback
}

function parseLooseObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
  }

  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      : []
  } catch {
    return []
  }
}

function mutationActorData(args: Record<string, unknown>): Record<string, unknown> {
  const actorAgentType = validStr(args.actorAgentType || args.agentType || args.agent, '').toLowerCase()
  return actorAgentType ? { actorAgentType } : {}
}

const AVATAR_ANIMATION_ALIASES: Record<string, string> = {
  dance: 'ual-dance',
  dancing: 'ual-dance',
  talk: 'ual-talking',
  talking: 'ual-talking',
  speak: 'ual-talking',
  speaking: 'ual-talking',
  yes: 'ual-yes',
  no: 'ual-no',
  idle: 'ual-idle',
  conjure: 'ual-spell-idle',
  spell: 'ual-spell-idle',
}

function normalizeAnimationLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/^lib:/, '')
}

async function loadAvatarAnimationCatalog() {
  const { ANIMATION_LIBRARY } = await import('../forge/animation-library')
  return ANIMATION_LIBRARY
}

async function resolveAvatarAnimation(requestedClip: string) {
  const library = await loadAvatarAnimationCatalog()
  const normalized = normalizeAnimationLookupKey(requestedClip)
  const aliased = AVATAR_ANIMATION_ALIASES[normalized] || normalized
  const exact = library.find(entry => entry.id === aliased)
  const suggestions = library
    .filter(entry =>
      entry.id.includes(aliased) ||
      entry.label.toLowerCase().includes(aliased) ||
      entry.category.toLowerCase().includes(aliased)
    )
    .slice(0, 8)
    .map(entry => entry.id)

  return {
    library,
    exact,
    normalized,
    suggestions,
  }
}

function normalizeState(state: WorldState): WorldState {
  // Defensive: old worlds may lack fields added later
  state.transforms = state.transforms || {}
  state.behaviors = state.behaviors || {}
  state.catalogPlacements = state.catalogPlacements || []
  state.agentAvatars = state.agentAvatars || []
  state.craftedScenes = state.craftedScenes || []
  state.conjuredAssetIds = state.conjuredAssetIds || []
  state.lights = state.lights || []
  state.groundTiles = state.groundTiles || {}
  return state
}

type AgentAvatarEntry = NonNullable<WorldState['agentAvatars']>[number]
const SHARED_AGENT_AVATAR_TYPES = new Set(['anorak-pro', 'merlin', 'hermes'])

function resolveAgentAvatarTarget(
  state: WorldState,
  args: Record<string, unknown>,
  fallbackAgentType = '',
): {
  agentType: string
  avatarId: string
  linkedWindowId: string
  existing: AgentAvatarEntry | null
} {
  const requestedAvatarId = validStr(args.avatarId, '')
  const linkedWindowId = validStr(args.linkedWindowId, '')
  const agentType = validStr(args.agentType || args.agent, fallbackAgentType).toLowerCase()

  let avatarId = requestedAvatarId
  let existing = requestedAvatarId
    ? (state.agentAvatars || []).find(avatar => avatar.id === requestedAvatarId) || null
    : null

  if (!existing && linkedWindowId) {
    existing = (state.agentAvatars || []).find(avatar => avatar.linkedWindowId === linkedWindowId) || null
    avatarId = existing?.id || `agent-avatar-${linkedWindowId}`
  }

  if (!existing && agentType) {
    existing = (state.agentAvatars || []).find(avatar => avatar.agentType === agentType) || null
    if (existing) {
      avatarId = existing.id
    } else if (!avatarId && SHARED_AGENT_AVATAR_TYPES.has(agentType)) {
      avatarId = `agent-avatar-${agentType}`
    }
  }

  if (!existing && !avatarId && agentType) {
    avatarId = `agent-avatar-${agentType}-${uid()}`
  }

  return { agentType, avatarId, linkedWindowId, existing }
}

// Simple per-world mutex to prevent concurrent read-modify-write races
const worldLocks = new Map<string, Promise<void>>()

async function withWorldLock<T>(worldId: string, fn: () => Promise<T>): Promise<T> {
  const existing = worldLocks.get(worldId) || Promise.resolve()
  let release: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  worldLocks.set(worldId, next)
  await existing
  try {
    return await fn()
  } finally {
    release!()
    if (worldLocks.get(worldId) === next) worldLocks.delete(worldId)
  }
}

async function loadActiveWorld(): Promise<{ worldId: string; state: WorldState }> {
  const preferredWorldId = await readBrowserActiveWorldId()
  if (preferredWorldId) {
    const preferredWorld = await prisma.world.findFirst({
      where: { id: preferredWorldId },
      select: { id: true, data: true },
    })
    if (preferredWorld?.data) {
      return { worldId: preferredWorld.id, state: normalizeState(JSON.parse(preferredWorld.data) as WorldState) }
    }
  }

  // Fallback: find most recently updated world for local-user
  const world = await prisma.world.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, data: true },
  })
  if (!world?.data) {
    throw new Error('No world found. Create one first.')
  }
  return { worldId: world.id, state: normalizeState(JSON.parse(world.data) as WorldState) }
}

async function loadRequestedWorld(worldIdLike: unknown): Promise<{ worldId: string; state: WorldState }> {
  const worldId = validStr(worldIdLike, '')
  if (!worldId) return loadActiveWorld()
  return { worldId, state: await loadWorldById(worldId) }
}

async function loadWorldById(worldId: string): Promise<WorldState> {
  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { data: true },
  })
  if (!world?.data) throw new Error(`World ${worldId} not found.`)
  return normalizeState(JSON.parse(world.data) as WorldState)
}

async function saveWorldState(worldId: string, state: WorldState): Promise<void> {
  state.savedAt = new Date().toISOString()
  await prisma.world.update({
    where: { id: worldId },
    data: { data: JSON.stringify(state), updatedAt: new Date() },
  })
}

async function upsertCraftedSceneInWorld(
  worldId: string,
  scene: CraftedScene,
  args: Record<string, unknown>,
  eventType: 'scene_craft_progress' | 'scene_crafted',
) {
  return withWorldLock(worldId, async () => {
    const state = await loadWorldById(worldId)
    state.craftedScenes = [
      ...(state.craftedScenes || []).filter(entry => entry.id !== scene.id),
      scene,
    ]
    if (scene.position.some(value => value !== 0)) {
      state.transforms[scene.id] = { position: scene.position }
    }
    await saveWorldState(worldId, state)
    emitWorldEvent(eventType, worldId, {
      id: scene.id,
      name: scene.name,
      position: scene.position,
      scene,
      transform: state.transforms[scene.id],
      ...mutationActorData(args),
    })
    return state.transforms[scene.id]
  })
}

async function removeCraftedSceneFromWorld(worldId: string, sceneId: string, args: Record<string, unknown>) {
  await withWorldLock(worldId, async () => {
    const state = await loadWorldById(worldId)
    state.craftedScenes = (state.craftedScenes || []).filter(entry => entry.id !== sceneId)
    if (state.transforms?.[sceneId]) {
      delete state.transforms[sceneId]
    }
    await saveWorldState(worldId, state)
    emitWorldEvent('object_removed', worldId, {
      objectId: sceneId,
      ...mutationActorData(args),
    })
  })
}

function cloneConjuredAsset(asset: ConjuredAsset | undefined | null): ConjuredAsset | null {
  return asset ? structuredClone(asset) as ConjuredAsset : null
}

function readWorldTransform(
  state: WorldState,
  objectId: string,
): {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
} | null {
  const transform = state.transforms?.[objectId]
  if (!transform || !Array.isArray(transform.position) || transform.position.length < 3) return null
  return structuredClone(transform) as { position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }
}

function summarizeWorldConjuredAsset(state: WorldState, assetId: string) {
  const asset = cloneConjuredAsset(getAssetById(assetId))
  const transform = readWorldTransform(state, assetId)
  return {
    id: assetId,
    displayName: asset?.displayName || null,
    prompt: asset?.prompt || null,
    provider: asset?.provider || null,
    tier: asset?.tier || null,
    status: asset?.status || null,
    glbPath: asset?.glbPath || null,
    thumbnailUrl: asset?.thumbnailUrl || null,
    position: transform?.position || asset?.position || null,
    rotation: transform?.rotation || asset?.rotation || null,
    scale: transform?.scale ?? asset?.scale ?? null,
  }
}

function resolveConjuredPlacement(
  args: Record<string, unknown>,
  fallback?: {
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number] | number
  },
) {
  const position = validPos(args.position) || fallback?.position || [0, 0, 0]
  const rotation = validPos(args.rotation) || fallback?.rotation || [0, 0, 0]
  const scaleCandidate = args.scale
  let scale: [number, number, number] | number = fallback?.scale ?? 1
  if (typeof scaleCandidate === 'number' || typeof scaleCandidate === 'string') {
    scale = validNum(scaleCandidate, typeof fallback?.scale === 'number' ? fallback.scale : 1)
  } else if (Array.isArray(scaleCandidate) && scaleCandidate.length >= 3) {
    const parsed = scaleCandidate.slice(0, 3).map(Number)
    if (parsed.every(Number.isFinite)) scale = [parsed[0], parsed[1], parsed[2]]
  }
  return { position, rotation, scale }
}

async function callInternalJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${INTERNAL_OASIS_BASE_URL}${path}`, init)
  const data = await response.json().catch(() => null) as T | { error?: string } | null
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  if (data == null) throw new Error(`Empty response from ${path}`)
  return data as T
}

async function placeConjuredAssetInWorld(
  worldIdLike: unknown,
  assetId: string,
  placement: {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number] | number
  },
) {
  const { worldId, state } = await loadRequestedWorld(worldIdLike)
  state.conjuredAssetIds = state.conjuredAssetIds || []
  if (!state.conjuredAssetIds.includes(assetId)) {
    state.conjuredAssetIds = [...state.conjuredAssetIds, assetId]
  }
  state.transforms = {
    ...state.transforms,
    [assetId]: {
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
    },
  }
  await saveWorldState(worldId, state)
  updateAsset(assetId, {
    position: placement.position,
    rotation: placement.rotation,
    scale: typeof placement.scale === 'number'
      ? placement.scale
      : Number(placement.scale[0]) || 1,
  })
  return { worldId, state, transform: state.transforms[assetId] }
}

async function removeConjuredAssetFromWorld(
  worldIdLike: unknown,
  assetId: string,
) {
  const { worldId, state } = await loadRequestedWorld(worldIdLike)
  state.conjuredAssetIds = (state.conjuredAssetIds || []).filter(id => id !== assetId)
  if (state.transforms?.[assetId]) {
    const { [assetId]: _removedTransform, ...remainingTransforms } = state.transforms
    state.transforms = remainingTransforms
  }
  if (state.behaviors?.[assetId]) {
    const { [assetId]: _removedBehavior, ...remainingBehaviors } = state.behaviors
    state.behaviors = remainingBehaviors
  }
  await saveWorldState(worldId, state)
  return { worldId, state }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolResult {
  ok: boolean
  message: string
  data?: unknown
}

type CraftJobStatus = 'queued' | 'running' | 'completed' | 'failed'

interface CraftJobRecord {
  id: string
  status: CraftJobStatus
  worldId: string
  sceneId: string
  prompt: string
  model: string
  name: string
  objectCount: number
  startedAt: string
  updatedAt: string
  error?: string
}

function getCraftJobStore() {
  const globalState = globalThis as typeof globalThis & {
    __oasisCraftJobs?: Map<string, CraftJobRecord>
  }
  if (!globalState.__oasisCraftJobs) {
    globalState.__oasisCraftJobs = new Map()
  }
  return globalState.__oasisCraftJobs
}

function writeCraftJob(job: CraftJobRecord) {
  getCraftJobStore().set(job.id, job)
  return job
}

function readCraftJob(jobId: string): CraftJobRecord | null {
  return getCraftJobStore().get(jobId) || null
}

function updateCraftJob(jobId: string, updater: (current: CraftJobRecord) => CraftJobRecord) {
  const current = readCraftJob(jobId)
  if (!current) return null
  const next = updater(current)
  getCraftJobStore().set(jobId, next)
  return next
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY — name → handler
// ═══════════════════════════════════════════════════════════════════════════

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

const tools: Record<string, ToolHandler> = {}

// ─═̷─═̷─ WORLD QUERY ─═̷─═̷─

tools.get_world_state = async (args) => {
  const worldId = validStr(args.worldId, '')
  const { state, worldId: resolvedId } = worldId
    ? { state: await loadWorldById(worldId), worldId }
    : await loadActiveWorld()
  const livePlayerContext = await readWorldPlayerContext(resolvedId)

  return {
    ok: true,
    message: `World ${resolvedId} loaded.`,
    data: {
      worldId: resolvedId,
      sky: state.skyBackgroundId || 'night007',
      ground: state.groundPresetId || 'none',
      tileCount: Object.keys(state.groundTiles || {}).length,
      catalogObjects: (state.catalogPlacements || []).map(p => ({
        id: p.id, catalogId: p.catalogId, name: p.name, position: p.position, rotation: p.rotation, scale: p.scale,
      })),
      craftedScenes: (state.craftedScenes || []).map(s => ({
        id: s.id, name: s.name, objectCount: s.objects?.length || 0, position: s.position,
      })),
      lights: (state.lights || []).map(l => ({
        id: l.id, type: l.type, color: l.color, intensity: l.intensity, position: l.position, visible: l.visible,
      })),
      agentAvatars: (state.agentAvatars || []).map(a => ({
        id: a.id,
        agentType: a.agentType,
        label: a.label,
        avatar3dUrl: a.avatar3dUrl,
        position: a.position,
        rotation: a.rotation,
        scale: a.scale,
        linkedWindowId: a.linkedWindowId,
      })),
      livePlayerAvatar: livePlayerContext?.player.avatar || null,
      livePlayerCamera: livePlayerContext?.player.camera || null,
      livePlayerUpdatedAt: livePlayerContext?.updatedAt || null,
      conjuredAssetCount: (state.conjuredAssetIds || []).length,
      conjuredAssets: (state.conjuredAssetIds || []).map(assetId => summarizeWorldConjuredAsset(state, assetId)),
      behaviors: state.behaviors || {},
    },
  }
}

tools.get_world_info = async (args) => {
  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const world = await prisma.world.findFirst({ where: { id: worldId } })
  if (!world) return { ok: false, message: 'No world found.' }
  const objectCount = state
    ? (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) + (state.conjuredAssetIds?.length || 0)
    : 0

  return {
    ok: true,
    message: `World "${world.name}"`,
    data: {
      worldId: world.id,
      name: world.name,
      icon: world.icon,
      objectCount,
      sky: state?.skyBackgroundId || 'night007',
      ground: state?.groundPresetId || 'none',
      tileCount: state ? Object.keys(state.groundTiles || {}).length : 0,
      lightCount: state?.lights?.length || 0,
      lastSaved: world.updatedAt.toISOString(),
    },
  }
}

tools.query_objects = async (args) => {
  const { state, worldId } = await loadRequestedWorld(args.worldId)
  const query = validStr(args.query, '').toLowerCase()
  const near = validPos(args.near)
  const radius = validNum(args.radius, 20)
  const typeFilter = validStr(args.type, '')

  type ObjEntry = { id: string; type: string; name: string; position?: unknown; catalogId?: string }
  const results: ObjEntry[] = []

  if (!typeFilter || typeFilter === 'catalog') {
    for (const p of state.catalogPlacements || []) {
      results.push({ id: p.id, type: 'catalog', name: p.name || p.catalogId, position: p.position, catalogId: p.catalogId })
    }
  }
  if (!typeFilter || typeFilter === 'crafted') {
    for (const s of state.craftedScenes || []) {
      results.push({ id: s.id, type: 'crafted', name: s.name, position: s.position })
    }
  }
  if (!typeFilter || typeFilter === 'light') {
    for (const l of state.lights || []) {
      results.push({ id: l.id, type: 'light', name: `${l.type} light`, position: l.position })
    }
  }
  if (!typeFilter || typeFilter === 'conjured') {
    for (const assetId of state.conjuredAssetIds || []) {
      const asset = getAssetById(assetId)
      const position = state.transforms?.[assetId]?.position || asset?.position
      results.push({
        id: assetId,
        type: 'conjured',
        name: asset?.displayName || asset?.prompt || assetId,
        position,
      })
    }
  }
  if (!typeFilter || typeFilter === 'agent-avatar') {
    for (const avatar of state.agentAvatars || []) {
      results.push({ id: avatar.id, type: 'agent-avatar', name: avatar.label || avatar.agentType, position: avatar.position })
    }
  }

  let filtered = results
  if (query) {
    filtered = filtered.filter(o =>
      o.name?.toLowerCase().includes(query) ||
      o.id?.toLowerCase().includes(query) ||
      o.catalogId?.toLowerCase().includes(query)
    )
  }
  if (near) {
    filtered = filtered.filter(o => {
      const pos = validPos(o.position)
      if (!pos) return true
      const d = Math.sqrt((pos[0] - near[0]) ** 2 + (pos[1] - near[1]) ** 2 + (pos[2] - near[2]) ** 2)
      return d <= radius
    })
  }

  return { ok: true, message: `Found ${filtered.length} objects in world ${worldId}.`, data: filtered }
}

tools.search_assets = async (args) => {
  const query = validStr(args.query, '').toLowerCase()
  const category = validStr(args.category, '')
  const limit = Math.min(validNum(args.limit, 20), 50)

  let results = ASSET_CATALOG.map(a => ({ id: a.id, name: a.name, category: a.category || 'misc', defaultScale: a.defaultScale }))
  if (category) results = results.filter(a => a.category.toLowerCase() === category.toLowerCase())
  if (query) {
    results = results.filter(a =>
      a.id.toLowerCase().includes(query) ||
      a.name.toLowerCase().includes(query) ||
      a.category.toLowerCase().includes(query)
    )
  }

  return { ok: true, message: `Found ${results.length} assets.`, data: results.slice(0, limit) }
}

tools.get_asset_catalog = async (args) => {
  const category = validStr(args.category, '')
  const byCategory: Record<string, Array<{ id: string; name: string; defaultScale?: number }>> = {}
  for (const a of ASSET_CATALOG) {
    const cat = a.category || 'misc'
    if (category && cat.toLowerCase() !== category.toLowerCase()) continue
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push({ id: a.id, name: a.name, defaultScale: a.defaultScale })
  }
  return { ok: true, message: `${ASSET_CATALOG.length} assets in catalog.`, data: byCategory }
}

// ─═̷─═̷─ WORLD BUILD ─═̷─═̷─

tools.place_object = async (args) => {
  const catalogId = validStr(args.assetId || args.catalogId, '')
  const asset = CATALOG_MAP.get(catalogId)
  if (!asset) return { ok: false, message: `Unknown asset: ${catalogId}. Use search_assets to find valid IDs.` }

  const position = validPos(args.position) || [0, 0, 0]
  const rotation = validPos(args.rotation) || [0, 0, 0]
  const scale = validNum(args.scale, asset.defaultScale || 1)
  const label = validStr(args.label, asset.name)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `catalog-${catalogId}-${uid()}`

  const placement: CatalogPlacement = {
    id, catalogId, name: label, glbPath: asset.path,
    position, rotation, scale,
  }

  state.catalogPlacements = [...(state.catalogPlacements || []), placement]
  await saveWorldState(worldId, state)
  emitWorldEvent('object_added', worldId, {
    id,
    catalogId,
    position,
    placement,
    ...mutationActorData(args),
  })

  return { ok: true, message: `Placed ${asset.name} (${catalogId}) at [${position.join(', ')}] as ${id}`, data: { id, catalogId, position } }
}

function normalizeCraftModel(value: unknown): string {
  const requested = validStr(value, '').toLowerCase()
  if (!requested) return 'cc-opus'
  if (requested === 'opus') return 'cc-opus'
  if (requested === 'sonnet') return 'cc-sonnet'
  return requested
}

const CRAFT_GEOMETRY_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'text'] as const
const CRAFT_SHADER_TYPES = ['flame', 'flag', 'crystal', 'water', 'particle_emitter', 'glow_orb', 'aurora'] as const
const CRAFT_ANIMATION_TYPES = ['rotate', 'bob', 'pulse', 'swing', 'orbit'] as const
const CRAFT_TEXTURE_PRESETS = [
  'stone', 'cobblestone', 'marble', 'concrete', 'rock', 'grass', 'sand', 'dirt', 'snow', 'metal', 'gravel', 'forest-floor',
  'kn-planks', 'kn-cobblestone', 'kn-roof', 'kn-wall', 'kn-asphalt', 'kn-concrete', 'kn-metal', 'kn-rock',
] as const

const SELF_CRAFT_GUIDE = {
  strategyDefault: 'agent',
  geometryTypes: CRAFT_GEOMETRY_TYPES,
  shaderTypes: CRAFT_SHADER_TYPES,
  animationTypes: CRAFT_ANIMATION_TYPES,
  texturePresets: CRAFT_TEXTURE_PRESETS,
  requiredFields: ['type', 'position', 'scale', 'color'],
  optionalFields: [
    'rotation', 'metalness', 'roughness', 'opacity', 'emissive', 'emissiveIntensity',
    'color2', 'color3', 'intensity', 'speed', 'particleCount', 'particleType', 'seed',
    'text', 'fontSize', 'texturePresetId', 'textureRepeat', 'animation',
  ],
  animationFields: ['type', 'speed', 'axis', 'amplitude'],
  rules: [
    'Do not add terrain, floor planes, sky domes, or background walls; Oasis already provides the world ground and sky.',
    'Use shader primitives aggressively for fire, cloth, crystals, water, particles, glow, and aurora effects.',
    'Use many overlapping primitives for richer silhouettes instead of one oversized primitive.',
    'Keep flames physically small and pair fire with particle_emitter embers.',
    'Crystal clusters should use 3+ crystals with varied seeds, scales, and rotations.',
    'At least some primitives should have non-zero rotation for visual interest.',
  ],
  example: {
    name: 'Arcane campfire',
    objects: [
      { type: 'cylinder', position: [0, 0.08, 0], scale: [0.55, 0.08, 0.55], color: '#3b2a1d', roughness: 0.92 },
      { type: 'flame', position: [0, 0.3, 0], scale: [0.22, 0.35, 0.22], color: '#fff4dd', color2: '#ff7a00', color3: '#9b1d00', intensity: 1, speed: 1.1 },
      { type: 'particle_emitter', position: [0, 0.75, 0], scale: [0.45, 0.85, 0.45], color: '#ffb347', color2: '#ff4d00', particleCount: 80, particleType: 'ember', speed: 0.7 },
      { type: 'crystal', position: [0.65, 0.32, 0.1], scale: [0.22, 0.6, 0.22], rotation: [0.14, 0.3, -0.08], color: '#4338ca', color2: '#8b5cf6', seed: 11 },
    ],
  },
} as const

function usesSelfCraftByDefault(actorAgentType: string): boolean {
  return actorAgentType === 'hermes' || actorAgentType === 'merlin' || actorAgentType === 'openclaw'
}

async function startPromptCraftJob(
  args: Record<string, unknown>,
  worldId: string,
  position: [number, number, number],
  prompt: string,
  name: string,
  model: string,
) {
  const { extractPartialCraftData } = await import('../craft-stream')
  const jobId = `craft-job-${uid()}`
  const sceneId = `crafted-mcp-${uid()}`
  const nowIso = new Date().toISOString()
  const placeholderScene: CraftedScene = {
    id: sceneId,
    name: 'Crafting...',
    prompt,
    objects: [],
    position,
    createdAt: nowIso,
    model,
  }

  writeCraftJob({
    id: jobId,
    status: 'queued',
    worldId,
    sceneId,
    prompt,
    model,
    name: placeholderScene.name,
    objectCount: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
  })

  const run = async (): Promise<ToolResult> => {
    try {
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'running',
        updatedAt: new Date().toISOString(),
      }))

      await upsertCraftedSceneInWorld(worldId, placeholderScene, args, 'scene_craft_progress')

      const isCC = model.startsWith('cc-')
      const response = await fetch(`${INTERNAL_OASIS_BASE_URL}/api/craft/${isCC ? 'cc' : 'stream'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      })

      const errorBody = !response.ok ? await response.json().catch(() => null) as { error?: string } | null : null
      if (!response.ok) {
        throw new Error(errorBody?.error || `HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new Error('No craft stream body returned.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let lastObjectCount = 0
      let lastSceneName = placeholderScene.name

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        accumulated += decoder.decode(value, { stream: true })
        const partial = extractPartialCraftData(accumulated)
        const nextName = partial.name || name || placeholderScene.name

        if (partial.objects.length !== lastObjectCount || nextName !== lastSceneName) {
          const progressScene: CraftedScene = {
            ...placeholderScene,
            name: nextName,
            objects: [...partial.objects],
          }
          await upsertCraftedSceneInWorld(worldId, progressScene, args, 'scene_craft_progress')
          lastObjectCount = partial.objects.length
          lastSceneName = nextName
          updateCraftJob(jobId, current => ({
            ...current,
            name: nextName,
            objectCount: partial.objects.length,
            updatedAt: new Date().toISOString(),
          }))
        }
      }

      const finalParsed = extractPartialCraftData(accumulated)
      if (finalParsed.objects.length === 0) {
        await removeCraftedSceneFromWorld(worldId, sceneId, args)
        const failedAt = new Date().toISOString()
        updateCraftJob(jobId, current => ({
          ...current,
          status: 'failed',
          name: name || current.name,
          objectCount: 0,
          updatedAt: failedAt,
          error: 'Craft stream returned no valid objects.',
        }))
        return {
          ok: false,
          message: 'Craft stream returned no valid objects.',
          data: { jobId, status: 'failed', sceneId },
        }
      }

      const finalScene: CraftedScene = {
        ...placeholderScene,
        name: finalParsed.name || name || 'Crafted Scene',
        objects: finalParsed.objects,
      }
      await upsertCraftedSceneInWorld(worldId, finalScene, args, 'scene_crafted')
      const completedAt = new Date().toISOString()
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'completed',
        name: finalScene.name,
        objectCount: finalScene.objects.length,
        updatedAt: completedAt,
      }))
      return {
        ok: true,
        message: `Crafted "${finalScene.name}" (${finalScene.objects.length} primitives) as ${sceneId}.`,
        data: {
          jobId,
          status: 'completed',
          id: sceneId,
          name: finalScene.name,
          objectCount: finalScene.objects.length,
        },
      }
    } catch (error) {
      const failedAt = new Date().toISOString()
      updateCraftJob(jobId, current => ({
        ...current,
        status: 'failed',
        updatedAt: failedAt,
        error: error instanceof Error ? error.message : String(error),
      }))
      await removeCraftedSceneFromWorld(worldId, sceneId, args).catch(() => {})
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Craft job failed.',
        data: {
          jobId,
          status: 'failed',
          sceneId,
        },
      }
    }
  }

  return { jobId, sceneId, run }
}

tools.craft_scene = async (args) => {
  const position = validPos(args.position) || [0, 0, 0]
  const rawObjects = parseLooseObjectArray(args.objects)
  const promptStr = validStr(args.prompt, '')
  const requestedName = validStr(args.name, 'Crafted Scene')
  const strategy = validStr(args.strategy, '').toLowerCase()
  const actorAgentType = validStr(args.actorAgentType || args.agentType || args.agent, '').toLowerCase()

  // If prompt is provided and no objects, route through the LLM crafting pipeline
  if (promptStr && rawObjects.length === 0) {
    if (usesSelfCraftByDefault(actorAgentType) && strategy !== 'sculptor') {
      return {
        ok: false,
        message: `${actorAgentType[0]?.toUpperCase() || 'A'}${actorAgentType.slice(1) || 'gent'} defaults to self-crafted scenes. Provide an objects array or explicitly set strategy: "sculptor" for prompt-mode fallback. Call get_craft_guide for the supported primitive schema.`,
        data: {
          strategyDefault: 'agent',
          fallbackStrategy: 'sculptor',
          actorAgentType,
        },
      }
    }

    const model = normalizeCraftModel(args.model)
    const waitForCompletion = validBool(args.waitForCompletion, false)
    const { worldId } = await loadRequestedWorld(args.worldId)
    const job = await startPromptCraftJob(args, worldId, position, promptStr, requestedName, model)

    if (waitForCompletion) {
      return job.run()
    }

    void job.run()
    return {
      ok: true,
      message: `Craft job ${job.jobId} started with ${model}. Poll get_craft_job for progress.`,
      data: {
        jobId: job.jobId,
        sceneId: job.sceneId,
        status: 'running',
        worldId,
        model,
      },
    }
  }

  // Direct primitive placement — no LLM involved
  const name = requestedName
  const objects = rawObjects.filter(o => {
    if (!o || typeof o !== 'object') return false
    const obj = o as Record<string, unknown>
    return obj.type && obj.position && obj.scale && obj.color
  }) as unknown as CraftedScene['objects']

  if (objects.length === 0) return { ok: false, message: 'No valid primitives in scene. Each needs type, position, scale, color. Or provide a "prompt" to have the LLM design the scene.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `crafted-mcp-${uid()}`

  const scene: CraftedScene = {
    id, name, prompt: promptStr || 'mcp-tool', objects, position, createdAt: new Date().toISOString(),
  }
  state.craftedScenes = [...(state.craftedScenes || []), scene]
  if (position.some(v => v !== 0)) {
    state.transforms[id] = { position }
  }
  await saveWorldState(worldId, state)
  emitWorldEvent('scene_crafted', worldId, {
    id,
    name,
    position,
    scene,
    transform: state.transforms[id],
    ...mutationActorData(args),
  })

  return { ok: true, message: `Created scene "${name}" with ${objects.length} primitives as ${id}`, data: { id, name, objectCount: objects.length } }
}

tools.get_craft_job = async (args) => {
  const jobId = validStr(args.jobId, '')
  if (!jobId) return { ok: false, message: 'jobId is required.' }
  const job = readCraftJob(jobId)
  if (!job) {
    return { ok: false, message: `Craft job ${jobId} not found.` }
  }
  return {
    ok: true,
    message: `Craft job ${jobId} is ${job.status}.`,
    data: {
      ...job,
    },
  }
}

tools.get_craft_guide = async () => ({
  ok: true,
  message: 'Self-craft guide ready. Use this schema to build explicit objects arrays for craft_scene.',
  data: SELF_CRAFT_GUIDE,
})

tools.modify_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const changes: string[] = []
  const pos = validPos(args.position)
  const rot = validPos(args.rotation)
  const scl = args.scale !== undefined ? validNum(args.scale, 1) : undefined
  const craftedIdx = (state.craftedScenes || []).findIndex(scene => scene.id === objectId)
  if (craftedIdx >= 0) {
    const scene = state.craftedScenes![craftedIdx]
    if (args.position) { scene.position = validPos(args.position) || scene.position; changes.push('position') }
    if (args.label) { scene.name = validStr(args.label, scene.name); changes.push('label') }
    state.craftedScenes![craftedIdx] = scene
  }

  // Find in catalog placements — only update label here.
  // Position/rotation/scale go through transforms (the override layer) to avoid
  // double-application: SelectableWrapper applies transforms, CatalogModelRenderer applies placement.
  const catalogIdx = (state.catalogPlacements || []).findIndex(p => p.id === objectId)
  if (catalogIdx >= 0) {
    const p = state.catalogPlacements![catalogIdx]
    if (args.label) { p.name = validStr(args.label, p.name); changes.push('label') }
    state.catalogPlacements![catalogIdx] = p
  }

  const avatarIdx = (state.agentAvatars || []).findIndex(avatar => avatar.id === objectId)
  if (avatarIdx >= 0) {
    const avatar = state.agentAvatars![avatarIdx]
    if (args.label) {
      avatar.label = validStr(args.label, avatar.label || avatar.agentType)
      changes.push('label')
    }
    if (args.scale !== undefined) {
      avatar.scale = validNum(args.scale, avatar.scale)
      changes.push('scale')
    }
    if (pos) {
      avatar.position = pos
    }
    if (rot) {
      avatar.rotation = rot
    }
    state.agentAvatars![avatarIdx] = avatar
  }

  // Update transform overrides
  if (pos || rot || scl !== undefined) {
    const existing = state.transforms[objectId] || {}
    if (pos) existing.position = pos
    if (rot) existing.rotation = rot
    if (scl !== undefined) existing.scale = scl
    state.transforms[objectId] = existing
    if (!changes.includes('position') && pos) changes.push('position')
    if (!changes.includes('rotation') && rot) changes.push('rotation')
    if (!changes.includes('scale') && scl !== undefined) changes.push('scale')
  }

  // Update behaviors (label, visibility, etc.)
  if (args.visible !== undefined || args.label) {
    if (!state.behaviors) state.behaviors = {}
    const existing = state.behaviors[objectId] || { visible: true, movement: { type: 'static' as const } }
    if (args.visible !== undefined) { existing.visible = Boolean(args.visible); changes.push('visible') }
    if (args.label) { existing.label = validStr(args.label, ''); changes.push('label') }
    state.behaviors[objectId] = existing
  }

  if (changes.length === 0) return { ok: false, message: `Object ${objectId} not found or no changes specified.` }

  await saveWorldState(worldId, state)
  const eventPosition = pos
    || validPos(state.transforms[objectId]?.position)
    || validPos(state.catalogPlacements?.[catalogIdx]?.position)
    || validPos(state.craftedScenes?.[craftedIdx]?.position)
    || validPos(state.agentAvatars?.find(avatar => avatar.id === objectId)?.position)
  emitWorldEvent('object_modified', worldId, {
    objectId,
    changes,
    ...(eventPosition ? { position: eventPosition } : {}),
    ...(catalogIdx >= 0 ? { placement: state.catalogPlacements?.[catalogIdx] } : {}),
    ...(craftedIdx >= 0 ? { scene: state.craftedScenes?.[craftedIdx] } : {}),
    ...(avatarIdx >= 0 ? { avatar: state.agentAvatars?.[avatarIdx] } : {}),
    ...(state.transforms[objectId] ? { transform: state.transforms[objectId] } : {}),
    ...(state.behaviors?.[objectId] ? { behavior: state.behaviors[objectId] } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Modified ${objectId}: ${changes.join(', ')}` }
}

tools.remove_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const beforeCatalog = state.catalogPlacements?.length || 0
  const beforeCrafted = state.craftedScenes?.length || 0
  const beforeAvatars = state.agentAvatars?.length || 0
  const removedPosition =
    validPos(state.transforms[objectId]?.position)
    || validPos((state.catalogPlacements || []).find(p => p.id === objectId)?.position)
    || validPos((state.craftedScenes || []).find(s => s.id === objectId)?.position)
    || validPos((state.agentAvatars || []).find(a => a.id === objectId)?.position)

  state.catalogPlacements = (state.catalogPlacements || []).filter(p => p.id !== objectId)
  state.craftedScenes = (state.craftedScenes || []).filter(s => s.id !== objectId)
  state.agentAvatars = (state.agentAvatars || []).filter(a => a.id !== objectId)
  delete state.transforms[objectId]
  if (state.behaviors) delete state.behaviors[objectId]

  const removed =
    (beforeCatalog - (state.catalogPlacements?.length || 0)) +
    (beforeCrafted - (state.craftedScenes?.length || 0)) +
    (beforeAvatars - (state.agentAvatars?.length || 0))
  if (removed === 0) return { ok: false, message: `Object ${objectId} not found in world.` }

  await saveWorldState(worldId, state)
  emitWorldEvent('object_removed', worldId, {
    objectId,
    ...(removedPosition ? { position: removedPosition } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Removed ${objectId}.` }
}

tools.set_sky = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.skyBackgroundId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('sky_changed', worldId, { presetId, ...mutationActorData(args) })
  return { ok: true, message: `Sky set to ${presetId}.` }
}

tools.set_ground_preset = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required (none, grass, sand, dirt, stone, snow, water).' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.groundPresetId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('ground_changed', worldId, { presetId, ...mutationActorData(args) })
  return { ok: true, message: `Ground set to ${presetId}.` }
}

tools.paint_ground_tiles = async (args) => {
  const tiles = parseLooseObjectArray(args.tiles)
  if (tiles.length === 0) return { ok: false, message: 'tiles array is required: [{x, z, presetId}]' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  if (!state.groundTiles) state.groundTiles = {}

  let painted = 0
  for (const tile of tiles) {
    if (!tile || typeof tile !== 'object') continue
    const t = tile as Record<string, unknown>
    const x = Math.floor(validNum(t.x, NaN))
    const z = Math.floor(validNum(t.z, NaN))
    const presetId = validStr(t.presetId, '')
    if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) continue
    if (x < -50 || x > 49 || z < -50 || z > 49) continue

    state.groundTiles[`${x},${z}`] = presetId
    painted++
  }

  if (painted === 0) return { ok: false, message: 'No valid tiles to paint. Format: {x: int, z: int, presetId: string}' }

  await saveWorldState(worldId, state)
  emitWorldEvent('tiles_painted', worldId, {
    painted,
    tiles: tiles
      .map(tile => {
        if (!tile || typeof tile !== 'object') return null
        const t = tile as Record<string, unknown>
        const x = Math.floor(validNum(t.x, NaN))
        const z = Math.floor(validNum(t.z, NaN))
        const presetId = validStr(t.presetId, '')
        if (!Number.isFinite(x) || !Number.isFinite(z) || !presetId) return null
        return { x, z, presetId }
      })
      .filter((tile): tile is { x: number; z: number; presetId: string } => !!tile),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Painted ${painted} ground tiles.`, data: { painted, totalTiles: Object.keys(state.groundTiles).length } }
}

tools.add_light = async (args) => {
  const type = validStr(args.type, 'point') as WorldLight['type']
  const position = validPos(args.position) || [0, 5, 0]
  const color = validStr(args.color, '#ffffff')
  const intensity = validNum(args.intensity, 3)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `light-mcp-${uid()}`
  const light: WorldLight = { id, type, color, intensity, position, visible: true }
  state.lights = [...(state.lights || []), light]
  await saveWorldState(worldId, state)
  emitWorldEvent('light_added', worldId, { id, type, position, light, ...mutationActorData(args) })

  return { ok: true, message: `Added ${type} light (${id}) at [${position.join(', ')}] color=${color} intensity=${intensity}`, data: { id } }
}

tools.modify_light = async (args) => {
  const lightId = validStr(args.lightId, '')
  if (!lightId) return { ok: false, message: 'lightId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const idx = (state.lights || []).findIndex(l => l.id === lightId)
  if (idx < 0) return { ok: false, message: `Light ${lightId} not found.` }

  const light = state.lights![idx]
  const changes: string[] = []
  if (args.color) { light.color = validStr(args.color, light.color); changes.push('color') }
  if (args.intensity !== undefined) { light.intensity = validNum(args.intensity, light.intensity); changes.push('intensity') }
  if (args.position) { light.position = validPos(args.position) || light.position; changes.push('position') }
  if (args.visible !== undefined) { light.visible = Boolean(args.visible); changes.push('visible') }
  state.lights![idx] = light
  await saveWorldState(worldId, state)
  emitWorldEvent('light_modified', worldId, {
    lightId,
    changes,
    light,
    position: light.position,
    ...mutationActorData(args),
  })

  return { ok: true, message: `Modified light ${lightId}: ${changes.join(', ')}` }
}

tools.set_behavior = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }
  const movement = validStr(args.movement, 'static')

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  if (!state.behaviors) state.behaviors = {}

  const movementPreset =
    movement === 'spin' ? { type: 'spin' as const, axis: 'y' as const, speed: validNum(args.speed, 1) } :
    movement === 'hover' ? { type: 'hover' as const, amplitude: validNum(args.amplitude, 0.5), speed: validNum(args.speed, 1), offset: 0 } :
    movement === 'orbit' ? { type: 'orbit' as const, radius: validNum(args.radius, 2), speed: validNum(args.speed, 1), axis: 'xz' as const } :
    movement === 'bounce' ? { type: 'bounce' as const, height: validNum(args.height, 1), speed: validNum(args.speed, 1) } :
    movement === 'patrol' ? { type: 'patrol' as const, radius: validNum(args.radius, 3), speed: validNum(args.speed, 1) } :
    { type: 'static' as const }

  const existing = state.behaviors[objectId]
  state.behaviors[objectId] = {
    visible: existing?.visible ?? true,
    movement: movementPreset,
    ...(args.label ? { label: validStr(args.label, '') } : existing?.label ? { label: existing.label } : {}),
  }

  await saveWorldState(worldId, state)
  const behaviorPosition =
    validPos(state.transforms[objectId]?.position)
    || validPos((state.catalogPlacements || []).find(entry => entry.id === objectId)?.position)
    || validPos((state.craftedScenes || []).find(entry => entry.id === objectId)?.position)
    || validPos((state.agentAvatars || []).find(entry => entry.id === objectId)?.position)
  emitWorldEvent('behavior_set', worldId, {
    objectId,
    movement,
    behavior: state.behaviors[objectId],
    ...(behaviorPosition ? { position: behaviorPosition } : {}),
    ...mutationActorData(args),
  })
  return { ok: true, message: `Set behavior on ${objectId}: movement=${movement}` }
}

function resolveAvatarUrl(raw: string): { url: string; resolved: boolean; suggestion?: string } {
  // External URLs (http/https) are allowed as-is — user's responsibility
  if (raw.startsWith('http://') || raw.startsWith('https://')) return { url: raw, resolved: true }
  const resolved = resolveAgentAvatarUrl(raw)
  return {
    url: resolved.url,
    resolved: resolved.resolved,
    suggestion: resolved.suggestion,
  }
}

tools.set_avatar = async (args) => {
  const rawUrl = validStr(args.avatarUrl || args.url, '')
  if (!rawUrl) return { ok: false, message: 'avatarUrl is required. Use a path like /avatars/gallery/Orion.vrm or call get_world_state to see available avatars.' }
  const { url: avatarUrl, resolved, suggestion } = resolveAvatarUrl(rawUrl)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing, avatarId, linkedWindowId, agentType } = resolveAgentAvatarTarget(
    state,
    args,
    validStr(args.linkedWindowId, '') ? 'anorak' : 'hermes',
  )
  const isSharedAvatarType = SHARED_AGENT_AVATAR_TYPES.has(agentType)
  const label = validStr(args.label, '')
  const position = validPos(args.position)
  const rotation = validPos(args.rotation)
  const scale = validNum(args.scale, agentType === 'hermes' || agentType === 'openclaw' ? 1.15 : 1)

  const nextAvatar = existing
    ? {
        ...existing,
        avatar3dUrl: avatarUrl,
        label: label || existing.label,
        position: position || existing.position,
        rotation: rotation || existing.rotation,
        scale: Number.isFinite(Number(args.scale)) ? scale : existing.scale,
        linkedWindowId: isSharedAvatarType ? undefined : (linkedWindowId || existing.linkedWindowId),
        agentType: validStr(agentType, existing.agentType) as typeof existing.agentType,
      }
    : {
        id: avatarId,
        agentType: agentType as 'anorak' | 'anorak-pro' | 'merlin' | 'devcraft' | 'parzival' | 'mission' | 'hermes',
        avatar3dUrl: avatarUrl,
        position: position || [0, 0, 3.2],
        rotation: rotation || [0, Math.PI, 0],
        scale,
        ...(!isSharedAvatarType && linkedWindowId ? { linkedWindowId } : {}),
        ...(label ? { label } : {}),
      }

  if (existing) {
    state.agentAvatars = (state.agentAvatars || []).map(avatar => avatar.id === nextAvatar.id ? nextAvatar : avatar)
  } else {
    state.agentAvatars = [...(state.agentAvatars || []), nextAvatar]
  }
  if (isSharedAvatarType) {
    state.agentAvatars = (state.agentAvatars || []).filter((avatar, index, list) => {
      if (avatar.agentType !== agentType) return true
      return list.findIndex(entry => entry.agentType === agentType) === index
    })
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_set', worldId, {
    avatarId: nextAvatar.id,
    agentType: nextAvatar.agentType,
    linkedWindowId: nextAvatar.linkedWindowId,
    position: nextAvatar.position,
    avatar: nextAvatar,
    ...mutationActorData(args),
  })

  const msg = suggestion
    ? `Avatar ${nextAvatar.id} now uses ${avatarUrl}. Note: ${suggestion}`
    : `Avatar ${nextAvatar.id} now uses ${avatarUrl}.`
  return {
    ok: resolved,
    message: msg,
    data: nextAvatar,
  }
}

tools.walk_avatar_to = async (args) => {
  const target = validPos(args.position || args.target)
  if (!target) return { ok: false, message: 'position is required as [x, y, z].' }
  const moveSpeed = validNum(args.speed, 3)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing: matchedAvatar, avatarId } = resolveAgentAvatarTarget(state, args)
  const avatar = matchedAvatar || ((state.agentAvatars || []).find(entry => entry.id === avatarId) || null)
  if (!avatar || !avatarId) return { ok: false, message: 'No matching avatar found. Call set_avatar first or specify avatarId.' }

  const existingBehavior = state.behaviors?.[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors = state.behaviors || {}
  state.behaviors[avatarId] = {
    ...existingBehavior,
    visible: existingBehavior.visible ?? true,
    // Walking should reclaim locomotion from stale emote loops instead of gliding forever in the old clip.
    animation: undefined,
    moveTarget: target,
    moveSpeed,
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_walk', worldId, {
    avatarId,
    target,
    moveSpeed,
    behavior: state.behaviors[avatarId],
    ...mutationActorData(args),
  })
  return { ok: true, message: `Avatar ${avatarId} is walking to [${target.join(', ')}].`, data: { avatarId, target, moveSpeed } }
}

tools.list_avatar_animations = async (args) => {
  const library = await loadAvatarAnimationCatalog()
  const query = normalizeAnimationLookupKey(validStr(args.query, ''))
  const category = validStr(args.category, '').toLowerCase()
  const limit = Math.max(1, Math.min(200, validNum(args.limit, 80)))

  const animations = library
    .filter(entry => !category || entry.category.toLowerCase() === category)
    .filter(entry =>
      !query ||
      entry.id.includes(query) ||
      entry.label.toLowerCase().includes(query) ||
      entry.category.toLowerCase().includes(query)
    )
    .slice(0, limit)
    .map(entry => ({
      id: entry.id,
      label: entry.label,
      category: entry.category,
      clipName: `lib:${entry.id}`,
      source: entry.filename,
      ...(entry.glbClipName ? { glbClipName: entry.glbClipName } : {}),
    }))

  return {
    ok: true,
    message: `Found ${animations.length} animation${animations.length === 1 ? '' : 's'}.`,
    data: {
      animations,
      aliases: AVATAR_ANIMATION_ALIASES,
    },
  }
}

tools.play_avatar_animation = async (args) => {
  const clipName = validStr(args.clipName || args.animation || args.name, '')
  if (!clipName) return { ok: false, message: 'clipName is required. Call list_avatar_animations for valid IDs.' }
  const loop = validStr(args.loop, 'once')
  const speed = validNum(args.speed, 1)
  const animation = await resolveAvatarAnimation(clipName)
  if (!animation.exact) {
    return {
      ok: false,
      message: `Unknown animation "${clipName}". Call list_avatar_animations for exact IDs.`,
      data: {
        requested: clipName,
        normalized: animation.normalized,
        suggestions: animation.suggestions,
      },
    }
  }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const { existing: matchedAvatar, avatarId } = resolveAgentAvatarTarget(state, args)
  const avatar = matchedAvatar || ((state.agentAvatars || []).find(entry => entry.id === avatarId) || null)
  if (!avatar || !avatarId) return { ok: false, message: 'No matching avatar found. Call set_avatar first or specify avatarId.' }

  state.behaviors = state.behaviors || {}
  const existingBehavior = state.behaviors[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors[avatarId] = {
    ...existingBehavior,
    visible: existingBehavior.visible ?? true,
    animation: {
      clipName: `lib:${animation.exact.id}`,
      loop: loop === 'once' || loop === 'pingpong' ? loop : 'repeat',
      speed,
    },
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_animation', worldId, {
    avatarId,
    clipName: animation.exact.id,
    loop,
    speed,
    behavior: state.behaviors[avatarId],
    ...mutationActorData(args),
  })
  return {
    ok: true,
    message: `Avatar ${avatarId} is now playing ${animation.exact.id}.`,
    data: {
      avatarId,
      clipName: animation.exact.id,
      label: animation.exact.label,
      category: animation.exact.category,
      loop,
      speed,
    },
  }
}

tools.clear_world = async (args) => {
  if (!args.confirm) return { ok: false, message: 'clear_world requires confirm: true. This is destructive.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.catalogPlacements = []
  state.craftedScenes = []
  state.conjuredAssetIds = []
  state.agentAvatars = []
  state.lights = []
  state.transforms = {}
  state.behaviors = {}
  state.groundTiles = {}
  await saveWorldState(worldId, state)
  emitWorldEvent('world_cleared', worldId, mutationActorData(args))

  return { ok: true, message: 'World cleared. All objects, conjured placements, lights, tiles, and behaviors removed.' }
}

// ─═̷─═̷─ WORLD MANAGEMENT ─═̷─═̷─

tools.list_worlds = async () => {
  const worlds = await prisma.world.findMany({
    select: { id: true, name: true, icon: true, objectCount: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
  return {
    ok: true,
    message: `${worlds.length} worlds.`,
    data: worlds.map((w: { id: string; name: string; icon: string; objectCount: number; updatedAt: Date }) => ({
      id: w.id,
      name: w.name,
      icon: w.icon,
      objectCount: w.objectCount,
      lastSaved: w.updatedAt.toISOString(),
    })),
  }
}

tools.load_world = async (args) => {
  const worldId = validStr(args.worldId, '')
  if (!worldId) return { ok: false, message: 'worldId is required.' }
  const state = await loadWorldById(worldId)
  emitWorldEvent('world_switch', worldId, { targetWorldId: worldId, ...mutationActorData(args) })
  return { ok: true, message: `Loaded world ${worldId}. Browser should switch momentarily.`, data: { worldId, objectCount: (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) } }
}

tools.create_world = async (args) => {
  const name = validStr(args.name, 'New World')
  const icon = validStr(args.icon, '🌍')
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date()

  const emptyState: WorldState = {
    version: 1, terrain: null, craftedScenes: [], conjuredAssetIds: [],
    catalogPlacements: [], agentAvatars: [], transforms: {}, savedAt: now.toISOString(),
  }

  await prisma.world.create({
    data: { id, userId: LOCAL_USER_ID, name, icon, data: JSON.stringify(emptyState), createdAt: now, updatedAt: now },
  })

  emitWorldEvent('world_switch', id, { targetWorldId: id, ...mutationActorData(args) })
  return { ok: true, message: `Created world "${name}" (${id}). Browser switching now.`, data: { worldId: id, name } }
}

// ─═̷─═̷─ SCREENSHOT (signal-based) ─═̷─═̷─

// Screenshot is a client-side operation. The MCP tool signals a request
// and the browser captures via canvas.toDataURL(). The result is stored
// temporarily and the tool returns it.
// For v1: return a placeholder indicating the screenshot was requested.
// The actual implementation requires a client-side event bridge.

export type ScreenshotFormat = 'jpeg' | 'png' | 'webp'

export interface ScreenshotViewRequest {
  id: string
  mode: 'current' | 'agent-avatar-phantom' | 'look-at' | 'external-orbit' | 'third-person-follow' | 'avatar-portrait'
  agentType?: string
  position?: [number, number, number]
  target?: [number, number, number]
  fov?: number
  distance?: number
  heightOffset?: number
  lookAhead?: number
}

export interface PendingScreenshotRequest {
  id: string
  requestedAt: number
  requesterAgentType?: string
  worldId?: string
  format: ScreenshotFormat
  quality: number
  width: number
  height: number
  settleMs: number
  views: ScreenshotViewRequest[]
}

export interface DeliveredScreenshotCapture {
  viewId: string
  base64: string
  format: ScreenshotFormat
  url?: string
  filePath?: string
}

interface ScreenshotCaptureSummary {
  viewId: string
  format: ScreenshotFormat
  url?: string
  filePath?: string
  hasInlineBase64?: true
}

function summarizeDeliveredScreenshotCapture(capture: DeliveredScreenshotCapture): ScreenshotCaptureSummary {
  return {
    viewId: capture.viewId,
    format: capture.format,
    url: capture.url,
    filePath: capture.filePath,
    hasInlineBase64: !capture.url && !capture.filePath && capture.base64 ? true : undefined,
  }
}

interface PendingScreenshotJob {
  request: PendingScreenshotRequest
  resolve: (captures: DeliveredScreenshotCapture[]) => void
  timeout: ReturnType<typeof setTimeout> | null
}

const pendingScreenshotJobs: PendingScreenshotJob[] = []

function validScreenshotFormat(value: unknown): ScreenshotFormat {
  return value === 'png' || value === 'webp' || value === 'jpeg'
    ? value
    : 'jpeg'
}

function normalizeScreenshotMode(
  entry: Record<string, unknown>,
  index: number,
  defaultAgentType: string,
  hasExplicitLookAt: boolean,
): ScreenshotViewRequest['mode'] | null {
  const rawMode = validStr(
    entry.mode
      || entry.view
      || entry.camera
      || entry.perspective
      || (entry.player === true ? 'player' : '')
      || (entry.agent === true ? 'agent' : '')
      || (entry.external === true ? 'external' : ''),
    defaultAgentType && index === 0 ? 'agent' : index === 0 ? 'current' : '',
  ).toLowerCase()

  if (!rawMode) return null
  if (rawMode === 'current' || rawMode === 'player') return 'current'
  if (rawMode === 'agent' || rawMode === 'phantom' || rawMode === 'agent-avatar-phantom') {
    return hasExplicitLookAt ? 'look-at' : 'agent-avatar-phantom'
  }
  if (
    rawMode === 'look-at'
    || rawMode === 'look_at'
    || rawMode === 'lookat'
    || rawMode === 'look at'
  ) {
    return 'look-at'
  }
  if (
    rawMode === 'third-person'
    || rawMode === 'third_person'
    || rawMode === 'thirdperson'
    || rawMode === 'third-person-follow'
    || rawMode === 'tps'
  ) {
    return 'third-person-follow'
  }
  if (
    rawMode === 'avatar'
    || rawMode === 'portrait'
    || rawMode === 'avatar-portrait'
    || rawMode === 'avatar_portrait'
    || rawMode === 'avatarpic'
  ) {
    return 'avatar-portrait'
  }
  if (rawMode === 'external' || rawMode === 'outside' || rawMode === 'overhead' || rawMode === 'birdseye' || rawMode === 'birds-eye') {
    return hasExplicitLookAt ? 'look-at' : 'external-orbit'
  }
  if (hasExplicitLookAt) {
    return 'look-at'
  }
  return null
}

function normalizeScreenshotView(value: unknown, index: number, defaultAgentType: string): ScreenshotViewRequest | null {
  const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}

  const position = validPos(entry.position ?? entry.cameraPosition)
  const target = validPos(entry.target ?? entry.cameraTarget)
  const mode = normalizeScreenshotMode(entry, index, defaultAgentType, !!(position && target))
  if (!mode) return null
  const defaultFov =
    mode === 'agent-avatar-phantom' ? 100 :
    mode === 'external-orbit' ? 60 :
    mode === 'third-person-follow' ? 72 :
    mode === 'avatar-portrait' ? 34 :
    75
  const maxDistance = mode === 'external-orbit' ? 40 : mode === 'third-person-follow' ? 18 : mode === 'avatar-portrait' ? 8 : 12
  const defaultDistance = mode === 'external-orbit' ? 16 : mode === 'third-person-follow' ? 4.4 : mode === 'avatar-portrait' ? 2.75 : 1
  const maxHeightOffset = mode === 'external-orbit' ? 30 : mode === 'third-person-follow' ? 6 : mode === 'avatar-portrait' ? 4 : 4
  const defaultHeightOffset = mode === 'external-orbit' ? 9 : mode === 'third-person-follow' ? 2.1 : mode === 'avatar-portrait' ? 1.55 : 1.55
  const defaultLookAhead = mode === 'third-person-follow' ? 4 : mode === 'avatar-portrait' ? 0.1 : 5
  return {
    id: validStr(entry.id, `view-${index + 1}`),
    mode,
    agentType: validStr(entry.agentType || entry.agent || entry.actorAgentType, defaultAgentType) || undefined,
    position: position || undefined,
    target: target || undefined,
    fov: Math.max(35, Math.min(120, validNum(entry.fov, defaultFov))),
    distance: Math.max(0, Math.min(maxDistance, validNum(entry.distance, defaultDistance))),
    heightOffset: Math.max(0, Math.min(maxHeightOffset, validNum(entry.heightOffset, defaultHeightOffset))),
    lookAhead: Math.max(0.5, Math.min(20, validNum(entry.lookAhead, defaultLookAhead))),
  }
}

function normalizeAvatarSubject(value: unknown, fallback = 'merlin'): string {
  const raw = validStr(value, fallback).trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'user' || raw === 'player' || raw === 'player-avatar' || raw === 'player_avatar') return 'player'
  if (raw === 'merlin-avatar' || raw === 'merlin_avatar') return 'merlin'
  return raw
}

function buildAvatarScreenshotArgs(args: Record<string, unknown>, fallbackSubject: string): Record<string, unknown> {
  const subject = normalizeAvatarSubject(
    args.subject || args.agentType || args.agent || args.defaultAgentType || args.requesterAgentType || args.actorAgentType,
    fallbackSubject,
  )
  const style = validStr(args.style || args.mode, 'portrait').trim().toLowerCase()
  const thirdPerson = style === 'third-person' || style === 'third_person' || style === 'thirdperson' || style === 'tps'
  const worldId = validStr(args.worldId, '')

  return {
    ...(worldId ? { worldId } : {}),
    ...(validStr(args.defaultAgentType, '') ? { defaultAgentType: validStr(args.defaultAgentType, '') } : {}),
    ...(validStr(args.requesterAgentType, '') ? { requesterAgentType: validStr(args.requesterAgentType, '') } : {}),
    ...(validStr(args.actorAgentType, '') ? { actorAgentType: validStr(args.actorAgentType, '') } : {}),
    ...(args.settleMs !== undefined ? { settleMs: args.settleMs } : {}),
    format: validScreenshotFormat(args.format),
    quality: Math.max(0.35, Math.min(0.95, validNum(args.quality, thirdPerson ? 0.8 : 0.9))),
    width: Math.max(320, Math.min(1280, Math.round(validNum(args.width, thirdPerson ? 960 : 640)))),
    height: Math.max(180, Math.min(1280, Math.round(validNum(args.height, thirdPerson ? 540 : 640)))),
    views: [{
      id: `${subject}-${thirdPerson ? 'tps' : 'portrait'}`,
      mode: thirdPerson ? 'third-person-follow' : 'avatar-portrait',
      agentType: subject,
      fov: validNum(args.fov, thirdPerson ? 72 : 34),
      distance: validNum(args.distance, thirdPerson ? 4.4 : 2.75),
      heightOffset: validNum(args.heightOffset, thirdPerson ? 2.1 : 1.55),
      lookAhead: validNum(args.lookAhead, thirdPerson ? 4 : 0.1),
    }],
  }
}

function normalizeScreenshotRequest(args: Record<string, unknown>): PendingScreenshotRequest {
  const defaultAgentType = validStr(args.defaultAgentType || args.agentType || args.agent || args.actorAgentType, '').toLowerCase()
  const requesterAgentType = validStr(args.requesterAgentType, defaultAgentType).toLowerCase()
  const worldId = validStr(args.worldId, '')
  const requestedViewsRaw =
    Array.isArray(args.views)
      ? args.views
      : typeof args.views === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(args.views)
              return Array.isArray(parsed) ? parsed : [args]
            } catch {
              return [args]
            }
          })()
        : [args]
  const requestedViews = requestedViewsRaw
  const views = requestedViews
    .map((entry, index) => normalizeScreenshotView(entry, index, defaultAgentType))
    .filter((entry): entry is ScreenshotViewRequest => !!entry)
  const defaultSettleMs = views.some(view => view.mode !== 'current') ? 220 : 80

  return {
    id: `shot-${uid()}`,
    requestedAt: Date.now(),
    ...(requesterAgentType ? { requesterAgentType } : {}),
    ...(worldId ? { worldId } : {}),
    format: validScreenshotFormat(args.format),
    quality: Math.max(0.35, Math.min(0.95, validNum(args.quality, 0.72))),
    width: Math.max(320, Math.min(1280, Math.round(validNum(args.width, 480)))),
    height: Math.max(180, Math.min(1280, Math.round(validNum(args.height, 270)))),
    settleMs: Math.max(0, Math.min(4000, Math.round(validNum(args.settleMs, defaultSettleMs)))),
    views: views.length > 0
      ? views
      : [{
          id: 'view-1',
          mode: defaultAgentType ? 'agent-avatar-phantom' : 'current',
          agentType: defaultAgentType || undefined,
          fov: defaultAgentType ? 100 : 75,
          distance: 1,
          heightOffset: 1.55,
          lookAhead: 5,
        }],
  }
}

function activeScreenshotJob(): PendingScreenshotJob | null {
  return pendingScreenshotJobs[0] || null
}

function clearScreenshotJobTimeout(job: PendingScreenshotJob) {
  if (job.timeout) {
    clearTimeout(job.timeout)
    job.timeout = null
  }
}

function removeScreenshotJob(job: PendingScreenshotJob) {
  const index = pendingScreenshotJobs.indexOf(job)
  if (index >= 0) pendingScreenshotJobs.splice(index, 1)
  clearScreenshotJobTimeout(job)
}

function resolveScreenshotJob(job: PendingScreenshotJob, captures: DeliveredScreenshotCapture[]) {
  removeScreenshotJob(job)
  job.resolve(captures)
}

tools.screenshot_viewport = async (args) => {
  const request = normalizeScreenshotRequest(args)

  return new Promise<ToolResult>((resolve) => {
    const job: PendingScreenshotJob = {
      request,
      resolve: (captures: DeliveredScreenshotCapture[]) => {
        removeScreenshotJob(job)
        if (captures.length === 0) {
          resolve({
            ok: false,
            message: 'Screenshot capture timed out or failed. The live Oasis screenshot bridge may be unavailable, on a different world, or missing the requested avatar/camera subject.',
          })
        } else {
          const summarizedCaptures = captures.map(summarizeDeliveredScreenshotCapture)
          const primaryInlineBase64 = !captures[0]?.url && !captures[0]?.filePath
            ? captures[0]?.base64
            : undefined
          resolve({
            ok: true,
            message: `Captured ${captures.length} screenshot ${captures.length === 1 ? 'view' : 'views'} (${request.format}, quality ${request.quality}).`,
            data: {
              format: request.format,
              captureCount: captures.length,
              captures: summarizedCaptures,
              primaryCaptureUrl: captures.find(capture => typeof capture.url === 'string' && capture.url.length > 0)?.url,
              primaryCapturePath: captures.find(capture => typeof capture.filePath === 'string' && capture.filePath.length > 0)?.filePath,
              base64: primaryInlineBase64,
            },
          })
        }
      },
      timeout: null,
    }

    pendingScreenshotJobs.push(job)
    job.timeout = setTimeout(() => {
      resolveScreenshotJob(job, [])
    }, 20000)
  })
}

tools.screenshot_avatar = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs(
    args,
    normalizeAvatarSubject(
      args.subject || args.agentType || args.agent || args.defaultAgentType || args.requesterAgentType || args.actorAgentType,
      'merlin',
    ),
  ))
}

tools.avatarpic_merlin = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs({ ...args, subject: 'merlin' }, 'merlin'))
}

tools.avatarpic_user = async (args) => {
  return tools.screenshot_viewport(buildAvatarScreenshotArgs({ ...args, subject: 'player' }, 'player'))
}

tools.list_conjured_assets = async (args) => {
  const worldId = validStr(args.worldId, '')
  const statusFilter = validStr(args.status, '').toLowerCase()
  const providerFilter = validStr(args.provider, '').toLowerCase()
  const limit = Math.max(1, Math.min(200, validNum(args.limit, 50)))
  const inWorldOnly = validBool(args.inWorldOnly ?? args.activeWorldOnly, false)
  const characterModeFilter = typeof args.characterMode === 'boolean' ? args.characterMode : null

  const { state, worldId: resolvedWorldId } = worldId
    ? { state: await loadWorldById(worldId), worldId }
    : await loadActiveWorld()

  const placedIds = new Set(state.conjuredAssetIds || [])
  const assets = getAllAssets()
    .filter(asset => !statusFilter || asset.status.toLowerCase() === statusFilter)
    .filter(asset => !providerFilter || asset.provider.toLowerCase() === providerFilter)
    .filter(asset => characterModeFilter === null || !!asset.characterMode === characterModeFilter)
    .filter(asset => !inWorldOnly || placedIds.has(asset.id))
    .slice(-limit)
    .reverse()
    .map(asset => ({
      ...cloneConjuredAsset(asset),
      inActiveWorld: placedIds.has(asset.id),
      worldTransform: readWorldTransform(state, asset.id),
    }))

  return {
    ok: true,
    message: `Found ${assets.length} conjured asset${assets.length === 1 ? '' : 's'}.`,
    data: {
      worldId: resolvedWorldId,
      assets,
    },
  }
}

tools.get_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }

  let worldSummary: { worldId: string; inWorld: boolean; transform: ReturnType<typeof readWorldTransform> } | null = null
  try {
    const { state, worldId } = await loadRequestedWorld(args.worldId)
    worldSummary = {
      worldId,
      inWorld: (state.conjuredAssetIds || []).includes(assetId),
      transform: readWorldTransform(state, assetId),
    }
  } catch {
    worldSummary = null
  }

  return {
    ok: true,
    message: `Loaded conjured asset ${assetId}.`,
    data: {
      asset,
      ...(worldSummary ? { world: worldSummary } : {}),
    },
  }
}

tools.conjure_asset = async (args) => {
  const prompt = validStr(args.prompt, '')
  if (!prompt) return { ok: false, message: 'prompt is required.' }

  const response = await callInternalJson<{ id: string; status: string; estimatedSeconds?: number }>('/api/conjure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      provider: validStr(args.provider, 'meshy') as ProviderName,
      ...(validStr(args.tier, '') ? { tier: validStr(args.tier, '') } : {}),
      ...(validStr(args.imageUrl, '') ? { imageUrl: validStr(args.imageUrl, '') } : {}),
      ...(validBool(args.characterMode, false) ? { characterMode: true } : {}),
      ...(args.characterOptions && typeof args.characterOptions === 'object' ? { characterOptions: args.characterOptions } : {}),
      ...(validBool(args.autoRig, false) ? { autoRig: true } : {}),
      ...(validBool(args.autoAnimate, false) ? { autoAnimate: true } : {}),
      ...(validStr(args.animationPreset, '') ? { animationPreset: validStr(args.animationPreset, '') } : {}),
    }),
  })

  const asset = cloneConjuredAsset(getAssetById(response.id))
  const placeInWorld = validBool(args.placeInWorld, true)
  const placement = resolveConjuredPlacement(args, asset ? {
    position: asset.position,
    rotation: asset.rotation,
    scale: asset.scale,
  } : undefined)

  let placedWorldId: string | null = null
  if (placeInWorld) {
    const { worldId } = await placeConjuredAssetInWorld(args.worldId, response.id, placement)
    placedWorldId = worldId
    emitWorldEvent('conjured_asset_added', worldId, {
      assetId: response.id,
      asset: asset || undefined,
      transform: {
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale,
      },
      position: placement.position,
      ...mutationActorData(args),
    })
  }

  return {
    ok: true,
    message: placeInWorld
      ? `Conjuration started for "${prompt}" and placed into world ${placedWorldId}.`
      : `Conjuration started for "${prompt}".`,
    data: {
      assetId: response.id,
      status: response.status,
      estimatedSeconds: response.estimatedSeconds ?? null,
      asset,
      placedInWorld: placeInWorld,
      worldId: placedWorldId,
      transform: placeInWorld ? placement : null,
    },
  }
}

tools.process_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  const action = validStr(args.action, '').toLowerCase() as PostProcessAction
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  if (!action) return { ok: false, message: 'action is required.' }

  const response = await callInternalJson<{ id: string; status: string }>(`/api/conjure/${assetId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      ...(args.options && typeof args.options === 'object' ? { options: args.options } : {}),
    }),
  })

  const asset = cloneConjuredAsset(getAssetById(response.id))
  const sourceAsset = cloneConjuredAsset(getAssetById(assetId))
  const placement = resolveConjuredPlacement(args, sourceAsset ? {
    position: sourceAsset.position,
    rotation: sourceAsset.rotation,
    scale: sourceAsset.scale,
  } : undefined)
  const placeInWorld = validBool(args.placeInWorld, true)

  let placedWorldId: string | null = null
  if (placeInWorld) {
    const { worldId } = await placeConjuredAssetInWorld(args.worldId, response.id, placement)
    placedWorldId = worldId
    emitWorldEvent('conjured_asset_added', worldId, {
      assetId: response.id,
      asset: asset || undefined,
      transform: {
        position: placement.position,
        rotation: placement.rotation,
        scale: placement.scale,
      },
      position: placement.position,
      sourceAssetId: assetId,
      action,
      ...mutationActorData(args),
    })
  }

  return {
    ok: true,
    message: placeInWorld
      ? `${action} started for ${assetId}; child asset ${response.id} placed into world ${placedWorldId}.`
      : `${action} started for ${assetId}; child asset ${response.id} queued.`,
    data: {
      assetId: response.id,
      sourceAssetId: assetId,
      status: response.status,
      action,
      asset,
      placedInWorld: placeInWorld,
      worldId: placedWorldId,
      transform: placeInWorld ? placement : null,
    },
  }
}

tools.place_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }
  const placement = resolveConjuredPlacement(args, {
    position: asset.position,
    rotation: asset.rotation,
    scale: asset.scale,
  })
  const { worldId } = await placeConjuredAssetInWorld(args.worldId, assetId, placement)
  emitWorldEvent('conjured_asset_added', worldId, {
    assetId,
    asset,
    transform: {
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
    },
    position: placement.position,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: `Placed conjured asset ${assetId} into world ${worldId}.`,
    data: {
      assetId,
      worldId,
      asset,
      transform: placement,
    },
  }
}

tools.delete_conjured_asset = async (args) => {
  const assetId = validStr(args.assetId || args.id, '')
  if (!assetId) return { ok: false, message: 'assetId is required.' }
  const asset = cloneConjuredAsset(getAssetById(assetId))
  if (!asset) return { ok: false, message: `Conjured asset ${assetId} not found.` }
  const { worldId } = await removeConjuredAssetFromWorld(args.worldId, assetId)

  const deleteRegistry = validBool(args.deleteRegistry, true)
  if (deleteRegistry) {
    await callInternalJson<{ success: boolean }>(`/api/conjure/${assetId}`, {
      method: 'DELETE',
    })
  }

  emitWorldEvent('conjured_asset_removed', worldId, {
    assetId,
    deleteRegistry,
    ...mutationActorData(args),
  })

  return {
    ok: true,
    message: deleteRegistry
      ? `Removed conjured asset ${assetId} from world ${worldId} and banished it from the Forge.`
      : `Removed conjured asset ${assetId} from world ${worldId}.`,
    data: {
      assetId,
      worldId,
      deleteRegistry,
    },
  }
}

/** Called by the client-side screenshot bridge to deliver a captured frame. */
export function deliverScreenshot(
  captures: string | DeliveredScreenshotCapture[],
  requestId?: string,
): boolean {
  const job = requestId
    ? pendingScreenshotJobs.find(entry => entry.request.id === requestId) || null
    : activeScreenshotJob()
  if (!job) return false

  if (typeof captures === 'string') {
    const fallbackCapture: DeliveredScreenshotCapture = {
      viewId: job.request.views[0]?.id || 'view-1',
      base64: captures,
      format: job.request.format,
    }
    resolveScreenshotJob(job, captures ? [fallbackCapture] : [])
    return true
  }
  resolveScreenshotJob(job, captures.filter(capture => typeof capture.base64 === 'string' && capture.base64.length > 0))
  return true
}

/** Check if a screenshot is pending (called by client poll). */
export function isScreenshotPending(): boolean {
  return pendingScreenshotJobs.length > 0
}

export function getPendingScreenshotRequest(options?: { worldId?: string; requestId?: string }): PendingScreenshotRequest | null {
  const requestedRequestId = validStr(options?.requestId, '')
  const requestedWorldId = validStr(options?.worldId, '')
  const request = requestedRequestId
    ? pendingScreenshotJobs.find(entry => entry.request.id === requestedRequestId)?.request || null
    : requestedWorldId
      ? pendingScreenshotJobs.find(entry => !entry.request.worldId || entry.request.worldId === requestedWorldId)?.request || null
      : activeScreenshotJob()?.request || null
  if (!request) return null
  return {
    ...request,
    views: request.views.map(view => ({ ...view })),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCHER — call a tool by name
// ═══════════════════════════════════════════════════════════════════════════

export const TOOL_NAMES = Object.keys(tools)

const MUTATING_TOOLS = new Set([
  'place_object', 'craft_scene', 'modify_object', 'remove_object',
  'set_sky', 'set_ground_preset', 'paint_ground_tiles', 'add_light',
  'modify_light', 'set_behavior', 'set_avatar', 'walk_avatar_to',
  'play_avatar_animation', 'clear_world',
  'conjure_asset', 'process_conjured_asset', 'place_conjured_asset', 'delete_conjured_asset',
])

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const handler = tools[name]
  if (!handler) {
    return { ok: false, message: `Unknown tool: ${name}. Available: ${TOOL_NAMES.join(', ')}` }
  }
  try {
    // Serialize mutating operations on the active world to prevent lost-update races
    if (MUTATING_TOOLS.has(name)) {
      // Resolve worldId for locking (all mutating tools use the active world)
      const worldId = validStr(args.worldId, '__active__')
      return await withWorldLock(worldId, () => handler(args))
    }
    return await handler(args)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[OasisTools] ${name} failed:`, msg)
    return { ok: false, message: `Tool ${name} failed: ${msg}` }
  }
}

// ▓▓▓▓【O̸A̸S̸I̸S̸】▓▓▓▓ॐ▓▓▓▓【T̸O̸O̸L̸S̸】▓▓▓▓
