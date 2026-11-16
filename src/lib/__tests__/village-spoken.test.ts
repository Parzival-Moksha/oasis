import { describe, expect, it } from 'vitest'
import {
  SPOKEN_MAX_CHARS,
  cleanSpoken,
  hasSpoken,
  SPEECH_SPEED,
  clampModelSpeed,
  clampSpeechSpeed,
  hideSpokenLive,
  modelSpeedEffect,
  playbackRateFor,
  speechSpeedPlan,
  splitSpoken,
  spokenForLastTurn,
  spokenInStream,
  villageVoiceFor,
} from '../village/village-spoken'

describe('spoken tag', () => {
  it('takes the tag out of the reply and returns what to say', () => {
    const { text, spoken } = splitSpoken('The build is green.\n\n- 12 tests pass\n\n<spoken>All good, the build is green.</spoken>')
    expect(text).toBe('The build is green.\n\n- 12 tests pass')
    expect(spoken).toBe('All good, the build is green.')
  })

  it('leaves a reply without a tag untouched', () => {
    expect(splitSpoken('Just text.')).toEqual({ text: 'Just text.', spoken: null })
    expect(splitSpoken('')).toEqual({ text: '', spoken: null })
    expect(splitSpoken(null)).toEqual({ text: '', spoken: null })
    expect(hasSpoken('a <SPOKEN>b</SPOKEN>')).toBe(true)
    expect(hasSpoken('nothing')).toBe(false)
  })

  it('says the last tag when there are several, and hides all of them', () => {
    const { text, spoken } = splitSpoken('One <spoken>first</spoken> two <spoken>second</spoken>')
    expect(spoken).toBe('second')
    expect(text).toBe('One  two')
  })

  it('treats a tag that never closes as running to the end', () => {
    expect(splitSpoken('Done.\n<spoken>Clipped words')).toEqual({ text: 'Done.', spoken: 'Clipped words' })
  })

  it('ignores an empty tag', () => {
    expect(splitSpoken('Done. <spoken>  </spoken>')).toEqual({ text: 'Done.', spoken: null })
  })

  it('is case-insensitive and keeps the reply’s language', () => {
    expect(splitSpoken('Fertig.\n<Spoken>Alles läuft, die Tests sind grün.</Spoken>').spoken).toBe('Alles läuft, die Tests sind grün.')
  })

  it('cleans markdown out of what is said', () => {
    expect(cleanSpoken('**Done**: see `file.ts` and [the log](http://x/y).\nNext _line_.')).toBe('Done: see file.ts and the log. Next line.')
  })

  it('caps what is said at 400 characters, at a sentence or word end', () => {
    const long = `${'This is a sentence. '.repeat(40)}`
    const capped = cleanSpoken(long)
    expect(capped.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS)
    expect(capped.endsWith('.')).toBe(true)
    const words = cleanSpoken('word '.repeat(200))
    expect(words.length).toBeLessThanOrEqual(SPOKEN_MAX_CHARS)
    expect(words.endsWith('word')).toBe(true)
    expect(cleanSpoken('x'.repeat(900)).length).toBe(SPOKEN_MAX_CHARS)
  })

  it('hides the tag while the reply streams in, even half a tag', () => {
    expect(hideSpokenLive('Working on it')).toBe('Working on it')
    expect(hideSpokenLive('Done.\n<spo')).toBe('Done.\n')
    expect(hideSpokenLive('Done.\n<')).toBe('Done.\n')
    expect(hideSpokenLive('Done.\n<spoken>All go')).toBe('Done.')
    expect(hideSpokenLive('Done.\n<spoken>All good.</spoken>')).toBe('Done.')
    expect(hideSpokenLive('a < b')).toBe('a < b')
  })
})

describe('what a finished turn says', () => {
  const user = { type: 'user', text: 'hi' }
  const turn = { type: 'turn' }

  it('says the spoken line of the last reply of the turn that just ended', () => {
    const log = [user, { type: 'text', text: 'Looking.' }, { type: 'tool' }, { type: 'text', text: 'Found it.\n<spoken>Found it.</spoken>' }, turn]
    expect(spokenForLastTurn(log)).toBe('Found it.')
  })

  it('says nothing when the last reply has no tag, even if an earlier one had', () => {
    const log = [user, { type: 'text', text: 'a <spoken>early</spoken>' }, { type: 'text', text: 'final, no tag' }, turn]
    expect(spokenForLastTurn(log)).toBeNull()
  })

  it('skips subagent text and never speaks history', () => {
    const log = [user, { type: 'text', text: 'Mine.<spoken>mine</spoken>' }, { type: 'text', text: 'sub <spoken>sub</spoken>', parentToolUseId: 't1' }, turn]
    expect(spokenForLastTurn(log)).toBe('mine')
    expect(spokenForLastTurn([user, { type: 'text', text: 'Old.<spoken>old</spoken>', history: true }, { type: 'turn', history: true }])).toBeNull()
  })

  it('does not reach back past the owner’s message or an earlier turn', () => {
    expect(spokenForLastTurn([{ type: 'text', text: 'x <spoken>old</spoken>' }, turn, user, turn])).toBeNull()
    expect(spokenForLastTurn([{ type: 'text', text: 'x <spoken>old</spoken>' }, turn, turn])).toBeNull()
    expect(spokenForLastTurn([])).toBeNull()
  })
})

describe('voices', () => {
  it('gives Anorak the wizard voice', () => {
    expect(villageVoiceFor('Anorak')).toBe('merlin')
    expect(villageVoiceFor('Debugger')).toBe('adam')
  })
})

describe('the line as it streams in', () => {
  it('is there the moment its closing tag arrives, not before', () => {
    expect(spokenInStream('Done.\n<spoken>All go')).toBeNull()
    expect(spokenInStream('Done.\n<spoken>All good.</spo')).toBeNull()
    expect(spokenInStream('Done.\n<spoken>All good.</spoken>')).toBe('All good.')
    expect(spokenInStream('Done.\n<SPOKEN>All good.</SPOKEN>\n')).toBe('All good.')
    expect(spokenInStream('No tag yet')).toBeNull()
    expect(spokenInStream(null)).toBeNull()
  })
})

describe('speech speed', () => {
  it('defaults to 1.2x and stays between 0.8x and 1.6x', () => {
    expect(SPEECH_SPEED.default).toBe(1.2)
    expect(clampSpeechSpeed(undefined)).toBe(1.2)
    expect(clampSpeechSpeed('junk')).toBe(1.2)
    expect(clampSpeechSpeed('1.4')).toBe(1.4)
    expect(clampSpeechSpeed(0.3)).toBe(0.8)
    expect(clampSpeechSpeed(9)).toBe(1.6)
    expect(clampSpeechSpeed(1.234)).toBe(1.25)
  })

  it('never asks ElevenLabs for a speed outside 0.7 to 1.2', () => {
    for (let speed = 0.8; speed <= 1.61; speed += 0.05) {
      const plan = speechSpeedPlan(speed)
      expect(plan.modelSpeed).toBeGreaterThanOrEqual(0.7)
      expect(plan.modelSpeed).toBeLessThanOrEqual(1.2)
    }
    expect(clampModelSpeed(1.5)).toBe(1.2)
    expect(clampModelSpeed(0.1)).toBe(0.7)
    expect(clampModelSpeed('x')).toBe(1)
  })

  it('lets the voice itself do what it can and the player the rest, adding up to the setting', () => {
    for (const speed of [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]) {
      const plan = speechSpeedPlan(speed)
      expect(modelSpeedEffect(plan.modelSpeed) * plan.playbackRate).toBeCloseTo(speed, 2)
    }
    expect(speechSpeedPlan(1)).toEqual({ speed: 1, modelSpeed: 1, playbackRate: 1 })
    // 1.2x (the default): the voice at its fastest, the player a little on top.
    const fast = speechSpeedPlan(1.2)
    expect(fast.modelSpeed).toBe(1.2)
    expect(fast.playbackRate).toBeGreaterThan(1)
    expect(fast.playbackRate).toBeLessThan(1.1)
    // Up to about 1.1x the player does next to nothing.
    expect(Math.abs(speechSpeedPlan(1.1).playbackRate - 1)).toBeLessThan(0.02)
    expect(Math.abs(speechSpeedPlan(0.8).playbackRate - 1)).toBeLessThan(0.02)
    // 1.6x: the player's share stays moderate, where keeping the pitch still sounds right.
    expect(speechSpeedPlan(1.6).playbackRate).toBeLessThan(1.45)
  })

  it('plays an older clip, made at another voice speed, at the speed now set', () => {
    expect(playbackRateFor(1.2, 1)).toBeCloseTo(1.2, 3)
    expect(playbackRateFor(1, 1.2)).toBeCloseTo(1 / 1.13, 3)
  })
})
