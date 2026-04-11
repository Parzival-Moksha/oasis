import { beforeEach, describe, expect, it, vi } from 'vitest'

const analyserFrames: number[][] = []

function queueAnalyserFrame(values: Record<number, number>) {
  const frame = new Array<number>(128).fill(0)
  for (const [index, value] of Object.entries(values)) {
    frame[Number(index)] = value
  }
  analyserFrames.push(frame)
}

function createMockAnalyser() {
  return {
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 128,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: vi.fn((target: Uint8Array) => {
      const next = analyserFrames.shift() || new Array<number>(128).fill(0)
      target.fill(0)
      for (let i = 0; i < Math.min(target.length, next.length); i += 1) {
        target[i] = next[i]
      }
    }),
  }
}

const mockAudioCtx = {
  state: 'running',
  destination: {},
  resume: vi.fn().mockResolvedValue(undefined),
  createAnalyser: vi.fn(() => createMockAnalyser()),
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

import {
  createLipSyncController,
  getLipSync,
  registerLipSync,
  unregisterLipSync,
} from '../lip-sync'

function attachController() {
  const ctrl = createLipSyncController()
  const element = {} as HTMLMediaElement
  ctrl.attachAudio(element)
  return { ctrl, element }
}

beforeEach(() => {
  analyserFrames.length = 0
  mockAudioCtx.createAnalyser.mockClear()
  mockAudioCtx.createMediaElementSource.mockClear()
  mockAudioCtx.resume.mockClear()
  unregisterLipSync('test-obj-1')
  unregisterLipSync('test-obj-2')
})

describe('createLipSyncController', () => {
  it('returns the expected interface', () => {
    const ctrl = createLipSyncController()
    expect(typeof ctrl.update).toBe('function')
    expect(typeof ctrl.attachAudio).toBe('function')
    expect(typeof ctrl.detach).toBe('function')
    expect(ctrl.isActive).toBe(false)
  })

  it('returns zero state while inactive', () => {
    const ctrl = createLipSyncController()
    expect(ctrl.update()).toEqual({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  })

  it('activates on attach and deactivates on detach', () => {
    const { ctrl } = attachController()
    expect(ctrl.isActive).toBe(true)
    ctrl.detach()
    expect(ctrl.isActive).toBe(false)
  })
})

describe('frequency band mapping', () => {
  it('maps low frequencies to aa', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 1: 255, 2: 255, 3: 255 })
    const state = ctrl.update()
    expect(state.aa).toBeGreaterThan(0)
    expect(state.aa).toBeGreaterThan(state.oh)
  })

  it('maps band 1 energy to oh', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 6: 255, 7: 255, 8: 255, 9: 255 })
    const state = ctrl.update()
    expect(state.oh).toBeGreaterThan(0)
    expect(state.oh).toBeGreaterThan(state.aa)
  })

  it('maps high-frequency energy to ih', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 28: 255, 30: 255, 32: 255, 34: 255 })
    const state = ctrl.update()
    expect(state.ih).toBeGreaterThan(0)
    expect(state.ih).toBeGreaterThan(state.oh)
  })

  it('leans toward ou when the second-formant centroid is low', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 12: 255, 13: 255, 14: 255 })
    const state = ctrl.update()
    expect(state.ou).toBeGreaterThan(state.ee)
  })

  it('leans toward ee when the second-formant centroid is high', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 21: 255, 22: 255, 23: 255 })
    const state = ctrl.update()
    expect(state.ee).toBeGreaterThan(state.ou)
  })
})

describe('smoothing and silence gate', () => {
  it('stays silent under the silence gate', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 1: 1, 2: 1, 3: 1 })
    expect(ctrl.update()).toEqual({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  })

  it('decays toward zero when energy disappears', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 1: 255, 2: 255, 3: 255 })
    const first = ctrl.update()
    queueAnalyserFrame({})
    const second = ctrl.update()
    queueAnalyserFrame({})
    const third = ctrl.update()
    expect(first.aa).toBeGreaterThan(0)
    expect(second.aa).toBeLessThan(first.aa)
    expect(third.aa).toBeLessThan(second.aa)
  })

  it('returns to zero after detach', () => {
    const { ctrl } = attachController()
    queueAnalyserFrame({ 1: 255, 2: 255, 3: 255 })
    expect(ctrl.update().aa).toBeGreaterThan(0)
    ctrl.detach()
    expect(ctrl.update()).toEqual({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  })
})

describe('registry', () => {
  it('stores and retrieves controllers', () => {
    const ctrl = createLipSyncController()
    registerLipSync('test-obj-1', ctrl)
    expect(getLipSync('test-obj-1')).toBe(ctrl)
  })

  it('unregister removes controllers', () => {
    const ctrl = createLipSyncController()
    registerLipSync('test-obj-1', ctrl)
    unregisterLipSync('test-obj-1')
    expect(getLipSync('test-obj-1')).toBeNull()
  })

  it('controller-aware unregister ignores stale controllers', () => {
    const ctrl1 = createLipSyncController()
    const ctrl2 = createLipSyncController()
    registerLipSync('test-obj-1', ctrl1)
    registerLipSync('test-obj-1', ctrl2)
    unregisterLipSync('test-obj-1', ctrl1)
    expect(getLipSync('test-obj-1')).toBe(ctrl2)
    unregisterLipSync('test-obj-1', ctrl2)
    expect(getLipSync('test-obj-1')).toBeNull()
  })
})
