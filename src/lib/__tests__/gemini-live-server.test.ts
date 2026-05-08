import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const geminiSdkMocks = vi.hoisted(() => ({
  createAuthToken: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAI() {
    return {
      authTokens: {
        create: geminiSdkMocks.createAuthToken,
      },
    }
  }),
}))

const originalEnv = { ...process.env }
const geminiEnvKeys = ['GEMINI_LIVE_MODEL', 'GEMINI_LIVE_VOICE', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const

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
  geminiSdkMocks.createAuthToken.mockReset()
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
    const { getGeminiApiKey, getGeminiLiveConfig } = await loadGeminiLiveServer({
      GEMINI_API_KEY: 'secret-gemini-key',
    })

    const config = getGeminiLiveConfig()
    const serialized = JSON.stringify({ config })

    expect(getGeminiApiKey()).toBe('secret-gemini-key')
    expect(config.configured).toBe(true)
    expect(serialized).not.toContain('secret-gemini-key')
  })

  it('declares Oasis tools, voice config, and token transport in the session manifest', async () => {
    geminiSdkMocks.createAuthToken.mockResolvedValue({ name: 'auth_tokens/test-token' })
    const { buildGeminiLiveSessionManifest } = await loadGeminiLiveServer({
      GEMINI_API_KEY: 'secret-gemini-key',
    })

    const manifest = await buildGeminiLiveSessionManifest({
      model: 'gemini-3.1-flash-live-preview',
      voice: 'Kore',
      worldId: 'world-1',
      worldName: 'Test World',
    })

    expect(manifest.setupMessage).toHaveProperty('setup')
    expect(manifest.toolDeclarationNames).toContain('create_spatial_web_object')
    expect(manifest.toolDeclarationNames).toContain('create_world_from_google_form')
    expect(manifest.toolDeclarationNames).toContain('share_world_link')
    expect(manifest.toolDeclarationNames).toContain('list_worlds')
    expect(manifest.toolDeclarationNames).toContain('create_portal_gate')
    expect(manifest.toolDeclarationNames).toContain('query_objects')
    expect(manifest.toolDeclarationNames).toContain('modify_object')
    expect(manifest.toolDeclarationNames).toContain('remove_object')
    expect(manifest.toolDeclarationNames).toContain('set_sky')
    expect(manifest.toolDeclarationNames).toContain('set_ground_preset')
    expect(manifest.toolDeclarationNames).toContain('paint_ground_tiles')
    expect(manifest.toolDeclarationNames).toContain('add_light')
    expect(manifest.toolDeclarationNames).toContain('set_behavior')
    expect(manifest.toolDeclarationNames).toContain('play_avatar_animation')
    expect(manifest.toolDeclarationNames).toContain('screenshot_viewport')
    expect(manifest.toolDeclarationNames).toContain('self_craft_scene')
    expect(manifest.toolDeclarationNames).toContain('get_world_state')
    expect(manifest.transport).toBe('ephemeral-token')
    expect(manifest.accessToken).toBe('auth_tokens/test-token')
    expect(JSON.stringify(manifest)).not.toContain('secret-gemini-key')
    expect(JSON.stringify(manifest.setupMessage)).toContain('Kore')
    expect(JSON.stringify(manifest.setupMessage)).toContain('Current Live model: gemini-3.1-flash-live-preview')
    expect(JSON.stringify(manifest.setupMessage)).toContain('Never say you called')
    expect(JSON.stringify(manifest.setupMessage)).toContain('paint_ground_tiles')
    expect(JSON.stringify(manifest.setupMessage)).toContain('create_portal_gate')
    expect(JSON.stringify(manifest.setupMessage)).toContain('create_world_from_google_form')
    expect(JSON.stringify(manifest.setupMessage)).toContain('query_objects before modify_object')
    expect(geminiSdkMocks.createAuthToken).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        uses: 1,
        liveConnectConstraints: expect.objectContaining({
          model: 'gemini-3.1-flash-live-preview',
        }),
      }),
    }))
  })

  it('keeps Gemini function schemas inside the Live API subset', async () => {
    const { getGeminiLiveToolDeclarations } = await loadGeminiLiveServer()

    const serialized = JSON.stringify(getGeminiLiveToolDeclarations())

    expect(serialized).not.toContain('additionalProperties')
    expect(serialized).not.toContain('minItems')
    expect(serialized).not.toContain('maxItems')
    expect(serialized).toContain('create_spatial_web_object')
    expect(serialized).toContain('create_world_from_google_form')
    expect(serialized).toContain('share_world_link')
    expect(serialized).toContain('list_worlds')
    expect(serialized).toContain('create_portal_gate')
    expect(serialized).toContain('query_objects')
    expect(serialized).toContain('modify_object')
    expect(serialized).toContain('remove_object')
    expect(serialized).toContain('set_sky')
    expect(serialized).toContain('set_ground_preset')
    expect(serialized).toContain('paint_ground_tiles')
    expect(serialized).toContain('add_light')
    expect(serialized).toContain('modify_light')
    expect(serialized).toContain('set_behavior')
    expect(serialized).toContain('set_avatar')
    expect(serialized).toContain('list_avatar_animations')
    expect(serialized).toContain('play_avatar_animation')
    expect(serialized).toContain('screenshot_viewport')
    expect(serialized).toContain('self_craft_scene')
  })
})
