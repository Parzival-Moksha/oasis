import { describe, expect, it } from 'vitest'

import {
  extractClaudeTokenUsage,
  extractCodexTokenUsage,
  getDisplayInputTokens,
  inferProviderFromSource,
  readTokenUsagePayload,
} from '@/lib/token-usage'

describe('token-usage helpers', () => {
  it('reads the standardized camelCase payload shape', () => {
    expect(readTokenUsagePayload({
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 450,
      costUsd: 0.031,
      sessionId: 'session-1',
      provider: 'openai',
      model: 'gpt-5-codex',
    })).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 450,
      costUsd: 0.031,
      sessionId: 'session-1',
      provider: 'openai',
      model: 'gpt-5-codex',
    })
  })

  it('reads legacy snake_case payloads with defaults', () => {
    expect(readTokenUsagePayload({
      total_input_tokens: '900',
      cached_input_tokens: '100',
      total_output_tokens: '200',
      cost_usd: '0.02',
      session_id: 'legacy-session',
    }, {
      provider: 'anthropic',
      model: 'opus',
    })).toEqual({
      inputTokens: 900,
      cachedInputTokens: 100,
      outputTokens: 200,
      costUsd: 0.02,
      sessionId: 'legacy-session',
      provider: 'anthropic',
      model: 'opus',
    })
  })

  it('extracts Claude usage from assistant message usage blocks', () => {
    expect(extractClaudeTokenUsage({
      usage: {
        input_tokens: 640,
        output_tokens: 128,
      },
      cost_usd: 0.01,
      session_id: 'claude-session',
    }, {
      sessionId: 'fallback-session',
      provider: 'anthropic',
      model: 'sonnet',
    })).toEqual({
      inputTokens: 640,
      outputTokens: 128,
      costUsd: 0.01,
      sessionId: 'claude-session',
      provider: 'anthropic',
      model: 'sonnet',
    })
  })

  it('extracts Codex cached input tokens exactly', () => {
    expect(extractCodexTokenUsage({
      input_tokens: 1400,
      cached_input_tokens: 900,
      output_tokens: 250,
      cost_usd: 0.02,
    }, {
      sessionId: 'codex-session',
      provider: 'openai',
      model: 'gpt-5-codex',
    })).toEqual({
      inputTokens: 1400,
      cachedInputTokens: 900,
      outputTokens: 250,
      costUsd: 0.02,
      sessionId: 'codex-session',
      provider: 'openai',
      model: 'gpt-5-codex',
    })
  })

  it('computes display input tokens from fresh plus cached tokens', () => {
    expect(getDisplayInputTokens({
      inputTokens: 2000,
      cachedInputTokens: 500,
    })).toBe(2500)
  })

  it('infers provider from source names', () => {
    expect(inferProviderFromSource('codex')).toBe('openai')
    expect(inferProviderFromSource('anorak-pro-chat')).toBe('anthropic')
  })
})
