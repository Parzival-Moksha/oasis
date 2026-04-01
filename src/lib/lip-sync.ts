// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIP SYNC ENGINE — amplitude-to-viseme mapping via Web Audio AnalyserNode
// ░▒▓ Pure engine. Zero external deps. Feeds VRM expression system. ▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface LipSyncState {
  aa: number  // jaw drop / fundamental (86-344Hz)
  ih: number  // sibilants / fricatives (2068-3448Hz)
  ou: number  // "oo" — second formant low centroid
  ee: number  // "eh" — second formant high centroid
  oh: number  // first formant (344-1034Hz)
}

export interface LipSyncController {
  update(): LipSyncState
  attachAudio(el: HTMLMediaElement): void
  detach(): void
  isActive: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// AudioContext singleton — reuse across all lip sync controllers
// ═══════════════════════════════════════════════════════════════════════════

let _lipSyncCtx: AudioContext | null = null
function getLipSyncCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_lipSyncCtx && _lipSyncCtx.state !== 'closed') return _lipSyncCtx
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    _lipSyncCtx = new AC()
    return _lipSyncCtx
  } catch { return null }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL GUARD: createMediaElementSource() throws InvalidStateError
// if called twice on the same element. WeakSet tracks connected elements.
// ═══════════════════════════════════════════════════════════════════════════

const _connectedElements = new WeakSet<HTMLMediaElement>()

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

const ZERO_STATE: LipSyncState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
const SILENCE_GATE = 0.05
const SMOOTH_FACTOR = 0.3

export function createLipSyncController(): LipSyncController {
  let analyser: AnalyserNode | null = null
  let source: MediaElementAudioSourceNode | null = null
  let freqData: Uint8Array<ArrayBuffer> | null = null
  let active = false

  // Smoothed previous state
  let prev: LipSyncState = { ...ZERO_STATE }

  const controller: LipSyncController = {
    get isActive() { return active },

    attachAudio(el: HTMLMediaElement) {
      const ctx = getLipSyncCtx()
      if (!ctx) return

      // Resume suspended context (browser gesture requirement)
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})

      // Create analyser
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256 // → 128 frequency bins
      analyser.smoothingTimeConstant = 0.4
      freqData = new Uint8Array(analyser.frequencyBinCount)

      // Connect source → analyser → destination
      // CRITICAL: only call createMediaElementSource ONCE per element
      if (!_connectedElements.has(el)) {
        try {
          source = ctx.createMediaElementSource(el)
          _connectedElements.add(el)
          source.connect(analyser)
          analyser.connect(ctx.destination)
        } catch {
          // If it still fails, bail gracefully
          analyser = null
          freqData = null
          return
        }
      } else {
        // Element already connected — we can't create a new source,
        // but we can still analyze by connecting the existing source node.
        // Unfortunately Web Audio doesn't expose the existing source,
        // so we create an analyser on the destination side via a gain node.
        // For the common case (single lip sync per element), the WeakSet
        // prevents the double-attach crash. If re-attaching after detach,
        // the source was already connected — just reconnect analyser.
        if (source) {
          try {
            source.connect(analyser)
            analyser.connect(ctx.destination)
          } catch { /* already connected */ }
        } else {
          // Can't reconnect — no source reference
          analyser = null
          freqData = null
          return
        }
      }

      active = true
    },

    update(): LipSyncState {
      if (!active || !analyser || !freqData) return { ...ZERO_STATE }

      analyser.getByteFrequencyData(freqData)

      // Split into 4 frequency bands (128 bins, sample rate ~44100Hz, bin width ~172Hz)
      // Band 0: bins 1-4   (~86-688Hz)   → aa (jaw drop / fundamental)
      // Band 1: bins 4-12  (~688-2068Hz)  → oh (first formant)
      // Band 2: bins 12-24 (~2068-4137Hz) → ee/ou (second formant)
      // Band 3: bins 24-40 (~4137-6892Hz) → ih (sibilants/fricatives)
      const band0 = bandEnergy(freqData, 1, 4)
      const band1 = bandEnergy(freqData, 4, 12)
      const band2 = bandEnergy(freqData, 12, 24)
      const band3 = bandEnergy(freqData, 24, 40)

      const totalEnergy = band0 + band1 + band2 + band3

      let raw: LipSyncState
      if (totalEnergy < SILENCE_GATE) {
        // Silence gate — snap to zero
        raw = { ...ZERO_STATE }
      } else {
        // Spectral centroid of band2 → split ee vs ou
        const centroid = spectralCentroid(freqData, 12, 24)
        const eeWeight = centroid > 0.5 ? band2 * centroid : band2 * 0.3
        const ouWeight = centroid <= 0.5 ? band2 * (1 - centroid) : band2 * 0.3

        raw = {
          aa: clamp01(band0 * 1.5),
          oh: clamp01(band1 * 1.2),
          ee: clamp01(eeWeight * 1.3),
          ou: clamp01(ouWeight * 1.3),
          ih: clamp01(band3 * 2.0),
        }
      }

      // Temporal smoothing: lerp toward raw values
      prev = {
        aa: lerp(prev.aa, raw.aa, SMOOTH_FACTOR),
        ih: lerp(prev.ih, raw.ih, SMOOTH_FACTOR),
        ou: lerp(prev.ou, raw.ou, SMOOTH_FACTOR),
        ee: lerp(prev.ee, raw.ee, SMOOTH_FACTOR),
        oh: lerp(prev.oh, raw.oh, SMOOTH_FACTOR),
      }

      return { ...prev }
    },

    detach() {
      if (source && analyser) {
        try { source.disconnect(analyser) } catch { /* already disconnected */ }
      }
      if (analyser) {
        try { analyser.disconnect() } catch { /* already disconnected */ }
      }
      analyser = null
      freqData = null
      active = false
      prev = { ...ZERO_STATE }
    },
  }

  return controller
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function bandEnergy(data: Uint8Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to && i < data.length; i++) sum += data[i]
  return sum / ((to - from) * 255)
}

function spectralCentroid(data: Uint8Array, from: number, to: number): number {
  let weightedSum = 0
  let totalWeight = 0
  for (let i = from; i < to && i < data.length; i++) {
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

// ═══════════════════════════════════════════════════════════════════════════
// Module-level registry — same pattern as _audioElements in WorldObjects
// ═══════════════════════════════════════════════════════════════════════════

const _lipSyncRegistry = new Map<string, LipSyncController>()

export function registerLipSync(objectId: string, ctrl: LipSyncController): void {
  _lipSyncRegistry.set(objectId, ctrl)
}

export function getLipSync(objectId: string): LipSyncController | null {
  return _lipSyncRegistry.get(objectId) ?? null
}

export function unregisterLipSync(objectId: string): void {
  _lipSyncRegistry.delete(objectId)
}
