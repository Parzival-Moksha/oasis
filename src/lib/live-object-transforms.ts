type LiveObjectTransform = {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  updatedAt: number
}

const liveObjectTransforms = new Map<string, LiveObjectTransform>()

export function setLiveObjectTransform(
  objectId: string,
  transform: Omit<LiveObjectTransform, 'updatedAt'>,
) {
  if (!objectId) return
  liveObjectTransforms.set(objectId, {
    ...transform,
    updatedAt: Date.now(),
  })
}

export function getLiveObjectTransform(objectId: string): LiveObjectTransform | null {
  if (!objectId) return null
  return liveObjectTransforms.get(objectId) || null
}

export function clearLiveObjectTransform(objectId: string) {
  if (!objectId) return
  liveObjectTransforms.delete(objectId)
}
