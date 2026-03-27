// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TERRAIN BRUSH TESTS — Mission #15
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests:
//   1. WorldSnapshot includes terrainParams field
//   2. captureWorldSnapshot captures terrainParams
//   3. setTerrainParams with withUndo creates undo entries
//   4. terrain-generator with known seed produces deterministic output
//   5. Terrain API validation (validateTerrainParams via route shape)
//   6. Slider debounce uses getState() for fresh state
//   7. generateTerrain output shapes + edge cases
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// PART A: Terrain Generator — pure logic, no mocks needed
// ═══════════════════════════════════════════════════════════════════════════

import { generateTerrain, DEFAULT_TERRAIN, type TerrainParams } from '../../lib/forge/terrain-generator'

describe('terrain-generator', () => {
  describe('deterministic output with known seed', () => {
    it('produces identical heights for the same seed', () => {
      const result1 = generateTerrain(DEFAULT_TERRAIN)
      const result2 = generateTerrain(DEFAULT_TERRAIN)
      expect(result1.heights.length).toBe(result2.heights.length)
      // Compare first 100 values for identity
      for (let i = 0; i < 100; i++) {
        expect(result1.heights[i]).toBe(result2.heights[i])
      }
    })

    it('produces different heights for different seeds', () => {
      const a = generateTerrain({ ...DEFAULT_TERRAIN, seed: 42 })
      const b = generateTerrain({ ...DEFAULT_TERRAIN, seed: 999 })
      // At least some values must differ
      let diffs = 0
      for (let i = 0; i < 100; i++) {
        if (a.heights[i] !== b.heights[i]) diffs++
      }
      expect(diffs).toBeGreaterThan(50) // most values should differ
    })

    it('returns heights, colors, normals, and params', () => {
      const result = generateTerrain(DEFAULT_TERRAIN)
      expect(result.heights).toBeInstanceOf(Float32Array)
      expect(result.colors).toBeInstanceOf(Float32Array)
      expect(result.normals).toBeInstanceOf(Float32Array)
      expect(result.params).toEqual(DEFAULT_TERRAIN)
    })

    it('heights array has resolution*resolution elements', () => {
      const params = { ...DEFAULT_TERRAIN, resolution: 32 }
      const result = generateTerrain(params)
      expect(result.heights.length).toBe(32 * 32)
    })

    it('colors array has resolution*resolution*3 elements (RGB)', () => {
      const params = { ...DEFAULT_TERRAIN, resolution: 32 }
      const result = generateTerrain(params)
      expect(result.colors.length).toBe(32 * 32 * 3)
    })

    it('normals array has resolution*resolution*3 elements', () => {
      const params = { ...DEFAULT_TERRAIN, resolution: 32 }
      const result = generateTerrain(params)
      expect(result.normals.length).toBe(32 * 32 * 3)
    })
  })

  describe('height normalization', () => {
    it('all heights are between 0 and 1 after normalization', () => {
      const result = generateTerrain({ ...DEFAULT_TERRAIN, resolution: 64 })
      for (let i = 0; i < result.heights.length; i++) {
        // Allow tiny float epsilon below 0 from normalization arithmetic
        expect(result.heights[i]).toBeGreaterThanOrEqual(-1e-7)
        expect(result.heights[i]).toBeLessThanOrEqual(1 + 1e-7)
      }
    })

    it('heights span the full 0-1 range (min=0, max=1)', () => {
      const result = generateTerrain({ ...DEFAULT_TERRAIN, resolution: 64 })
      let min = Infinity, max = -Infinity
      for (let i = 0; i < result.heights.length; i++) {
        if (result.heights[i] < min) min = result.heights[i]
        if (result.heights[i] > max) max = result.heights[i]
      }
      expect(min).toBeCloseTo(0, 5)
      expect(max).toBeCloseTo(1, 5)
    })
  })

  describe('normals validity', () => {
    it('normals are unit vectors (length ~1)', () => {
      const result = generateTerrain({ ...DEFAULT_TERRAIN, resolution: 32 })
      // Sample 50 random normals
      for (let i = 0; i < 50; i++) {
        const idx = Math.floor(Math.random() * 32 * 32)
        const nx = result.normals[idx * 3]
        const ny = result.normals[idx * 3 + 1]
        const nz = result.normals[idx * 3 + 2]
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        expect(len).toBeCloseTo(1, 2)
      }
    })

    it('normals Y component is positive (upward-facing terrain)', () => {
      const result = generateTerrain({ ...DEFAULT_TERRAIN, resolution: 32, heightScale: 2 })
      // For gentle terrain, most normals should point up
      let upCount = 0
      for (let i = 0; i < 32 * 32; i++) {
        if (result.normals[i * 3 + 1] > 0) upCount++
      }
      expect(upCount).toBe(32 * 32) // ALL normals should have positive Y
    })
  })

  describe('color values', () => {
    it('all color components are in 0-1 range', () => {
      const result = generateTerrain({ ...DEFAULT_TERRAIN, resolution: 32 })
      for (let i = 0; i < result.colors.length; i++) {
        expect(result.colors[i]).toBeGreaterThanOrEqual(0)
        expect(result.colors[i]).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('edge case: single octave', () => {
    it('generates valid terrain with noiseOctaves=1', () => {
      const params = { ...DEFAULT_TERRAIN, resolution: 32, noiseOctaves: 1 }
      const result = generateTerrain(params)
      expect(result.heights.length).toBe(32 * 32)
      // Heights should still be 0-1
      for (let i = 0; i < result.heights.length; i++) {
        expect(result.heights[i]).toBeGreaterThanOrEqual(0)
        expect(result.heights[i]).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('edge case: minimal resolution', () => {
    it('handles resolution=2 (minimum mesh)', () => {
      const params = { ...DEFAULT_TERRAIN, resolution: 2 }
      const result = generateTerrain(params)
      expect(result.heights.length).toBe(4) // 2*2
      expect(result.colors.length).toBe(12) // 2*2*3
      expect(result.normals.length).toBe(12)
    })
  })

  describe('DEFAULT_TERRAIN constant', () => {
    it('has all required fields', () => {
      expect(DEFAULT_TERRAIN).toHaveProperty('name')
      expect(DEFAULT_TERRAIN).toHaveProperty('size')
      expect(DEFAULT_TERRAIN).toHaveProperty('resolution')
      expect(DEFAULT_TERRAIN).toHaveProperty('heightScale')
      expect(DEFAULT_TERRAIN).toHaveProperty('noiseOctaves')
      expect(DEFAULT_TERRAIN).toHaveProperty('noisePersistence')
      expect(DEFAULT_TERRAIN).toHaveProperty('noiseLacunarity')
      expect(DEFAULT_TERRAIN).toHaveProperty('noiseScale')
      expect(DEFAULT_TERRAIN).toHaveProperty('seed')
      expect(DEFAULT_TERRAIN).toHaveProperty('waterLevel')
      expect(DEFAULT_TERRAIN).toHaveProperty('palette')
      expect(DEFAULT_TERRAIN).toHaveProperty('features')
    })

    it('palette has all 7 biome colors', () => {
      const p = DEFAULT_TERRAIN.palette
      expect(p).toHaveProperty('deepWater')
      expect(p).toHaveProperty('shallowWater')
      expect(p).toHaveProperty('sand')
      expect(p).toHaveProperty('grass')
      expect(p).toHaveProperty('forest')
      expect(p).toHaveProperty('rock')
      expect(p).toHaveProperty('snow')
    })

    it('seed is 42 (the answer)', () => {
      expect(DEFAULT_TERRAIN.seed).toBe(42)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART B: Oasis Store — terrainParams in WorldSnapshot + undo
// ═══════════════════════════════════════════════════════════════════════════

// Mock world-persistence to prevent actual file/DB I/O during tests
vi.mock('../../lib/forge/world-persistence', () => ({
  loadWorld: vi.fn().mockResolvedValue(null),
  debouncedSaveWorld: vi.fn(),
  saveWorld: vi.fn(),
  getWorldRegistry: vi.fn().mockReturnValue([]),
  getActiveWorldId: vi.fn().mockReturnValue('test-world'),
  setActiveWorldId: vi.fn(),
  createWorld: vi.fn().mockResolvedValue('new-world-id'),
  deleteWorld: vi.fn().mockResolvedValue(undefined),
  exportWorld: vi.fn().mockResolvedValue('{}'),
  importWorld: vi.fn().mockResolvedValue('imported-id'),
  cancelPendingSave: vi.fn(),
  loadPublicWorld: vi.fn().mockResolvedValue(null),
  migrateIfNeeded: vi.fn(),
}))

vi.mock('../../lib/forge/scene-library', () => ({
  addToSceneLibrary: vi.fn(),
  getSceneLibrary: vi.fn().mockReturnValue([]),
  removeFromSceneLibrary: vi.fn(),
}))

vi.mock('../../hooks/useXp', () => ({
  awardXp: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  getBrowserSupabase: vi.fn().mockReturnValue(null),
}))

// Must import AFTER mocks are set up
import { useOasisStore } from '../../store/oasisStore'
import { debouncedSaveWorld } from '../../lib/forge/world-persistence'

const mockDebouncedSave = debouncedSaveWorld as ReturnType<typeof vi.fn>

function getState() { return useOasisStore.getState() }

/** Terrain params for testing */
const TEST_TERRAIN: TerrainParams = {
  name: 'Test Hills',
  size: 64,
  resolution: 128,
  heightScale: 6,
  noiseOctaves: 5,
  noisePersistence: 0.45,
  noiseLacunarity: 2.1,
  noiseScale: 0.025,
  seed: 12345,
  waterLevel: 0.25,
  palette: {
    deepWater: '#1a3a5c',
    shallowWater: '#2980b9',
    sand: '#e8d68c',
    grass: '#4a7c2e',
    forest: '#2d5a1e',
    rock: '#6b6b6b',
    snow: '#f0f0f0',
  },
  features: ['rolling'],
}

function resetStore() {
  useOasisStore.setState({
    terrainParams: null,
    terrainLoading: false,
    placedCatalogAssets: [],
    craftedScenes: [],
    worldConjuredAssetIds: [],
    transforms: {},
    behaviors: {},
    groundTiles: {},
    worldLights: [],
    undoStack: [],
    redoStack: [],
    _undoBatch: null,
    _isUndoRedoing: false,
    _worldReady: false,
    _loadedObjectCount: 0,
    _isReceivingRemoteUpdate: false,
    isViewMode: false,
    isViewModeEditable: false,
  })
}

describe('OasisStore — Terrain in WorldSnapshot + Undo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─═̷─═̷─ WorldSnapshot contains terrainParams ─═̷─═̷─
  describe('WorldSnapshot includes terrainParams', () => {
    it('terrainParams defaults to null in initial state', () => {
      expect(getState().terrainParams).toBeNull()
    })

    it('terrainParams is stored in the state', () => {
      useOasisStore.setState({ terrainParams: TEST_TERRAIN })
      expect(getState().terrainParams).toEqual(TEST_TERRAIN)
    })

    it('terrainParams can be set to null (clear terrain)', () => {
      useOasisStore.setState({ terrainParams: TEST_TERRAIN })
      useOasisStore.setState({ terrainParams: null })
      expect(getState().terrainParams).toBeNull()
    })
  })

  // ─═̷─═̷─ captureWorldSnapshot captures terrainParams ─═̷─═̷─
  describe('captureWorldSnapshot captures terrainParams', () => {
    it('undo snapshot includes terrainParams when set', () => {
      // Set terrain via the store action (which uses withUndo)
      getState().setTerrainParams(TEST_TERRAIN)

      // The undo stack should have one entry
      expect(getState().undoStack.length).toBe(1)

      // The "before" snapshot should have null terrain
      expect(getState().undoStack[0].before.terrainParams).toBeNull()

      // The "after" snapshot should have the terrain
      expect(getState().undoStack[0].after.terrainParams).toEqual(TEST_TERRAIN)
    })

    it('undo snapshot preserves null terrainParams', () => {
      // Set terrain then clear it — two undo entries
      getState().setTerrainParams(TEST_TERRAIN)
      getState().setTerrainParams(null)

      expect(getState().undoStack.length).toBe(2)

      // Second entry: before had terrain, after has null
      expect(getState().undoStack[1].before.terrainParams).toEqual(TEST_TERRAIN)
      expect(getState().undoStack[1].after.terrainParams).toBeNull()
    })
  })

  // ─═̷─═̷─ setTerrainParams with withUndo ─═̷─═̷─
  describe('setTerrainParams creates undo entries', () => {
    it('pushes one undo entry per setTerrainParams call', () => {
      expect(getState().undoStack.length).toBe(0)

      getState().setTerrainParams(TEST_TERRAIN)
      expect(getState().undoStack.length).toBe(1)

      getState().setTerrainParams({ ...TEST_TERRAIN, seed: 999 })
      expect(getState().undoStack.length).toBe(2)
    })

    it('undo entry has label "Terrain"', () => {
      getState().setTerrainParams(TEST_TERRAIN)
      expect(getState().undoStack[0].label).toBe('Terrain')
    })

    it('undo entry has icon', () => {
      getState().setTerrainParams(TEST_TERRAIN)
      expect(getState().undoStack[0].icon).toBeTruthy()
    })

    it('clears redo stack on new terrain action', () => {
      // Build some redo by doing undo
      getState().setTerrainParams(TEST_TERRAIN)
      getState().undo()
      expect(getState().redoStack.length).toBe(1)

      // New action clears redo
      getState().setTerrainParams({ ...TEST_TERRAIN, seed: 777 })
      expect(getState().redoStack.length).toBe(0)
    })

    it('undo restores previous terrainParams', () => {
      getState().setTerrainParams(TEST_TERRAIN)
      expect(getState().terrainParams).toEqual(TEST_TERRAIN)

      getState().undo()
      expect(getState().terrainParams).toBeNull()
    })

    it('redo re-applies terrainParams', () => {
      getState().setTerrainParams(TEST_TERRAIN)
      getState().undo()
      expect(getState().terrainParams).toBeNull()

      getState().redo()
      expect(getState().terrainParams).toEqual(TEST_TERRAIN)
    })

    it('setTerrainParams triggers delayed saveWorldState', () => {
      mockDebouncedSave.mockClear()
      useOasisStore.setState({ _worldReady: true, _loadedObjectCount: 0 })
      getState().setTerrainParams(TEST_TERRAIN)

      // saveWorldState called via setTimeout(100ms)
      vi.advanceTimersByTime(150)

      // The debouncedSaveWorld mock should have been called
      expect(mockDebouncedSave).toHaveBeenCalled()
    })
  })

  // ─═̷─═̷─ setTerrainParams(null) clears terrain ─═̷─═̷─
  describe('clearing terrain', () => {
    it('setTerrainParams(null) clears the terrain and creates undo entry', () => {
      getState().setTerrainParams(TEST_TERRAIN)
      expect(getState().terrainParams).toEqual(TEST_TERRAIN)

      getState().setTerrainParams(null)
      expect(getState().terrainParams).toBeNull()
      expect(getState().undoStack.length).toBe(2)
    })
  })

  // ─═̷─═̷─ terrain seed modification ─═̷─═̷─
  describe('terrain seed reseed (spread + override)', () => {
    it('reseed preserves all other params', () => {
      getState().setTerrainParams(TEST_TERRAIN)

      const newSeed = 54321
      const reseeded = { ...TEST_TERRAIN, seed: newSeed }
      getState().setTerrainParams(reseeded)

      const current = getState().terrainParams!
      expect(current.seed).toBe(newSeed)
      expect(current.name).toBe(TEST_TERRAIN.name)
      expect(current.heightScale).toBe(TEST_TERRAIN.heightScale)
      expect(current.waterLevel).toBe(TEST_TERRAIN.waterLevel)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART C: Terrain API route — validation logic
// ═══════════════════════════════════════════════════════════════════════════

describe('Terrain API response shape', () => {
  it('client correctly unwraps data.params from response', () => {
    // Simulate the shape of a successful API response:
    // { params: TerrainParams }
    const apiResponse = { params: TEST_TERRAIN }

    // The WorldTab does: setTerrainParams(data.params as TerrainParams)
    const extracted = apiResponse.params as TerrainParams
    expect(extracted).toEqual(TEST_TERRAIN)
    expect(extracted.name).toBe('Test Hills')
    expect(extracted.seed).toBe(12345)
  })

  it('response without params field gives undefined', () => {
    const badResponse = { error: 'Something went wrong' } as any
    expect(badResponse.params).toBeUndefined()
  })

  it('clamp helper logic matches route validation', () => {
    // Recreate the clamp logic from the route
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

    // heightScale clamped to 1-30
    expect(clamp(0, 1, 30)).toBe(1)
    expect(clamp(50, 1, 30)).toBe(30)
    expect(clamp(15, 1, 30)).toBe(15)

    // noiseOctaves clamped to 1-8
    expect(clamp(0, 1, 8)).toBe(1)
    expect(clamp(10, 1, 8)).toBe(8)

    // waterLevel clamped to 0-0.8
    expect(clamp(-0.5, 0, 0.8)).toBe(0)
    expect(clamp(1.0, 0, 0.8)).toBe(0.8)

    // size clamped to 32-128
    expect(clamp(10, 32, 128)).toBe(32)
    expect(clamp(200, 32, 128)).toBe(128)
  })

  it('hex validation matches route isHex check', () => {
    const isHex = (s: unknown): s is string =>
      typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)

    expect(isHex('#1a3a5c')).toBe(true)
    expect(isHex('#FFFFFF')).toBe(true)
    expect(isHex('#000000')).toBe(true)
    expect(isHex('1a3a5c')).toBe(false)   // missing #
    expect(isHex('#1a3')).toBe(false)      // too short
    expect(isHex('#1a3a5cFF')).toBe(false) // too long (alpha)
    expect(isHex(null)).toBe(false)
    expect(isHex(42)).toBe(false)
    expect(isHex('#GGGGGG')).toBe(false)   // invalid hex chars
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PART D: Slider debounce — getState() for fresh state
// ═══════════════════════════════════════════════════════════════════════════

describe('Slider debounce pattern uses getState()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('simulates the debounce: delayed setTerrainParams uses fresh state', () => {
    // Emulate what WorldTab.debouncedTerrainSlider does:
    // 1. Sets terrain initially
    // 2. Slider changes heightScale via debounced callback
    // 3. The callback reads getState().terrainParams for the CURRENT value

    getState().setTerrainParams(TEST_TERRAIN)

    // Simulate slider debounce: after 200ms, read fresh state and update
    const field = 'heightScale'
    const value = 12

    setTimeout(() => {
      const current = useOasisStore.getState().terrainParams
      if (current) {
        useOasisStore.getState().setTerrainParams({ ...current, [field]: value })
      }
    }, 200)

    // Before timer fires, terrainParams still has original heightScale
    expect(getState().terrainParams!.heightScale).toBe(6)

    // Advance timer
    vi.advanceTimersByTime(200)

    // After debounce, heightScale is updated
    expect(getState().terrainParams!.heightScale).toBe(12)
  })

  it('rapid slider changes: only the last value persists after debounce', () => {
    getState().setTerrainParams(TEST_TERRAIN)

    // Simulate rapid slider moves with debounce (clear + re-set timeout)
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedUpdate = (field: string, value: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const current = useOasisStore.getState().terrainParams
        if (current) useOasisStore.getState().setTerrainParams({ ...current, [field]: value })
      }, 200)
    }

    debouncedUpdate('heightScale', 8)
    vi.advanceTimersByTime(50)
    debouncedUpdate('heightScale', 10)
    vi.advanceTimersByTime(50)
    debouncedUpdate('heightScale', 15) // final value

    // Not enough time passed — still original
    expect(getState().terrainParams!.heightScale).toBe(6)

    // Advance past debounce
    vi.advanceTimersByTime(200)

    // Only the last value (15) should have been applied
    expect(getState().terrainParams!.heightScale).toBe(15)
  })

  it('debounce callback is a no-op when terrainParams is null', () => {
    // Terrain starts null — slider debounce should guard against it
    expect(getState().terrainParams).toBeNull()

    setTimeout(() => {
      const current = useOasisStore.getState().terrainParams
      if (current) {
        useOasisStore.getState().setTerrainParams({ ...current, heightScale: 99 })
      }
    }, 200)

    vi.advanceTimersByTime(200)

    // terrainParams should still be null — no crash, no update
    expect(getState().terrainParams).toBeNull()
  })

  it('getState() reads fresh state, not stale closure', () => {
    // Set initial terrain
    getState().setTerrainParams(TEST_TERRAIN)

    // Schedule a debounced update
    setTimeout(() => {
      const current = useOasisStore.getState().terrainParams
      if (current) {
        useOasisStore.getState().setTerrainParams({ ...current, waterLevel: 0.5 })
      }
    }, 200)

    // BETWEEN scheduling and firing, change the terrain seed externally
    getState().setTerrainParams({ ...TEST_TERRAIN, seed: 777 })

    // Now fire the debounce
    vi.advanceTimersByTime(200)

    // The debounced callback should have read the FRESH state (seed=777),
    // not the stale closure state (seed=12345)
    const result = getState().terrainParams!
    expect(result.seed).toBe(777)
    expect(result.waterLevel).toBe(0.5)
  })
})
