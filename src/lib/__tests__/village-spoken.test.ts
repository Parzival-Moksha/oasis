import { describe, expect, it } from 'vitest'
import {
  SPOKEN_MAX_CHARS,
  cleanSpoken,
  hasSpoken,
  hideSpokenLive,
  splitSpoken,
  spokenForLastTurn,
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
