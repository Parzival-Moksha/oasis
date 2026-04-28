// Lip sync engine: amplitude-to-viseme mapping via Web Audio AnalyserNode.
// Pure client-side FFT analysis. No model-provided viseme stream required.

export interface LipSyncState {
  aa: number  // jaw drop / fundamental (86-344Hz)
  ih: number  // sibilants / fricatives (2068-3448Hz)
  ou: number  // "oo" second formant low centroid
  ee: number  // "eh" second formant high centroid
  oh: number  // first formant (344-1034Hz)
}

export interface LipSyncTuning {
  fftSize: number
  analyserSmoothing: number
  silenceGate: number
  smoothFactor: number
  mouthOpenCap: number
  aaGain: number
  ohGain: number
  eeGain: number
  ouGain: number
  ihGain: number
  eeOuSplit: number
  eeLowBias: number
  ouHighBias: number
}

export interface LipSyncController {
  update(): LipSyncState
  attachAudio(el: HTMLMediaElement): void
  attachStream(stream: MediaStream): void
  configure(tuning: Partial<LipSyncTuning>): void
  getTuning(): LipSyncTuning
  detach(): void
  isActive: boolean
}

let _lipSyncCtx: AudioContext | null = null

function getLipSyncCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_lipSyncCtx && _lipSyncCtx.state !== 'closed') return _lipSyncCtx
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    _lipSyncCtx = new AC()
    return _lipSyncCtx
  } catch {
    return null
  }
}

export async function resumeLipSyncContext(): Promise<AudioContext | null> {
  const ctx = getLipSyncCtx()
  if (!ctx) return null
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return ctx
    }
  }
  return ctx
}

const _connectedElements = new WeakSet<HTMLMediaElement>()

const ZERO_STATE: LipSyncState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
const FFT_SIZES = [128, 256, 512, 1024, 2048] as const

export const DEFAULT_LIP_SYNC_TUNING: LipSyncTuning = {
  fftSize: 256,
  analyserSmoothing: 0.4,
  silenceGate: 0.08,
  smoothFactor: 0.3,
  mouthOpenCap: 0.65,
  aaGain: 0.8,
  ohGain: 0.7,
  eeGain: 0.9,
  ouGain: 0.9,
  ihGain: 1.4,
  eeOuSplit: 0.5,
  eeLowBias: 0.3,
  ouHighBias: 0.3,
}

function nearestFftSize(value: number): LipSyncTuning['fftSize'] {
  if (!Number.isFinite(value)) return DEFAULT_LIP_SYNC_TUNING.fftSize
  let winner: LipSyncTuning['fftSize'] = FFT_SIZES[0]
  let distance = Math.abs(value - winner)
  for (const candidate of FFT_SIZES) {
    const nextDistance = Math.abs(value - candidate)
    if (nextDistance < distance) {
      winner = candidate
      distance = nextDistance
    }
  }
  return winner
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

function normalizeLipSyncTuning(next?: Partial<LipSyncTuning>): LipSyncTuning {
  return {
    fftSize: nearestFftSize(next?.fftSize ?? DEFAULT_LIP_SYNC_TUNING.fftSize),
    analyserSmoothing: clampRange(next?.analyserSmoothing ?? DEFAULT_LIP_SYNC_TUNING.analyserSmoothing, 0, 0.99),
    silenceGate: clampRange(next?.silenceGate ?? DEFAULT_LIP_SYNC_TUNING.silenceGate, 0, 1),
    smoothFactor: clampRange(next?.smoothFactor ?? DEFAULT_LIP_SYNC_TUNING.smoothFactor, 0, 1),
    mouthOpenCap: clampRange(next?.mouthOpenCap ?? DEFAULT_LIP_SYNC_TUNING.mouthOpenCap, 0, 1),
    aaGain: clampRange(next?.aaGain ?? DEFAULT_LIP_SYNC_TUNING.aaGain, 0, 3),
    ohGain: clampRange(next?.ohGain ?? DEFAULT_LIP_SYNC_TUNING.ohGain, 0, 3),
    eeGain: clampRange(next?.eeGain ?? DEFAULT_LIP_SYNC_TUNING.eeGain, 0, 3),
    ouGain: clampRange(next?.ouGain ?? DEFAULT_LIP_SYNC_TUNING.ouGain, 0, 3),
    ihGain: clampRange(next?.ihGain ?? DEFAULT_LIP_SYNC_TUNING.ihGain, 0, 3),
    eeOuSplit: clampRange(next?.eeOuSplit ?? DEFAULT_LIP_SYNC_TUNING.eeOuSplit, 0.1, 0.9),
    eeLowBias: clampRange(next?.eeLowBias ?? DEFAULT_LIP_SYNC_TUNING.eeLowBias, 0, 1),
    ouHighBias: clampRange(next?.ouHighBias ?? DEFAULT_LIP_SYNC_TUNING.ouHighBias, 0, 1),
  }
}

export function createLipSyncController(initialTuning?: Partial<LipSyncTuning>): LipSyncController {
  let analyser: AnalyserNode | null = null
  let source: AudioNode | null = null
  let freqData: Uint8Array<ArrayBuffer> | null = null
  let active = false
  let currentElement: HTMLMediaElement | null = null
  let currentStream: MediaStream | null = null
  let prev: LipSyncState = { ...ZERO_STATE }
  let tuning = normalizeLipSyncTuning(initialTuning)

  const applyAnalyserTuning = () => {
    if (!analyser) return
    analyser.fftSize = tuning.fftSize
    analyser.smoothingTimeConstant = tuning.analyserSmoothing
    freqData = new Uint8Array(analyser.frequencyBinCount)
  }

  const resetGraph = () => {
    if (source && analyser) {
      try { source.disconnect(analyser) } catch { /* already disconnected */ }
    }
    if (analyser) {
      try { analyser.disconnect() } catch { /* already disconnected */ }
    }
    analyser = null
    source = null
    freqData = null
    active = false
    prev = { ...ZERO_STATE }
  }

  const prepareAnalyser = () => {
    const ctx = getLipSyncCtx()
    if (!ctx) return null
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    analyser = ctx.createAnalyser()
    applyAnalyserTuning()

    return ctx
  }

  const controller: LipSyncController = {
    get isActive() { return active },

    attachAudio(el: HTMLMediaElement) {
      if (active && currentElement === el) return

      resetGraph()
      currentElement = el
      currentStream = null

      const ctx = prepareAnalyser()
      if (!ctx || !analyser) return

      // Native HTML audio path used by Merlin and the audio media bubbles.
      if (!_connectedElements.has(el)) {
        try {
          source = ctx.createMediaElementSource(el)
          _connectedElements.add(el)
          source.connect(analyser)
          analyser.connect(ctx.destination)
        } catch {
          resetGraph()
          return
        }
      } else {
        // createMediaElementSource() may only be called once per element.
        // If another controller already claimed the element, fail soft.
        resetGraph()
        return
      }

      active = true
    },

    attachStream(stream: MediaStream) {
      if (active && currentStream === stream) return

      resetGraph()
      currentStream = stream
      currentElement = null

      const ctx = prepareAnalyser()
      if (!ctx || !analyser) return

      try {
        source = ctx.createMediaStreamSource(stream)
        source.connect(analyser)
        active = true
      } catch {
        resetGraph()
      }
    },

    configure(nextTuning) {
      tuning = normalizeLipSyncTuning({
        ...tuning,
        ...nextTuning,
      })
      applyAnalyserTuning()
    },

    getTuning() {
      return { ...tuning }
    },

    update(): LipSyncState {
      if (!active || !analyser || !freqData) return { ...ZERO_STATE }

      analyser.getByteFrequencyData(freqData)

      // 128 bins, sample rate about 44100Hz, bin width about 172Hz.
      // Bin groups:
      // 1-4   => aa
      // 4-12  => oh
      // 12-24 => ee/ou split by centroid
      // 24-40 => ih
      const band0 = bandEnergy(freqData, 1, 4)
      const band1 = bandEnergy(freqData, 4, 12)
      const band2 = bandEnergy(freqData, 12, 24)
      const band3 = bandEnergy(freqData, 24, 40)

      const totalEnergy = band0 + band1 + band2 + band3

      let raw: LipSyncState
      if (totalEnergy < tuning.silenceGate) {
        raw = { ...ZERO_STATE }
      } else {
        const centroid = spectralCentroid(freqData, 12, 24)
        const eeWeight = centroid > tuning.eeOuSplit ? band2 * centroid : band2 * tuning.eeLowBias
        const ouWeight = centroid <= tuning.eeOuSplit ? band2 * (1 - centroid) : band2 * tuning.ouHighBias

        raw = {
          aa: Math.min(tuning.mouthOpenCap, clamp01(band0 * tuning.aaGain)),
          oh: Math.min(tuning.mouthOpenCap, clamp01(band1 * tuning.ohGain)),
          ee: clamp01(eeWeight * tuning.eeGain),
          ou: clamp01(ouWeight * tuning.ouGain),
          ih: clamp01(band3 * tuning.ihGain),
        }
      }

      prev = {
        aa: lerp(prev.aa, raw.aa, tuning.smoothFactor),
        ih: lerp(prev.ih, raw.ih, tuning.smoothFactor),
        ou: lerp(prev.ou, raw.ou, tuning.smoothFactor),
        ee: lerp(prev.ee, raw.ee, tuning.smoothFactor),
        oh: lerp(prev.oh, raw.oh, tuning.smoothFactor),
      }

      return { ...prev }
    },

    detach() {
      resetGraph()
      currentElement = null
      currentStream = null
    },
  }

  return controller
}

function bandEnergy(data: Uint8Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to && i < data.length; i += 1) sum += data[i]
  return sum / ((to - from) * 255)
}

function spectralCentroid(data: Uint8Array, from: number, to: number): number {
  let weightedSum = 0
  let totalWeight = 0
  for (let i = from; i < to && i < data.length; i += 1) {
    weightedSum += (i - from) * data[i]
    totalWeight += data[i]
  }
  if (totalWeight === 0) return 0.5
  return weightedSum / (totalWeight * (to - from - 1))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const _lipSyncRegistry = new Map<string, LipSyncController>()

export function registerLipSync(objectId: string, ctrl: LipSyncController): void {
  _lipSyncRegistry.set(objectId, ctrl)
}

export function getLipSync(objectId: string): LipSyncController | null {
  return _lipSyncRegistry.get(objectId) ?? null
}

export function unregisterLipSync(
  objectId: string,
  expectedCtrl?: LipSyncController,
  options?: { detach?: boolean },
): void {
  const current = _lipSyncRegistry.get(objectId)
  if (!current) return
  if (expectedCtrl && current !== expectedCtrl) return
  if (options?.detach !== false) {
    current.detach()
  }
  _lipSyncRegistry.delete(objectId)
}
