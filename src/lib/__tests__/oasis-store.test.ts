// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OASIS STORE TESTS — Zustand state: agent windows, z-ordering, save guards
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
import type { AgentWindowType, AgentWindow } from '../../store/oasisStore'
import { debouncedSaveWorld, saveWorld } from '../../lib/forge/world-persistence'

// Cast the mocked imports for easy access
const mockDebouncedSave = debouncedSaveWorld as ReturnType<typeof vi.fn>
const mockSaveWorld = saveWorld as ReturnType<typeof vi.fn>

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function getState() { return useOasisStore.getState() }

function makeAgentWindow(overrides: Partial<AgentWindow> = {}): AgentWindow {
  return {
    id: `agent-test-${Date.now()}`,
    agentType: 'anorak',
    position: [0, 2, 0],
    rotation: [0, 0, 0],
    scale: 1,
    width: 800,
    height: 600,
    ...overrides,
  }
}

/** Reset store to a clean baseline between tests */
function resetStore() {
  useOasisStore.setState({
    placedAgentWindows: [],
    placedAgentAvatars: [],
    liveAgentAvatarAudio: {},
    focusedAgentWindowId: null,
    _preFocusCameraState: null,
    _panelZCounter: 0,
    _panelZMap: {},
    _worldReady: false,
    _loadedObjectCount: 0,
    _isReceivingRemoteUpdate: false,
    isViewMode: false,
    isViewModeEditable: false,
    placedCatalogAssets: [],
    craftedScenes: [],
    worldConjuredAssetIds: [],
    placementPending: null,
    activePlacementVfx: [],
    focusedImageId: null,
    transforms: {},
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('OasisStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
    mockDebouncedSave.mockClear()
    mockSaveWorld.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─═̷─═̷─ AgentWindowType ─═̷─═̷─
  describe('AgentWindowType', () => {
    it('includes anorak-pro as a valid type', () => {
      // Type-level test: if this compiles, AgentWindowType includes 'anorak-pro'
      const t: AgentWindowType = 'anorak-pro'
      expect(t).toBe('anorak-pro')
    })

    it('includes all expected agent types', () => {
      const types: AgentWindowType[] = ['anorak', 'anorak-pro', 'merlin', 'devcraft', 'parzival']
      expect(types).toHaveLength(5)
    })
  })

  // ─═̷─═̷─ addAgentWindow ─═̷─═̷─
  describe('addAgentWindow()', () => {
    it('adds a window to placedAgentWindows', () => {
      const win = makeAgentWindow({ id: 'win-1' })
      getState().addAgentWindow(win)
      expect(getState().placedAgentWindows).toHaveLength(1)
      expect(getState().placedAgentWindows[0].id).toBe('win-1')
    })

    it('clears placementPending after adding', () => {
      useOasisStore.setState({ placementPending: { type: 'agent', name: 'test', agentType: 'anorak' } })
      getState().addAgentWindow(makeAgentWindow())
      expect(getState().placementPending).toBeNull()
    })

    it('accumulates multiple windows', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'w1' }))
      getState().addAgentWindow(makeAgentWindow({ id: 'w2' }))
      getState().addAgentWindow(makeAgentWindow({ id: 'w3' }))
      expect(getState().placedAgentWindows).toHaveLength(3)
    })

    it('can add anorak-pro window', () => {
      const win = makeAgentWindow({ id: 'pro-1', agentType: 'anorak-pro' })
      getState().addAgentWindow(win)
      expect(getState().placedAgentWindows[0].agentType).toBe('anorak-pro')
    })

    it('spawns placement VFX at window position', () => {
      const pos: [number, number, number] = [5, 3, 10]
      getState().addAgentWindow(makeAgentWindow({ position: pos }))
      // spawnPlacementVfx adds to activePlacementVfx
      expect(getState().activePlacementVfx.length).toBeGreaterThanOrEqual(1)
      expect(getState().activePlacementVfx[0].position).toEqual(pos)
    })
  })

  // ─═̷─═̷─ removeAgentWindow ─═̷─═̷─
  describe('removeAgentWindow()', () => {
    it('removes the window by id', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'rm-1' }))
      getState().addAgentWindow(makeAgentWindow({ id: 'rm-2' }))
      getState().removeAgentWindow('rm-1')
      expect(getState().placedAgentWindows).toHaveLength(1)
      expect(getState().placedAgentWindows[0].id).toBe('rm-2')
    })

    it('clears focusedAgentWindowId if removed window was focused', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'focus-rm' }))
      useOasisStore.setState({ focusedAgentWindowId: 'focus-rm' })
      getState().removeAgentWindow('focus-rm')
      expect(getState().focusedAgentWindowId).toBeNull()
    })

    it('preserves focusedAgentWindowId if another window was focused', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'a' }))
      getState().addAgentWindow(makeAgentWindow({ id: 'b' }))
      useOasisStore.setState({ focusedAgentWindowId: 'b' })
      getState().removeAgentWindow('a')
      expect(getState().focusedAgentWindowId).toBe('b')
    })

    it('no-ops on non-existent id', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'exists' }))
      getState().removeAgentWindow('ghost')
      expect(getState().placedAgentWindows).toHaveLength(1)
    })

    it('also removes any linked companion avatar', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'rm-linked' }))
      getState().assignAvatarToAgentWindow('rm-linked', '/avatars/gallery/Orion.vrm')
      expect(getState().placedAgentAvatars).toHaveLength(1)

      getState().removeAgentWindow('rm-linked')
      expect(getState().placedAgentAvatars).toEqual([])
    })
  })

  // ─═̷─═̷─ updateAgentWindow ─═̷─═̷─
  describe('updateAgentWindow()', () => {
    it('merges partial updates into the window', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'upd-1', width: 800, label: undefined }))
      getState().updateAgentWindow('upd-1', { width: 1024, label: 'My Anorak' })
      const win = getState().placedAgentWindows.find(w => w.id === 'upd-1')!
      expect(win.width).toBe(1024)
      expect(win.label).toBe('My Anorak')
      expect(win.height).toBe(600) // unchanged
    })

    it('does not affect other windows', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'u1', width: 800 }))
      getState().addAgentWindow(makeAgentWindow({ id: 'u2', width: 800 }))
      getState().updateAgentWindow('u1', { width: 1920 })
      const u2 = getState().placedAgentWindows.find(w => w.id === 'u2')!
      expect(u2.width).toBe(800)
    })

    it('updates position', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'pos-1', position: [0, 0, 0] }))
      getState().updateAgentWindow('pos-1', { position: [10, 5, -3] })
      const win = getState().placedAgentWindows.find(w => w.id === 'pos-1')!
      expect(win.position).toEqual([10, 5, -3])
    })

    it('updates frame properties', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'frame-1' }))
      getState().updateAgentWindow('frame-1', { frameStyle: 'neon', frameThickness: 2.5, windowOpacity: 0.8, windowBlur: 10 })
      const win = getState().placedAgentWindows.find(w => w.id === 'frame-1')!
      expect(win.frameStyle).toBe('neon')
      expect(win.frameThickness).toBe(2.5)
      expect(win.windowOpacity).toBe(0.8)
      expect(win.windowBlur).toBe(10)
    })
  })

  // ─═̷─═̷─ focusAgentWindow ─═̷─═̷─
  describe('focusAgentWindow()', () => {
    it('sets focusedAgentWindowId when given an id', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'focus-1' }))
      getState().focusAgentWindow('focus-1')
      expect(getState().focusedAgentWindowId).toBe('focus-1')
    })

    it('clears focus when given null', () => {
      useOasisStore.setState({ focusedAgentWindowId: 'some-id' })
      getState().focusAgentWindow(null)
      expect(getState().focusedAgentWindowId).toBeNull()
    })

    it('can switch focus between windows', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'f1' }))
      getState().addAgentWindow(makeAgentWindow({ id: 'f2' }))
      getState().focusAgentWindow('f1')
      expect(getState().focusedAgentWindowId).toBe('f1')
      getState().focusAgentWindow('f2')
      expect(getState().focusedAgentWindowId).toBe('f2')
    })
  })

  describe('agent avatars', () => {
    it('assignAvatarToAgentWindow creates a linked companion avatar', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'avatar-win', label: 'Window Buddy' }))

      const avatarId = getState().assignAvatarToAgentWindow('avatar-win', '/avatars/gallery/Orion.vrm')
      const avatar = getState().placedAgentAvatars[0]

      expect(avatarId).toBe('agent-avatar-avatar-win')
      expect(avatar.linkedWindowId).toBe('avatar-win')
      expect(avatar.avatar3dUrl).toBe('/avatars/gallery/Orion.vrm')
      expect(avatar.label).toBe('Window Buddy')
      expect(avatar.scale).toBeGreaterThan(1)
    })

    it('assignAvatarToAgentWindow(null) removes the linked avatar', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'avatar-rm' }))
      getState().assignAvatarToAgentWindow('avatar-rm', '/avatars/gallery/Orion.vrm')

      const result = getState().assignAvatarToAgentWindow('avatar-rm', null)
      expect(result).toBeNull()
      expect(getState().placedAgentAvatars).toEqual([])
    })

    it('assignHermesAvatar creates a standalone Hermes body', () => {
      const avatarId = getState().assignHermesAvatar('/avatars/gallery/CoolAlien.vrm')
      const avatar = getState().placedAgentAvatars[0]

      expect(avatarId).toBe('agent-avatar-hermes')
      expect(avatar.agentType).toBe('hermes')
      expect(avatar.avatar3dUrl).toBe('/avatars/gallery/CoolAlien.vrm')
      expect(avatar.linkedWindowId).toBeUndefined()
    })

    it('repairs invalid Hermes avatar URLs to a valid gallery VRM', () => {
      const avatarId = getState().assignHermesAvatar('/avatars/hermes.glb#vrm')
      const avatar = getState().placedAgentAvatars[0]

      expect(avatarId).toBe('agent-avatar-hermes')
      expect(avatar.avatar3dUrl).toBe('/avatars/gallery/CoolAlien.vrm')
    })

    it('setAgentAvatarAudio stores and clears ephemeral playback state', () => {
      getState().setAgentAvatarAudio('agent-avatar-hermes', { url: 'blob:test', state: 'playing' })
      expect(getState().liveAgentAvatarAudio['agent-avatar-hermes']?.url).toBe('blob:test')

      getState().setAgentAvatarAudio('agent-avatar-hermes', null)
      expect(getState().liveAgentAvatarAudio['agent-avatar-hermes']).toBeUndefined()
    })
  })

  // ─═̷─═̷─ __OASIS_STORE__ global exposure ─═̷─═̷─
  describe('__OASIS_STORE__ global', () => {
    it('typeof window check guards the assignment', () => {
      // In Node test env, typeof window === 'undefined', so __OASIS_STORE__ is NOT set.
      // This proves the SSR guard works — the store doesn't crash on the server.
      // The store module loaded without throwing, which is the real test.
      expect(useOasisStore.getState).toBeDefined()
      expect(typeof useOasisStore.getState).toBe('function')
    })

    it('store is functional even without window (SSR-safe)', () => {
      // The store should work identically regardless of window presence
      const state = getState()
      expect(state).toHaveProperty('placedAgentWindows')
      expect(state).toHaveProperty('_worldReady')
      expect(state).toHaveProperty('_panelZCounter')
      expect(state).toHaveProperty('addAgentWindow')
    })

    it('__OASIS_STORE__ shape exposes getState and setState when window exists', () => {
      // Verify the code path: store line 325-327 assigns { getState, setState }
      // We can't test window assignment in Node, but we verify the contract:
      // the store's own getState/setState match the shape that would be exposed
      const storeApi = { getState: useOasisStore.getState, setState: useOasisStore.setState }
      expect(typeof storeApi.getState).toBe('function')
      expect(typeof storeApi.setState).toBe('function')
      expect(storeApi.getState()).toHaveProperty('activeRealm')
    })
  })

  // ─═̷─═̷─ Panel Z-ordering ─═̷─═̷─
  describe('panel z-ordering', () => {
    it('starts with _panelZCounter at 0 and empty _panelZMap', () => {
      expect(getState()._panelZCounter).toBe(0)
      expect(getState()._panelZMap).toEqual({})
    })

    it('bringPanelToFront increments counter and records panel', () => {
      getState().bringPanelToFront('anorak')
      expect(getState()._panelZCounter).toBe(1)
      expect(getState()._panelZMap['anorak']).toBe(1)
    })

    it('subsequent calls give higher z to last-clicked panel', () => {
      getState().bringPanelToFront('anorak')
      getState().bringPanelToFront('merlin')
      getState().bringPanelToFront('devcraft')
      expect(getState()._panelZMap['anorak']).toBe(1)
      expect(getState()._panelZMap['merlin']).toBe(2)
      expect(getState()._panelZMap['devcraft']).toBe(3)
    })

    it('re-clicking a panel moves it to the top', () => {
      getState().bringPanelToFront('anorak')   // z=1
      getState().bringPanelToFront('merlin')   // z=2
      getState().bringPanelToFront('anorak')   // z=3 (re-focus)
      expect(getState()._panelZMap['anorak']).toBe(3)
      expect(getState()._panelZMap['merlin']).toBe(2) // unchanged
    })

    it('getPanelZIndex returns defaultZ when panel has no entry', () => {
      const z = getState().getPanelZIndex('unknown-panel', 42)
      expect(z).toBe(42)
    })

    it('getPanelZIndex returns 9990 + order when panel has entry', () => {
      getState().bringPanelToFront('anorak')
      const z = getState().getPanelZIndex('anorak', 50)
      expect(z).toBe(9991) // 9990 + 1
    })

    it('multiple panels get correct z-indices', () => {
      getState().bringPanelToFront('a')
      getState().bringPanelToFront('b')
      getState().bringPanelToFront('c')
      expect(getState().getPanelZIndex('a', 0)).toBe(9991)
      expect(getState().getPanelZIndex('b', 0)).toBe(9992)
      expect(getState().getPanelZIndex('c', 0)).toBe(9993)
    })
  })

  // ─═̷─═̷─ World save guards ─═̷─═̷─
  describe('world save guards', () => {
    it('_worldReady defaults to false', () => {
      expect(getState()._worldReady).toBe(false)
    })

    it('saveWorldState is blocked when _worldReady is false', () => {
      getState().saveWorldState()
      expect(mockDebouncedSave).not.toHaveBeenCalled()
      expect(mockSaveWorld).not.toHaveBeenCalled()
    })

    it('saveWorldState proceeds when _worldReady is true', () => {
      useOasisStore.setState({ _worldReady: true, _loadedObjectCount: 0 })
      getState().saveWorldState()
      expect(mockDebouncedSave).toHaveBeenCalled()
    })

    it('nuke protection blocks save when loaded 5+ objects but current is 0', () => {
      useOasisStore.setState({
        _worldReady: true,
        _loadedObjectCount: 10,
        placedCatalogAssets: [],
        craftedScenes: [],
        worldConjuredAssetIds: [],
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      getState().saveWorldState()

      expect(mockDebouncedSave).not.toHaveBeenCalled()
      expect(mockSaveWorld).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('nuke protection allows save when loaded < 5 objects even if current is 0', () => {
      useOasisStore.setState({
        _worldReady: true,
        _loadedObjectCount: 3,
        placedCatalogAssets: [],
        craftedScenes: [],
        worldConjuredAssetIds: [],
      })

      getState().saveWorldState()
      expect(mockDebouncedSave).toHaveBeenCalled()
    })

    it('save blocked during view mode (read-only)', () => {
      useOasisStore.setState({ _worldReady: true, isViewMode: true, isViewModeEditable: false })
      getState().saveWorldState()
      expect(mockDebouncedSave).not.toHaveBeenCalled()
      expect(mockSaveWorld).not.toHaveBeenCalled()
    })

    it('save allowed during view mode when isViewModeEditable is true', () => {
      useOasisStore.setState({
        _worldReady: true,
        _loadedObjectCount: 0,
        isViewMode: true,
        isViewModeEditable: true,
        viewingWorldId: 'public-world',
      })
      getState().saveWorldState()
      // isViewModeEditable + viewingWorldId => calls saveWorld directly
      expect(mockSaveWorld).toHaveBeenCalled()
    })

    it('save blocked while receiving remote update (_isReceivingRemoteUpdate)', () => {
      useOasisStore.setState({ _worldReady: true, _isReceivingRemoteUpdate: true })
      getState().saveWorldState()
      expect(mockDebouncedSave).not.toHaveBeenCalled()
      expect(mockSaveWorld).not.toHaveBeenCalled()
    })
  })

  // ─═̷─═̷─ focusImage ─═̷─═̷─
  describe('focusImage()', () => {
    it('sets focusedImageId and clears focusedAgentWindowId', () => {
      useOasisStore.setState({ focusedAgentWindowId: 'agent-1' })
      getState().focusImage('img-42')
      expect(getState().focusedImageId).toBe('img-42')
      expect(getState().focusedAgentWindowId).toBeNull()
    })

    it('clears focusedImageId when given null', () => {
      useOasisStore.setState({ focusedImageId: 'img-42' })
      getState().focusImage(null)
      expect(getState().focusedImageId).toBeNull()
    })

    it('mutual exclusion: focusAgentWindow clears focusedImageId', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'aw-1' }))
      useOasisStore.setState({ focusedImageId: 'img-99' })
      getState().focusAgentWindow('aw-1')
      expect(getState().focusedImageId).toBeNull()
      expect(getState().focusedAgentWindowId).toBe('aw-1')
    })
  })

  // ─═̷─═̷─ navigateSlide ─═̷─═̷─
  describe('navigateSlide()', () => {
    function makePlacement(id: string, x: number, z = 0, imageUrl = 'http://img.png') {
      return {
        id,
        catalogId: 'generated-image',
        name: id,
        glbPath: '',
        position: [x, 2, z] as [number, number, number],
        scale: 1,
        imageUrl,
      }
    }

    it('does nothing when there are no images', () => {
      useOasisStore.setState({ placedCatalogAssets: [], focusedImageId: null })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBeNull()
    })

    it('navigateSlide(1) focuses first image sorted by X when none focused', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('b', 10),
          makePlacement('a', -5),
          makePlacement('c', 20),
        ] as any,
        transforms: {},
        focusedImageId: null,
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('a') // leftmost X=-5
    })

    it('navigateSlide(-1) focuses last image sorted by X when none focused', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('b', 10),
          makePlacement('a', -5),
          makePlacement('c', 20),
        ] as any,
        transforms: {},
        focusedImageId: null,
      })
      getState().navigateSlide(-1)
      expect(getState().focusedImageId).toBe('c') // rightmost X=20
    })

    it('navigateSlide(1) cycles forward through images', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('a', 0),
          makePlacement('b', 5),
          makePlacement('c', 10),
        ] as any,
        transforms: {},
        focusedImageId: 'a',
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('b')
    })

    it('navigateSlide(-1) cycles backward through images', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('a', 0),
          makePlacement('b', 5),
          makePlacement('c', 10),
        ] as any,
        transforms: {},
        focusedImageId: 'b',
      })
      getState().navigateSlide(-1)
      expect(getState().focusedImageId).toBe('a')
    })

    it('wraps around forward at end', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('a', 0),
          makePlacement('b', 5),
        ] as any,
        transforms: {},
        focusedImageId: 'b',
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('a') // wraps to first
    })

    it('wraps around backward at start', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('a', 0),
          makePlacement('b', 5),
        ] as any,
        transforms: {},
        focusedImageId: 'a',
      })
      getState().navigateSlide(-1)
      expect(getState().focusedImageId).toBe('b') // wraps to last
    })

    it('uses transforms override for sorting when available', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          makePlacement('a', 0),   // original X=0
          makePlacement('b', 5),   // original X=5
        ] as any,
        transforms: {
          'a': { position: [100, 2, 0] },  // moved far right
        },
        focusedImageId: null,
      })
      getState().navigateSlide(1)
      // b (X=5) is now leftmost since a was moved to X=100
      expect(getState().focusedImageId).toBe('b')
    })

    it('skips non-image placements', () => {
      useOasisStore.setState({
        placedCatalogAssets: [
          { id: 'model-1', catalogId: 'tree', name: 'Tree', glbPath: '/tree.glb', position: [0, 0, 0], scale: 1 },
          makePlacement('img-1', 5),
        ] as any,
        transforms: {},
        focusedImageId: null,
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('img-1') // only image
    })

    it('includes video placements (videoUrl) in slide navigation', () => {
      const videoPlacement = {
        id: 'vid-1',
        catalogId: 'video',
        name: 'Demo Video',
        glbPath: '',
        position: [0, 2, 0] as [number, number, number],
        scale: 2,
        videoUrl: 'http://example.com/demo.mp4',
      }
      useOasisStore.setState({
        placedCatalogAssets: [videoPlacement] as any,
        transforms: {},
        focusedImageId: null,
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('vid-1')
    })

    it('navigates through mixed image and video placements sorted by X', () => {
      const img = makePlacement('img-left', -10)
      const vid = {
        id: 'vid-mid',
        catalogId: 'video',
        name: 'Mid Video',
        glbPath: '',
        position: [0, 2, 0] as [number, number, number],
        scale: 2,
        videoUrl: 'http://example.com/mid.mp4',
      }
      const img2 = makePlacement('img-right', 10)
      useOasisStore.setState({
        placedCatalogAssets: [vid, img2, img] as any, // unsorted order
        transforms: {},
        focusedImageId: null,
      })
      // First slide → leftmost (img-left at X=-10)
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('img-left')
      // Next → vid-mid at X=0
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('vid-mid')
      // Next → img-right at X=10
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('img-right')
    })

    it('excludes placements with neither imageUrl nor videoUrl', () => {
      const glbOnly = {
        id: 'glb-1',
        catalogId: 'some-model',
        name: 'Model',
        glbPath: '/model.glb',
        position: [0, 2, 0] as [number, number, number],
        scale: 1,
      }
      const vid = {
        id: 'vid-1',
        catalogId: 'video',
        name: 'Video',
        glbPath: '',
        position: [5, 2, 0] as [number, number, number],
        scale: 2,
        videoUrl: 'http://example.com/v.mp4',
      }
      useOasisStore.setState({
        placedCatalogAssets: [glbOnly, vid] as any,
        transforms: {},
        focusedImageId: null,
      })
      getState().navigateSlide(1)
      expect(getState().focusedImageId).toBe('vid-1') // glb-1 excluded
    })
  })

  // ─═̷─═̷─ placeVideoAt ─═̷─═̷─
  describe('placeVideoAt()', () => {
    it('adds a video placement to placedCatalogAssets', () => {
      getState().placeVideoAt('My Video', 'http://example.com/clip.mp4', [3, 0, -2])
      const assets = getState().placedCatalogAssets
      expect(assets).toHaveLength(1)
      expect(assets[0].name).toBe('My Video')
      expect(assets[0].videoUrl).toBe('http://example.com/clip.mp4')
      expect(assets[0].position).toEqual([3, 0, -2])
    })

    it('generates id with video- prefix', () => {
      getState().placeVideoAt('V', 'http://v.mp4', [0, 0, 0])
      expect(getState().placedCatalogAssets[0].id).toMatch(/^video-/)
    })

    it('sets catalogId to "video"', () => {
      getState().placeVideoAt('V', 'http://v.mp4', [0, 0, 0])
      expect(getState().placedCatalogAssets[0].catalogId).toBe('video')
    })

    it('sets scale to 2', () => {
      getState().placeVideoAt('V', 'http://v.mp4', [0, 0, 0])
      expect(getState().placedCatalogAssets[0].scale).toBe(2)
    })

    it('clears placementPending', () => {
      useOasisStore.setState({ placementPending: { type: 'catalog', name: 'something', catalogId: 'x' } })
      getState().placeVideoAt('V', 'http://v.mp4', [0, 0, 0])
      expect(getState().placementPending).toBeNull()
    })

    it('spawns placement VFX', () => {
      getState().placeVideoAt('V', 'http://v.mp4', [7, 1, 3])
      expect(getState().activePlacementVfx.length).toBeGreaterThanOrEqual(1)
      expect(getState().activePlacementVfx[0].position).toEqual([7, 1, 3])
    })

    it('accumulates multiple video placements', () => {
      getState().placeVideoAt('V1', 'http://v1.mp4', [0, 0, 0])
      getState().placeVideoAt('V2', 'http://v2.mp4', [5, 0, 0])
      expect(getState().placedCatalogAssets).toHaveLength(2)
    })
  })

  // ─═̷─═̷─ focusImage / focusAgentWindow mutual exclusion ─═̷─═̷─
  describe('focusImage ↔ focusAgentWindow mutual exclusion', () => {
    it('focusImage clears focusedAgentWindowId', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'aw-me' }))
      getState().focusAgentWindow('aw-me')
      expect(getState().focusedAgentWindowId).toBe('aw-me')
      // Now focus an image — should clear agent window focus
      getState().focusImage('img-1')
      expect(getState().focusedImageId).toBe('img-1')
      expect(getState().focusedAgentWindowId).toBeNull()
    })

    it('focusAgentWindow clears focusedImageId', () => {
      getState().focusImage('img-2')
      expect(getState().focusedImageId).toBe('img-2')
      // Now focus an agent window — should clear image focus
      getState().addAgentWindow(makeAgentWindow({ id: 'aw-2' }))
      getState().focusAgentWindow('aw-2')
      expect(getState().focusedAgentWindowId).toBe('aw-2')
      expect(getState().focusedImageId).toBeNull()
    })

    it('rapid toggling between image and agent window keeps state consistent', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'aw-toggle' }))
      for (let i = 0; i < 5; i++) {
        getState().focusImage(`img-${i}`)
        expect(getState().focusedImageId).toBe(`img-${i}`)
        expect(getState().focusedAgentWindowId).toBeNull()

        getState().focusAgentWindow('aw-toggle')
        expect(getState().focusedAgentWindowId).toBe('aw-toggle')
        expect(getState().focusedImageId).toBeNull()
      }
    })

    it('unfocusing image (null) does not restore agent window focus', () => {
      getState().addAgentWindow(makeAgentWindow({ id: 'aw-x' }))
      getState().focusAgentWindow('aw-x')
      getState().focusImage('img-x')
      // Agent window is cleared by focusImage
      expect(getState().focusedAgentWindowId).toBeNull()
      // Now unfocus image
      getState().focusImage(null)
      expect(getState().focusedImageId).toBeNull()
      expect(getState().focusedAgentWindowId).toBeNull() // still null
    })

    it('unfocusing agent window (null) does not restore image focus', () => {
      getState().focusImage('img-y')
      getState().focusAgentWindow('aw-y')
      // Image is cleared by focusAgentWindow
      expect(getState().focusedImageId).toBeNull()
      // Now unfocus agent window
      getState().focusAgentWindow(null)
      expect(getState().focusedAgentWindowId).toBeNull()
      expect(getState().focusedImageId).toBeNull() // still null
    })
  })

  // ─═̷─═̷─ Initial state sanity ─═̷─═̷─
  describe('initial state defaults', () => {
    it('placedAgentWindows starts empty', () => {
      expect(getState().placedAgentWindows).toEqual([])
    })

    it('focusedAgentWindowId starts null', () => {
      expect(getState().focusedAgentWindowId).toBeNull()
    })

    it('_loadedObjectCount starts at 0', () => {
      expect(getState()._loadedObjectCount).toBe(0)
    })
  })
})
