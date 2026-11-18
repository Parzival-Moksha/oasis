import { describe, expect, it } from 'vitest'
import { browserSpeechAvailable, pickBrowserVoice } from '../village/browser-speech'

const voices = [
  { name: 'Zira', lang: 'en-US', localService: true },
  { name: 'David', lang: 'en-US', localService: true },
  { name: 'Online Aria', lang: 'en-US', localService: false },
  { name: 'Hedda', lang: 'de-DE', localService: true },
]

describe("the browser's own voices, for a village without an ElevenLabs key", () => {
  it('gives an agent the same voice every time, among the voices of the page language that run on the machine', () => {
    const first = pickBrowserVoice(voices, 'brian', 'en-GB')
    expect(first).not.toBeNull()
    expect(pickBrowserVoice(voices, 'brian', 'en-GB')).toBe(first)
    expect(['Zira', 'David']).toContain(first?.name)
    expect(pickBrowserVoice(voices, 'brian', 'de')?.name).toBe('Hedda')
  })
  it('falls back to English, then to anything, and to nothing without voices', () => {
    expect(['Zira', 'David']).toContain(pickBrowserVoice(voices, 'x', 'ja')?.name)
    expect(pickBrowserVoice([{ name: 'Kyoko', lang: 'ja-JP' }], 'x', 'fr')?.name).toBe('Kyoko')
    expect(pickBrowserVoice([], 'x')).toBeNull()
  })
  it('different agents can get different voices', () => {
    const names = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(key => pickBrowserVoice(voices, key, 'en')?.name))
    expect(names.size).toBe(2)
  })
  it('is simply off where there is no browser', () => {
    expect(browserSpeechAvailable()).toBe(false)
  })
})
