import type { LipSyncState } from '@/lib/lip-sync'

export const CANONICAL_MOUTH_SHAPES = [
  'sil',
  'pp',
  'ff',
  'th',
  'dd',
  'kk',
  'ch',
  'ss',
  'nn',
  'rr',
  'aa',
  'ee',
  'ih',
  'oh',
  'ou',
] as const

export type CanonicalMouthShape = (typeof CANONICAL_MOUTH_SHAPES)[number]

export type MouthShapeWeights = Record<CanonicalMouthShape, number>

export interface ElevenLabsAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export interface TimedPhoneme {
  phoneme: string
  start: number
  end: number
  confidence?: number
}

export interface MouthCue {
  shape: CanonicalMouthShape
  start: number
  end: number
  strength: number
  source: string
}

export interface MouthTimeline {
  cues: MouthCue[]
  duration: number
}

export interface SpeechCoverage {
  rawNames: string[]
  byShape: Record<CanonicalMouthShape, string[]>
  ovrCoverage: number
  vrmCoverage: number
  hasEmotionShapes: boolean
  speechRig: 'ovr15' | 'vrm5' | 'limited' | 'none'
}

const OVR_SHAPES: CanonicalMouthShape[] = ['sil', 'pp', 'ff', 'th', 'dd', 'kk', 'ch', 'ss', 'nn', 'rr', 'aa', 'ee', 'ih', 'oh', 'ou']
const VRM_SHAPES: CanonicalMouthShape[] = ['aa', 'ih', 'ou', 'ee', 'oh']
const EMOTION_TOKENS = ['happy', 'joy', 'smile', 'angry', 'sad', 'surprised', 'relaxed', 'fun']

const EXACT_MORPH_ALIASES: Record<CanonicalMouthShape, string[]> = {
  sil: ['sil', 'silence', 'rest', 'idle', 'neutralmouth'],
  pp: ['pp', 'bmp', 'pbm'],
  ff: ['ff', 'fv'],
  th: ['th', 'dh'],
  dd: ['dd', 'td'],
  kk: ['kk', 'kg'],
  ch: ['ch', 'jh'],
  ss: ['ss', 'sz', 'sh', 'zh'],
  nn: ['nn', 'nl'],
  rr: ['rr', 'er'],
  aa: ['aa', 'a'],
  ee: ['ee', 'eh', 'e'],
  ih: ['ih', 'iy', 'i'],
  oh: ['oh', 'ao', 'o'],
  ou: ['ou', 'uw', 'oo', 'u'],
}

const PHONEME_TO_SHAPE: Record<string, CanonicalMouthShape> = {
  AA: 'aa',
  AE: 'aa',
  AH: 'aa',
  AO: 'oh',
  AW: 'ou',
  AY: 'ih',
  B: 'pp',
  CH: 'ch',
  D: 'dd',
  DH: 'th',
  EH: 'ee',
  ER: 'rr',
  EY: 'ee',
  F: 'ff',
  G: 'kk',
  HH: 'aa',
  IH: 'ih',
  IY: 'ih',
  JH: 'ch',
  K: 'kk',
  L: 'dd',
  M: 'pp',
  N: 'nn',
  NG: 'kk',
  OW: 'oh',
  OY: 'oh',
  P: 'pp',
  R: 'rr',
  S: 'ss',
  SH: 'ss',
  T: 'dd',
  TH: 'th',
  UH: 'ou',
  UW: 'ou',
  V: 'ff',
  W: 'ou',
  Y: 'ih',
  Z: 'ss',
  ZH: 'ss',
}

const CHARACTER_TO_SHAPE: Array<[RegExp, CanonicalMouthShape]> = [
  [/[\s.,!?;:()[\]{}"'-]/, 'sil'],
  [/[bmp]/i, 'pp'],
  [/[fv]/i, 'ff'],
  [/[t]/i, 'th'],
  [/[dln]/i, 'dd'],
  [/[kgq]/i, 'kk'],
  [/[cj]/i, 'ch'],
  [/[szx]/i, 'ss'],
  [/[r]/i, 'rr'],
  [/[ae]/i, 'ee'],
  [/[iy]/i, 'ih'],
  [/[o]/i, 'oh'],
  [/[uw]/i, 'ou'],
] as Array<[RegExp, CanonicalMouthShape]>

function emptyShapeMap<T>(factory: () => T): Record<CanonicalMouthShape, T> {
  return {
    sil: factory(),
    pp: factory(),
    ff: factory(),
    th: factory(),
    dd: factory(),
    kk: factory(),
    ch: factory(),
    ss: factory(),
    nn: factory(),
    rr: factory(),
    aa: factory(),
    ee: factory(),
    ih: factory(),
    oh: factory(),
    ou: factory(),
  }
}

export function emptyMouthShapeWeights(): MouthShapeWeights {
  return {
    sil: 0,
    pp: 0,
    ff: 0,
    th: 0,
    dd: 0,
    kk: 0,
    ch: 0,
    ss: 0,
    nn: 0,
    rr: 0,
    aa: 0,
    ee: 0,
    ih: 0,
    oh: 0,
    ou: 0,
  }
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function normalizeMorphToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function buildMorphCandidates(value: string): string[] {
  const normalized = normalizeMorphToken(value)
  if (!normalized) return []

  const queue = [normalized]
  const seen = new Set<string>()
  const prefixes = [
    'blendshape',
    'expression',
    'expr',
    'mouthshape',
    'mouth',
    'viseme',
    'vrcv',
    'vrc',
    'oculus',
    'rpm',
    'bs',
  ]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (!current || seen.has(current)) continue
    seen.add(current)

    const withoutLeadingDigits = current.replace(/^[0-9]+/, '')
    if (withoutLeadingDigits && withoutLeadingDigits !== current) {
      queue.push(withoutLeadingDigits)
    }

    for (const prefix of prefixes) {
      if (current.startsWith(prefix) && current.length > prefix.length) {
        queue.push(current.slice(prefix.length))
      }
    }
  }

  return Array.from(seen).map(candidate =>
    candidate
      .replace(/(left|right)$/, '')
      .replace(/[0-9]+$/, ''),
  )
}

export function detectCanonicalMouthShape(name: string): CanonicalMouthShape | null {
  const candidates = buildMorphCandidates(name)
  for (const candidate of candidates) {
    for (const shape of CANONICAL_MOUTH_SHAPES) {
      const aliases = EXACT_MORPH_ALIASES[shape]
      if (aliases.includes(candidate)) return shape
    }
  }

  return null
}

export function mapPhonemeToMouthShape(phoneme: string): CanonicalMouthShape | null {
  const normalized = phoneme.trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (!normalized) return null
  return PHONEME_TO_SHAPE[normalized] || null
}

export function detectEmotionToken(name: string): string | null {
  const normalized = normalizeMorphToken(name)
  if (!normalized) return null
  return EMOTION_TOKENS.find(token => normalized.includes(token)) || null
}

export function buildSpeechCoverage(names: string[]): SpeechCoverage {
  const byShape = emptyShapeMap<string[]>(() => [])
  const uniqueNames = Array.from(new Set(names.filter(Boolean)))

  for (const name of uniqueNames) {
    const shape = detectCanonicalMouthShape(name)
    if (shape) {
      byShape[shape].push(name)
    }
  }

  const ovrCoverage = OVR_SHAPES.filter(shape => byShape[shape].length > 0).length
  const vrmCoverage = VRM_SHAPES.filter(shape => byShape[shape].length > 0).length
  const hasEmotionShapes = uniqueNames.some(name => detectEmotionToken(name))

  let speechRig: SpeechCoverage['speechRig'] = 'none'
  if (ovrCoverage >= 10) speechRig = 'ovr15'
  else if (vrmCoverage >= 5) speechRig = 'vrm5'
  else if (ovrCoverage > 0 || vrmCoverage > 0) speechRig = 'limited'

  return {
    rawNames: uniqueNames,
    byShape,
    ovrCoverage,
    vrmCoverage,
    hasEmotionShapes,
    speechRig,
  }
}

function inferCharacterShape(char: string): CanonicalMouthShape {
  for (const [pattern, shape] of CHARACTER_TO_SHAPE) {
    if (pattern.test(char)) return shape
  }
  return 'aa'
}

function cueStrength(shape: CanonicalMouthShape): number {
  switch (shape) {
    case 'sil':
      return 0.35
    case 'pp':
    case 'ff':
    case 'th':
    case 'dd':
    case 'kk':
    case 'ch':
    case 'ss':
    case 'nn':
    case 'rr':
      return 0.82
    default:
      return 0.92
  }
}

export function buildCharacterMouthTimeline(alignment?: ElevenLabsAlignment | null): MouthTimeline {
  if (!alignment) return { cues: [], duration: 0 }
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment
  const cues: MouthCue[] = []
  let duration = 0

  for (let index = 0; index < characters.length; index += 1) {
    const start = starts[index]
    const end = ends[index]
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

    const char = characters[index] || ''
    const shape = inferCharacterShape(char)
    cues.push({
      shape,
      start,
      end,
      strength: cueStrength(shape),
      source: char,
    })
    duration = Math.max(duration, end)
  }

  return { cues, duration }
}

export function buildPhonemeMouthTimeline(phonemes: TimedPhoneme[]): MouthTimeline {
  const cues: MouthCue[] = []
  let duration = 0

  for (const phoneme of phonemes) {
    const shape = mapPhonemeToMouthShape(phoneme.phoneme)
    if (!shape) continue
    if (!Number.isFinite(phoneme.start) || !Number.isFinite(phoneme.end) || phoneme.end <= phoneme.start) continue

    cues.push({
      shape,
      start: phoneme.start,
      end: phoneme.end,
      strength: clamp01(phoneme.confidence ?? cueStrength(shape)),
      source: phoneme.phoneme,
    })
    duration = Math.max(duration, phoneme.end)
  }

  return { cues, duration }
}

export function sampleMouthTimeline(
  timeline: MouthTimeline | null | undefined,
  timeSeconds: number,
  options?: {
    intensity?: number
    crossfadeSeconds?: number
  },
): MouthShapeWeights {
  const weights = emptyMouthShapeWeights()
  if (!timeline || !Number.isFinite(timeSeconds)) return weights

  const crossfade = Math.max(0.012, options?.crossfadeSeconds ?? 0.05)
  const intensity = clamp01(options?.intensity ?? 1)

  for (const cue of timeline.cues) {
    const localStart = cue.start - crossfade
    const localEnd = cue.end + crossfade
    if (timeSeconds < localStart || timeSeconds > localEnd) continue

    let envelope = 1
    if (timeSeconds < cue.start) {
      envelope = 1 - (cue.start - timeSeconds) / crossfade
    } else if (timeSeconds > cue.end) {
      envelope = 1 - (timeSeconds - cue.end) / crossfade
    }

    const value = clamp01(envelope) * cue.strength * intensity
    weights[cue.shape] = Math.max(weights[cue.shape], value)
  }

  return weights
}

export function mapLegacyLipSyncStateToWeights(state: LipSyncState): MouthShapeWeights {
  const weights = emptyMouthShapeWeights()
  weights.aa = clamp01(state.aa)
  weights.ee = clamp01(state.ee)
  weights.ih = clamp01(state.ih)
  weights.oh = clamp01(state.oh)
  weights.ou = clamp01(state.ou)
  weights.sil = clamp01(1 - Math.max(state.aa, state.ee, state.ih, state.oh, state.ou))
  return weights
}

export function mapMouthWeightsToLegacyLipSyncState(weights: MouthShapeWeights): LipSyncState {
  return {
    aa: clamp01(Math.max(weights.aa, weights.dd * 0.24, weights.nn * 0.18, weights.th * 0.14)),
    ih: clamp01(Math.max(weights.ih, weights.ss * 0.82, weights.ch * 0.62, weights.ff * 0.38)),
    ou: clamp01(Math.max(weights.ou, weights.pp * 0.58)),
    ee: clamp01(Math.max(weights.ee, weights.rr * 0.42)),
    oh: clamp01(Math.max(weights.oh, weights.kk * 0.32)),
  }
}
