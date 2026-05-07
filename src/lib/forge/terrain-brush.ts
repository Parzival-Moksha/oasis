export type TerrainBrushDirection = 'up' | 'down'
export type TerrainBrushMode = 'texture' | 'sculpt'

export const TERRAIN_WORLD_SIZE = 100
export const TERRAIN_GRID_SEGMENTS = 100
export const TERRAIN_GRID_RESOLUTION = TERRAIN_GRID_SEGMENTS + 1
export const TERRAIN_HEIGHT_COUNT = TERRAIN_GRID_RESOLUTION * TERRAIN_GRID_RESOLUTION
export const TERRAIN_MIN_HEIGHT = -12
export const TERRAIN_MAX_HEIGHT = 24

export interface TerrainBrushOptions {
  radius: number
  intensity: number
  direction: TerrainBrushDirection
  deltaSeconds: number
}

export function terrainVertexIndex(ix: number, iz: number): number {
  return iz * TERRAIN_GRID_RESOLUTION + ix
}

export function createFlatTerrainHeights(): number[] {
  return Array.from({ length: TERRAIN_HEIGHT_COUNT }, () => 0)
}

export function normalizeTerrainHeights(input: unknown): number[] {
  if (!Array.isArray(input)) return createFlatTerrainHeights()

  const normalized = createFlatTerrainHeights()
  const count = Math.min(input.length, TERRAIN_HEIGHT_COUNT)
  for (let i = 0; i < count; i++) {
    const value = Number(input[i])
    normalized[i] = Number.isFinite(value)
      ? clamp(value, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT)
      : 0
  }
  return normalized
}

export function hasTerrainRelief(heights: number[], epsilon = 0.001): boolean {
  return heights.some(height => Math.abs(height) > epsilon)
}

export function worldToTerrainCoord(value: number): number {
  return clamp(value + TERRAIN_WORLD_SIZE / 2, 0, TERRAIN_GRID_SEGMENTS)
}

export function sampleTerrainHeightAt(heights: number[], worldX: number, worldZ: number): number {
  const normalized = normalizeTerrainHeights(heights)
  const gx = Math.round(worldToTerrainCoord(worldX))
  const gz = Math.round(worldToTerrainCoord(worldZ))
  return normalized[terrainVertexIndex(gx, gz)] || 0
}

export function terrainBrushFalloff(distance: number, radius: number): number {
  if (radius <= 0 || distance > radius) return 0
  const t = distance / radius
  return 0.5 + 0.5 * Math.cos(Math.PI * t)
}

export function applyTerrainBrush(
  heights: number[],
  centerX: number,
  centerZ: number,
  options: TerrainBrushOptions,
): number[] {
  const radius = clamp(options.radius, 1, 10)
  const intensity = clamp(options.intensity, 0, 20)
  const deltaSeconds = clamp(options.deltaSeconds, 0, 0.25)
  const sign = options.direction === 'down' ? -1 : 1
  const amount = sign * intensity * deltaSeconds
  if (amount === 0) return normalizeTerrainHeights(heights)

  const next = normalizeTerrainHeights(heights)
  const centerGridX = worldToTerrainCoord(centerX)
  const centerGridZ = worldToTerrainCoord(centerZ)
  const minX = Math.max(0, Math.floor(centerGridX - radius))
  const maxX = Math.min(TERRAIN_GRID_SEGMENTS, Math.ceil(centerGridX + radius))
  const minZ = Math.max(0, Math.floor(centerGridZ - radius))
  const maxZ = Math.min(TERRAIN_GRID_SEGMENTS, Math.ceil(centerGridZ + radius))

  for (let iz = minZ; iz <= maxZ; iz++) {
    for (let ix = minX; ix <= maxX; ix++) {
      const dx = ix - centerGridX
      const dz = iz - centerGridZ
      const distance = Math.sqrt(dx * dx + dz * dz)
      const falloff = terrainBrushFalloff(distance, radius)
      if (falloff <= 0) continue
      const index = terrainVertexIndex(ix, iz)
      next[index] = clamp(next[index] + amount * falloff, TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT)
    }
  }

  return next
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
