import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const originalEnv = { ...process.env }
const geminiEnvKeys = ['GEMINI_LIVE_MODEL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const

async function loadGeminiLiveServer(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const key of geminiEnvKeys) {
    delete process.env[key]
    if (env[key] !== undefined) {
      process.env[key] = env[key]
    }
  }
  return import('../gemini-live-server')
}

afterEach(() => {
  for (const key of geminiEnvKeys) {
    delete process.env[key]
    if (originalEnv[key] !== undefined) {
      process.env[key] = originalEnv[key]
    }
  }
  vi.restoreAllMocks()
})

describe('gemini live server guardrails', () => {
  it('keeps Gemini Live model selection scoped to known Live models', async () => {
    const { getGeminiLiveConfig, sanitizeGeminiLiveModel } = await loadGeminiLiveServer({
      GEMINI_LIVE_MODEL: 'gemini-2.5-pro',
    })

    expect(getGeminiLiveConfig().model).toBe('gemini-3.1-flash-live-preview')
    expect(getGeminiLiveConfig().models).not.toContain('gemini-2.5-pro')
    expect(sanitizeGeminiLiveModel('gemini-2.5-pro')).toBe('gemini-3.1-flash-live-preview')
    expect(sanitizeGeminiLiveModel('gemini-2.5-flash-native-audio-preview-12-2025')).toBe('gemini-2.5-flash-native-audio-preview-12-2025')
  })

  it('reports server key availability without leaking the key', async () => {
    const { buildGeminiLiveSessionManifest, getGeminiApiKey, getGeminiLiveConfig } = await loadGeminiLiveServer({
      GEMINI_API_KEY: 'secret-gemini-key',
    })

    const config = getGeminiLiveConfig()
    const manifest = buildGeminiLiveSessionManifest({ worldId: 'world-1', worldName: 'Test World' })
    const serialized = JSON.stringify({ config, manifest })

    expect(getGeminiApiKey()).toBe('secret-gemini-key')
    expect(config.configured).toBe(true)
    expect(manifest.configured).toBe(true)
    expect(serialized).not.toContain('secret-gemini-key')
  })

  it('declares Oasis tools, including spatial web primitives, in the setup manifest', async () => {
    const { buildGeminiLiveSessionManifest } = await loadGeminiLiveServer()

    const manifest = buildGeminiLiveSessionManifest({ model: 'gemini-3.1-flash-live-preview' })

    expect(manifest.setupMessage).toHaveProperty('setup')
    expect(manifest.toolDeclarationNames).toContain('create_spatial_web_object')
    expect(manifest.toolDeclarationNames).toContain('get_world_state')
    expect(manifest.transport).toBe('manifest-only')
  })
})
