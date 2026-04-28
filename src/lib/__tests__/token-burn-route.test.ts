import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  recordTokenBurn,
  readTokenBurnSummary,
  readTokenUsagePayload,
  inferProviderFromSource,
} = vi.hoisted(() => ({
  recordTokenBurn: vi.fn(),
  readTokenBurnSummary: vi.fn(),
  readTokenUsagePayload: vi.fn(),
  inferProviderFromSource: vi.fn((source: string) => source.startsWith('codex') ? 'openai' : 'anthropic'),
}))

vi.mock('@/lib/token-burn', () => ({
  recordTokenBurn,
  readTokenBurnSummary,
}))

vi.mock('@/lib/token-usage', () => ({
  readTokenUsagePayload,
  inferProviderFromSource,
}))

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      _body: body,
      json: async () => body,
    }),
  },
}))

import { GET, POST } from '../../app/api/token-burn/route'

describe('/api/token-burn route', () => {
  beforeEach(() => {
    recordTokenBurn.mockReset()
    readTokenBurnSummary.mockReset()
    readTokenUsagePayload.mockReset()
    inferProviderFromSource.mockClear()
  })

  it('rejects POST requests without a source', async () => {
    const response = await POST(new Request('http://localhost/api/token-burn', {
      method: 'POST',
      body: JSON.stringify({ inputTokens: 10, outputTokens: 2 }),
    }) as never) as any

    expect(response.status).toBe(400)
    expect(response._body).toEqual({ error: 'source required' })
    expect(recordTokenBurn).not.toHaveBeenCalled()
  })

  it('persists normalized token usage payloads', async () => {
    readTokenUsagePayload.mockReturnValue({
      inputTokens: 120,
      cachedInputTokens: 30,
      outputTokens: 45,
      costUsd: 0.02,
      sessionId: 'session-1',
      provider: 'anthropic',
      model: 'opus',
    })

    const response = await POST(new Request('http://localhost/api/token-burn', {
      method: 'POST',
      body: JSON.stringify({
        source: 'merlin',
        inputTokens: 120,
        cachedInputTokens: 30,
        outputTokens: 45,
      }),
    }) as never) as any

    expect(inferProviderFromSource).toHaveBeenCalledWith('merlin')
    expect(readTokenUsagePayload).toHaveBeenCalled()
    expect(recordTokenBurn).toHaveBeenCalledWith({
      source: 'merlin',
      inputTokens: 120,
      cachedInputTokens: 30,
      outputTokens: 45,
      costUsd: 0.02,
      sessionId: 'session-1',
      provider: 'anthropic',
      model: 'opus',
    })
    expect(response.status).toBe(200)
    expect(response._body).toEqual({ ok: true })
  })

  it('rejects POST requests without token usage', async () => {
    readTokenUsagePayload.mockReturnValue(null)

    const response = await POST(new Request('http://localhost/api/token-burn', {
      method: 'POST',
      body: JSON.stringify({ source: 'anorak' }),
    }) as never) as any

    expect(response.status).toBe(400)
    expect(response._body).toEqual({ error: 'token usage required' })
    expect(recordTokenBurn).not.toHaveBeenCalled()
  })

  it('returns provider-aware token summaries from GET', async () => {
    readTokenBurnSummary.mockResolvedValue({
      range: 'daily',
      totals: [],
      providers: [{ provider: 'openai', inputTokens: 50, cachedInputTokens: 20, outputTokens: 10, displayInputTokens: 70, costUsd: 0.01 }],
      grand: { inputTokens: 50, cachedInputTokens: 20, outputTokens: 10, displayInputTokens: 70, costUsd: 0.01 },
    })

    const response = await GET(new Request('http://localhost/api/token-burn?range=daily&source=codex') as never) as any

    expect(readTokenBurnSummary).toHaveBeenCalledWith({ source: 'codex', range: 'daily' })
    expect(response.status).toBe(200)
    expect(response._body).toMatchObject({
      range: 'daily',
      grand: { displayInputTokens: 70 },
      providers: [{ provider: 'openai' }],
    })
  })
})
