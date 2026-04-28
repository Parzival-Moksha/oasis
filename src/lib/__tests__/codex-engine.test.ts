import { describe, expect, it } from 'vitest'

import { getFreshInputTokens, parseCodexSSE } from '@/lib/codex-engine'

async function collectCodexEvents(response: Response) {
  const events = []
  for await (const event of parseCodexSSE(response)) {
    events.push(event)
  }
  return events
}

describe('codex-engine', () => {
  it('parses result events with exact cached input tokens', async () => {
    const payload = {
      type: 'result',
      inputTokens: 1800,
      cachedInputTokens: 1200,
      outputTokens: 320,
      sessionId: 'codex-session',
      provider: 'openai',
      model: 'gpt-5-codex',
    }

    await expect(
      collectCodexEvents(new Response(`data: ${JSON.stringify(payload)}\n\n`))
    ).resolves.toEqual([payload])
  })

  it('parses done events with standardized usage fields', async () => {
    const payload = {
      type: 'done',
      success: true,
      inputTokens: 1800,
      cachedInputTokens: 1200,
      outputTokens: 320,
      sessionId: 'codex-session',
      provider: 'openai',
      model: 'gpt-5-codex',
    }

    await expect(
      collectCodexEvents(new Response(`data: ${JSON.stringify(payload)}\n\n`))
    ).resolves.toEqual([payload])
  })

  it('derives fresh input tokens by subtracting cached input tokens', () => {
    expect(getFreshInputTokens({
      inputTokens: 1800,
      cachedInputTokens: 1200,
    })).toBe(600)
  })
})
