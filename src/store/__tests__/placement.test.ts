// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Tests: enterPlacementMode → input-manager pointer-lock handshake.
// ─═̷─═̷─🪄─═̷─═̷─
// The store uses `require('../lib/input-manager').useInputManager.getState()`
// (CJS-style) inside enterPlacementMode. Node's plain CJS require can't load
// .ts files; vitest's `vi.mock` interceptor only handles ESM `import`. To
// bridge this, we patch Module._resolveFilename + pre-populate require.cache
// with a shim that returns our fake input-manager state.
//
// NOTE: The eager-lock guard reads `im._previousCameraState` (set by the real
// transition() side-effect), not im.can(). For faithful simulation, the
// fake's `transition` mock mirrors the real input-manager's logic of stashing
// the current base camera state on entry to 'placement'.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Fake input-manager ───────────────────────────────────────────────────

type FakeBaseState = 'orbit' | 'noclip' | 'third-person'
type FakeInputState = FakeBaseState | 'agent-focus' | 'placement' | 'paint' | 'ui-focused'

const inputManagerFake = {
  inputState: 'orbit' as FakeInputState,
  pointerLocked: false,
  _previousCameraState: null as FakeBaseState | null,
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

vi.mock('../../lib/input-manager', () => ({
  useInputManager: { getState: () => inputManagerFake },
}))

// ── Node.js CJS require() shim ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require('node:path') as typeof import('node:path')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('node:module') as typeof import('node:module')
type ModuleInternal = typeof NodeModule & {
  _resolveFilename: (request: string, parent: NodeJS.Module | null, ...rest: unknown[]) => string
  _cache: Record<string, NodeJS.Module>
}
const ModuleAny = NodeModule as unknown as ModuleInternal
const inputManagerStubPath = nodePath.resolve(__dirname, '../../lib/__input-manager.shim.js')
ModuleAny._cache[inputManagerStubPath] = {
  id: inputManagerStubPath,
  filename: inputManagerStubPath,
  loaded: true,
  exports: {
    useInputManager: { getState: () => inputManagerFake },
  },
} as unknown as NodeJS.Module
const originalResolveFilename = ModuleAny._resolveFilename.bind(NodeModule)
ModuleAny._resolveFilename = function patchedResolveFilename(request, parent, ...rest) {
  if (request === '../lib/input-manager' || request.endsWith('lib/input-manager') || request.endsWith('lib\\input-manager')) {
    return inputManagerStubPath
  }
  return originalResolveFilename(request, parent, ...rest)
}

// ── Quiet noisy collaborators that the store pulls in at module load. ────
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
vi.mock('../../hooks/useXp', () => ({ awardXp: vi.fn() }))
vi.mock('../../lib/audio-manager', () => ({
  useAudioManager: { getState: () => ({ play: vi.fn() }) },
}))
// Prevent the dynamic import('@react-three/drei') in enterPlacementMode from
// hitting the real package (pulls in three.js + WebGL globals that don't
// exist in a vitest worker).
vi.mock('@react-three/drei', () => ({ useGLTF: { preload: vi.fn() } }))

// ── Import target AFTER mocks are declared ───────────────────────────────

import { useOasisStore } from '../oasisStore'

// ── Helpers ──────────────────────────────────────────────────────────────

interface SetupOpts {
  /** Camera mode the user is in BEFORE entering placement. */
  fromCamera?: FakeBaseState
  /** Whether pointer is already locked before entering placement. */
  pointerLocked?: boolean
  /** Pre-existing UI layer stack — placement should clear these. */
  uiLayers?: string[]
}

function setupFake(opts: SetupOpts = {}) {
  const from = opts.fromCamera ?? 'orbit'
  inputManagerFake.inputState = from
  inputManagerFake.pointerLocked = opts.pointerLocked ?? false
  inputManagerFake._previousCameraState = null
  inputManagerFake._uiLayerStack = opts.uiLayers ?? []
  inputManagerFake.popUILayer.mockReset()
  inputManagerFake.transition.mockReset()
  inputManagerFake.requestPointerLock.mockReset()
  inputManagerFake.returnToPrevious.mockReset()
  inputManagerFake.can.mockReset()
  // ░▒▓ The faithful bit: transition('placement') stashes the current base
  // camera into _previousCameraState, matching what input-manager.ts does. ▓▒░
  inputManagerFake.transition.mockImplementation((to: FakeInputState) => {
    if (to === 'placement' || to === 'paint') {
      const cur = inputManagerFake.inputState
      const isBase = cur === 'orbit' || cur === 'noclip' || cur === 'third-person'
      inputManagerFake._previousCameraState = isBase
        ? (cur as FakeBaseState)
        : (inputManagerFake._previousCameraState || 'orbit')
    }
    inputManagerFake.inputState = to
  })
  // popUILayer should remove from the stack the way the real one does.
  inputManagerFake.popUILayer.mockImplementation((id: string) => {
    inputManagerFake._uiLayerStack = inputManagerFake._uiLayerStack.filter(x => x !== id)
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  setupFake()
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('enterPlacementMode — eager pointer-lock handshake', () => {
  it('requests pointer-lock when entering from noclip (a state that supports lock)', () => {
    setupFake({ fromCamera: 'noclip', pointerLocked: false })
    useOasisStore.getState().enterPlacementMode({
      type: 'light', name: 'pointlight', lightType: 'pointlight' as never,
    })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('requests pointer-lock when entering from third-person', () => {
    setupFake({ fromCamera: 'third-person', pointerLocked: false })
    useOasisStore.getState().enterPlacementMode({
      type: 'light', name: 'pointlight', lightType: 'pointlight' as never,
    })
    expect(inputManagerFake.requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('does NOT request pointer-lock when entering from orbit (mouse cursor stays visible)', () => {
    // Orbit users expect to keep their mouse cursor visible — the eager lock
    // would surprise them. transition() still runs to switch state, but the
    // requestPointerLock gate falls through.
    setupFake({ fromCamera: 'orbit', pointerLocked: false })
    useOasisStore.getState().enterPlacementMode({
      type: 'light', name: 'pointlight', lightType: 'pointlight' as never,
    })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).not.toHaveBeenCalled()
  })

  it('does NOT request pointer-lock when already pointer-locked, even from noclip', () => {
    setupFake({ fromCamera: 'noclip', pointerLocked: true })
    useOasisStore.getState().enterPlacementMode({
      type: 'light', name: 'pointlight', lightType: 'pointlight' as never,
    })
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
    expect(inputManagerFake.requestPointerLock).not.toHaveBeenCalled()
  })

  it('clears every UI layer (popUILayer for each id) before transitioning', () => {
    setupFake({ fromCamera: 'noclip', pointerLocked: false, uiLayers: ['panel-a', 'panel-b'] })
    useOasisStore.getState().enterPlacementMode({
      type: 'light', name: 'pointlight', lightType: 'pointlight' as never,
    })
    expect(inputManagerFake.popUILayer).toHaveBeenCalledTimes(2)
    expect(inputManagerFake.popUILayer).toHaveBeenCalledWith('panel-a')
    expect(inputManagerFake.popUILayer).toHaveBeenCalledWith('panel-b')
    expect(inputManagerFake.transition).toHaveBeenCalledWith('placement')
  })

  it('sets placementPending on the store regardless of camera mode', () => {
    setupFake({ fromCamera: 'noclip', pointerLocked: false })
    const pending = { type: 'light' as const, name: 'pointlight', lightType: 'pointlight' as never }
    useOasisStore.getState().enterPlacementMode(pending)
    expect(useOasisStore.getState().placementPending).toEqual(pending)
  })
})
