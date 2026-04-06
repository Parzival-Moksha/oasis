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
import { emitWorldEvent } from './world-events'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG_MAP = new Map(ASSET_CATALOG.map(a => [a.id, a]))
// Don't filter by userId — local-first means all worlds accessible
// Old SaaS worlds have Google OAuth IDs, new ones have "local-user"

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function validPos(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null
  const [x, y, z] = v.map(Number)
  if ([x, y, z].some(n => !Number.isFinite(n))) return null
  return [x, y, z]
}

function validStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function validNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
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
  // Find most recently updated world for local-user
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

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RESULT TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolResult {
  ok: boolean
  message: string
  data?: unknown
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
      conjuredAssetCount: (state.conjuredAssetIds || []).length,
      behaviors: state.behaviors || {},
    },
  }
}

tools.get_world_info = async (args) => {
  const worldId = validStr(args.worldId, '')
  let world
  if (worldId) {
    world = await prisma.world.findFirst({ where: { id: worldId } })
  } else {
    world = await prisma.world.findFirst({ orderBy: { updatedAt: 'desc' } })
  }
  if (!world) return { ok: false, message: 'No world found.' }

  const state = world.data ? JSON.parse(world.data) as WorldState : null
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
  emitWorldEvent('object_added', worldId, { id, catalogId, position, placement })

  return { ok: true, message: `Placed ${asset.name} (${catalogId}) at [${position.join(', ')}] as ${id}`, data: { id, catalogId, position } }
}

tools.craft_scene = async (args) => {
  const name = validStr(args.name, 'Crafted Scene')
  const position = validPos(args.position) || [0, 0, 0]
  const rawObjects = Array.isArray(args.objects) ? args.objects : []

  const objects = rawObjects.filter(o => {
    if (!o || typeof o !== 'object') return false
    const obj = o as Record<string, unknown>
    return obj.type && obj.position && obj.scale && obj.color
  }) as CraftedScene['objects']

  if (objects.length === 0) return { ok: false, message: 'No valid primitives in scene. Each needs type, position, scale, color.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const id = `crafted-mcp-${uid()}`

  const scene: CraftedScene = {
    id, name, prompt: 'mcp-tool', objects, position, createdAt: new Date().toISOString(),
  }
  state.craftedScenes = [...(state.craftedScenes || []), scene]
  if (position.some(v => v !== 0)) {
    state.transforms[id] = { position }
  }
  await saveWorldState(worldId, state)
  emitWorldEvent('scene_crafted', worldId, { id, name })

  return { ok: true, message: `Created scene "${name}" with ${objects.length} primitives as ${id}`, data: { id, name, objectCount: objects.length } }
}

tools.modify_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const changes: string[] = []

  // Find in catalog placements
  const catalogIdx = (state.catalogPlacements || []).findIndex(p => p.id === objectId)
  if (catalogIdx >= 0) {
    const p = state.catalogPlacements![catalogIdx]
    if (args.position) { p.position = validPos(args.position) || p.position; changes.push('position') }
    if (args.rotation) { p.rotation = validPos(args.rotation) || p.rotation; changes.push('rotation') }
    if (args.scale !== undefined) { p.scale = validNum(args.scale, p.scale); changes.push('scale') }
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
    }
    state.agentAvatars![avatarIdx] = avatar
  }

  // Update transform overrides
  const pos = validPos(args.position)
  const rot = validPos(args.rotation)
  const scl = args.scale !== undefined ? validNum(args.scale, 1) : undefined
  if (pos || rot || scl !== undefined) {
    const existing = state.transforms[objectId] || { position: [0, 0, 0] as [number, number, number] }
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
  emitWorldEvent('object_modified', worldId, { objectId, changes })
  return { ok: true, message: `Modified ${objectId}: ${changes.join(', ')}` }
}

tools.remove_object = async (args) => {
  const objectId = validStr(args.objectId, '')
  if (!objectId) return { ok: false, message: 'objectId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const beforeCatalog = state.catalogPlacements?.length || 0
  const beforeCrafted = state.craftedScenes?.length || 0
  const beforeAvatars = state.agentAvatars?.length || 0

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
  emitWorldEvent('object_removed', worldId, { objectId })
  return { ok: true, message: `Removed ${objectId}.` }
}

tools.set_sky = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.skyBackgroundId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('sky_changed', worldId, { presetId })
  return { ok: true, message: `Sky set to ${presetId}.` }
}

tools.set_ground_preset = async (args) => {
  const presetId = validStr(args.presetId, '')
  if (!presetId) return { ok: false, message: 'presetId is required (none, grass, sand, dirt, stone, snow, water).' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.groundPresetId = presetId
  await saveWorldState(worldId, state)
  emitWorldEvent('ground_changed', worldId, { presetId })
  return { ok: true, message: `Ground set to ${presetId}.` }
}

tools.paint_ground_tiles = async (args) => {
  const tiles = Array.isArray(args.tiles) ? args.tiles : []
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
  emitWorldEvent('tiles_painted', worldId, { painted })
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
  emitWorldEvent('light_added', worldId, { id, type, position })

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
  emitWorldEvent('light_modified', worldId, { lightId, changes })

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
  emitWorldEvent('behavior_set', worldId, { objectId, movement })
  return { ok: true, message: `Set behavior on ${objectId}: movement=${movement}` }
}

tools.set_avatar = async (args) => {
  const avatarUrl = validStr(args.avatarUrl || args.url, '')
  if (!avatarUrl) return { ok: false, message: 'avatarUrl is required.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const requestedAvatarId = validStr(args.avatarId, '')
  const linkedWindowId = validStr(args.linkedWindowId, '')
  const agentType = validStr(args.agent || args.agentType, linkedWindowId ? 'anorak' : 'hermes').toLowerCase()
  const label = validStr(args.label, '')
  const position = validPos(args.position)
  const rotation = validPos(args.rotation)
  const scale = validNum(args.scale, agentType === 'hermes' ? 1.15 : 1)

  let avatarId = requestedAvatarId
  let existing = requestedAvatarId
    ? (state.agentAvatars || []).find(avatar => avatar.id === requestedAvatarId)
    : null

  if (!existing && linkedWindowId) {
    existing = (state.agentAvatars || []).find(avatar => avatar.linkedWindowId === linkedWindowId) || null
    avatarId = existing?.id || `agent-avatar-${linkedWindowId}`
  }

  if (!existing && agentType === 'hermes') {
    existing = (state.agentAvatars || []).find(avatar => avatar.agentType === 'hermes') || null
    avatarId = existing?.id || 'agent-avatar-hermes'
  }

  if (!existing && !avatarId) {
    avatarId = `agent-avatar-${agentType}-${uid()}`
  }

  const nextAvatar = existing
    ? {
        ...existing,
        avatar3dUrl: avatarUrl,
        label: label || existing.label,
        position: position || existing.position,
        rotation: rotation || existing.rotation,
        scale: Number.isFinite(Number(args.scale)) ? scale : existing.scale,
        linkedWindowId: linkedWindowId || existing.linkedWindowId,
        agentType: validStr(agentType, existing.agentType) as typeof existing.agentType,
      }
    : {
        id: avatarId,
        agentType: agentType as 'anorak' | 'anorak-pro' | 'merlin' | 'devcraft' | 'parzival' | 'mission' | 'hermes',
        avatar3dUrl: avatarUrl,
        position: position || [0, 0, 3.2],
        rotation: rotation || [0, Math.PI, 0],
        scale,
        ...(linkedWindowId ? { linkedWindowId } : {}),
        ...(label ? { label } : {}),
      }

  if (existing) {
    state.agentAvatars = (state.agentAvatars || []).map(avatar => avatar.id === nextAvatar.id ? nextAvatar : avatar)
  } else {
    state.agentAvatars = [...(state.agentAvatars || []), nextAvatar]
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_set', worldId, {
    avatarId: nextAvatar.id,
    agentType: nextAvatar.agentType,
    linkedWindowId: nextAvatar.linkedWindowId,
  })

  return {
    ok: true,
    message: `Avatar ${nextAvatar.id} now uses ${avatarUrl}.`,
    data: nextAvatar,
  }
}

tools.walk_avatar_to = async (args) => {
  const avatarId = validStr(args.avatarId, '')
  if (!avatarId) return { ok: false, message: 'avatarId is required.' }
  const target = validPos(args.position || args.target)
  if (!target) return { ok: false, message: 'position is required as [x, y, z].' }
  const moveSpeed = validNum(args.speed, 3)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const avatar = (state.agentAvatars || []).find(entry => entry.id === avatarId)
  if (!avatar) return { ok: false, message: `Avatar ${avatarId} not found.` }

  const existing = state.behaviors?.[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors = state.behaviors || {}
  state.behaviors[avatarId] = {
    ...existing,
    visible: existing.visible ?? true,
    moveTarget: target,
    moveSpeed,
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_walk', worldId, { avatarId, target, moveSpeed })
  return { ok: true, message: `Avatar ${avatarId} is walking to [${target.join(', ')}].`, data: { avatarId, target, moveSpeed } }
}

tools.play_avatar_animation = async (args) => {
  const avatarId = validStr(args.avatarId, '')
  if (!avatarId) return { ok: false, message: 'avatarId is required.' }
  const clipName = validStr(args.clipName || args.animation || args.name, '')
  if (!clipName) return { ok: false, message: 'clipName is required.' }
  const loop = validStr(args.loop, 'repeat')
  const speed = validNum(args.speed, 1)

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  const avatar = (state.agentAvatars || []).find(entry => entry.id === avatarId)
  if (!avatar) return { ok: false, message: `Avatar ${avatarId} not found.` }

  state.behaviors = state.behaviors || {}
  const existing = state.behaviors[avatarId] || { visible: true, movement: { type: 'static' as const } }
  state.behaviors[avatarId] = {
    ...existing,
    visible: existing.visible ?? true,
    animation: {
      clipName: clipName.startsWith('lib:') ? clipName : `lib:${clipName}`,
      loop: loop === 'once' || loop === 'pingpong' ? loop : 'repeat',
      speed,
    },
  }

  await saveWorldState(worldId, state)
  emitWorldEvent('agent_avatar_animation', worldId, { avatarId, clipName, loop, speed })
  return { ok: true, message: `Avatar ${avatarId} is now playing ${clipName}.`, data: { avatarId, clipName, loop, speed } }
}

tools.clear_world = async (args) => {
  if (!args.confirm) return { ok: false, message: 'clear_world requires confirm: true. This is destructive.' }

  const { worldId, state } = await loadRequestedWorld(args.worldId)
  state.catalogPlacements = []
  state.craftedScenes = []
  state.agentAvatars = []
  state.lights = []
  state.transforms = {}
  state.behaviors = {}
  state.groundTiles = {}
  await saveWorldState(worldId, state)
  emitWorldEvent('world_cleared', worldId)

  return { ok: true, message: 'World cleared. All objects, lights, tiles, and behaviors removed.' }
}

// ─═̷─═̷─ WORLD MANAGEMENT ─═̷─═̷─

tools.list_worlds = async () => {
  const worlds = await prisma.world.findMany({
    select: { id: true, name: true, icon: true, objectCount: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
  return { ok: true, message: `${worlds.length} worlds.`, data: worlds.map(w => ({ id: w.id, name: w.name, icon: w.icon, objectCount: w.objectCount, lastSaved: w.updatedAt.toISOString() })) }
}

tools.load_world = async (args) => {
  const worldId = validStr(args.worldId, '')
  if (!worldId) return { ok: false, message: 'worldId is required.' }
  const state = await loadWorldById(worldId)
  return { ok: true, message: `Loaded world ${worldId}.`, data: { worldId, objectCount: (state.catalogPlacements?.length || 0) + (state.craftedScenes?.length || 0) } }
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
    data: { id, userId: 'local-user', name, icon, data: JSON.stringify(emptyState), createdAt: now, updatedAt: now },
  })

  return { ok: true, message: `Created world "${name}" (${id}).`, data: { worldId: id, name } }
}

// ─═̷─═̷─ SCREENSHOT (signal-based) ─═̷─═̷─

// Screenshot is a client-side operation. The MCP tool signals a request
// and the browser captures via canvas.toDataURL(). The result is stored
// temporarily and the tool returns it.
// For v1: return a placeholder indicating the screenshot was requested.
// The actual implementation requires a client-side event bridge.

let pendingScreenshotResolve: ((data: string) => void) | null = null
let pendingScreenshotTimeout: ReturnType<typeof setTimeout> | null = null

tools.screenshot_viewport = async (args) => {
  const format = validStr(args.format, 'jpeg')
  const quality = validNum(args.quality, 0.75)

  // If a previous pending screenshot exists, resolve it empty
  if (pendingScreenshotResolve) {
    pendingScreenshotResolve('')
    pendingScreenshotResolve = null
  }
  if (pendingScreenshotTimeout) {
    clearTimeout(pendingScreenshotTimeout)
    pendingScreenshotTimeout = null
  }

  return new Promise<ToolResult>((resolve) => {
    pendingScreenshotResolve = (base64: string) => {
      pendingScreenshotResolve = null
      if (pendingScreenshotTimeout) { clearTimeout(pendingScreenshotTimeout); pendingScreenshotTimeout = null }
      if (!base64) {
        resolve({ ok: false, message: 'Screenshot capture timed out or failed.' })
      } else {
        resolve({ ok: true, message: `Screenshot captured (${format}, quality ${quality}).`, data: { base64, format } })
      }
    }

    // Timeout after 10 seconds
    pendingScreenshotTimeout = setTimeout(() => {
      if (pendingScreenshotResolve) {
        pendingScreenshotResolve('')
        pendingScreenshotResolve = null
      }
    }, 10000)
  })
}

/** Called by the client-side screenshot bridge to deliver a captured frame. */
export function deliverScreenshot(base64: string): boolean {
  if (pendingScreenshotResolve) {
    pendingScreenshotResolve(base64)
    return true
  }
  return false
}

/** Check if a screenshot is pending (called by client poll). */
export function isScreenshotPending(): boolean {
  return pendingScreenshotResolve !== null
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
