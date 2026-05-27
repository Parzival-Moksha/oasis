import { describe, expect, it } from 'vitest'

import {
  ALLOWED_CRAFT_MODELS,
  DEFAULT_CRAFT_MODEL,
  normalizeCraftModelId,
} from '../craft-models'

describe('craft model normalization', () => {
  it('keeps allowed OpenRouter craft models', () => {
    expect(normalizeCraftModelId('google/gemini-3.5-flash')).toBe('google/gemini-3.5-flash')
    expect(normalizeCraftModelId('openai/gpt-5.4-mini')).toBe('openai/gpt-5.4-mini')
  })

  it('collapses removed and unknown models to the default', () => {
    expect(normalizeCraftModelId('cc-sonnet')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('sonnet')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('google/gemini-3.1-pro-preview')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('anthropic/claude-haiku-4-5')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('z-ai/glm-5')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('nvidia/nemotron-3-super-120b-a12b:free')).toBe(DEFAULT_CRAFT_MODEL)
    expect(normalizeCraftModelId('not-a-real-model')).toBe(DEFAULT_CRAFT_MODEL)
  })

  it('only exposes normalized models in the shared allowlist', () => {
    expect(ALLOWED_CRAFT_MODELS).not.toContain('cc-sonnet')
    expect(ALLOWED_CRAFT_MODELS).not.toContain('anthropic/claude-sonnet-4-6')
    expect(ALLOWED_CRAFT_MODELS).not.toContain('z-ai/glm-5')
    expect(ALLOWED_CRAFT_MODELS).not.toContain('nvidia/nemotron-3-super-120b-a12b:free')
    expect(ALLOWED_CRAFT_MODELS).toContain(DEFAULT_CRAFT_MODEL)
  })
})
