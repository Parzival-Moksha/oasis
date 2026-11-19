import { describe, expect, it } from 'vitest'

import { FEATURE_KEY_RULES, featureKeyStates } from '../feature-keys'

describe('generation features and the keys they need', () => {
  it('a machine without keys: every generation spell is not ready, with one plain line naming the key', () => {
    const states = featureKeyStates({})
    expect(Object.keys(states).sort()).toEqual(Object.keys(FEATURE_KEY_RULES).sort())
    for (const state of Object.values(states)) expect(state.ready).toBe(false)
    expect(states['text-to-music'].line).toBe('Text to Music needs your own ElevenLabs key. Add ELEVENLABS_API_KEY to the .env file in the Oasis folder, then start the Oasis again.')
    expect(states['text-to-3d'].line).toContain('MESHY_API_KEY or TRIPO_API_KEY')
  })

  it('a key that is set makes its features ready; an empty one does not', () => {
    const states = featureKeyStates({ ELEVENLABS_API_KEY: 'x', TRIPO_API_KEY: 'y', FAL_KEY: '   ' })
    expect(states['text-to-music']).toEqual({ ready: true, line: '' })
    expect(states['text-to-3d'].ready).toBe(true)
    expect(states['text-to-video'].ready).toBe(false)
    expect(states['text-to-pic'].ready).toBe(false)
  })

  it('never carries a key value', () => {
    expect(JSON.stringify(featureKeyStates({ ELEVENLABS_API_KEY: 'secret-value' }))).not.toContain('secret-value')
  })
})
