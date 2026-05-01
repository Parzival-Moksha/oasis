// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// WORLD PERSISTENCE TESTS — Save guards, debounce, data shapes
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Mock fetch globally before importing the module
// ═══════════════════════════════════════════════════════════════════════════

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

// Mock window for API_BASE resolution
vi.stubGlobal('window', {
  location: { origin: 'http://localhost:4516' },
})

import {
  getActiveWorldId,
  setActiveWorldId,
  getWorldRegistry,
  createWorld,
  deleteWorld,
  saveWorld,
  loadWorld,
  loadPublicWorld,
  exportWorld,
  importWorld,
  debouncedSaveWorld,
  cancelPendingSave,
  migrateIfNeeded,
  type WorldState,
  type WorldMeta,
  type PublicWorldResult,
} from '../forge/world-persistence'

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeFetchOk(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) }
}
function makeFetch404() {
  return { ok: false, status: 404, json: () => Promise.resolve(null) }
}

function makeMinimalWorldState(): WorldState {
  return {
    version: 1,
    terrain: null,
    craftedScenes: [],
    conjuredAssetIds: [],
    catalogPlacements: [],
    transforms: {},
    savedAt: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('WorldPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    localStorageMock.clear()
    cancelPendingSave() // clear any leftover debounce timer
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Active World ID (localStorage)
  // ─────────────────────────────────────────────────────────────────────────

  describe('getActiveWorldId / setActiveWorldId', () => {
    it('returns default world ID when localStorage is empty', () => {
      expect(getActiveWorldId()).toBe('forge-default')
    })

    it('stores and retrieves world ID', () => {
      setActiveWorldId('my-world-42')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('oasis-active-world', 'my-world-42')
      expect(getActiveWorldId()).toBe('my-world-42')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Registry fetch
  // ─────────────────────────────────────────────────────────────────────────

  describe('getWorldRegistry', () => {
    it('returns world list on success', async () => {
      const worlds: WorldMeta[] = [
        { id: 'w1', name: 'Alpha', icon: '🏔️', visibility: 'private', createdAt: '', lastSavedAt: '' },
      ]
      fetchMock.mockResolvedValueOnce(makeFetchOk(worlds))

      const result = await getWorldRegistry()
      expect(result).toEqual(worlds)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns empty array on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'))
      const result = await getWorldRegistry()
      expect(result).toEqual([])
    })

    it('returns empty array on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
      const result = await getWorldRegistry()
      expect(result).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Create / Delete
  // ─────────────────────────────────────────────────────────────────────────

  describe('createWorld', () => {
    it('POSTs name + icon and returns new WorldMeta', async () => {
      const meta: WorldMeta = { id: 'new-1', name: 'Test', icon: '🌍', visibility: 'private', createdAt: '', lastSavedAt: '' }
      fetchMock.mockResolvedValueOnce(makeFetchOk(meta))

      const result = await createWorld('Test')
      expect(result).toEqual(meta)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const callArgs = fetchMock.mock.calls[0]
      expect(callArgs[1].method).toBe('POST')
      const body = JSON.parse(callArgs[1].body)
      expect(body).toEqual({ name: 'Test', icon: '🌍' })
    })

    it('uses custom icon when provided', async () => {
      fetchMock.mockResolvedValueOnce(makeFetchOk({ id: 'x' }))
      await createWorld('Zen', '☯')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.icon).toBe('☯')
    })

    it('throws on HTTP error', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
      await expect(createWorld('Fail')).rejects.toThrow('Create world failed')
    })
  })

  describe('deleteWorld', () => {
    it('sends DELETE request', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })
      await deleteWorld('some-world')
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    })

    it('refuses to delete the default world', async () => {
      await deleteWorld('forge-default')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Save / Load — core persistence
  // ─────────────────────────────────────────────────────────────────────────

  describe('saveWorld', () => {
    it('PUTs state to the active world endpoint', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })
      const state = { terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} }

      await saveWorld(state as any)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    })

    it('uses explicit worldId over active world', async () => {
      setActiveWorldId('should-not-use-this')
      fetchMock.mockResolvedValueOnce({ ok: true })

      await saveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any, 'explicit-world')
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('explicit-world')
      expect(url).not.toContain('should-not-use-this')
    })

    it('stores the forked world id returned from a template save', async () => {
      fetchMock.mockResolvedValueOnce(makeFetchOk({
        ok: true,
        saved: true,
        worldId: 'forked-world',
        forkedFromWorldId: 'template-world',
      }))

      await saveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any, 'template-world')

      expect(localStorageMock.setItem).toHaveBeenCalledWith('oasis-active-world', 'forked-world')
    })

    it('does not throw on network error (logs instead)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'))
      // Should not throw
      await saveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any)
    })
  })

  describe('loadWorld', () => {
    it('returns WorldState on success', async () => {
      const state = makeMinimalWorldState()
      fetchMock.mockResolvedValueOnce(makeFetchOk(state))

      const result = await loadWorld('test-world')
      expect(result).toEqual(state)
    })

    it('returns null on 404', async () => {
      fetchMock.mockResolvedValueOnce(makeFetch404())
      const result = await loadWorld('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'))
      const result = await loadWorld('bad')
      expect(result).toBeNull()
    })

    it('uses active world ID when none specified', async () => {
      setActiveWorldId('my-active')
      fetchMock.mockResolvedValueOnce(makeFetchOk(makeMinimalWorldState()))

      await loadWorld()
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('my-active')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Public world loading
  // ─────────────────────────────────────────────────────────────────────────

  describe('loadPublicWorld', () => {
    it('fetches /public endpoint and returns result', async () => {
      const result: PublicWorldResult = {
        state: makeMinimalWorldState(),
        meta: { id: 'pub-1', name: 'Public', icon: '🌎', visibility: 'public', createdAt: '', lastSavedAt: '' },
      }
      fetchMock.mockResolvedValueOnce(makeFetchOk(result))

      const loaded = await loadPublicWorld('pub-1')
      expect(loaded).toEqual(result)
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('/pub-1/public')
    })

    it('returns null on error', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
      expect(await loadPublicWorld('secret')).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Export / Import
  // ─────────────────────────────────────────────────────────────────────────

  describe('exportWorld', () => {
    it('returns JSON string with meta + state', async () => {
      const state = makeMinimalWorldState()
      const meta: WorldMeta = { id: 'exp-1', name: 'Exported', icon: '📦', visibility: 'private', createdAt: '', lastSavedAt: '' }

      // First call: loadWorld, second call: getWorldRegistry
      fetchMock
        .mockResolvedValueOnce(makeFetchOk(state))  // loadWorld
        .mockResolvedValueOnce(makeFetchOk([meta]))  // getWorldRegistry

      const json = await exportWorld('exp-1')
      expect(json).not.toBeNull()
      const parsed = JSON.parse(json!)
      expect(parsed.state).toEqual(state)
      expect(parsed.meta).toEqual(meta)
    })

    it('returns null if world not found', async () => {
      fetchMock
        .mockResolvedValueOnce(makeFetch404()) // loadWorld returns null
        .mockResolvedValueOnce(makeFetchOk([]))
      const result = await exportWorld('nope')
      expect(result).toBeNull()
    })
  })

  describe('importWorld', () => {
    it('POSTs import payload and returns meta', async () => {
      const state = makeMinimalWorldState()
      const meta: WorldMeta = { id: 'imp-1', name: 'Imported', icon: '📥', visibility: 'private', createdAt: '', lastSavedAt: '' }

      fetchMock.mockResolvedValueOnce(makeFetchOk(meta))

      const result = await importWorld(JSON.stringify({ meta, state }))
      expect(result).toEqual(meta)

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.import).toBe(true)
      expect(body.state.version).toBe(1)
    })

    it('returns null for invalid version', async () => {
      const result = await importWorld(JSON.stringify({ state: { version: 99 } }))
      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('returns null for malformed JSON', async () => {
      const result = await importWorld('not json at all {{')
      expect(result).toBeNull()
    })

    it('returns null when state is missing', async () => {
      const result = await importWorld(JSON.stringify({ meta: {} }))
      expect(result).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Debounced Save — the 1000ms default debounce
  // ─────────────────────────────────────────────────────────────────────────

  describe('debouncedSaveWorld', () => {
    it('does not fire immediately', () => {
      fetchMock.mockResolvedValue({ ok: true })
      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fires after default 1000ms delay', () => {
      fetchMock.mockResolvedValue({ ok: true })
      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any)

      vi.advanceTimersByTime(999)
      expect(fetchMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('respects custom delay', () => {
      fetchMock.mockResolvedValue({ ok: true })
      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any, 500)

      vi.advanceTimersByTime(499)
      expect(fetchMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('resets timer on rapid calls (only last one fires)', () => {
      fetchMock.mockResolvedValue({ ok: true })

      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any)
      vi.advanceTimersByTime(800)
      // Second call resets the timer
      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: ['extra'], transforms: {} } as any)
      vi.advanceTimersByTime(800)
      // First timer's 1000ms has passed, but it was cancelled
      expect(fetchMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(200)
      // Now second timer fires (800 + 200 = 1000ms)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      // Verify it saved the SECOND payload (with 'extra' asset)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.conjuredAssetIds).toEqual(['extra'])
    })
  })

  describe('cancelPendingSave', () => {
    it('prevents a scheduled save from firing', () => {
      fetchMock.mockResolvedValue({ ok: true })
      debouncedSaveWorld({ terrain: null, craftedScenes: [], conjuredAssetIds: [], transforms: {} } as any)

      cancelPendingSave()
      vi.advanceTimersByTime(2000)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is safe to call when no save is pending', () => {
      // Should not throw
      cancelPendingSave()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // migrateIfNeeded — no-op in v2
  // ─────────────────────────────────────────────────────────────────────────

  describe('migrateIfNeeded', () => {
    it('is a no-op and does not throw', () => {
      expect(() => migrateIfNeeded()).not.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // WorldState type shape validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('WorldState data shape', () => {
    it('minimal valid state has required fields', () => {
      const state = makeMinimalWorldState()
      expect(state.version).toBe(1)
      expect(state.terrain).toBeNull()
      expect(state.craftedScenes).toEqual([])
      expect(state.conjuredAssetIds).toEqual([])
      expect(state.transforms).toEqual({})
      expect(state.savedAt).toBeTruthy()
    })

    it('supports optional fields without breaking', () => {
      const state: WorldState = {
        ...makeMinimalWorldState(),
        groundPresetId: 'grass',
        groundTiles: { '0,0': 'sand', '1,1': 'custom_abc' },
        skyBackgroundId: 'night007',
        behaviors: { 'obj-1': { movement: 'float' } as any },
        lights: [],
        customGroundPresets: [],
        agentWindows: [],
      }
      expect(state.groundPresetId).toBe('grass')
      expect(state.groundTiles?.['0,0']).toBe('sand')
      expect(state.skyBackgroundId).toBe('night007')
      expect(state.agentWindows).toEqual([])
    })

    it('transform entries have correct tuple shape', () => {
      const state = makeMinimalWorldState()
      state.transforms = {
        'obj-1': { position: [1, 2, 3] },
        'obj-2': { position: [0, 0, 0], rotation: [0, 1.57, 0], scale: [2, 2, 2] },
        'obj-3': { position: [0, 0, 0], scale: 0.5 },
      }
      expect(state.transforms['obj-1'].position).toHaveLength(3)
      expect(state.transforms['obj-2'].rotation).toEqual([0, 1.57, 0])
      expect(state.transforms['obj-3'].scale).toBe(0.5)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // WorldMeta type shape
  // ─────────────────────────────────────────────────────────────────────────

  describe('WorldMeta data shape', () => {
    it('has required fields for registry entries', () => {
      const meta: WorldMeta = {
        id: 'test-world',
        name: 'Test World',
        icon: '🏔️',
        visibility: 'private',
        createdAt: '2025-01-01T00:00:00Z',
        lastSavedAt: '2025-01-02T00:00:00Z',
      }
      expect(meta.id).toBe('test-world')
      expect(meta.visibility).toBe('private')
    })

    it('supports all visibility modes', () => {
      const modes: WorldMeta['visibility'][] = ['private', 'public', 'unlisted', 'public_edit']
      modes.forEach(v => {
        const meta: WorldMeta = { id: 'x', name: 'X', icon: '🌍', visibility: v, createdAt: '', lastSavedAt: '' }
        expect(meta.visibility).toBe(v)
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Save guard logic (tested via saveWorldState in oasisStore, but
  // we verify the pure-logic patterns here as documentation)
  // ─────────────────────────────────────────────────────────────────────────

  describe('Save guard logic (pure functions)', () => {
    it('_worldReady guard: false means save is blocked', () => {
      // This tests the PATTERN used in oasisStore.saveWorldState
      const _worldReady = false
      const shouldSave = _worldReady
      expect(shouldSave).toBe(false)
    })

    it('_worldReady guard: true means save is allowed', () => {
      const _worldReady = true
      const shouldSave = _worldReady
      expect(shouldSave).toBe(true)
    })

    it('nuke protection: loaded 5+ objects but saving 0 = blocked', () => {
      const _loadedObjectCount = 10
      const conjuredAssetIds: string[] = []
      const placedCatalogAssets: any[] = []
      const craftedScenes: any[] = []
      const currentObjCount = conjuredAssetIds.length + placedCatalogAssets.length + craftedScenes.length

      const nukeBlocked = _loadedObjectCount >= 5 && currentObjCount === 0
      expect(nukeBlocked).toBe(true)
    })

    it('nuke protection: loaded 5+ but still has objects = allowed', () => {
      const _loadedObjectCount = 10
      const currentObjCount = 3 as number
      const nukeBlocked = _loadedObjectCount >= 5 && currentObjCount === 0
      expect(nukeBlocked).toBe(false)
    })

    it('nuke protection: loaded < 5 and saving 0 = allowed (empty world is fine)', () => {
      const _loadedObjectCount = 3
      const currentObjCount = 0
      const nukeBlocked = _loadedObjectCount >= 5 && currentObjCount === 0
      expect(nukeBlocked).toBe(false)
    })

    it('nuke protection: loaded exactly 5 and saving 0 = blocked', () => {
      const _loadedObjectCount = 5
      const currentObjCount = 0
      const nukeBlocked = _loadedObjectCount >= 5 && currentObjCount === 0
      expect(nukeBlocked).toBe(true)
    })

    it('nuke protection: loaded 0 and saving 0 = allowed (fresh world)', () => {
      const _loadedObjectCount = 0
      const currentObjCount = 0
      const nukeBlocked = _loadedObjectCount >= 5 && currentObjCount === 0
      expect(nukeBlocked).toBe(false)
    })
  })
})
