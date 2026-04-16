import type { ModelStats } from './conjure/types'

const MOVE_ORDER_CLIP_PATTERN = /walk|run|move|locomotion|jog/i

type MoveOrderStats = Pick<ModelStats, 'clips'> | undefined | null

export function canReceiveMoveOrder(stats: MoveOrderStats): boolean {
  return Array.isArray(stats?.clips) && stats.clips.some((clip) => MOVE_ORDER_CLIP_PATTERN.test(clip.name))
}

export function resolveMoveOrderObjectIds(
  selectedObjectId: string | null,
  walkableAvatarIds: string[],
  objectMeshStats: Record<string, Pick<ModelStats, 'clips'> | undefined>,
): string[] {
  if (!selectedObjectId) return []
  const isKnownAvatar = walkableAvatarIds.includes(selectedObjectId)
  if (isKnownAvatar && canReceiveMoveOrder(objectMeshStats[selectedObjectId])) {
    return [selectedObjectId]
  }
  return canReceiveMoveOrder(objectMeshStats[selectedObjectId]) ? [selectedObjectId] : []
}
