import {
  DEFAULT_LIP_SYNC_TUNING,
  resumeLipSyncContext,
  type LipSyncController,
  type LipSyncState,
  type LipSyncTuning,
} from '@/lib/lip-sync'
import { clamp01, emptyMouthShapeWeights, type MouthShapeWeights } from '@/lib/lip-sync-lab'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const PROFILE_URL = `${OASIS_BASE}/lipsync/wlipsync/profile.bin`
const MODULE_URL = `${OASIS_BASE}/lipsync/wlipsync/wlipsync-single.js`

export interface WLipSyncTuning {
  minVolume: number
  maxVolume: number
  smoothness: number
}

export interface WLipSyncController {
  readonly isActive: boolean
  readonly isReady: boolean
  attachAudio(el: HTMLMediaElement): Promise<void>
  attachStream(stream: MediaStream): Promise<void>
  configure(next: Partial<WLipSyncTuning>): void
  getTuning(): WLipSyncTuning
  update(): MouthShapeWeights
  detach(): void
}

type CaptureStreamMediaElement = HTMLMediaElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

interface WLipSyncProfile {
  mfccs: Array<{ name: string }>
}

interface WLipSyncAudioNodeLike extends AudioNode {
  minVolume: number
  maxVolume: number
  smoothness: number
  volume: number
  weights: Record<string, number>
}

interface WLipSyncModule {
  createWLipSyncNode: (audioContext: AudioContext, profile: WLipSyncProfile) => Promise<WLipSyncAudioNodeLike>
  parseBinaryProfile: (binary: ArrayBuffer) => WLipSyncProfile
}

export const DEFAULT_WLIPSYNC_TUNING: WLipSyncTuning = {
  minVolume: -2.5,
  maxVolume: -1.5,
  smoothness: 0.05,
}

const ZERO_WEIGHTS = emptyMouthShapeWeights()
let modulePromise: Promise<WLipSyncModule> | null = null
let profilePromise: Promise<WLipSyncProfile> | null = null

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

function normalizeTuning(value?: Partial<WLipSyncTuning>): WLipSyncTuning {
  const minVolume = clampRange(value?.minVolume ?? DEFAULT_WLIPSYNC_TUNING.minVolume, -5, -0.1)
  const maxVolume = clampRange(value?.maxVolume ?? DEFAULT_WLIPSYNC_TUNING.maxVolume, minVolume + 0.05, 0.5)
  return {
    minVolume,
    maxVolume,
    smoothness: clampRange(value?.smoothness ?? DEFAULT_WLIPSYNC_TUNING.smoothness, 0.005, 0.45),
  }
}

function captureElementStream(el: HTMLMediaElement): MediaStream {
  const media = el as CaptureStreamMediaElement
  if (typeof media.captureStream === 'function') {
    return media.captureStream()
  }
  if (typeof media.mozCaptureStream === 'function') {
    return media.mozCaptureStream()
  }
  throw new Error('captureStream is unavailable for this audio element')
}

async function loadWLipSyncModule(): Promise<WLipSyncModule> {
  if (!modulePromise) {
    modulePromise = (import(/* webpackIgnore: true */ MODULE_URL) as Promise<WLipSyncModule>).catch(error => {
      modulePromise = null
      throw error
    })
  }
  return modulePromise
}

async function loadWLipSyncProfile(): Promise<WLipSyncProfile> {
  if (!profilePromise) {
    profilePromise = (async () => {
      const [mod, response] = await Promise.all([
        loadWLipSyncModule(),
        fetch(PROFILE_URL, { cache: 'force-cache' }),
      ])
      if (!response.ok) {
        throw new Error(`wLipSync profile fetch failed: HTTP ${response.status}`)
      }
      return mod.parseBinaryProfile(await response.arrayBuffer())
    })().catch(error => {
      profilePromise = null
      throw error
    })
  }
  return profilePromise
}

function normalizeWeightSet(node: WLipSyncAudioNodeLike | null): MouthShapeWeights {
  if (!node) return { ...ZERO_WEIGHTS }

  const volumeSpan = Math.max(0.0001, node.maxVolume - node.minVolume)
  const volume = clamp01((node.volume - node.minVolume) / volumeSpan)
  const a = clamp01(node.weights.A ?? 0)
  const e = clamp01(node.weights.E ?? 0)
  const i = clamp01(node.weights.I ?? 0)
  const o = clamp01(node.weights.O ?? 0)
  const u = clamp01(node.weights.U ?? 0)
  const s = clamp01(node.weights.S ?? 0)
  const voiced = Math.max(a, e, i, o, u, s)
  const gain = clamp01(volume * 1.15)

  return {
    sil: clamp01(1 - voiced * gain),
    pp: 0,
    ff: 0,
    th: 0,
    dd: 0,
    kk: 0,
    ch: 0,
    ss: clamp01(s * gain),
    nn: 0,
    rr: 0,
    aa: clamp01(a * gain),
    ee: clamp01(e * gain),
    ih: clamp01(i * gain),
    oh: clamp01(o * gain),
    ou: clamp01(u * gain),
  }
}

function mouthWeightsToLegacyState(weights: MouthShapeWeights): LipSyncState {
  return {
    aa: clamp01(weights.aa),
    ih: clamp01(Math.max(weights.ih, weights.ss * 0.82)),
    ou: clamp01(weights.ou),
    ee: clamp01(weights.ee),
    oh: clamp01(weights.oh),
  }
}

// ─── node pool ──────────────────────────────────────────────────────────────
// A wLipSync node is an AudioWorklet whose processor never finishes (process() returns true), so a
// node that is only disconnected keeps running on the audio thread for the life of the page. The old
// controller built a fresh node for every dictation and left the previous one wired to the speakers:
// one more per "T talk". Controllers now borrow a node while attached and give it back on detach, so
// the page holds as many nodes as mics live at the same time (normally one).

interface PooledNode {
  node: WLipSyncAudioNodeLike
  sink: GainNode
  ctx: AudioContext
}

const idleNodes: PooledNode[] = []
let nodesCreated = 0

async function acquireNode(): Promise<PooledNode> {
  const ctx = await resumeLipSyncContext()
  if (!ctx) throw new Error('AudioContext unavailable')
  while (idleNodes.length) {
    const entry = idleNodes.pop() as PooledNode
    if (entry.ctx === ctx && ctx.state !== 'closed') return entry
  }
  const [mod, profile] = await Promise.all([loadWLipSyncModule(), loadWLipSyncProfile()])
  const node = await mod.createWLipSyncNode(ctx, profile)
  const sink = ctx.createGain()
  sink.gain.value = 0
  node.connect(sink)
  sink.connect(ctx.destination)
  nodesCreated += 1
  return { node, sink, ctx }
}

function releaseNode(entry: PooledNode): void {
  // Start the next borrower from a closed mouth.
  entry.node.volume = 0
  for (const key of Object.keys(entry.node.weights)) entry.node.weights[key] = 0
  idleNodes.push(entry)
}

/** How many wLipSync nodes this page has built, and how many sit idle in the pool (tests, debugging). */
export function getWLipSyncNodeStats(): { created: number; idle: number } {
  return { created: nodesCreated, idle: idleNodes.length }
}

export function createWLipSyncController(initialTuning?: Partial<WLipSyncTuning>): WLipSyncController {
  let tuning = normalizeTuning(initialTuning)
  let active = false
  let source: MediaStreamAudioSourceNode | null = null
  let pooled: PooledNode | null = null
  let acquiring: Promise<PooledNode> | null = null
  /** Bumped by every attach and detach, so a slow attach can tell it was overtaken. */
  let attachToken = 0
  /** The latest call was an attach (true) or a detach (false). */
  let wantAttached = false
  let lastWeights = { ...ZERO_WEIGHTS }

  const applyNodeTuning = () => {
    if (!pooled) return
    pooled.node.minVolume = tuning.minVolume
    pooled.node.maxVolume = tuning.maxVolume
    pooled.node.smoothness = tuning.smoothness
  }

  const disconnectSource = () => {
    if (source) {
      try { source.disconnect() } catch {}
      source = null
    }
  }

  const giveBack = () => {
    if (!pooled) return
    releaseNode(pooled)
    pooled = null
  }

  const ensureNode = async (): Promise<PooledNode> => {
    if (pooled) return pooled
    if (!acquiring) {
      acquiring = acquireNode().then(
        entry => {
          acquiring = null
          pooled = entry
          applyNodeTuning()
          return entry
        },
        error => {
          acquiring = null
          throw error
        },
      )
    }
    return acquiring
  }

  const connectStream = async (stream: MediaStream) => {
    disconnectSource()
    const token = ++attachToken
    wantAttached = true
    const entry = await ensureNode()
    if (token !== attachToken) {
      // Overtaken while the node was on its way: a newer attach uses it, a detach hands it back.
      if (!wantAttached) giveBack()
      return
    }
    source = entry.ctx.createMediaStreamSource(stream)
    source.connect(entry.node)
    active = true
  }

  return {
    get isActive() {
      return active
    },
    get isReady() {
      return Boolean(pooled)
    },
    async attachAudio(el: HTMLMediaElement) {
      await connectStream(captureElementStream(el))
    },
    async attachStream(stream: MediaStream) {
      await connectStream(stream)
    },
    configure(next) {
      tuning = normalizeTuning({
        ...tuning,
        ...next,
      })
      applyNodeTuning()
    },
    getTuning() {
      return { ...tuning }
    },
    update() {
      lastWeights = normalizeWeightSet(pooled?.node ?? null)
      return { ...lastWeights }
    },
    detach() {
      attachToken += 1
      wantAttached = false
      disconnectSource()
      active = false
      lastWeights = { ...ZERO_WEIGHTS }
      giveBack()
    },
  }
}

export function createWLipSyncLegacyController(initialTuning?: Partial<WLipSyncTuning>): LipSyncController {
  const controller = createWLipSyncController(initialTuning)

  return {
    get isActive() {
      return controller.isActive
    },
    attachAudio(el) {
      void controller.attachAudio(el).catch(() => {})
    },
    attachStream(stream) {
      void controller.attachStream(stream).catch(() => {})
    },
    configure(_nextTuning: Partial<LipSyncTuning>) {
      // Live wLipSync has its own tuning surface.
    },
    getTuning() {
      return { ...DEFAULT_LIP_SYNC_TUNING }
    },
    update() {
      return mouthWeightsToLegacyState(controller.update())
    },
    detach() {
      controller.detach()
    },
  }
}
