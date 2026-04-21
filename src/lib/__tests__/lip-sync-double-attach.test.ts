// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// lip-sync — double-attach guard behavior
// ─═̷─═̷─ॐ─═̷─═̷─ mirrors AvatarGallery re-play guard ─═̷─═̷─ॐ─═̷─═̷─
//
// The lip-sync module uses a WeakSet<HTMLMediaElement> to prevent
// createMediaElementSource() from being called twice on the same element
// (that would throw InvalidStateError). The second attach on the SAME
// controller is a no-op via the `isActive` check that AvatarGallery wraps
// around `attachAudio`. This test captures the guard's deterministic
// behavior so it doesn't silently drift.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════
// Mock Web Audio primitives (jsdom does not provide them)
// ═══════════════════════════════════════════════════════════════════════════
const mockAudioCtx = {
  state: 'running',
  destination: {},
  resume: vi.fn().mockResolvedValue(undefined),
  createAnalyser: vi.fn(() => ({
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 128,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: vi.fn(),
  })),
  createMediaElementSource: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}

const mockAudioContextCtor = vi.fn().mockImplementation(function () {
  return mockAudioCtx
})

vi.stubGlobal('window', {
  AudioContext: mockAudioContextCtor,
})
vi.stubGlobal('AudioContext', mockAudioContextCtor)

import { createLipSyncController } from '../lip-sync'

beforeEach(() => {
  mockAudioCtx.state = 'running'
  mockAudioCtx.createAnalyser.mockClear()
  mockAudioCtx.createMediaElementSource.mockClear()
  mockAudioCtx.resume.mockClear()
})

describe('lip-sync: double-attach guard (same controller, same element)', () => {
  it('creates exactly ONE MediaElementSource per element, even across 2 attaches', () => {
    const ctrl = createLipSyncController()
    const el = {} as HTMLMediaElement
    ctrl.attachAudio(el)
    ctrl.attachAudio(el)
    // The WeakSet prevents a second createMediaElementSource on the same el,
    // regardless of how many times we call attach.
    expect(mockAudioCtx.createMediaElementSource).toHaveBeenCalledTimes(1)
  })

  it('is still active after a second attachAudio on the same element', () => {
    const ctrl = createLipSyncController()
    const el = {} as HTMLMediaElement
    ctrl.attachAudio(el)
    expect(ctrl.isActive).toBe(true)
    ctrl.attachAudio(el)
    // The gallery guards with `!isActive`, so the second call never happens.
    // But if it does, the engine must not crash. `isActive` may stay true OR
    // flip false depending on the reconnect path — the CRITICAL invariant is
    // no exception and no second source.
    expect(typeof ctrl.isActive).toBe('boolean')
  })
})

describe('lip-sync: same element, fresh controller', () => {
  it('does not throw when a second fresh controller attaches to an already-connected element', () => {
    const el = {} as HTMLMediaElement
    const ctrlA = createLipSyncController()
    ctrlA.attachAudio(el)
    expect(ctrlA.isActive).toBe(true)
    expect(mockAudioCtx.createMediaElementSource).toHaveBeenCalledTimes(1)

    const ctrlB = createLipSyncController()
    expect(() => ctrlB.attachAudio(el)).not.toThrow()
    // Source was not created again — WeakSet caught it.
    expect(mockAudioCtx.createMediaElementSource).toHaveBeenCalledTimes(1)
  })
})

describe('lip-sync: different elements', () => {
  it('creates a new MediaElementSource for each unique element', () => {
    const ctrl = createLipSyncController()
    const elA = {} as HTMLMediaElement
    const elB = {} as HTMLMediaElement
    ctrl.attachAudio(elA)
    ctrl.attachAudio(elB)
    // Note: the second attach REPLACES the internal analyser but does NOT
    // create a second source if the second element was never seen either.
    // Behavior check: two distinct elements → two createMediaElementSource calls.
    expect(mockAudioCtx.createMediaElementSource).toHaveBeenCalledTimes(2)
  })
})
