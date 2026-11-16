import { describe, expect, it } from 'vitest'
import {
  ANORAK_VOICE,
  SPEECH_SPEED,
  VILLAGE_VOICES,
  clampModelSpeed,
  clampSpeechSpeed,
  dealVoice,
  modelSpeedEffect,
  parseVoicePrefs,
  playbackRateFor,
  speechSpeedPlan,
  speedOf,
  villageVoice,
  voiceChosenBy,
  voiceOf,
  withVoicePrefs,
  type VoicePrefs,
} from '../village/village-voices'
import { resolveSpeechVoice } from '../village/village-speech-server'

describe('the voices', () => {
  it('are twenty different ElevenLabs voices, Anorak’s among them, with characters as well as narrators', () => {
    expect(VILLAGE_VOICES).toHaveLength(20)
    expect(new Set(VILLAGE_VOICES.map(voice => voice.key)).size).toBe(20)
    expect(new Set(VILLAGE_VOICES.map(voice => voice.id)).size).toBe(20)
    for (const key of ['harry', 'austin', 'spuds', 'don', 'lolo', 'bruno']) expect(villageVoice(key)).not.toBeNull()
    for (const voice of VILLAGE_VOICES) expect(voice.id).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(villageVoice(ANORAK_VOICE)?.id).toBe('6sFKzaJr574YWVu4UuJF')
    expect(villageVoice('nobody')).toBeNull()
  })

  it('the server speaks with the id of the voice picked', () => {
    for (const voice of VILLAGE_VOICES) expect(resolveSpeechVoice(voice.key, {})).toBe(voice.id)
    // The Merlin voice can still be swapped in .env; a name it does not know falls back to one of the ten.
    expect(resolveSpeechVoice('merlin', { OASIS_MERLIN_ELEVENLABS_VOICE_ID: 'abcdefghij0123456789' })).toBe('abcdefghij0123456789')
    expect(VILLAGE_VOICES.some(voice => voice.id === resolveSpeechVoice('???', {}))).toBe(true)
    expect(resolveSpeechVoice('adam', {})).toBe('pNInz6obpgDQGcFmaJgB')
  })
})

describe('each agent’s voice', () => {
  it('Anorak keeps his voice unless the owner picks another', () => {
    expect(voiceOf({}, 's-anorak', 'Anorak')).toBe('merlin')
    expect(voiceOf({}, 's-anorak', 'Anorakdev')).toBe('merlin')
    const picked = withVoicePrefs({}, 's-anorak', { voice: 'george', picked: true })
    expect(voiceOf(picked, 's-anorak', 'Anorak')).toBe('george')
  })

  it('the owner’s pick wins over the agent’s own choice, which wins over the dealt one and over Anorak’s default', () => {
    const dealt = withVoicePrefs({}, 's1', { voice: 'lily' })
    expect(voiceOf(dealt, 's1', 'Rick', 'harry')).toBe('harry')
    expect(voiceChosenBy(dealt, 's1', 'harry')).toBe('agent')
    expect(voiceChosenBy(dealt, 's1', null)).toBe('nobody')
    const picked = withVoicePrefs(dealt, 's1', { voice: 'george', picked: true })
    expect(voiceOf(picked, 's1', 'Rick', 'harry')).toBe('george')
    expect(voiceChosenBy(picked, 's1', 'harry')).toBe('owner')
    // The owner takes the pick back: the agent's own choice counts again.
    const back = withVoicePrefs(picked, 's1', { picked: false })
    expect(voiceOf(back, 's1', 'Rick', 'harry')).toBe('harry')
    expect(back.s1.picked).toBeUndefined()
    expect(voiceOf({}, 's-anorak', 'Anorak', 'don')).toBe('don')
    // A choice that is not on the list (an older engine, a typo) is ignored.
    expect(voiceOf(dealt, 's1', 'Rick', 'nobody')).toBe('lily')
  })

  it('a new agent has none until one is dealt, then keeps it', () => {
    expect(voiceOf({}, 's1', 'Rick')).toBeNull()
    const voice = dealVoice({}, () => 0.5)
    const prefs = withVoicePrefs({}, 's1', { voice })
    expect(voiceOf(prefs, 's1', 'Rick')).toBe(voice)
    expect(prefs.s1.picked).toBeUndefined()
  })

  it('deals a random voice nobody has yet, and never Anorak’s while others are free', () => {
    let prefs: VoicePrefs = {}
    const dealt: string[] = []
    for (let i = 0; i < 19; i += 1) {
      const voice = dealVoice(prefs, () => (i * 0.37) % 1)
      dealt.push(voice)
      prefs = withVoicePrefs(prefs, `s${i}`, { voice })
    }
    expect(new Set(dealt).size).toBe(19)
    expect(dealt).not.toContain(ANORAK_VOICE)
    // One more agent shares: every voice is taken once.
    expect(villageVoice(dealVoice(prefs, () => 0.99))).not.toBeNull()
    // Random means random: another roll, another voice.
    expect(dealVoice({}, () => 0)).not.toBe(dealVoice({}, () => 0.99))
  })

  it('stores per session, drops junk, and keeps nothing that equals the default', () => {
    expect(parseVoicePrefs('{"a":{"voice":"lily","picked":true,"speed":2},"b":{"voice":"nobody"},"c":{"speed":"fast"},"d":7}')).toEqual({ a: { voice: 'lily', picked: true, speed: 2 } })
    expect(parseVoicePrefs('not json')).toEqual({})
    expect(parseVoicePrefs(null)).toEqual({})
    let prefs = withVoicePrefs({}, 's1', { speed: 2.4 })
    expect(speedOf(prefs, 's1')).toBe(2.4)
    expect(speedOf(prefs, 's2')).toBe(SPEECH_SPEED.default)
    prefs = withVoicePrefs(prefs, 's1', { speed: SPEECH_SPEED.default })
    expect(prefs).toEqual({})
    // Speed and voice are separate: changing one keeps the other.
    prefs = withVoicePrefs(withVoicePrefs({}, 's1', { voice: 'lily', picked: true }), 's1', { speed: 0.7 })
    expect(prefs).toEqual({ s1: { voice: 'lily', picked: true, speed: 0.7 } })
  })
})

describe('speech speed', () => {
  it('defaults to 1.3x and runs from 0.5x to 3x in steps of 0.1', () => {
    expect(SPEECH_SPEED).toMatchObject({ min: 0.5, max: 3, step: 0.1, default: 1.3 })
    expect(clampSpeechSpeed(undefined)).toBe(1.3)
    expect(clampSpeechSpeed('junk')).toBe(1.3)
    expect(clampSpeechSpeed('2.4')).toBe(2.4)
    expect(clampSpeechSpeed(0.1)).toBe(0.5)
    expect(clampSpeechSpeed(9)).toBe(3)
    expect(clampSpeechSpeed(1.234)).toBe(1.2)
  })

  it('never asks ElevenLabs for a speed outside 0.7 to 1.2', () => {
    for (let speed = 0.5; speed <= 3.01; speed += 0.1) {
      const plan = speechSpeedPlan(speed)
      expect(plan.modelSpeed).toBeGreaterThanOrEqual(0.7)
      expect(plan.modelSpeed).toBeLessThanOrEqual(1.2)
    }
    expect(clampModelSpeed(1.5)).toBe(1.2)
    expect(clampModelSpeed(0.1)).toBe(0.7)
    expect(clampModelSpeed('x')).toBe(1)
  })

  it('lets the voice itself do what it can and the player the rest, adding up to the setting', () => {
    for (let step = 5; step <= 30; step += 1) {
      const speed = step / 10
      const plan = speechSpeedPlan(speed)
      expect(modelSpeedEffect(plan.modelSpeed) * plan.playbackRate).toBeCloseTo(speed, 2)
    }
    expect(speechSpeedPlan(1)).toEqual({ speed: 1, modelSpeed: 1, playbackRate: 1 })
    // 1.3x (the default): the voice at its fastest, the player 15% on top.
    const fast = speechSpeedPlan(1.3)
    expect(fast.modelSpeed).toBe(1.2)
    expect(fast.playbackRate).toBeCloseTo(1.15, 2)
    // Near 1x the player does next to nothing.
    expect(Math.abs(speechSpeedPlan(1.1).playbackRate - 1)).toBeLessThan(0.02)
    expect(Math.abs(speechSpeedPlan(0.8).playbackRate - 1)).toBeLessThan(0.02)
    // The ends of the slider are the player's work.
    expect(speechSpeedPlan(3).playbackRate).toBeCloseTo(3 / 1.13, 2)
    expect(speechSpeedPlan(0.5).playbackRate).toBeCloseTo(0.5 / 0.805, 2)
  })

  it('plays an older clip, made at another voice speed, at the speed now set', () => {
    expect(playbackRateFor(1.2, 1)).toBeCloseTo(1.2, 3)
    expect(playbackRateFor(1, 1.2)).toBeCloseTo(1 / 1.13, 3)
  })
})
