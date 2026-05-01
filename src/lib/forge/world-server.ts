// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD SERVER — The bedrock beneath all worlds
// ─═̷─═̷─ॐ─═̷─═̷─ SQLite local-first persistence ─═̷─═̷─ॐ─═̷─═̷─
//
// v4: Local SQLite via Prisma. One row per world, JSON data column.
// No Supabase dependency. No internet required. Fully offline.
//
// SERVER-ONLY — never import from client code.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { prisma } from '../db'
import { normalizeWorldStateAgentAvatarTransforms } from '../agent-avatar-world-state'
import { getOasisMode } from '../oasis-profile'
import { isAdminUserId } from '../admin-auth'
import {
  DISCOVERABLE_VISIBILITIES,
  FFA_VISIBILITIES,
  PUBLICLY_READABLE_VISIBILITIES,
  WorldAccessError,
  assertCanEditWorldSettings,
  canDiscoverWorld,
  canEditWorldSettings,
  canReadWorld,
  getWorldWriteDecision,
  normalizeWorldKind,
  toStorageVisibility,
  type WorldAccessContext,
  type WorldAccessSubject,
} from './world-access'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

import type { WorldMeta, WorldState } from './world-persistence'
export type { WorldState, WorldMeta }

export interface SnapshotMeta {
  id: string
  world_id: string
  object_count: number
  source: 'auto' | 'manual'
  created_at: string
}

export interface SaveWorldResult {
  saved: boolean
  conflict?: boolean
  serverUpdatedAt?: string
  worldId?: string
  forkedFromWorldId?: string
}

const MAX_SNAPSHOTS_PER_WORLD = 20
const SNAPSHOT_THROTTLE_MS = 5 * 60 * 1000

function normalizeSavedWorldState(state: WorldState): WorldState {
  return normalizeWorldStateAgentAvatarTransforms(state)
}

function accessContext(userId?: string): WorldAccessContext {
  const resolvedUserId = userId || 'local-user'
  return {
    userId: resolvedUserId,
    mode: getOasisMode(),
    admin: isAdminUserId(resolvedUserId),
  }
}

function toAccessSubject(row: WorldAccessSubject): WorldAccessSubject {
  return {
    id: row.id,
    userId: row.userId,
    visibility: row.visibility || 'private',
  }
}

function countWorldObjects(state: Pick<WorldState, 'conjuredAssetIds' | 'catalogPlacements' | 'craftedScenes'>): number {
  return (state.conjuredAssetIds?.length || 0) +
    (state.catalogPlacements?.length || 0) +
    (state.craftedScenes?.length || 0)
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function toWorldMeta(
  row: { id: string; userId?: string; name: string; icon: string; visibility: string; createdAt: Date; updatedAt: Date },
  ctx?: WorldAccessContext,
): WorldMeta {
  const subject = row.userId ? toAccessSubject(row as WorldAccessSubject) : null
  const writeDecision = ctx && subject ? getWorldWriteDecision(ctx, subject) : undefined
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || '🌍',
    visibility: (row.visibility as WorldMeta['visibility']) || 'private',
    canWrite: writeDecision ? writeDecision !== 'deny' : undefined,
    canEditSettings: ctx && subject ? canEditWorldSettings(ctx, subject) : undefined,
    writeDecision,
    createdAt: row.createdAt.toISOString(),
    lastSavedAt: row.updatedAt.toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY — local lists everything; hosted lists owned + discoverable worlds.
// ═══════════════════════════════════════════════════════════════════════════

export async function getRegistry(userId?: string): Promise<WorldMeta[]> {
  const ctx = accessContext(userId)
  const worlds = await prisma.world.findMany({
    select: { id: true, userId: true, name: true, icon: true, visibility: true, createdAt: true, updatedAt: true },
    where: ctx.mode === 'hosted' && !ctx.admin
      ? {
          OR: [
            { userId: ctx.userId },
            { visibility: { in: DISCOVERABLE_VISIBILITIES } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'asc' },
  })

  if (worlds.length === 0) {
    const defaultWorld = await createWorld('The Forge', '🔥', ctx.userId)
    return [defaultWorld]
  }

  return worlds
    .filter(world => canDiscoverWorld(ctx, toAccessSubject(world)))
    .map(world => toWorldMeta(world, ctx))
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD — Fetch a single world's full state
// ═══════════════════════════════════════════════════════════════════════════

export async function loadWorld(id: string, userId?: string): Promise<WorldState | null> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, visibility: true, data: true },
  })
  if (!world) return null
  if (!canReadWorld(ctx, toAccessSubject(world))) return null
  if (!world?.data) return null
  return normalizeSavedWorldState(JSON.parse(world.data) as WorldState)
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE — Upsert world state with auto-snapshot
// ═══════════════════════════════════════════════════════════════════════════

async function forkTemplateWorld(
  template: { id: string; name: string; icon: string; visibility: string },
  userId: string,
  worldData: WorldState,
  now: Date,
): Promise<WorldMeta> {
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const world = await prisma.world.create({
    data: {
      id,
      userId,
      name: template.name,
      icon: template.icon,
      visibility: 'private',
      data: JSON.stringify(worldData),
      objectCount: countWorldObjects(worldData),
      createdAt: now,
      updatedAt: now,
    },
  })

  console.log(`[WorldServer] Forked template ${template.id} -> ${id} for user ${userId}`)
  return toWorldMeta(world, accessContext(userId))
}

export async function saveWorld(
  id: string,
  userId: string,
  state: Omit<WorldState, 'version' | 'savedAt'>,
  clientLoadedAt?: string
): Promise<SaveWorldResult> {
  const ctx = accessContext(userId)
  const now = new Date()
  const worldData = normalizeSavedWorldState({ version: 1, ...state, savedAt: now.toISOString() })

  const target = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, name: true, icon: true, visibility: true, updatedAt: true },
  })
  if (!target) {
    throw new WorldAccessError('World not found', 'world_not_found', 404)
  }

  const writeDecision = getWorldWriteDecision(ctx, toAccessSubject(target))
  if (writeDecision === 'deny') {
    throw new WorldAccessError('This session cannot mutate that world', 'world_write_forbidden')
  }

  if (writeDecision === 'fork') {
    const fork = await forkTemplateWorld(target, ctx.userId, worldData, now)
    return { saved: true, worldId: fork.id, forkedFromWorldId: id }
  }

  // Optimistic concurrency check
  if (clientLoadedAt) {
    if (target.updatedAt && target.updatedAt.toISOString() > clientLoadedAt) {
      console.warn(`[WorldServer] ⚠️ CONFLICT on ${id}`)
      return { saved: false, conflict: true, serverUpdatedAt: target.updatedAt.toISOString() }
    }
  }

  // Auto-snapshot before overwriting
  await snapshotBeforeSave(id)

  await prisma.world.update({
    where: { id },
    data: {
      data: JSON.stringify(worldData),
      objectCount: countWorldObjects(worldData),
      updatedAt: now,
    },
  })

  return { saved: true, worldId: id }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE — New world
// ═══════════════════════════════════════════════════════════════════════════

export async function createWorld(name: string, icon = '🌍', userId: string): Promise<WorldMeta> {
  const id = `world-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date()

  const emptyState: WorldState = {
    version: 1,
    terrain: null,
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    transforms: {},
    savedAt: now.toISOString(),
  }

  const world = await prisma.world.create({
    data: {
      id,
      userId,
      name,
      icon,
      data: JSON.stringify(emptyState),
      createdAt: now,
      updatedAt: now,
    },
  })

  console.log(`[WorldServer] Created world "${name}" (${id}) for user ${userId}`)
  return toWorldMeta(world, accessContext(userId))
}

// ═══════════════════════════════════════════════════════════════════════════
// DELETE
// ═══════════════════════════════════════════════════════════════════════════

export async function deleteWorld(id: string, userId?: string): Promise<void> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) return
  assertCanEditWorldSettings(ctx, toAccessSubject(world))
  await prisma.world.deleteMany({ where: { id } })
}

// ═══════════════════════════════════════════════════════════════════════════
// VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════

export async function setWorldVisibility(
  id: string,
  userId: string,
  visibility: string
): Promise<void> {
  const nextVisibility = toStorageVisibility(visibility)
  if (!nextVisibility) {
    throw new WorldAccessError('Unsupported world visibility', 'invalid_world_visibility', 400)
  }

  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) {
    throw new WorldAccessError('World not found', 'world_not_found', 404)
  }
  assertCanEditWorldSettings(ctx, toAccessSubject(world))

  const nextKind = normalizeWorldKind(nextVisibility)
  if (!ctx.system && !ctx.admin && (nextKind === 'core' || nextKind === 'template')) {
    throw new WorldAccessError('Only system tools can mark core or template worlds', 'system_visibility_forbidden')
  }

  await prisma.world.updateMany({
    where: { id },
    data: {
      visibility: nextVisibility,
      creatorName: 'Player 1',
      updatedAt: new Date(),
    },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// METADATA — settings changes use stricter owner/system permissions.
// ═══════════════════════════════════════════════════════════════════════════

export async function updateWorldMetadata(
  id: string,
  userId: string,
  updates: { name?: string; icon?: string },
): Promise<boolean> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) return false
  assertCanEditWorldSettings(ctx, toAccessSubject(world))

  const data: Record<string, string | Date> = { updatedAt: new Date() }
  if (updates.name?.trim()) data.name = updates.name.trim().slice(0, 50)
  if (updates.icon) data.icon = updates.icon
  if (Object.keys(data).length === 1) return false

  const result = await prisma.world.updateMany({
    where: { id },
    data,
  })
  return result.count > 0
}

// SAVE FFA — anyone can edit if visibility is ffa/public_edit.
export async function savePublicEditWorld(
  id: string,
  state: Omit<WorldState, 'version' | 'savedAt'>
): Promise<boolean> {
  const now = new Date()
  const worldData = normalizeSavedWorldState({ version: 1, ...state, savedAt: now.toISOString() })

  await snapshotBeforeSave(id)

  const result = await prisma.world.updateMany({
    where: { id, visibility: { in: FFA_VISIBILITIES } },
    data: {
      data: JSON.stringify(worldData),
      objectCount: countWorldObjects(worldData),
      updatedAt: now,
    },
  })

  return result.count > 0
}

// ═══════════════════════════════════════════════════════════════════════════
// VISIT COUNTER
// ═══════════════════════════════════════════════════════════════════════════

export async function recordVisit(worldId: string): Promise<void> {
  await prisma.world.update({
    where: { id: worldId },
    data: { visitCount: { increment: 1 } },
  }).catch(() => {}) // fire-and-forget
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD PUBLIC — no user_id check (for explore/view)
// ═══════════════════════════════════════════════════════════════════════════

export async function loadPublicWorld(id: string): Promise<{ state: WorldState; meta: WorldMeta & { creator_name?: string; creator_avatar?: string } } | null> {
  const world = await prisma.world.findFirst({
    where: { id, visibility: { in: PUBLICLY_READABLE_VISIBILITIES } },
  })

  if (!world?.data) return null

  return {
    state: normalizeSavedWorldState(JSON.parse(world.data) as WorldState),
    meta: {
      ...toWorldMeta(world),
      creator_name: world.creatorName || 'Player 1',
      creator_avatar: world.creatorAvatar || undefined,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE OBJECT COUNT
// ═══════════════════════════════════════════════════════════════════════════

export async function updateObjectCount(id: string, userId: string, count: number): Promise<void> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) return
  const decision = getWorldWriteDecision(ctx, toAccessSubject(world))
  if (decision === 'deny' || decision === 'fork') return
  await prisma.world.updateMany({
    where: { id },
    data: { objectCount: count },
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSET USAGE — Count how many times an asset appears across ALL worlds
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetUsageResult {
  totalCount: number
  worldCount: number
  currentWorldCount: number
}

/**
 * Count how many times an asset URL or conjured asset ID is used across all worlds.
 * Searches catalogPlacements (imageUrl/videoUrl/audioUrl), behaviors (audioUrl),
 * and customGroundPresets (customTextureUrl) for media.
 * Searches conjuredAssetIds for conjured assets.
 */
export async function countAssetUsageAcrossWorlds(
  userId: string,
  assetUrl: string,
  currentWorldId: string,
  type: 'media' | 'conjured' = 'media'
): Promise<AssetUsageResult> {
  const worlds = await prisma.world.findMany({
    where: { userId },
    select: { id: true, data: true },
  })

  let totalCount = 0
  let worldCount = 0
  let currentWorldCount = 0

  for (const world of worlds) {
    if (!world.data) continue
    try {
      const state = normalizeSavedWorldState(JSON.parse(world.data) as WorldState)
      let count = 0

      if (type === 'media') {
        // 1. catalogPlacements — imageUrl, videoUrl, audioUrl
        count += (state.catalogPlacements || []).filter(
          p => p.imageUrl === assetUrl || p.videoUrl === assetUrl || p.audioUrl === assetUrl
        ).length

        // 2. behaviors — audioUrl on any object (loudspeakers via behavior system)
        if (state.behaviors) {
          for (const b of Object.values(state.behaviors)) {
            if (b && b.audioUrl === assetUrl) count++
          }
        }

        // 3. customGroundPresets — images used as ground tiles
        if (state.customGroundPresets) {
          count += state.customGroundPresets.filter(
            p => p.customTextureUrl === assetUrl
          ).length
        }
      } else {
        // Count in conjuredAssetIds — match asset ID
        count = (state.conjuredAssetIds || []).filter(id => id === assetUrl).length
      }

      if (count > 0) {
        totalCount += count
        worldCount++
        if (world.id === currentWorldId) currentWorldCount = count
      }
    } catch { /* skip corrupt world data */ }
  }

  return { totalCount, worldCount, currentWorldCount }
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOTS — Auto-backup. Born from pain.
// ═══════════════════════════════════════════════════════════════════════════

async function snapshotBeforeSave(worldId: string, userId?: string): Promise<void> {
  try {
    // Throttle — skip if last snapshot is < 5 min old
    const lastSnap = await prisma.worldSnapshot.findFirst({
      where: { worldId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    if (lastSnap?.createdAt) {
      const elapsed = Date.now() - lastSnap.createdAt.getTime()
      if (elapsed < SNAPSHOT_THROTTLE_MS) return
    }

    // Fetch current state
    const where: { id: string; userId?: string } = { id: worldId }
    if (userId) where.userId = userId
    const current = await prisma.world.findFirst({ where, select: { data: true } })

    if (!current?.data) return

    const worldData = JSON.parse(current.data) as WorldState
    const objectCount =
      (worldData.conjuredAssetIds?.length || 0) +
      (worldData.catalogPlacements?.length || 0) +
      (worldData.craftedScenes?.length || 0)

    // Skip empty worlds
    if (objectCount === 0 && !worldData.terrain && (worldData.groundPresetId || 'none') === 'none') return

    // Insert snapshot
    await prisma.worldSnapshot.create({
      data: { worldId, data: current.data, objectCount, source: 'auto' },
    })

    // Prune old snapshots
    const allSnapshots = await prisma.worldSnapshot.findMany({
      where: { worldId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    if (allSnapshots.length > MAX_SNAPSHOTS_PER_WORLD) {
      const toDelete = allSnapshots.slice(MAX_SNAPSHOTS_PER_WORLD).map(s => s.id)
      await prisma.worldSnapshot.deleteMany({ where: { id: { in: toDelete } } })
    }
  } catch (err) {
    console.error(`[WorldServer] Snapshot failed for ${worldId}:`, err)
  }
}

export async function listSnapshots(worldId: string, userId: string): Promise<SnapshotMeta[]> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) return []
  assertCanEditWorldSettings(ctx, toAccessSubject(world))

  const snapshots = await prisma.worldSnapshot.findMany({
    where: { worldId },
    orderBy: { createdAt: 'desc' },
    take: MAX_SNAPSHOTS_PER_WORLD,
    select: { id: true, worldId: true, objectCount: true, source: true, createdAt: true },
  })

  return snapshots.map(s => ({
    id: s.id,
    world_id: s.worldId,
    object_count: s.objectCount,
    source: s.source as 'auto' | 'manual',
    created_at: s.createdAt.toISOString(),
  }))
}

export async function loadSnapshot(snapshotId: string): Promise<WorldState | null> {
  const snap = await prisma.worldSnapshot.findUnique({
    where: { id: snapshotId },
    select: { data: true },
  })
  if (!snap?.data) return null
  return normalizeSavedWorldState(JSON.parse(snap.data) as WorldState)
}

export async function restoreSnapshot(
  worldId: string,
  userId: string,
  snapshotId: string
): Promise<boolean> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, visibility: true },
  })
  if (!world) return false
  assertCanEditWorldSettings(ctx, toAccessSubject(world))

  const snapshotState = await loadSnapshot(snapshotId)
  if (!snapshotState) return false

  // Snapshot current state first (undo safety)
  await snapshotBeforeSave(worldId)

  const now = new Date()
  const worldData = normalizeSavedWorldState({ ...snapshotState, savedAt: now.toISOString() })
  await prisma.world.updateMany({
    where: { id: worldId },
    data: {
      data: JSON.stringify(worldData),
      objectCount: countWorldObjects(worldData),
      updatedAt: now,
    },
  })

  console.log(`[WorldServer] ✅ Restored snapshot ${snapshotId} → world ${worldId}`)
  return true
}

export async function createManualSnapshot(worldId: string, userId: string): Promise<{ ok: true; objectCount: number } | null> {
  const ctx = accessContext(userId)
  const world = await prisma.world.findFirst({
    where: { id: worldId },
    select: { id: true, userId: true, visibility: true, data: true },
  })
  if (!world?.data) return null
  assertCanEditWorldSettings(ctx, toAccessSubject(world))

  const worldState = normalizeSavedWorldState(JSON.parse(world.data) as WorldState)
  const objectCount = countWorldObjects(worldState)
  await prisma.worldSnapshot.create({
    data: {
      worldId,
      data: JSON.stringify(worldState),
      objectCount,
      source: 'manual',
    },
  })
  return { ok: true, objectCount }
}

// ▓▓▓▓【W̸O̸R̸L̸D̸】▓▓▓▓ॐ▓▓▓▓【S̸E̸R̸V̸E̸R̸】▓▓▓▓
