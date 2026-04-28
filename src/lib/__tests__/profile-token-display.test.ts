import { describe, expect, it } from 'vitest'

import {
  estimateProfileTokenCostUsd,
  formatProfileTokenCost,
  getProfileDisplayInputTokens,
  hasProfileTokenUsage,
  normalizeProfileTokenBurnSummary,
} from '@/lib/profile-token-display'

describe('profile token display helpers', () => {
  it('normalizes grand totals and provider rows from token-burn responses', () => {
    const summary = normalizeProfileTokenBurnSummary({
      grand: {
        inputTokens: 1000,
        cachedInputTokens: 600,
        outputTokens: 300,
      },
      providers: [
        {
          provider: 'openai',
          inputTokens: 1000,
          cachedInputTokens: 600,
          outputTokens: 300,
        },
      ],
    })

    expect(summary.grand).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 600,
      outputTokens: 300,
      displayInputTokens: 1600,
    })
    expect(summary.providers[0]).toMatchObject({
      provider: 'openai',
      displayInputTokens: 1600,
    })
  })

  it('prefers explicit displayInputTokens when provided', () => {
    expect(getProfileDisplayInputTokens({
      inputTokens: 200,
      cachedInputTokens: 50,
      outputTokens: 25,
      displayInputTokens: 999,
    })).toBe(999)
  })

  it('detects usage when only cached input tokens are present', () => {
    expect(hasProfileTokenUsage({
      inputTokens: 0,
      cachedInputTokens: 500,
      outputTokens: 0,
    })).toBe(true)
  })

  it('uses exact provider costs and provider-aware fallbacks together', () => {
    const summary = normalizeProfileTokenBurnSummary({
      grand: {
        inputTokens: 3000,
        cachedInputTokens: 1000,
        outputTokens: 1500,
      },
      providers: [
        {
          provider: 'anthropic',
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0.25,
        },
        {
          provider: 'openai',
          inputTokens: 2000,
          cachedInputTokens: 1000,
          outputTokens: 1000,
        },
      ],
    })

    expect(estimateProfileTokenCostUsd(summary)).toBeCloseTo(
      0.25 + ((2000 * 2.5 + 1000 * 0.25 + 1000 * 10) / 1_000_000),
      8,
    )
  })

  it('formats small costs without breaking the UI', () => {
    const summary = normalizeProfileTokenBurnSummary({
      grand: {
        inputTokens: 100,
        outputTokens: 50,
      },
    })

    expect(formatProfileTokenCost(summary)).toBe('<$0.01')
  })
})
