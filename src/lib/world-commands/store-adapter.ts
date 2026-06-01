import type { CatalogPlacement, CraftedScene, ObjectBehavior, WorldLight } from '@/lib/conjure/types'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { PaintStroke } from '@/lib/forge/paint-stroke'
import type { Text3DObject } from '@/lib/forge/text-3d-object'
import type { PortalGate } from '@/lib/portal-gates'
import type { SpatialWebObject } from '@/lib/spatial-web'
import type { AgentAvatar, AgentWindow } from '@/lib/agent-window-types'
import type { TerrainParams } from '@/lib/forge/terrain-generator'
import type { WorldMutation } from '@/lib/world-mutation-bus'

import { makeWorldCommand, worldCommandToLegacyMutation } from './legacy-map'
import { applyWorldCommand } from './reducer'
import type { WorldCommandEnvelope, WorldCommandKind, WorldCommandPayloadByKind } from './types'

export interface WorldCommandStoreState {
  terrainParams: TerrainParams | null
  terrainHeights: number[]
  groundPresetId: string
  groundTiles: Record<string, string>
  craftedScenes: CraftedScene[]
  worldConjuredAssetIds: string[]
  placedCatalogAssets: CatalogPlacement[]
  portalGates: PortalGate[]
  spatialWebObjects: SpatialWebObject[]
  paintStrokes: PaintStroke[]
  text3dObjects: Text3DObject[]
  transforms: WorldState['transforms']
  behaviors: Record<string, ObjectBehavior>
  worldLights: WorldLight[]
  worldSkyBackground: string
  customGroundPresets: WorldState['customGroundPresets']
  placedAgentWindows: AgentWindow[]
  placedAgentAvatars: AgentAvatar[]
  _worldLoadedAt: string | null
}

export type WorldCommandStorePatch = Partial<Pick<
  WorldCommandStoreState,
  | 'terrainParams'
  | 'terrainHeights'
  | 'groundPresetId'
  | 'groundTiles'
  | 'craftedScenes'
  | 'worldConjuredAssetIds'
  | 'placedCatalogAssets'
  | 'portalGates'
  | 'spatialWebObjects'
  | 'paintStrokes'
  | 'text3dObjects'
  | 'transforms'
  | 'behaviors'
  | 'worldLights'
  | 'worldSkyBackground'
  | 'customGroundPresets'
  | 'placedAgentWindows'
  | 'placedAgentAvatars'
>>

export interface StoreWorldCommandContext {
  worldId: string
  actorId: string
  actorDisplayName?: string
  clientId?: string
  commandId?: string
  createdAt?: string
}

export interface StoreWorldCommandResult<K extends WorldCommandKind = WorldCommandKind> {
  command: WorldCommandEnvelope<K>
  changed: boolean
  legacyMutation: WorldMutation | null
  patch: WorldCommandStorePatch
  state: WorldState
}

export function storeStateToWorldState(
  state: WorldCommandStoreState,
  savedAt = state._worldLoadedAt || new Date().toISOString(),
): WorldState {
  return {
    version: 1,
    terrain: state.terrainParams,
    terrainHeights: state.terrainHeights,
    groundPresetId: state.groundPresetId,
    groundTiles: state.groundTiles,
    craftedScenes: state.craftedScenes,
    conjuredAssetIds: state.worldConjuredAssetIds,
    catalogPlacements: state.placedCatalogAssets,
    portalGates: state.portalGates,
    spatialWebObjects: state.spatialWebObjects,
    paintStrokes: state.paintStrokes,
    text3dObjects: state.text3dObjects,
    transforms: state.transforms,
    behaviors: state.behaviors,
    lights: state.worldLights,
    skyBackgroundId: state.worldSkyBackground,
    customGroundPresets: state.customGroundPresets,
    agentWindows: state.placedAgentWindows,
    agentAvatars: state.placedAgentAvatars,
    savedAt,
  }
}

export function worldStateToStorePatch(state: WorldState): WorldCommandStorePatch {
  return {
    terrainParams: state.terrain || null,
    terrainHeights: state.terrainHeights || [],
    groundPresetId: state.groundPresetId || 'none',
    groundTiles: state.groundTiles || {},
    craftedScenes: state.craftedScenes || [],
    worldConjuredAssetIds: state.conjuredAssetIds || [],
    placedCatalogAssets: state.catalogPlacements || [],
    portalGates: state.portalGates || [],
    spatialWebObjects: state.spatialWebObjects || [],
    paintStrokes: state.paintStrokes || [],
    text3dObjects: state.text3dObjects || [],
    transforms: state.transforms || {},
    behaviors: state.behaviors || {},
    worldLights: state.lights || [],
    worldSkyBackground: state.skyBackgroundId || '',
    customGroundPresets: state.customGroundPresets || [],
    placedAgentWindows: state.agentWindows || [],
    placedAgentAvatars: state.agentAvatars || [],
  }
}

export function applyStoreWorldCommand<K extends WorldCommandKind>(
  state: WorldCommandStoreState,
  kind: K,
  payload: WorldCommandPayloadByKind[K],
  context: StoreWorldCommandContext,
): StoreWorldCommandResult<K> {
  const command = makeWorldCommand(kind, payload, {
    id: context.commandId,
    worldId: context.worldId,
    actorId: context.actorId,
    actorDisplayName: context.actorDisplayName,
    clientId: context.clientId,
    createdAt: context.createdAt,
  })
  const applied = applyWorldCommand(storeStateToWorldState(state, command.createdAt), command)
  return {
    command,
    changed: applied.changed,
    legacyMutation: worldCommandToLegacyMutation(command),
    patch: applied.changed ? worldStateToStorePatch(applied.state) : {},
    state: applied.state,
  }
}
