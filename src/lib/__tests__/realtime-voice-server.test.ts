import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/world-runtime-context', () => ({
  readWorldPlayerContext: vi.fn(),
}))

const originalEnv = { ...process.env }
const realtimeEnvKeys = ['OPENAI_REALTIME_MODEL', 'OPENAI_REALTIME_API_KEY', 'OPENAI_API_KEY'] as const

async function loadRealtimeVoiceServer(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const key of realtimeEnvKeys) {
    delete process.env[key]
    if (env[key] !== undefined) {
      process.env[key] = env[key]
    }
  }
  return import('../realtime-voice-server')
}

afterEach(() => {
  for (const key of realtimeEnvKeys) {
    delete process.env[key]
    if (originalEnv[key] !== undefined) {
      process.env[key] = originalEnv[key]
    }
  }
  vi.restoreAllMocks()
})

describe('realtime voice server guardrails', () => {
  it('rejects full text model names for realtime sessions', async () => {
    const { getRealtimeVoiceConfig, sanitizeRealtimeModel } = await loadRealtimeVoiceServer({
      OPENAI_REALTIME_MODEL: 'gpt-5.5',
    })

    expect(getRealtimeVoiceConfig().model).toBe('gpt-realtime')
    expect(getRealtimeVoiceConfig().models).not.toContain('gpt-5.5')
    expect(sanitizeRealtimeModel('gpt-5.4')).toBe('gpt-realtime')
    expect(sanitizeRealtimeModel('gpt-realtime-mini')).toBe('gpt-realtime-mini')
  })

  it('allows a scoped realtime key without a global OpenAI API key', async () => {
    const { getRealtimeApiKey, getRealtimeVoiceConfig } = await loadRealtimeVoiceServer({
      OPENAI_REALTIME_API_KEY: 'test-realtime-key',
      OPENAI_API_KEY: undefined,
    })

    expect(getRealtimeApiKey()).toBe('test-realtime-key')
    expect(getRealtimeVoiceConfig().configured).toBe(true)
  })
})
