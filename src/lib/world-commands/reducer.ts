import type { CatalogPlacement, CraftedScene, ObjectBehavior, WorldLight } from '@/lib/conjure/types'
import {
  applyTerrainBrush,
  createFlatTerrainHeights,
} from '@/lib/forge/terrain-brush'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { PaintStroke } from '@/lib/forge/paint-stroke'
import type { Text3DObject } from '@/lib/forge/text-3d-object'
import type { PortalGate } from '@/lib/portal-gates'
import type { SpatialWebObject } from '@/lib/spatial-web'
import type { AgentAvatar, AgentWindow } from '@/lib/agent-window-types'
import type {
  ScopedSpatialWebObject,
  WorldCommandApplyResult,
  WorldCommandEnvelope,
  WorldCommandKind,
  WorldMediaBehavior,
  WorldTransformPatch,
} from './types'
import { commandTouchesDurableWorldState } from './types'

type Identified = { id: string }

function upsertById<T extends Identified>(items: T[] | undefined, item: T): T[] {
  const source = items || []
  const index = source.findIndex(candidate => candidate.id === item.id)
  if (index < 0) return [...source, item]
  return source.map(candidate => candidate.id === item.id ? item : candidate)
}

function patchById<T extends Identified>(items: T[] | undefined, id: string, updates: Partial<T>): T[] {
  const source = items || []
  let changed = false
  const next = source.map(item => {
    if (item.id !== id) return item
    changed = true
    return { ...item, ...updates }
  })
  return changed ? next : source
}

function removeById<T extends Identified>(items: T[] | undefined, id: string): T[] {
  const source = items || []
  return source.filter(item => item.id !== id)
}

function removeManyById<T extends Identified>(items: T[] | undefined, ids: Set<string>): T[] {
  const source = items || []
  if (ids.size === 0) return source
  return source.filter(item => !ids.has(item.id))
}

function deleteKeys<T>(record: Record<string, T> | undefined, ids: Set<string>): Record<string, T> {
  const next = { ...(record || {}) }
  for (const id of ids) delete next[id]
  return next
}

function patchRecord<T>(record: Record<string, T> | undefined, id: string, value: T): Record<string, T> {
  return {
    ...(record || {}),
    [id]: value,
  }
}

function encodeGroundTileValue(presetId: string, stretch: number): string {
  const normalizedStretch = Math.max(1, Math.floor(stretch || 1))
  return normalizedStretch === 1 ? presetId : `${presetId}@${normalizedStretch}`
}

function decodeGroundTileValue(raw: string): { presetId: string; stretch: number } {
  const at = raw.lastIndexOf('@')
  if (at <= 0) return { presetId: raw, stretch: 1 }
  const presetId = raw.slice(0, at)
  const parsedStretch = Number(raw.slice(at + 1))
  return {
    presetId,
    stretch: Number.isFinite(parsedStretch) && parsedStretch >= 1
      ? Math.floor(parsedStretch)
      : 1,
  }
}

function parseGroundTileKey(key: string): [number, number] | null {
  const [xRaw, zRaw] = key.split(',')
  const x = Number(xRaw)
  const z = Number(zRaw)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return [Math.floor(x), Math.floor(z)]
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && bMin < aMax
}

function removeGroundTilesOverlapping(
  groundTiles: Record<string, string>,
  x: number,
  z: number,
  stretch: number,
): void {
  const nextMaxX = x + stretch
  const nextMaxZ = z + stretch
  for (const [key, value] of Object.entries(groundTiles)) {
    const parsed = parseGroundTileKey(key)
    if (!parsed) continue
    const [existingX, existingZ] = parsed
    const existing = decodeGroundTileValue(value)
    const existingMaxX = existingX + existing.stretch
    const existingMaxZ = existingZ + existing.stretch
    if (
      rangesOverlap(x, nextMaxX, existingX, existingMaxX)
      && rangesOverlap(z, nextMaxZ, existingZ, existingMaxZ)
    ) {
      delete groundTiles[key]
    }
  }
}

export function paintGroundTilesForCommand(
  groundTiles: Record<string, string> | undefined,
  cx: number,
  cz: number,
  presetId: string,
  size = 1,
  stretch = 1,
): Record<string, string> {
  const normalizedStretch = Math.max(1, Math.floor(stretch || 1))
  const half = Math.floor(Math.max(1, Math.min(5, Math.floor(size || 1))) / 2)
  const nextTiles = { ...(groundTiles || {}) }
  const baseX = Math.floor(cx / normalizedStretch) * normalizedStretch
  const baseZ = Math.floor(cz / normalizedStretch) * normalizedStretch
  const cellValue = encodeGroundTileValue(presetId, normalizedStretch)
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const tx = baseX + dx * normalizedStretch
      const tz = baseZ + dz * normalizedStretch
      if (tx < -50 || tx + normalizedStretch > 50 || tz < -50 || tz + normalizedStretch > 50) continue
      removeGroundTilesOverlapping(nextTiles, tx, tz, normalizedStretch)
      nextTiles[`${tx},${tz}`] = cellValue
    }
  }
  return nextTiles
}

function removeGroundTileContaining(
  groundTiles: Record<string, string> | undefined,
  x: number,
  z: number,
): Record<string, string> {
  const cellX = Math.floor(x)
  const cellZ = Math.floor(z)
  const next = { ...(groundTiles || {}) }
  for (const [key, value] of Object.entries(next)) {
    const parsed = parseGroundTileKey(key)
    if (!parsed) continue
    const [tileX, tileZ] = parsed
    const { stretch } = decodeGroundTileValue(value)
    if (cellX >= tileX && cellX < tileX + stretch && cellZ >= tileZ && cellZ < tileZ + stretch) {
      delete next[key]
    }
  }
  return next
}

function patchTransform(
  transforms: WorldState['transforms'] | undefined,
  id: string,
  patch: WorldTransformPatch,
): WorldState['transforms'] {
  const existing = transforms?.[id] || {}
  return {
    ...(transforms || {}),
    [id]: {
      ...existing,
      ...(patch.position ? { position: patch.position } : {}),
      ...(patch.rotation ? { rotation: patch.rotation } : {}),
      ...(patch.scale !== undefined ? { scale: patch.scale } : {}),
    },
  }
}

function updateBehavior(
  behaviors: WorldState['behaviors'] | undefined,
  id: string,
  updates: Partial<ObjectBehavior> & { moveTarget?: [number, number, number] | null },
): WorldState['behaviors'] {
  const existing = behaviors?.[id] || { movement: { type: 'static' }, visible: true }
  const next: ObjectBehavior = { ...existing, ...updates }
  if (updates.moveTarget === null) delete next.moveTarget
  return patchRecord(behaviors, id, next)
}

function updateMediaBehavior(
  behaviors: WorldState['behaviors'] | undefined,
  payload: Extract<WorldCommandEnvelope<'media.playback.set'>['payload'], { objectId: string }>,
): WorldState['behaviors'] {
  const existing = behaviors?.[payload.objectId] || { movement: { type: 'static' }, visible: true }
  const next: WorldMediaBehavior = {
    ...existing,
    audioState: payload.state,
    audioPlaybackScope: payload.playbackScope,
    audioUpdatedAt: payload.updatedAt,
  }
  if (payload.audioUrl !== undefined) next.audioUrl = payload.audioUrl
  if (payload.volume !== undefined) next.audioVolume = payload.volume
  if (payload.maxDistance !== undefined) next.audioMaxDistance = payload.maxDistance
  if (payload.muted !== undefined) next.audioMuted = payload.muted
  if (payload.loop !== undefined) next.audioLoop = payload.loop
  if (payload.playbackId !== undefined) next.audioPlaybackId = payload.playbackId
  if (payload.startedAt !== undefined) next.audioStartedAt = payload.startedAt
  return patchRecord(behaviors, payload.objectId, next)
}

export function applyWorldCommand(
  state: WorldState,
  command: WorldCommandEnvelope,
): WorldCommandApplyResult {
  const nextSavedAt = commandTouchesDurableWorldState(command.kind)
    ? command.createdAt || state.savedAt
    : state.savedAt

  switch (command.kind) {
    case 'object.add': {
      return changed(state, {
        catalogPlacements: upsertById(state.catalogPlacements, command.payload.object),
        savedAt: nextSavedAt,
      })
    }
    case 'object.update': {
      return changed(state, {
        catalogPlacements: patchById<CatalogPlacement>(state.catalogPlacements, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    }
    case 'object.remove': {
      const ids = new Set([command.payload.id, ...(command.payload.linkedAvatarIds || [])])
      return changed(state, {
        catalogPlacements: removeById(state.catalogPlacements, command.payload.id),
        craftedScenes: removeById(state.craftedScenes, command.payload.id),
        conjuredAssetIds: (state.conjuredAssetIds || []).filter(id => id !== command.payload.id),
        portalGates: removeById(state.portalGates, command.payload.id),
        spatialWebObjects: removeById(state.spatialWebObjects, command.payload.id),
        lights: removeById(state.lights, command.payload.id),
        paintStrokes: removeById(state.paintStrokes, command.payload.id),
        text3dObjects: removeById(state.text3dObjects, command.payload.id),
        agentWindows: (state.agentWindows || [])
          .filter(window => window.id !== command.payload.id)
          .map(window => ids.has(window.linkedAvatarId || '')
            ? { ...window, linkedAvatarId: undefined, anchorMode: 'detached' as const }
            : window),
        agentAvatars: removeManyById(state.agentAvatars, ids),
        transforms: deleteKeys(state.transforms, ids),
        behaviors: deleteKeys(state.behaviors, ids),
        savedAt: nextSavedAt,
      })
    }
    case 'object.transform': {
      return changed(state, {
        transforms: patchTransform(state.transforms, command.payload.id, command.payload),
        savedAt: nextSavedAt,
      })
    }
    case 'object.behavior.update': {
      return changed(state, {
        behaviors: updateBehavior(state.behaviors, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    }

    case 'crafted.add':
      return changed(state, {
        craftedScenes: upsertById(state.craftedScenes, command.payload.scene),
        savedAt: nextSavedAt,
      })
    case 'crafted.update':
      return changed(state, {
        craftedScenes: patchById<CraftedScene>(state.craftedScenes, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'crafted.remove':
      return changed(state, {
        craftedScenes: removeById(state.craftedScenes, command.payload.id),
        savedAt: nextSavedAt,
      })

    case 'portal.add':
      return changed(state, {
        portalGates: upsertById(state.portalGates, command.payload.gate),
        savedAt: nextSavedAt,
      })
    case 'portal.update':
      return changed(state, {
        portalGates: patchById<PortalGate>(state.portalGates, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'portal.remove':
      return changed(state, {
        portalGates: removeById(state.portalGates, command.payload.id),
        savedAt: nextSavedAt,
      })

    case 'spatial.add':
      return changed(state, {
        spatialWebObjects: upsertById<ScopedSpatialWebObject>(state.spatialWebObjects, command.payload.object),
        savedAt: nextSavedAt,
      })
    case 'spatial.update':
      return changed(state, {
        spatialWebObjects: patchById<SpatialWebObject>(state.spatialWebObjects, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'spatial.remove':
      return changed(state, {
        spatialWebObjects: removeById(state.spatialWebObjects, command.payload.id),
        savedAt: nextSavedAt,
      })
    case 'spatial.value.set':
      if (command.payload.stateScope && command.payload.stateScope !== 'world') {
        return { state, changed: false }
      }
      return changed(state, {
        spatialWebObjects: patchById<SpatialWebObject>(state.spatialWebObjects, command.payload.id, {
          value: command.payload.value,
          lastEvent: command.payload.event,
          lastInteractionAt: command.createdAt,
          statusMessage: command.payload.statusMessage,
          errorMessage: command.payload.errorMessage === null ? undefined : command.payload.errorMessage,
        }),
        savedAt: nextSavedAt,
      })

    case 'ground.setPreset':
      return changed(state, { groundPresetId: command.payload.groundPresetId, savedAt: nextSavedAt })
    case 'ground.paint':
      return changed(state, {
        groundTiles: paintGroundTilesForCommand(
          state.groundTiles,
          command.payload.cx,
          command.payload.cz,
          command.payload.presetId,
          command.payload.size,
          command.payload.stretch,
        ),
        savedAt: nextSavedAt,
      })
    case 'ground.tile.erase':
      return changed(state, {
        groundTiles: removeGroundTileContaining(state.groundTiles, command.payload.x, command.payload.z),
        savedAt: nextSavedAt,
      })
    case 'ground.tiles.clear':
      return changed(state, { groundTiles: {}, savedAt: nextSavedAt })

    case 'terrain.brush':
      return changed(state, {
        terrainHeights: applyTerrainBrush(state.terrainHeights || createFlatTerrainHeights(), command.payload.x, command.payload.z, command.payload),
        savedAt: nextSavedAt,
      })
    case 'terrain.reset':
      return changed(state, { terrainHeights: createFlatTerrainHeights(), savedAt: nextSavedAt })

    case 'light.add':
      return changed(state, {
        lights: upsertById<WorldLight>(state.lights, command.payload.light),
        savedAt: nextSavedAt,
      })
    case 'light.update':
      return changed(state, {
        lights: patchById<WorldLight>(state.lights, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'light.remove':
      return changed(state, {
        lights: removeById(state.lights, command.payload.id),
        savedAt: nextSavedAt,
      })
    case 'sky.set':
      return changed(state, { skyBackgroundId: command.payload.skyBackgroundId, savedAt: nextSavedAt })

    case 'stroke.start':
    case 'stroke.point':
      return { state, changed: false }
    case 'stroke.end':
      return changed(state, {
        paintStrokes: upsertById<PaintStroke>(state.paintStrokes, command.payload.finalStroke),
        savedAt: nextSavedAt,
      })
    case 'stroke.update':
      return changed(state, {
        paintStrokes: patchById<PaintStroke>(state.paintStrokes, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'stroke.remove':
      return changed(state, {
        paintStrokes: removeById(state.paintStrokes, command.payload.id),
        savedAt: nextSavedAt,
      })

    case 'text3d.add':
      return changed(state, {
        text3dObjects: upsertById<Text3DObject>(state.text3dObjects, command.payload.object),
        savedAt: nextSavedAt,
      })
    case 'text3d.update':
      return changed(state, {
        text3dObjects: patchById<Text3DObject>(state.text3dObjects, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'text3d.remove':
      return changed(state, {
        text3dObjects: removeById(state.text3dObjects, command.payload.id),
        savedAt: nextSavedAt,
      })

    case 'agent.window.add':
      return changed(state, {
        agentWindows: upsertById<AgentWindow>(state.agentWindows, command.payload.window),
        savedAt: nextSavedAt,
      })
    case 'agent.window.update':
      return changed(state, {
        agentWindows: patchById<AgentWindow>(state.agentWindows, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'agent.window.remove': {
      const removedIds = new Set([command.payload.id])
      if (command.payload.linkedAvatarId) removedIds.add(command.payload.linkedAvatarId)
      return changed(state, {
        agentWindows: removeById(state.agentWindows, command.payload.id),
        agentAvatars: removeManyById(state.agentAvatars, removedIds),
        transforms: deleteKeys(state.transforms, removedIds),
        behaviors: deleteKeys(state.behaviors, removedIds),
        savedAt: nextSavedAt,
      })
    }
    case 'agent.avatar.add':
      return changed(state, {
        agentAvatars: upsertById<AgentAvatar>(state.agentAvatars, command.payload.avatar),
        savedAt: nextSavedAt,
      })
    case 'agent.avatar.update':
      return changed(state, {
        agentAvatars: patchById<AgentAvatar>(state.agentAvatars, command.payload.id, command.payload.updates),
        savedAt: nextSavedAt,
      })
    case 'agent.avatar.remove':
      return changed(state, {
        agentAvatars: removeById(state.agentAvatars, command.payload.id),
        agentWindows: command.payload.linkedWindowId
          ? patchById<AgentWindow>(state.agentWindows, command.payload.linkedWindowId, { linkedAvatarId: undefined })
          : state.agentWindows,
        transforms: deleteKeys(state.transforms, new Set([command.payload.id])),
        behaviors: deleteKeys(state.behaviors, new Set([command.payload.id])),
        savedAt: nextSavedAt,
      })

    case 'media.playback.set':
      if (command.payload.playbackScope !== 'shared') {
        return { state, changed: false }
      }
      return changed(state, {
        behaviors: updateMediaBehavior(state.behaviors, command.payload),
        savedAt: nextSavedAt,
      })

    case 'placement.vfx':
      return { state, changed: false }

    default:
      assertNever(command)
      return { state, changed: false }
  }
}

export function applyWorldCommands(
  state: WorldState,
  commands: WorldCommandEnvelope[],
): WorldCommandApplyResult {
  let current = state
  let anyChanged = false
  for (const command of commands) {
    const result = applyWorldCommand(current, command)
    current = result.state
    anyChanged = anyChanged || result.changed
  }
  return { state: current, changed: anyChanged }
}

function changed(state: WorldState, patch: Partial<WorldState>): WorldCommandApplyResult {
  return { state: { ...state, ...patch }, changed: true }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled world command: ${String((value as { kind?: string }).kind)}`)
}

export function isDurableWorldCommandKind(kind: WorldCommandKind): boolean {
  return commandTouchesDurableWorldState(kind)
}
