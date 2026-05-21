import type { CatalogPlacement, ConjuredAsset, CraftedScene, ObjectBehavior, WorldLight } from './conjure/types'
import type { PortalGate } from './portal-gates'
import type { SpatialWebObject } from './spatial-web'
import type { Text3DObject } from './forge/text-3d-object'

export const OBJECT_INTERACTION_DEFAULT_RADIUS = 3.2

export interface ObjectInteractionCandidate {
  id: string
  label: string
  position: [number, number, number]
  radius: number
  distanceSq: number
}

type TransformMap = Record<string, { position?: [number, number, number] } | undefined>
type InteractableAgentWindow = { id: string; agentType: string; label?: string; position: [number, number, number] }
type InteractableAgentAvatar = { id: string; agentType: string; label?: string; position: [number, number, number] }

function resolvePosition(id: string, fallback: [number, number, number], transforms: TransformMap): [number, number, number] {
  return transforms[id]?.position || fallback
}

function candidate(
  id: string,
  label: string | undefined,
  fallbackPosition: [number, number, number] | undefined,
  behaviors: Record<string, ObjectBehavior>,
  transforms: TransformMap,
): Omit<ObjectInteractionCandidate, 'distanceSq'> | null {
  const behavior = behaviors[id]
  const interaction = behavior?.interaction
  if (!interaction || !Array.isArray(interaction.actions) || interaction.actions.length === 0) return null
  if (behavior.visible === false) return null
  if (!fallbackPosition) return null

  return {
    id,
    label: interaction.label || behavior.label || label || 'Interact',
    position: resolvePosition(id, fallbackPosition, transforms),
    radius: interaction.radius || OBJECT_INTERACTION_DEFAULT_RADIUS,
  }
}

export function findNearestObjectInteraction(args: {
  actorPosition: [number, number, number] | null | undefined
  behaviors: Record<string, ObjectBehavior>
  transforms: TransformMap
  catalogPlacements?: CatalogPlacement[]
  craftedScenes?: CraftedScene[]
  conjuredAssets?: ConjuredAsset[]
  worldConjuredAssetIds?: string[]
  portalGates?: PortalGate[]
  spatialWebObjects?: SpatialWebObject[]
  text3dObjects?: Text3DObject[]
  agentWindows?: InteractableAgentWindow[]
  agentAvatars?: InteractableAgentAvatar[]
  worldLights?: WorldLight[]
}): ObjectInteractionCandidate | null {
  const actorPosition = args.actorPosition
  if (!actorPosition) return null

  const candidates: Array<Omit<ObjectInteractionCandidate, 'distanceSq'> | null> = []
  const worldConjuredIds = new Set(args.worldConjuredAssetIds || [])

  for (const placement of args.catalogPlacements || []) {
    candidates.push(candidate(placement.id, placement.name, placement.position, args.behaviors, args.transforms))
  }
  for (const scene of args.craftedScenes || []) {
    candidates.push(candidate(scene.id, scene.name, scene.position, args.behaviors, args.transforms))
  }
  for (const asset of args.conjuredAssets || []) {
    if (!worldConjuredIds.has(asset.id)) continue
    candidates.push(candidate(asset.id, asset.displayName || asset.prompt, asset.position || [0, 0, 0], args.behaviors, args.transforms))
  }
  for (const gate of args.portalGates || []) {
    candidates.push(candidate(gate.id, gate.label, gate.position, args.behaviors, args.transforms))
  }
  for (const object of args.spatialWebObjects || []) {
    candidates.push(candidate(object.id, object.label, object.position, args.behaviors, args.transforms))
  }
  for (const object of args.text3dObjects || []) {
    candidates.push(candidate(object.id, object.text, object.position, args.behaviors, args.transforms))
  }
  for (const window of args.agentWindows || []) {
    candidates.push(candidate(window.id, window.label || window.agentType, window.position, args.behaviors, args.transforms))
  }
  for (const avatar of args.agentAvatars || []) {
    candidates.push(candidate(avatar.id, avatar.label || avatar.agentType, avatar.position, args.behaviors, args.transforms))
  }
  for (const light of args.worldLights || []) {
    candidates.push(candidate(light.id, light.type, light.position, args.behaviors, args.transforms))
  }

  let nearest: ObjectInteractionCandidate | null = null
  for (const entry of candidates) {
    if (!entry) continue
    const dx = entry.position[0] - actorPosition[0]
    const dy = entry.position[1] - actorPosition[1]
    const dz = entry.position[2] - actorPosition[2]
    const distanceSq = dx * dx + dy * dy + dz * dz
    if (distanceSq > entry.radius * entry.radius) continue
    if (!nearest || distanceSq < nearest.distanceSq) {
      nearest = { ...entry, distanceSq }
    }
  }

  return nearest
}
