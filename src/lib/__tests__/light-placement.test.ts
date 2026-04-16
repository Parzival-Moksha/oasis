// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIGHT PLACEMENT TESTS — addWorldLight + placeLightAt (round 3)
// ─═̷─═̷─ point/spot → placement mode; others → immediate add ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─═̷─═̷─ Mocks must precede the store import (same pattern as oasis-store.test.ts) ─═̷─═̷─

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
import type { WorldLight } from '../../lib/conjure/types'

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getState() { return useOasisStore.getState() }

/** Reset the slice of state this file exercises to a clean baseline. */
function resetStore() {
  useOasisStore.setState({
    worldLights: [],
    placementPending: null,
    activePlacementVfx: [],
    _worldReady: false,
    _loadedObjectCount: 0,
    _isReceivingRemoteUpdate: false,
    isViewMode: false,
    isViewModeEditable: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Light placement (round 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─═̷─═̷─💡 addWorldLight — spatial lights enter placement mode ─═̷─═̷─💡
  describe("addWorldLight('point')", () => {
    it('enters placement mode with correct PlacementPending shape', () => {
      getState().addWorldLight('point')
      const pending = getState().placementPending
      expect(pending).not.toBeNull()
      expect(pending!.type).toBe('light')
      expect(pending!.lightType).toBe('point')
      expect(pending!.name).toBe('point light')
    })

    it('does NOT add a light to worldLights immediately', () => {
      getState().addWorldLight('point')
      expect(getState().worldLights).toHaveLength(0)
    })
  })

  describe("addWorldLight('spot')", () => {
    it('enters placement mode with correct PlacementPending shape', () => {
      getState().addWorldLight('spot')
      const pending = getState().placementPending
      expect(pending).not.toBeNull()
      expect(pending!.type).toBe('light')
      expect(pending!.lightType).toBe('spot')
      expect(pending!.name).toBe('spot light')
    })

    it('does NOT add a light to worldLights immediately', () => {
      getState().addWorldLight('spot')
      expect(getState().worldLights).toHaveLength(0)
    })
  })

  // ─═̷─═̷─💡 addWorldLight — non-spatial lights add immediately ─═̷─═̷─💡
  describe("addWorldLight('ambient')", () => {
    it('adds the light immediately (no placement mode)', () => {
      getState().addWorldLight('ambient')
      expect(getState().placementPending).toBeNull()
      expect(getState().worldLights).toHaveLength(1)
    })

    it('adds with intensity 0.4', () => {
      getState().addWorldLight('ambient')
      const light = getState().worldLights[0]
      expect(light.type).toBe('ambient')
      expect(light.intensity).toBe(0.4)
    })
  })

  describe("addWorldLight('directional')", () => {
    it('adds the light immediately with intensity 1.2', () => {
      getState().addWorldLight('directional')
      expect(getState().placementPending).toBeNull()
      expect(getState().worldLights).toHaveLength(1)
      const light = getState().worldLights[0]
      expect(light.type).toBe('directional')
      expect(light.intensity).toBe(1.2)
    })

    it('places the sun above the scene at [30, 40, 20]', () => {
      getState().addWorldLight('directional')
      const light = getState().worldLights[0]
      expect(light.position).toEqual([30, 40, 20])
    })
  })

  describe("addWorldLight('hemisphere')", () => {
    it('adds the light immediately with intensity 0.3 and a groundColor', () => {
      getState().addWorldLight('hemisphere')
      expect(getState().placementPending).toBeNull()
      expect(getState().worldLights).toHaveLength(1)
      const light = getState().worldLights[0]
      expect(light.type).toBe('hemisphere')
      expect(light.intensity).toBe(0.3)
      expect(light.groundColor).toBeDefined()
      expect(light.groundColor).toBe('#3a5f0b')
    })
  })

  describe("addWorldLight('environment')", () => {
    it('is a no-op when an environment light already exists', () => {
      const existing: WorldLight = {
        id: 'light-environment-preexisting',
        type: 'environment',
        color: '#ffffff',
        intensity: 1.0,
        position: [0, 0, 0],
        visible: true,
      }
      useOasisStore.setState({ worldLights: [existing] })

      getState().addWorldLight('environment')
      // Should NOT add a second environment light
      expect(getState().worldLights).toHaveLength(1)
      expect(getState().worldLights[0].id).toBe('light-environment-preexisting')
      // And should NOT enter placement mode
      expect(getState().placementPending).toBeNull()
    })

    it('adds an environment light when none exists yet (intensity 1.0)', () => {
      getState().addWorldLight('environment')
      expect(getState().worldLights).toHaveLength(1)
      expect(getState().worldLights[0].type).toBe('environment')
      expect(getState().worldLights[0].intensity).toBe(1.0)
    })
  })

  // ─═̷─═̷─💡 placeLightAt — called after user picks a spot ─═̷─═̷─💡
  describe("placeLightAt('point', [x, y, z])", () => {
    it('adds a point light at the given position with intensity 100', () => {
      // Pretend we were in placement mode
      useOasisStore.setState({
        placementPending: { type: 'light', name: 'point light', lightType: 'point' },
      })

      getState().placeLightAt('point', [1, 2, 3])

      const lights = getState().worldLights
      expect(lights).toHaveLength(1)
      expect(lights[0].type).toBe('point')
      expect(lights[0].position).toEqual([1, 2, 3])
      expect(lights[0].intensity).toBe(100)
      expect(lights[0].color).toBe('#FFF5E6')
    })

    it('clears placementPending', () => {
      useOasisStore.setState({
        placementPending: { type: 'light', name: 'point light', lightType: 'point' },
      })
      getState().placeLightAt('point', [1, 2, 3])
      expect(getState().placementPending).toBeNull()
    })

    it('spawns a placement VFX at the same position', () => {
      getState().placeLightAt('point', [1, 2, 3])
      const vfx = getState().activePlacementVfx
      expect(vfx.length).toBeGreaterThanOrEqual(1)
      expect(vfx[vfx.length - 1].position).toEqual([1, 2, 3])
    })
  })

  describe("placeLightAt('spot', [x, y, z])", () => {
    it('adds a spot light with intensity 100, angle 45, and target derived from position', () => {
      useOasisStore.setState({
        placementPending: { type: 'light', name: 'spot light', lightType: 'spot' },
      })

      getState().placeLightAt('spot', [1, 2, 3])

      const lights = getState().worldLights
      expect(lights).toHaveLength(1)
      const light = lights[0]
      expect(light.type).toBe('spot')
      expect(light.position).toEqual([1, 2, 3])
      expect(light.intensity).toBe(100)
      expect(light.angle).toBe(45)
      // Target derived from position: same X/Z, Y=0 (aim at ground below the light)
      expect(light.target).toEqual([1, 0, 3])
    })

    it('clears placementPending', () => {
      useOasisStore.setState({
        placementPending: { type: 'light', name: 'spot light', lightType: 'spot' },
      })
      getState().placeLightAt('spot', [1, 2, 3])
      expect(getState().placementPending).toBeNull()
    })

    it('spawns a placement VFX at the same position', () => {
      getState().placeLightAt('spot', [7, 4, -2])
      const vfx = getState().activePlacementVfx
      expect(vfx.length).toBeGreaterThanOrEqual(1)
      expect(vfx[vfx.length - 1].position).toEqual([7, 4, -2])
    })
  })

  // ─═̷─═̷─💡 End-to-end: addWorldLight → placeLightAt flow ─═̷─═̷─💡
  describe('full point-light placement flow', () => {
    it("addWorldLight('point') then placeLightAt('point', pos) yields exactly one light + cleared pending + vfx", () => {
      getState().addWorldLight('point')
      expect(getState().placementPending).not.toBeNull()
      expect(getState().worldLights).toHaveLength(0)

      getState().placeLightAt('point', [10, 5, -4])

      expect(getState().placementPending).toBeNull()
      expect(getState().worldLights).toHaveLength(1)
      const light = getState().worldLights[0]
      expect(light.type).toBe('point')
      expect(light.position).toEqual([10, 5, -4])
      expect(light.intensity).toBe(100)
      expect(getState().activePlacementVfx.length).toBeGreaterThanOrEqual(1)
    })
  })
})
