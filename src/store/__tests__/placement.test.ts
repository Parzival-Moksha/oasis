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
  __identity__: 'TEST-FAKE-' + Math.random().toString(36).slice(2, 8),
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

vi.mock('../../lib/input-manager', () => ({
  useInputManager: {
    getState: () => inputManagerFake,
  },
}))

// ░▒▓ NODE.JS REQUIRE() SHIM ▓▒░
// oasisStore.ts uses `require('../lib/input-manager')` at runtime (not
// `import`) inside enterPlacementMode. Node's plain CJS require can't resolve
// .ts files; vitest's mock interceptor only handles ESM `import`. To bridge
// this, we hook Module._resolveFilename to redirect that specific request to
// our pre-cached stub, and pre-populate require.cache so Node finds the stub
// without needing the file to exist on disk.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path') as typeof import('node:path')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('node:module') as typeof import('node:module')
type ModuleInternal = typeof Module & {
  _resolveFilename: (request: string, parent: NodeJS.Module | null, ...rest: unknown[]) => string
  _cache: Record<string, NodeJS.Module>
}
const ModuleAny = Module as unknown as ModuleInternal
const inputManagerStubPath = path.resolve(__dirname, '../../lib/__input-manager.shim.js')
ModuleAny._cache[inputManagerStubPath] = {
  id: inputManagerStubPath,
  filename: inputManagerStubPath,
  loaded: true,
  exports: {
    useInputManager: {
      getState: () => {
        // eslint-disable-next-line no-console
        const canResult = inputManagerFake.can()
        console.log('[SHIM getState] returning fake, identity=', (inputManagerFake as any).__identity__, 'pointerLocked=', inputManagerFake.pointerLocked, 'can()=', canResult)
        return inputManagerFake
      },
    },
  },
} as unknown as NodeJS.Module
const originalResolveFilename = ModuleAny._resolveFilename.bind(Module)
ModuleAny._resolveFilename = function patchedResolveFilename(request, parent, ...rest) {
  // Match the literal request from oasisStore.ts AND its filename-prefixed
  // variants, since Node resolves relative to the parent module.
  if (request === '../lib/input-manager' || request.endsWith('lib/input-manager') || request.endsWith('lib\\input-manager')) {
    return inputManagerStubPath
  }
  return originalResolveFilename(request, parent, ...rest)
}

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
  it('DIRECT: can a vi.fn-on-object be called by an external require', () => {
    resetFake({ inputState: 'noclip', pointerLocked: false, canLockPointer: true })
    // The shim uses inputManagerFake. Let's directly verify by calling im.requestPointerLock manually.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path2 = require('node:path') as typeof import('node:path')
    const p2 = path2.resolve(__dirname, '../../lib/__input-manager.shim.js')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const M = require('node:module') as any
    const im = (M._cache[p2].exports as any).useInputManager.getState()
    console.log('[DIRECT] im === inputManagerFake?', im === inputManagerFake)
    console.log('[DIRECT] im.pointerLocked:', im.pointerLocked)
    console.log('[DIRECT] im.can():', im.can())
    console.log('[DIRECT] im.can().canLockPointer:', im.can().canLockPointer)
    console.log('[DIRECT] cond evaluates to:', (!im.pointerLocked && im.can().canLockPointer))
    im.requestPointerLock()
    console.log('[DIRECT] after manual call, count:', inputManagerFake.requestPointerLock.mock.calls.length)
    expect(inputManagerFake.requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('calls requestPointerLock when canLockPointer=true and not already locked (noclip case)', () => {
    resetFake({ inputState: 'noclip', pointerLocked: false, canLockPointer: true })
    console.log('[DEBUG before] can():', inputManagerFake.can())
    console.log('[DEBUG before] pointerLocked:', inputManagerFake.pointerLocked)
    // Trace inside the store by intercepting the fake's requestPointerLock
    inputManagerFake.requestPointerLock.mockImplementation(() => {
      console.log('[DEBUG] requestPointerLock CALLED')
    })
    inputManagerFake.transition.mockImplementation((arg: unknown) => {
      console.log('[DEBUG] transition called with', arg)
    })
    useOasisStore.getState().enterPlacementMode({ type: 'light', name: 'pointlight', lightType: 'pointlight' as any })
    console.log('[DEBUG after] can() calls:', inputManagerFake.can.mock.calls.length)
    console.log('[DEBUG after] can() results:', inputManagerFake.can.mock.results)
    console.log('[DEBUG after] requestPointerLock calls:', inputManagerFake.requestPointerLock.mock.calls.length)
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

  it('DEBUG: what is require + dirname?', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = (typeof require !== 'undefined' ? require : null)
    console.log('[DEBUG] __dirname:', typeof __dirname !== 'undefined' ? __dirname : 'undef')
    console.log('[DEBUG] __filename:', typeof __filename !== 'undefined' ? __filename : 'undef')
    console.log('[DEBUG] require.cache keys (input-manager filtered):',
      Object.keys(r?.cache || {}).filter(k => k.includes('input-manager')))
    let err: any = null
    let mod: any = null
    try { mod = r('../../lib/input-manager') } catch (e) { err = e }
    console.log('[DEBUG] mod:', mod ? Object.keys(mod) : 'ERR ' + err?.message)
    expect(true).toBe(true)
  })
})
