import { describe, expect, it } from 'vitest'

import { FEATURE_KEY_RULES, OASIS_FEATURE_KEYS, featureKeyStates, featuresForKey } from '../feature-keys'
import { isKeyEnvName } from '../village/keychain'

describe('generation features and the keys they need', () => {
  it('a machine without keys: every generation spell is not ready, with one plain line naming the key', () => {
    const states = featureKeyStates({})
    expect(Object.keys(states).sort()).toEqual(Object.keys(FEATURE_KEY_RULES).sort())
    for (const state of Object.values(states)) expect(state.ready).toBe(false)
    expect(states['text-to-music'].line).toBe('Text to Music needs your own ElevenLabs key. Click to add it in the keychain.')
    expect(states['text-to-3d']).toMatchObject({ keychainKey: 'meshy' })
  })

  it('a key that is set makes its features ready; an empty one does not', () => {
    const states = featureKeyStates({ ELEVENLABS_API_KEY: 'x', TRIPO_API_KEY: 'y', FAL_KEY: '   ' })
    expect(states['text-to-music']).toEqual({ ready: true, line: '', keychainKey: 'elevenlabs' })
    expect(states['text-to-3d'].ready).toBe(true)
    expect(states['text-to-video'].ready).toBe(false)
    expect(states['text-to-pic'].ready).toBe(false)
  })

  it('never carries a key value', () => {
    expect(JSON.stringify(featureKeyStates({ ELEVENLABS_API_KEY: 'secret-value' }))).not.toContain('secret-value')
  })

  it('every keyed spell names a keychain key the keychain knows, stored under the names the spell reads', () => {
    for (const rule of Object.values(FEATURE_KEY_RULES)) {
      const key = OASIS_FEATURE_KEYS.find(item => item.id === rule.keychainKey)
      expect(key, rule.name).toBeDefined()
      expect(rule.anyOf.some(name => key!.env.includes(name)), rule.name).toBe(true)
      for (const name of key!.env) expect(isKeyEnvName(name), name).toBe(true)
    }
    expect(featuresForKey('openrouter')).toEqual(['Text to Pic', 'Text to Pic Building'])
    expect(featuresForKey('tripo')).toEqual(['Text to 3D'])
    expect(featuresForKey('nothing')).toEqual([])
  })
})
