// ░▒▓ VILLAGE VISEMES — the mouth for a spoken line, from ElevenLabs' character timings ▓▒░
// ElevenLabs returns when each CHARACTER of the text is spoken, not phonemes. The first version mapped
// every letter on its own to a mouth shape ("h" opened the mouth wide, the "e" of "make" flapped, "th"
// was two shapes, b/m/p did not close). This reads the text the way it is said: letters are grouped into
// the sounds they spell (th, sh, ch, oo, ee, ou, a silent final e…), each sound gets the time its letters
// span, and each maps to one of the five mouth shapes every VRM avatar has (aa ih ou ee oh), with the
// lips closed on b, m and p and nearly closed on f and v. No audio analysis, no extra wait.
//
// It is still spelling, not phonemes: "through" and "tough" spell alike and sound different. A phoneme
// aligner run on the audio would be exact (see the mission log of 2026-11-16 for what that would take).

import type { LipSyncController, LipSyncState } from '@/lib/lip-sync'
import type { ElevenLabsAlignment } from '@/lib/lip-sync-lab'

export interface VisemeCue {
  start: number
  end: number
  /** The letters this cue was read from. */
  source: string
  aa: number
  ih: number
  ou: number
  ee: number
  oh: number
}

export interface VisemeTimeline {
  cues: VisemeCue[]
  duration: number
}

type Shape = Pick<VisemeCue, 'aa' | 'ih' | 'ou' | 'ee' | 'oh'>
const shape = (aa: number, ih: number, ou: number, ee: number, oh: number): Shape => ({ aa, ih, ou, ee, oh })

const CLOSED = shape(0, 0, 0, 0, 0)
// Vowels: the five VRM mouths (A I U E O).
const A = shape(0.85, 0, 0, 0, 0)
const I = shape(0, 0.7, 0, 0, 0)
const U = shape(0, 0, 0.8, 0, 0)
const E = shape(0, 0, 0, 0.7, 0)
const O = shape(0, 0, 0, 0, 0.8)
const SCHWA = shape(0.35, 0, 0, 0.2, 0)
// Consonants: how open the mouth stays while the tongue or teeth do the work.
const TEETH = shape(0, 0.28, 0, 0.1, 0) // s z sh ch j th x
const TONGUE = shape(0.18, 0.1, 0, 0, 0) // t d n l
const BACK = shape(0.22, 0, 0, 0, 0.08) // k g h ng
const LIP_TEETH = shape(0, 0.12, 0, 0, 0) // f v
const ROUND = shape(0, 0, 0.6, 0, 0) // w
const R = shape(0, 0, 0.3, 0, 0.2)

/** Letter groups, longest first within a first letter. `silent`: takes its time from the sound before it. */
const GRAPHEMES: Array<[string, Shape | 'silent']> = [
  // three letters
  ['sch', TEETH], ['tch', TEETH], ['igh', I], ['eau', O], ['ough', O], ['augh', O],
  // consonant pairs
  ['th', TEETH], ['sh', TEETH], ['ch', TEETH], ['ph', LIP_TEETH], ['wh', ROUND], ['ck', BACK], ['ng', BACK], ['qu', ROUND],
  ['gh', 'silent'], ['kn', TONGUE], ['wr', R], ['mb', CLOSED], ['ll', TONGUE], ['ss', TEETH], ['tt', TONGUE], ['pp', CLOSED],
  ['mm', CLOSED], ['bb', CLOSED], ['nn', TONGUE], ['rr', R], ['ff', LIP_TEETH], ['dd', TONGUE], ['zz', TEETH], ['gg', BACK],
  // vowel pairs
  ['oo', U], ['ou', U], ['ow', O], ['oa', O], ['oi', O], ['oy', O], ['au', O], ['aw', O],
  ['ee', I], ['ea', I], ['ie', I], ['ei', E], ['ey', E], ['ai', E], ['ay', E], ['eu', O], ['ue', U], ['ui', U], ['ew', U],
  ['aa', A], ['ah', A], ['oh', O], ['uh', U], ['er', SCHWA], ['ar', A], ['or', O], ['ur', SCHWA], ['ir', SCHWA],
  // single letters
  ['a', A], ['e', E], ['i', I], ['o', O], ['u', U], ['y', I],
  ['ä', E], ['ö', O], ['ü', U], ['é', E], ['è', E], ['á', A], ['à', A], ['í', I], ['ó', O], ['ú', U], ['ß', TEETH],
  ['b', CLOSED], ['m', CLOSED], ['p', CLOSED],
  ['f', LIP_TEETH], ['v', LIP_TEETH], ['w', ROUND], ['r', R],
  ['s', TEETH], ['z', TEETH], ['x', TEETH], ['j', TEETH], ['c', BACK],
  ['t', TONGUE], ['d', TONGUE], ['n', TONGUE], ['l', TONGUE],
  ['k', BACK], ['g', BACK], ['h', BACK], ['q', BACK],
]
const MAX_GRAPHEME = 4
const LETTER = /[\p{L}]/u
const VOWEL = /[aeiouyäöüéèáàíóú]/

interface Sound {
  /** Index of its first and last letter in the word. */
  from: number
  to: number
  source: string
  shape: Shape | 'silent'
}

/** The sounds a word spells, in order. */
export function wordSounds(word: string): Sound[] {
  const lower = word.toLowerCase()
  const sounds: Sound[] = []
  let i = 0
  while (i < lower.length) {
    let match: [string, Shape | 'silent'] | null = null
    for (let length = Math.min(MAX_GRAPHEME, lower.length - i); length > 0 && !match; length -= 1) {
      const piece = lower.slice(i, i + length)
      match = GRAPHEMES.find(([letters]) => letters === piece) || null
    }
    const letters = match ? match[0] : lower[i]
    let mouth: Shape | 'silent' = match ? match[1] : TONGUE
    // "c" before e, i, y is an s (cent, city); "y" at the start of a word is a consonant (yes).
    if (letters === 'c' && /[eiy]/.test(lower[i + 1] || '')) mouth = TEETH
    if (letters === 'y' && i === 0 && VOWEL.test(lower[i + 1] || '')) mouth = shape(0, 0.4, 0, 0, 0)
    sounds.push({ from: i, to: i + letters.length - 1, source: word.slice(i, i + letters.length), shape: mouth })
    i += letters.length
  }
  // A final "e" after a consonant is silent when the word has another vowel (make, time, are; not "the", "be").
  const last = sounds[sounds.length - 1]
  if (last && last.source.toLowerCase() === 'e' && sounds.length > 2) {
    const before = sounds[sounds.length - 2]
    const otherVowel = sounds.slice(0, -1).some(sound => sound.shape !== 'silent' && VOWEL.test(sound.source[0].toLowerCase()))
    if (otherVowel && !VOWEL.test(before.source[before.source.length - 1].toLowerCase())) last.shape = 'silent'
  }
  return sounds
}

/** The mouth over time for a clip, from its character timings. */
export function buildVisemeTimeline(alignment?: ElevenLabsAlignment | null): VisemeTimeline {
  if (!alignment) return { cues: [], duration: 0 }
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment
  const cues: VisemeCue[] = []
  let duration = 0
  let i = 0
  const count = Math.min(characters.length, starts.length, ends.length)
  while (i < count) {
    if (!LETTER.test(characters[i] || '')) {
      i += 1
      continue
    }
    let j = i
    while (j < count && LETTER.test(characters[j] || '')) j += 1
    const word = characters.slice(i, j).join('')
    // One entry per character is assumed; a multi-letter "character" would shift the indexes, so fall back to it whole.
    const sounds = word.length === j - i ? wordSounds(word) : [{ from: 0, to: j - i - 1, source: word, shape: A as Shape | 'silent' }]
    for (const sound of sounds) {
      const start = starts[i + sound.from]
      const end = ends[i + sound.to]
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      duration = Math.max(duration, end)
      if (sound.shape === 'silent') {
        // Its time belongs to the sound before it (the "a" of "make" lasts through the "ke").
        const previous = cues[cues.length - 1]
        if (previous && start - previous.end < 0.05) previous.end = end
        continue
      }
      cues.push({ start, end, source: sound.source, ...sound.shape })
    }
    i = j
  }
  return { cues, duration }
}

const ZERO: LipSyncState = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

/** How long a mouth shape takes to form and to let go (seconds): shapes blend into their neighbours. */
const BLEND = 0.045

/**
 * The mouth at `time`. Cues are sorted; `hint` is where the last call ended up, so a clip playing
 * forward costs a handful of comparisons per frame however long it is.
 */
export function sampleVisemes(timeline: VisemeTimeline, time: number, hint: { index: number } = { index: 0 }, out: LipSyncState = { ...ZERO }): LipSyncState {
  out.aa = 0
  out.ih = 0
  out.ou = 0
  out.ee = 0
  out.oh = 0
  const cues = timeline.cues
  if (!cues.length || !Number.isFinite(time)) return out
  let index = Math.min(Math.max(0, hint.index), cues.length - 1)
  // Back up after a seek, then skip what is over.
  while (index > 0 && cues[index].start - BLEND > time) index -= 1
  while (index < cues.length - 1 && cues[index].end + BLEND < time) index += 1
  hint.index = index
  for (let k = index; k < cues.length; k += 1) {
    const cue = cues[k]
    if (cue.start - BLEND > time) break
    if (cue.end + BLEND < time) continue
    let weight = 1
    if (time < cue.start) weight = 1 - (cue.start - time) / BLEND
    else if (time > cue.end) weight = 1 - (time - cue.end) / BLEND
    if (weight <= 0) continue
    // Smooth the ramp (ease in and out).
    weight = weight * weight * (3 - 2 * weight)
    if (cue.aa * weight > out.aa) out.aa = cue.aa * weight
    if (cue.ih * weight > out.ih) out.ih = cue.ih * weight
    if (cue.ou * weight > out.ou) out.ou = cue.ou * weight
    if (cue.ee * weight > out.ee) out.ee = cue.ee * weight
    if (cue.oh * weight > out.oh) out.oh = cue.oh * weight
  }
  return out
}

/** A lip-sync controller (the registry the VRM renderer reads) that follows a media element's clock. */
export function createVisemeLipSync(timeline: VisemeTimeline): LipSyncController {
  let element: HTMLMediaElement | null = null
  const hint = { index: 0 }
  const state: LipSyncState = { ...ZERO }
  return {
    get isActive() {
      return element !== null
    },
    attachAudio(el: HTMLMediaElement) {
      element = el
      hint.index = 0
    },
    attachStream() {
      element = null
    },
    configure() {
      // Timing-driven: nothing to tune.
    },
    getTuning() {
      return { fftSize: 256, analyserSmoothing: 0, silenceGate: 0, smoothFactor: 0, mouthOpenCap: 1, aaGain: 1, ohGain: 1, eeGain: 1, ouGain: 1, ihGain: 1, eeOuSplit: 0.5, eeLowBias: 0, ouHighBias: 0 }
    },
    update(): LipSyncState {
      if (!element || element.paused || element.ended) return { ...ZERO }
      return { ...sampleVisemes(timeline, element.currentTime, hint, state) }
    },
    detach() {
      element = null
    },
  }
}
