import type { CatalogPlacement } from '@/lib/conjure/types'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { WorldMutation } from '@/lib/world-mutation-bus'

import { makeWorldCommand, worldCommandToLegacyMutation } from './legacy-map'
import { applyWorldCommand } from './reducer'
import type { WorldCommandEnvelope } from './types'

export interface CatalogPlacementUpdateCommandContext {
  worldId: string
  actorId: string
  actorDisplayName?: string
  clientId?: string
  commandId?: string
  createdAt?: string
}

export interface CatalogPlacementUpdateCommandResult {
  command: WorldCommandEnvelope<'object.update'>
  changed: boolean
  legacyMutation: WorldMutation | null
  placements: CatalogPlacement[]
  state: WorldState
}

function catalogOnlyWorldState(
  catalogPlacements: CatalogPlacement[],
  savedAt: string,
): WorldState {
  return {
    version: 1,
    terrain: null,
    groundPresetId: 'none',
    groundTiles: {},
    terrainHeights: [],
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements,
    portalGates: [],
    spatialWebObjects: [],
    transforms: {},
    behaviors: {},
    lights: [],
    skyBackgroundId: 'night007',
    customGroundPresets: [],
    agentWindows: [],
    agentAvatars: [],
    paintStrokes: [],
    text3dObjects: [],
    savedAt,
  }
}

export function applyCatalogPlacementUpdateCommand(
  catalogPlacements: CatalogPlacement[],
  id: string,
  updates: Partial<CatalogPlacement>,
  context: CatalogPlacementUpdateCommandContext,
): CatalogPlacementUpdateCommandResult {
  const createdAt = context.createdAt || new Date().toISOString()
  const command = makeWorldCommand('object.update', { id, updates }, {
    id: context.commandId,
    worldId: context.worldId,
    actorId: context.actorId,
    actorDisplayName: context.actorDisplayName,
    clientId: context.clientId,
    createdAt,
  })
  const applied = applyWorldCommand(catalogOnlyWorldState(catalogPlacements, createdAt), command)
  return {
    command,
    changed: applied.changed,
    legacyMutation: worldCommandToLegacyMutation(command),
    placements: applied.state.catalogPlacements || [],
    state: applied.state,
  }
}
