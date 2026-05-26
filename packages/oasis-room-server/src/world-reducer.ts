type AnyRecord = Record<string, any>

export interface RoomCommandApplyResult {
  state: AnyRecord
  changed: boolean
}

const TERRAIN_WORLD_SIZE = 100
const TERRAIN_GRID_SEGMENTS = 100
const TERRAIN_GRID_RESOLUTION = TERRAIN_GRID_SEGMENTS + 1
const TERRAIN_HEIGHT_COUNT = TERRAIN_GRID_RESOLUTION * TERRAIN_GRID_RESOLUTION
const TERRAIN_MIN_HEIGHT = -12
const TERRAIN_MAX_HEIGHT = 24

function cloneState(state: unknown): AnyRecord {
  if (!state || typeof state !== 'object') return { version: 1, savedAt: new Date().toISOString() }
  if (typeof structuredClone === 'function') return structuredClone(state) as AnyRecord
  return JSON.parse(JSON.stringify(state)) as AnyRecord
}

function upsertById(items: unknown, item: AnyRecord): AnyRecord[] {
  const source = Array.isArray(items) ? items as AnyRecord[] : []
  const index = source.findIndex(candidate => candidate?.id === item.id)
  if (index < 0) return [...source, item]
  return source.map(candidate => candidate.id === item.id ? item : candidate)
}

function patchById(items: unknown, id: string, updates: AnyRecord): AnyRecord[] {
  const source = Array.isArray(items) ? items as AnyRecord[] : []
  return source.map(item => item?.id === id ? { ...item, ...updates } : item)
}

function removeById(items: unknown, id: string): AnyRecord[] {
  const source = Array.isArray(items) ? items as AnyRecord[] : []
  return source.filter(item => item?.id !== id)
}

function deleteRecordKey(record: unknown, id: string): AnyRecord {
  const next = { ...((record && typeof record === 'object') ? record as AnyRecord : {}) }
  delete next[id]
  return next
}

function patchRecord(record: unknown, id: string, value: AnyRecord): AnyRecord {
  return {
    ...((record && typeof record === 'object') ? record as AnyRecord : {}),
    [id]: value,
  }
}

function patchTransform(transforms: unknown, id: string, payload: AnyRecord): AnyRecord {
  const current = (transforms && typeof transforms === 'object') ? transforms as AnyRecord : {}
  const existing = current[id] && typeof current[id] === 'object' ? current[id] : {}
  return {
    ...current,
    [id]: {
      ...existing,
      ...(Array.isArray(payload.position) ? { position: payload.position } : {}),
      ...(Array.isArray(payload.rotation) ? { rotation: payload.rotation } : {}),
      ...(payload.scale !== undefined ? { scale: payload.scale } : {}),
    },
  }
}

function updateBehavior(behaviors: unknown, id: string, updates: AnyRecord): AnyRecord {
  const current = (behaviors && typeof behaviors === 'object') ? behaviors as AnyRecord : {}
  const existing = current[id] && typeof current[id] === 'object'
    ? current[id]
    : { movement: { type: 'static' }, visible: true }
  const next = { ...existing, ...updates }
  if (updates.moveTarget === null) delete next.moveTarget
  return patchRecord(current, id, next)
}

function encodeGroundTileValue(presetId: string, stretch: number): string {
  const normalizedStretch = Math.max(1, Math.floor(stretch || 1))
  return normalizedStretch === 1 ? presetId : `${presetId}@${normalizedStretch}`
}

function decodeGroundTileValue(raw: string): { presetId: string; stretch: number } {
  const at = raw.lastIndexOf('@')
  if (at <= 0) return { presetId: raw, stretch: 1 }
  const parsedStretch = Number(raw.slice(at + 1))
  return {
    presetId: raw.slice(0, at),
    stretch: Number.isFinite(parsedStretch) && parsedStretch >= 1 ? Math.floor(parsedStretch) : 1,
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

function removeGroundTilesOverlapping(groundTiles: AnyRecord, x: number, z: number, stretch: number): void {
  const nextMaxX = x + stretch
  const nextMaxZ = z + stretch
  for (const [key, value] of Object.entries(groundTiles)) {
    if (typeof value !== 'string') continue
    const parsed = parseGroundTileKey(key)
    if (!parsed) continue
    const [existingX, existingZ] = parsed
    const existing = decodeGroundTileValue(value)
    const existingMaxX = existingX + existing.stretch
    const existingMaxZ = existingZ + existing.stretch
    if (rangesOverlap(x, nextMaxX, existingX, existingMaxX) && rangesOverlap(z, nextMaxZ, existingZ, existingMaxZ)) {
      delete groundTiles[key]
    }
  }
}

function paintGroundTiles(groundTiles: unknown, cx: number, cz: number, presetId: string, size = 1, stretch = 1): AnyRecord {
  const normalizedStretch = Math.max(1, Math.floor(stretch || 1))
  const half = Math.floor(Math.max(1, Math.min(5, Math.floor(size || 1))) / 2)
  const nextTiles = { ...((groundTiles && typeof groundTiles === 'object') ? groundTiles as AnyRecord : {}) }
  const baseX = Math.floor(cx / normalizedStretch) * normalizedStretch
  const baseZ = Math.floor(cz / normalizedStretch) * normalizedStretch
  const cellValue = encodeGroundTileValue(presetId, normalizedStretch)
  for (let dx = -half; dx <= half; dx += 1) {
    for (let dz = -half; dz <= half; dz += 1) {
      const tx = baseX + dx * normalizedStretch
      const tz = baseZ + dz * normalizedStretch
      if (tx < -50 || tx + normalizedStretch > 50 || tz < -50 || tz + normalizedStretch > 50) continue
      removeGroundTilesOverlapping(nextTiles, tx, tz, normalizedStretch)
      nextTiles[`${tx},${tz}`] = cellValue
    }
  }
  return nextTiles
}

function removeGroundTileContaining(groundTiles: unknown, x: number, z: number): AnyRecord {
  const cellX = Math.floor(x)
  const cellZ = Math.floor(z)
  const next = { ...((groundTiles && typeof groundTiles === 'object') ? groundTiles as AnyRecord : {}) }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== 'string') continue
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

function terrainVertexIndex(ix: number, iz: number): number {
  return iz * TERRAIN_GRID_RESOLUTION + ix
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createFlatTerrainHeights(): number[] {
  return Array.from({ length: TERRAIN_HEIGHT_COUNT }, () => 0)
}

function normalizeTerrainHeights(input: unknown): number[] {
  if (!Array.isArray(input)) return createFlatTerrainHeights()
  const normalized = createFlatTerrainHeights()
  const count = Math.min(input.length, TERRAIN_HEIGHT_COUNT)
  for (let i = 0; i < count; i += 1) {
    const value = Number(input[i])
    normalized[i] = Number.isFinite(value) ? clamp(value, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT) : 0
  }
  return normalized
}

function worldToTerrainCoord(value: number): number {
  return clamp(value + TERRAIN_WORLD_SIZE / 2, 0, TERRAIN_GRID_SEGMENTS)
}

function terrainBrushFalloff(distance: number, radius: number): number {
  if (radius <= 0 || distance > radius) return 0
  const t = distance / radius
  return 0.5 + 0.5 * Math.cos(Math.PI * t)
}

function applyTerrainBrush(heights: unknown, centerX: number, centerZ: number, payload: AnyRecord): number[] {
  const radius = clamp(Number(payload.radius) || 1, 1, 10)
  const intensity = clamp(Number(payload.intensity) || 0, 0, 20)
  const deltaSeconds = clamp(Number(payload.deltaSeconds) || 0, 0, 0.25)
  const sign = payload.direction === 'down' ? -1 : 1
  const amount = sign * intensity * deltaSeconds
  const next = normalizeTerrainHeights(heights)
  if (amount === 0) return next
  const centerGridX = worldToTerrainCoord(centerX)
  const centerGridZ = worldToTerrainCoord(centerZ)
  const minX = Math.max(0, Math.floor(centerGridX - radius))
  const maxX = Math.min(TERRAIN_GRID_SEGMENTS, Math.ceil(centerGridX + radius))
  const minZ = Math.max(0, Math.floor(centerGridZ - radius))
  const maxZ = Math.min(TERRAIN_GRID_SEGMENTS, Math.ceil(centerGridZ + radius))

  for (let iz = minZ; iz <= maxZ; iz += 1) {
    for (let ix = minX; ix <= maxX; ix += 1) {
      const dx = ix - centerGridX
      const dz = iz - centerGridZ
      const falloff = terrainBrushFalloff(Math.sqrt(dx * dx + dz * dz), radius)
      if (falloff <= 0) continue
      const index = terrainVertexIndex(ix, iz)
      next[index] = clamp(next[index] + amount * falloff, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT)
    }
  }
  return next
}

function removeObjectEverywhere(state: AnyRecord, id: string, linkedAvatarIds: string[] = []): void {
  const ids = new Set([id, ...linkedAvatarIds])
  state.catalogPlacements = removeById(state.catalogPlacements, id)
  state.craftedScenes = removeById(state.craftedScenes, id)
  state.conjuredAssetIds = Array.isArray(state.conjuredAssetIds) ? state.conjuredAssetIds.filter((item: string) => item !== id) : []
  state.portalGates = removeById(state.portalGates, id)
  state.spatialWebObjects = removeById(state.spatialWebObjects, id)
  state.lights = removeById(state.lights, id)
  state.paintStrokes = removeById(state.paintStrokes, id)
  state.text3dObjects = removeById(state.text3dObjects, id)
  state.agentWindows = Array.isArray(state.agentWindows)
    ? state.agentWindows
      .filter((window: AnyRecord) => window?.id !== id)
      .map((window: AnyRecord) => ids.has(window.linkedAvatarId || '') ? { ...window, linkedAvatarId: undefined, anchorMode: 'detached' } : window)
    : []
  state.agentAvatars = Array.isArray(state.agentAvatars)
    ? state.agentAvatars.filter((avatar: AnyRecord) => !ids.has(avatar?.id))
    : []
  for (const removedId of ids) {
    state.transforms = deleteRecordKey(state.transforms, removedId)
    state.behaviors = deleteRecordKey(state.behaviors, removedId)
  }
}

function setSavedAt(state: AnyRecord, command: AnyRecord): void {
  if (typeof command.createdAt === 'string') state.savedAt = command.createdAt
}

export function applyRoomWorldCommand(state: unknown, command: AnyRecord): RoomCommandApplyResult {
  const kind = typeof command.kind === 'string' ? command.kind : ''
  const payload = command.payload && typeof command.payload === 'object' ? command.payload as AnyRecord : {}
  if (kind === 'placement.vfx' || kind === 'stroke.start' || kind === 'stroke.point') {
    return { state: cloneState(state), changed: false }
  }

  const next = cloneState(state)
  switch (kind) {
    case 'object.add':
      next.catalogPlacements = upsertById(next.catalogPlacements, payload.object)
      break
    case 'object.update':
      next.catalogPlacements = patchById(next.catalogPlacements, payload.id, payload.updates || {})
      break
    case 'object.remove':
      removeObjectEverywhere(next, payload.id, Array.isArray(payload.linkedAvatarIds) ? payload.linkedAvatarIds : [])
      break
    case 'object.transform':
      next.transforms = patchTransform(next.transforms, payload.id, payload)
      break
    case 'object.behavior.update':
      next.behaviors = updateBehavior(next.behaviors, payload.id, payload.updates || {})
      break
    case 'crafted.add':
      next.craftedScenes = upsertById(next.craftedScenes, payload.scene)
      break
    case 'crafted.update':
      next.craftedScenes = patchById(next.craftedScenes, payload.id, payload.updates || {})
      break
    case 'crafted.remove':
      next.craftedScenes = removeById(next.craftedScenes, payload.id)
      break
    case 'portal.add':
      next.portalGates = upsertById(next.portalGates, payload.gate)
      break
    case 'portal.update':
      next.portalGates = patchById(next.portalGates, payload.id, payload.updates || {})
      break
    case 'portal.remove':
      next.portalGates = removeById(next.portalGates, payload.id)
      break
    case 'spatial.add':
      next.spatialWebObjects = upsertById(next.spatialWebObjects, payload.object)
      break
    case 'spatial.update':
      next.spatialWebObjects = patchById(next.spatialWebObjects, payload.id, payload.updates || {})
      break
    case 'spatial.remove':
      next.spatialWebObjects = removeById(next.spatialWebObjects, payload.id)
      break
    case 'spatial.value.set':
      if (payload.stateScope && payload.stateScope !== 'world') return { state: next, changed: false }
      next.spatialWebObjects = patchById(next.spatialWebObjects, payload.id, {
        value: payload.value,
        lastEvent: payload.event,
        lastInteractionAt: command.createdAt,
        statusMessage: payload.statusMessage,
        errorMessage: payload.errorMessage === null ? undefined : payload.errorMessage,
      })
      break
    case 'ground.setPreset':
      next.groundPresetId = payload.groundPresetId
      break
    case 'ground.paint':
      next.groundTiles = paintGroundTiles(next.groundTiles, Number(payload.cx), Number(payload.cz), String(payload.presetId || 'grass'), Number(payload.size || 1), Number(payload.stretch || 1))
      break
    case 'ground.tile.erase':
      next.groundTiles = removeGroundTileContaining(next.groundTiles, Number(payload.x), Number(payload.z))
      break
    case 'ground.tiles.clear':
      next.groundTiles = {}
      break
    case 'terrain.brush':
      next.terrainHeights = applyTerrainBrush(next.terrainHeights, Number(payload.x), Number(payload.z), payload)
      break
    case 'terrain.reset':
      next.terrainHeights = createFlatTerrainHeights()
      break
    case 'light.add':
      next.lights = upsertById(next.lights, payload.light)
      break
    case 'light.update':
      next.lights = patchById(next.lights, payload.id, payload.updates || {})
      break
    case 'light.remove':
      next.lights = removeById(next.lights, payload.id)
      break
    case 'sky.set':
      next.skyBackgroundId = payload.skyBackgroundId
      break
    case 'stroke.end':
      next.paintStrokes = upsertById(next.paintStrokes, payload.finalStroke)
      break
    case 'stroke.update':
      next.paintStrokes = patchById(next.paintStrokes, payload.id, payload.updates || {})
      break
    case 'stroke.remove':
      next.paintStrokes = removeById(next.paintStrokes, payload.id)
      break
    case 'text3d.add':
      next.text3dObjects = upsertById(next.text3dObjects, payload.object)
      break
    case 'text3d.update':
      next.text3dObjects = patchById(next.text3dObjects, payload.id, payload.updates || {})
      break
    case 'text3d.remove':
      next.text3dObjects = removeById(next.text3dObjects, payload.id)
      break
    case 'agent.window.add':
      next.agentWindows = upsertById(next.agentWindows, payload.window)
      break
    case 'agent.window.update':
      next.agentWindows = patchById(next.agentWindows, payload.id, payload.updates || {})
      break
    case 'agent.window.remove':
      next.agentWindows = removeById(next.agentWindows, payload.id)
      if (payload.linkedAvatarId) {
        next.agentAvatars = removeById(next.agentAvatars, payload.linkedAvatarId)
        next.transforms = deleteRecordKey(next.transforms, payload.linkedAvatarId)
        next.behaviors = deleteRecordKey(next.behaviors, payload.linkedAvatarId)
      }
      next.transforms = deleteRecordKey(next.transforms, payload.id)
      next.behaviors = deleteRecordKey(next.behaviors, payload.id)
      break
    case 'agent.avatar.add':
      next.agentAvatars = upsertById(next.agentAvatars, payload.avatar)
      break
    case 'agent.avatar.update':
      next.agentAvatars = patchById(next.agentAvatars, payload.id, payload.updates || {})
      break
    case 'agent.avatar.remove':
      next.agentAvatars = removeById(next.agentAvatars, payload.id)
      if (payload.linkedWindowId) {
        next.agentWindows = patchById(next.agentWindows, payload.linkedWindowId, { linkedAvatarId: undefined })
      }
      next.transforms = deleteRecordKey(next.transforms, payload.id)
      next.behaviors = deleteRecordKey(next.behaviors, payload.id)
      break
    case 'media.playback.set': {
      if (payload.playbackScope !== 'shared') return { state: next, changed: false }
      const existing = next.behaviors?.[payload.objectId] || { movement: { type: 'static' }, visible: true }
      next.behaviors = patchRecord(next.behaviors, payload.objectId, {
        ...existing,
        audioState: payload.state,
        audioPlaybackScope: payload.playbackScope,
        audioUpdatedAt: payload.updatedAt,
        ...(payload.audioUrl !== undefined ? { audioUrl: payload.audioUrl } : {}),
        ...(payload.volume !== undefined ? { audioVolume: payload.volume } : {}),
        ...(payload.maxDistance !== undefined ? { audioMaxDistance: payload.maxDistance } : {}),
        ...(payload.muted !== undefined ? { audioMuted: payload.muted } : {}),
        ...(payload.loop !== undefined ? { audioLoop: payload.loop } : {}),
        ...(payload.playbackId !== undefined ? { audioPlaybackId: payload.playbackId } : {}),
        ...(payload.startedAt !== undefined ? { audioStartedAt: payload.startedAt } : {}),
      })
      break
    }
    default:
      return { state: next, changed: false }
  }

  setSavedAt(next, command)
  return { state: next, changed: true }
}
