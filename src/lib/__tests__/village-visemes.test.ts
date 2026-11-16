import { describe, expect, it } from 'vitest'
import { buildVisemeTimeline, createVisemeLipSync, sampleVisemes, wordSounds } from '../village/village-visemes'

/** Character timings the way ElevenLabs returns them: every character `per` seconds long, one after the other. */
function alignment(text: string, per = 0.08) {
  const characters = [...text]
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => +(i * per).toFixed(3)),
    character_end_times_seconds: characters.map((_, i) => +((i + 1) * per).toFixed(3)),
  }
}

const sources = (word: string) => wordSounds(word).map(sound => sound.source.toLowerCase())
const open = (state: { aa: number; ih: number; ou: number; ee: number; oh: number }) => Math.max(state.aa, state.ih, state.ou, state.ee, state.oh)
/** The mouth in the middle of the cue read from `letters`. */
function mouthAt(text: string, letters: string) {
  const timeline = buildVisemeTimeline(alignment(text))
  const cue = timeline.cues.find(c => c.source.toLowerCase() === letters)
  if (!cue) throw new Error(`no cue for "${letters}" in "${text}": ${timeline.cues.map(c => c.source).join(' ')}`)
  return sampleVisemes(timeline, (cue.start + cue.end) / 2)
}

describe('letters read as the sounds they spell', () => {
  it('groups letters that make one sound', () => {
    expect(sources('the')).toEqual(['th', 'e'])
    expect(sources('should')).toEqual(['sh', 'ou', 'l', 'd'])
    expect(sources('moon')).toEqual(['m', 'oo', 'n'])
    expect(sources('night')).toEqual(['n', 'igh', 't'])
    expect(sources('phone')).toEqual(['ph', 'o', 'n', 'e'])
    expect(sources('Schule')).toEqual(['sch', 'u', 'l', 'e'])
  })

  it('keeps a final e silent after a consonant, and spoken in short words', () => {
    const silent = (word: string) => wordSounds(word).slice(-1)[0].shape === 'silent'
    expect(silent('make')).toBe(true)
    expect(silent('time')).toBe(true)
    expect(silent('the')).toBe(false)
    expect(silent('be')).toBe(false)
    expect(silent('tree')).toBe(false)
  })
})

describe('the mouth over a clip', () => {
  it('closes the lips on b, m and p', () => {
    expect(open(mouthAt('a map', 'm'))).toBeLessThan(0.05)
    expect(open(mouthAt('a map', 'p'))).toBeLessThan(0.05)
    expect(open(mouthAt('robot', 'b'))).toBeLessThan(0.05)
  })

  it('opens on vowels, each with its own shape', () => {
    expect(mouthAt('map', 'a').aa).toBeGreaterThan(0.7)
    expect(mouthAt('moon', 'oo').ou).toBeGreaterThan(0.7)
    expect(mouthAt('see', 'ee').ih).toBeGreaterThan(0.6)
    expect(mouthAt('go', 'o').oh).toBeGreaterThan(0.7)
    expect(mouthAt('bed', 'e').ee).toBeGreaterThan(0.6)
  })

  it('does not throw the mouth wide open on an h or flap on a silent e (the old letter-by-letter mapping did)', () => {
    expect(open(mouthAt('the hat', 'th'))).toBeLessThan(0.35)
    expect(open(mouthAt('the hat', 'h'))).toBeLessThan(0.35)
    const timeline = buildVisemeTimeline(alignment('make'))
    expect(timeline.cues.map(cue => cue.source)).toEqual(['m', 'a', 'k'])
    // The silent e's time goes to the k before it.
    expect(timeline.cues[2].end).toBeCloseTo(0.32, 3)
  })

  it('is closed between words and after the clip', () => {
    const timeline = buildVisemeTimeline(alignment('go.   go', 0.1))
    expect(open(sampleVisemes(timeline, 0.5))).toBe(0)
    expect(open(sampleVisemes(timeline, 5))).toBe(0)
    expect(timeline.duration).toBeCloseTo(0.8, 3)
  })

  it('reads German umlauts and numbers without breaking', () => {
    const timeline = buildVisemeTimeline(alignment('Grüße 42 mal'))
    expect(timeline.cues.map(cue => cue.source.toLowerCase())).toEqual(['g', 'r', 'ü', 'ß', 'm', 'a', 'l'])
    expect(buildVisemeTimeline(null)).toEqual({ cues: [], duration: 0 })
  })

  it('samples the same whether the clip plays forward or the clock jumps back', () => {
    const timeline = buildVisemeTimeline(alignment('the quick brown fox jumps over the lazy dog'))
    const hint = { index: 0 }
    const forward = [0.3, 1.1, 2.2, 3.0].map(t => ({ ...sampleVisemes(timeline, t, hint) }))
    const back = { ...sampleVisemes(timeline, 0.3, hint) }
    expect(back).toEqual(forward[0])
    expect(forward.map(t => ({ ...sampleVisemes(timeline, [0.3, 1.1, 2.2, 3.0][forward.indexOf(t)]) }))).toEqual(forward)
  })

  it('drives the mouth from a media element’s clock, at any playback rate', () => {
    const timeline = buildVisemeTimeline(alignment('map'))
    const lip = createVisemeLipSync(timeline)
    const clock = { paused: false, ended: false, currentTime: 0.12, playbackRate: 3 }
    expect(lip.isActive).toBe(false)
    lip.attachAudio(clock as unknown as HTMLMediaElement)
    expect(lip.isActive).toBe(true)
    expect(lip.update().aa).toBeGreaterThan(0.7)
    clock.paused = true
    expect(open(lip.update())).toBe(0)
    lip.detach()
    expect(lip.isActive).toBe(false)
  })
})
