// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: enterPlacementMode → input-manager pointer-lock handshake.
// ─═̷─═̷─🪄─═̷─═̷─
// The store does `require('../lib/input-manager').useInputManager.getState()`
// inside enterPlacementMode. To intercept that, we vi.mock that exact module
// path BEFORE importing the store (vi.mock is hoisted, so this works).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────

// Reusable fake input-manager state. Tests reach in and tweak fields per case.
const inputManagerFake = {
  inputState: 'orbit' as 'orbit' | 'noclip' | 'third-person' | 'agent-focus' | 'placement' | 'paint' | 'ui-focused',
  pointerLocked: false,
  _uiLayerStack: [] as string[],
  can: vi.fn(() => ({
    movement: false, mouseLook: false, objectSelection: true, transformShortcuts: true,
    clipboardShortcuts: true, deleteShortcut: true, enterFocuses: true,
    canLockPointer: false, showHoverLabels: true,
  })),
  popUILayer: vi.fn(),
  transition: vi.fn(),
  requestPointerLock: vi.fn(),
  returnToPrevious: vi.fn(),
}

// Mock under TWO identifiers because oasisStore.ts uses `require('../lib/input-manager')`
// at runtime, and Vitest's mock-id matching needs the resolved path to match
// whatever `require` resolves to. We register a mock for the canonical TS path
// (used by the test's import-graph) AND patch the bare-spec form below.
vi.mock('../../lib/input-manager', () => ({
  useInputManager: {
    getState: () => inputManagerFake,
  },
}))
vi.mock('../../lib/input-manager.ts', () => ({
  useInputManager: {
    getState: () => inputManagerFake,
  },
}))

// Quiet noisy collaborators that the store pulls in at module load.
vi.mock('../../lib/forge/world-persistence', () => ({
  loadWorld: vi.fn(),
  debouncedSaveWorld: vi.fn(),
  saveWorld: vi.fn(),
  getWorldRegistry: vi.fn(async () => []),
  getActiveWorldId: vi.fn(async () => null),
  setActiveWorldId: vi.fn(),
  getServerActiveWorld: vi.fn(),
  createWorld: vi.fn(),
  deleteWorld: vi.fn(),
  exportWorld: vi.fn(),
  importWorld: vi.fn(),
  cancelPendingSave: vi.fn(),
  loadPublicWorld: vi.fn(),
}))
vi.mock('../../lib/forge/scene-library', () => ({
  addToSceneLibrary: vi.fn(),
  getSceneLibrary: vi.fn(async () => []),
  removeFromSceneLibrary: vi.fn(),
}))
vi.mock('../../hooks/useXp', () => ({
  awardXp: vi.fn(),
}))
vi.mock('../../lib/audio-manager', () => ({
  useAudioManager: { getState: () => ({ play: vi.fn() }) },
}))
// Prevent the dynamic import('@react-three/drei') in enterPlacementMode from
// hitting the real package (it pulls in three.js + a pile of WebGL globals
// that don't exist in a vitest worker).
vi.mock('@react-three/drei', () => ({
  useGLTF: { preload: vi.fn() },
}))

// ── Import target AFTER mocks are declared ──────────────────────────────

import { useOasisStore } from '../oasisStore'

// ── Helpers ─────────────────────────────────────────────────────────────

function resetFake(opts: Partial<typeof inputManagerFake> & { canLockPointer?: boolean } = {}) {
  inputManagerFake.inputState = opts.inputState ?? 'orbit'
  inputManagerFake.pointerLocked = opts.pointerLocked ?? false
  inputManagerFake._uiLayerStack = opts._uiLayerStack ?? []
  inputManagerFake.popUILayer.mockReset()
  inputManagerFake.transition.mockReset()
  inputManagerFake.requestPointerLock.mockReset()
  inputManagerFake.returnToPrevious.mockReset()
  inputManagerFake.can.mockReset()
  inputManagerFake.can.mockReturnValue({
    movement: false, mouseLook: false, objectSelection: true, transformShortcuts: true,
    clipboardShortcuts: true, deleteShortcut: true, enterFocuses: true,
    canLockPointer: opts.canLockPointer ?? false, // default: orbit (cannot lock)
    showHoverLabels: true,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  resetFake()
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('enterPlacementMode — requests pointer-lock when the *current* state can lock', () => {
  it('calls requestPointerLock when canLockPointer=true and not already locked (noclip case)', () => {
    resetFake({ inputState: 'noclip', pointerLocked: false, canLockPointer: true })
    useOasisStore.getState().enterPlacementMode({ type: 'light', name: 'pointlight', lightType: 'pointlight' as any })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('does NOT call requestPointerLock when the originating state cannot lock (orbit case)', () => {
    // The eager-lock guard uses im.can() — i.e. the state BEFORE transition.
    // From orbit (canLockPointer=false), we transition into 'placement', but
    // do not request pointer-lock eagerly. The lock happens later via the
    // user's first canvas click, after CameraController re-checks.
    resetFake({ inputState: 'orbit', pointerLocked: false, canLockPointer: false })
    useOasisStore.getState().enterPlacementMode({ type: 'light', name: 'pointlight', lightType: 'pointlight' as any })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).not.toHaveBeenCalled()
  })

  it('does NOT call requestPointerLock when already pointer-locked', () => {
    resetFake({ inputState: 'noclip', pointerLocked: true, canLockPointer: true })
    useOasisStore.getState().enterPlacementMode({ type: 'light', name: 'pointlight', lightType: 'pointlight' as any })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).not.toHaveBeenCalled()
  })

  it('clears every UI layer (popUILayer for each id) before transitioning', () => {
    resetFake({ inputState: 'noclip', pointerLocked: false, canLockPointer: true, _uiLayerStack: ['panel-a', 'panel-b'] })
    useOasisStore.getState().enterPlacementMode({ type: 'light', name: 'pointlight', lightType: 'pointlight' as any })
    expect(inputManagerFake.popUILayer).toHaveBeenCalledTimes(2)
    expect(inputManagerFake.popUILayer).toHaveBeenCalledWith('panel-a')
    expect(inputManagerFake.popUILayer).toHaveBeenCalledWith('panel-b')
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
  })

  it('sets placementPending on the store', () => {
    resetFake({ inputState: 'noclip', pointerLocked: false, canLockPointer: true })
    const pending = { type: 'light' as const, name: 'pointlight', lightType: 'pointlight' as any }
    useOasisStore.getState().enterPlacementMode(pending)
    expect(useOasisStore.getState().placementPending).toEqual(pending)
  })

  it('DEBUG: what does the require() return?', () => {
    let err1: any = null
    let err2: any = null
    let mod1: any = null
    let mod2: any = null
    try { mod1 = require('../../lib/input-manager') } catch (e) { err1 = e }
    try { mod2 = require('../../lib/input-manager.ts') } catch (e) { err2 = e }
    console.log('[DEBUG] require no-ext:', mod1 ? Object.keys(mod1) : 'ERR ' + err1?.message)
    console.log('[DEBUG] require .ts ext:', mod2 ? Object.keys(mod2) : 'ERR ' + err2?.message)
    expect(true).toBe(true)
  })
})
