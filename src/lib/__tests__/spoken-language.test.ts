import { describe, expect, it } from 'vitest'

import { defaultModelSpeaks, detectSpokenLanguage } from '../village/spoken-language'
import { speak, speechClipId, speechModelFor } from '../village/village-speech-server'
import { pickBrowserVoice } from '../village/browser-speech'

describe('detectSpokenLanguage', () => {
  it('finds Hungarian', () => {
    expect(detectSpokenLanguage('Át tudnád váltani a hangodat valami nemzetközire, hogy megértsük?')).toBe('hu')
    expect(detectSpokenLanguage('Szia! Kész vagyok, a gomb már működik.')).toBe('hu')
    expect(detectSpokenLanguage('Igen, rendben.')).toBe('hu')
    expect(detectSpokenLanguage('Köszönöm szépen, most már értem, mit szeretnél.')).toBe('hu')
  })
  it('leaves English alone, accents and all', () => {
    expect(detectSpokenLanguage('The gear is gone. Everything it held is in the Settings tab now.')).toBeNull()
    expect(detectSpokenLanguage('I ordered a café latte at the résumé workshop.')).toBeNull()
    expect(detectSpokenLanguage('Hi')).toBeNull()
    expect(detectSpokenLanguage('')).toBeNull()
  })
  it('leaves the default model\'s own languages alone', () => {
    expect(detectSpokenLanguage('Je suis prêt, le bouton fonctionne déjà.')).toBeNull()
    expect(detectSpokenLanguage('Das ist schön, ich höre dich gut.')).toBeNull()
    expect(detectSpokenLanguage('¿Qué tal? Está listo, ya funciona.')).toBeNull()
    expect(detectSpokenLanguage('Já jsem připraven, tlačítko už funguje.')).toBeNull()
  })
  it('finds Vietnamese', () => {
    expect(detectSpokenLanguage('Xin chào, tôi đã sẵn sàng.')).toBe('vi')
  })
})

describe('defaultModelSpeaks', () => {
  it('says which languages need the other model', () => {
    expect(defaultModelSpeaks(null)).toBe(true)
    expect(defaultModelSpeaks('en')).toBe(true)
    expect(defaultModelSpeaks('de')).toBe(true)
    expect(defaultModelSpeaks('hu')).toBe(false)
    expect(defaultModelSpeaks('vi')).toBe(false)
  })
})

describe('speech: the line goes to a model that speaks its language', () => {
  const env = { ELEVENLABS_API_KEY: 'test-key', OASIS_VILLAGE_SPEECH_DIR: `${process.env.TEMP || '/tmp'}/oasis-speech-lang-${Date.now()}` }
  const fetcher = (bodies: Array<Record<string, any>>) => (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ audio_base64: 'QUJD', alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } }), { status: 200 })
  }) as unknown as typeof fetch

  it('English: the default model, no language code, the same clip name as before', async () => {
    const bodies: Array<Record<string, any>> = []
    const clip = await speak('The gear is gone.', 'brian', { env, fetcher: fetcher(bodies) })
    expect(bodies[0].model_id).toBe('eleven_multilingual_v2')
    expect(bodies[0]).not.toHaveProperty('language_code')
    expect(clip.id).toBe(speechClipId('The gear is gone.', clip.voiceId, 'eleven_multilingual_v2'))
  })

  it('Hungarian: eleven_v4 with language_code hu, and its timings come back', async () => {
    const bodies: Array<Record<string, any>> = []
    const clip = await speak('Szia! Kész vagyok, minden a Beállítások fülön van.', 'brian', { env, fetcher: fetcher(bodies) })
    expect(bodies[0]).toMatchObject({ model_id: 'eleven_v4', language_code: 'hu' })
    expect(clip.alignment?.characters).toEqual(['a'])
  })

  it('the caller can name the language; the other model can be swapped in .env', async () => {
    const bodies: Array<Record<string, any>> = []
    await speak('Okay.', 'brian', { env: { ...env, OASIS_VILLAGE_VOICE_MODEL_OTHER: 'eleven_flash_v2_5' }, fetcher: fetcher(bodies), language: 'hu' })
    expect(bodies[0]).toMatchObject({ model_id: 'eleven_flash_v2_5', language_code: 'hu' })
    expect(speechModelFor('de')).toEqual({ model: 'eleven_multilingual_v2', languageCode: null })
  })
})

describe("the browser's own voices (no key) for a Hungarian line", () => {
  it('a Hungarian system voice where the machine has one, else the voices as before', () => {
    const voices = [{ name: 'Microsoft David', lang: 'en-US' }, { name: 'Microsoft Szabolcs', lang: 'hu-HU' }]
    const lang = detectSpokenLanguage('Szia! Kész vagyok, a gomb már működik.')
    expect(pickBrowserVoice(voices, 'brian', lang ?? 'en')?.name).toBe('Microsoft Szabolcs')
    expect(pickBrowserVoice([voices[0]], 'brian', lang ?? 'en')?.name).toBe('Microsoft David')
  })
})
