import { describe, expect, it } from 'vitest'

import {
  TERRAIN_HEIGHT_COUNT,
  applyTerrainBrush,
  createFlatTerrainHeights,
  hasTerrainRelief,
  normalizeTerrainHeights,
  sampleTerrainHeightAt,
  sampleTerrainSurfaceAt,
  terrainBrushFalloff,
  terrainVertexIndex,
} from '../forge/terrain-brush'

describe('terrain-brush helpers', () => {
  it('creates a flat persisted heightmap with the expected vertex count', () => {
    const heights = createFlatTerrainHeights()
    expect(heights).toHaveLength(TERRAIN_HEIGHT_COUNT)
    expect(hasTerrainRelief(heights)).toBe(false)
  })

  it('raises the center vertex and fades out at the brush edge', () => {
    const heights = createFlatTerrainHeights()
    const sculpted = applyTerrainBrush(heights, 0, 0, {
      radius: 3,
      intensity: 4,
      direction: 'up',
      deltaSeconds: 0.5,
    })

    const center = sculpted[terrainVertexIndex(50, 50)]
    const edge = sculpted[terrainVertexIndex(53, 50)]
    expect(center).toBeCloseTo(1)
    expect(edge).toBeCloseTo(0)
    expect(hasTerrainRelief(sculpted)).toBe(true)
  })

  it('pushes terrain down when direction is down', () => {
    const sculpted = applyTerrainBrush(createFlatTerrainHeights(), 0, 0, {
      radius: 2,
      intensity: 3,
      direction: 'down',
      deltaSeconds: 1 / 3,
    })

    expect(sampleTerrainHeightAt(sculpted, 0, 0)).toBeLessThan(0)
  })

  it('samples terrain surface height smoothly between heightmap vertices', () => {
    const heights = createFlatTerrainHeights()
    heights[terrainVertexIndex(50, 50)] = 0
    heights[terrainVertexIndex(51, 50)] = 2
    heights[terrainVertexIndex(50, 51)] = 2
    heights[terrainVertexIndex(51, 51)] = 4

    const surface = sampleTerrainSurfaceAt(heights, 0.5, 0.5)
    expect(surface.height).toBeCloseTo(2)
    expect(surface.normal[1]).toBeGreaterThan(0)
  })

  it('normalizes stale or invalid persisted height data safely', () => {
    const normalized = normalizeTerrainHeights([1, Number.NaN, 999, -999])
    expect(normalized).toHaveLength(TERRAIN_HEIGHT_COUNT)
    expect(normalized[0]).toBe(1)
    expect(normalized[1]).toBe(0)
    expect(normalized[2]).toBe(24)
    expect(normalized[3]).toBe(-12)
  })

  it('uses a smooth cosine falloff', () => {
    expect(terrainBrushFalloff(0, 4)).toBeCloseTo(1)
    expect(terrainBrushFalloff(2, 4)).toBeCloseTo(0.5)
    expect(terrainBrushFalloff(4, 4)).toBeCloseTo(0)
    expect(terrainBrushFalloff(5, 4)).toBe(0)
  })
})
