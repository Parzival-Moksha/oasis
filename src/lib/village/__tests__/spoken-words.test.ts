import { describe, expect, it } from 'vitest'
import { PLAYER_SPEEDS, formatSpokenClock, nextPlayerSpeed, spokenTokens, spokenWordAt } from '../spoken-words'

function alignmentFor(text: string, perChar = 0.1) {
  const characters = text.split('')
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * perChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * perChar),
  }
}

describe('spokenTokens', () => {
  it('times each word from its own characters', () => {
    const tokens = spokenTokens('Hi there', alignmentFor('Hi there'))
    expect(tokens.map(t => t.text)).toEqual(['Hi', ' ', 'there'])
    expect(tokens[0]).toMatchObject({ word: true, start: 0, end: 0.2 })
    expect(tokens[1].word).toBe(false)
    expect(tokens[2].start).toBeCloseTo(0.3)
    expect(tokens[2].end).toBeCloseTo(0.8)
  })
  it('shares the length out by position when the alignment does not match the text', () => {
    const tokens = spokenTokens('one two', alignmentFor('one, two!'), null)
    expect(tokens[0].start).toBe(0)
    expect(tokens[2].end).toBeCloseTo(0.9)
    const none = spokenTokens('one two', null, 7)
    expect(none[2].end).toBeCloseTo(7)
    expect(none[2].start).toBeCloseTo(4)
  })
  it('handles an empty line', () => {
    expect(spokenTokens('', null)).toEqual([])
  })
})

describe('spokenWordAt', () => {
  const tokens = spokenTokens('a bb ccc', alignmentFor('a bb ccc'))
  it('is the last word that has started', () => {
    expect(spokenWordAt(tokens, -1)).toBe(-1)
    expect(spokenWordAt(tokens, 0)).toBe(0)
    expect(spokenWordAt(tokens, 0.25)).toBe(2)
    expect(spokenWordAt(tokens, 99)).toBe(4)
  })
})

describe('clock and speeds', () => {
  it('formats seconds', () => {
    expect(formatSpokenClock(7.9)).toBe('0:07')
    expect(formatSpokenClock(72)).toBe('1:12')
    expect(formatSpokenClock(null)).toBe('-:--')
    expect(formatSpokenClock(Number.NaN)).toBe('-:--')
  })
  it('steps through the speeds and wraps', () => {
    expect(nextPlayerSpeed(1.3)).toBe(1.5)
    expect(nextPlayerSpeed(1.2)).toBe(1.3)
    expect(nextPlayerSpeed(PLAYER_SPEEDS[PLAYER_SPEEDS.length - 1])).toBe(PLAYER_SPEEDS[0])
    expect(nextPlayerSpeed(3)).toBe(PLAYER_SPEEDS[0])
  })
})
