export const GEMINI_AGENT_TYPE = 'gemini'

export const GEMINI_LIVE_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
] as const

export const GEMINI_LIVE_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
] as const

export const GEMINI_LIVE_RESPONSE_MODALITIES = ['AUDIO'] as const
export const GEMINI_LIVE_INPUT_SAMPLE_RATE = 16000
export const GEMINI_LIVE_OUTPUT_SAMPLE_RATE = 24000
export const GEMINI_LIVE_PANEL_SETTINGS_KEY = 'oasis-gemini-live-panel-settings'
export const GEMINI_LIVE_SESSION_SETTINGS_KEY = 'oasis-gemini-live-session-settings'
export const GEMINI_LIVE_AUDIO_START_LOOKAHEAD_SECONDS = 0.06
export const GEMINI_LIVE_AUDIO_INITIAL_JITTER_SECONDS = 0.56
export const GEMINI_LIVE_AUDIO_STARTUP_SMOOTH_SECONDS = 3.2
export const GEMINI_LIVE_AUDIO_STARTUP_MIN_QUEUE_SECONDS = 0.36
export const GEMINI_LIVE_AUDIO_MIN_QUEUE_SECONDS = 0.16
export const GEMINI_LIVE_AUDIO_CHUNK_FADE_SECONDS = 0.005
export const GEMINI_LIVE_GO_AWAY_RECONNECT_MARGIN_MS = 15000
export const DEFAULT_GEMINI_AGENT_WINDOW_WIDTH = 740
export const DEFAULT_GEMINI_AGENT_WINDOW_HEIGHT = 960
export const DEFAULT_GEMINI_AGENT_FRAME_STYLE = 'void'
export const DEFAULT_GEMINI_AGENT_FRAME_THICKNESS = 7

export type GeminiLiveModel = typeof GEMINI_LIVE_MODELS[number]
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]
export type GeminiLiveConnectionState = 'idle' | 'starting' | 'connected' | 'stopped' | 'error'

export interface GeminiLivePanelSettings {
  bgColor: string
  opacity: number
  gainDb: number
  spatialAudioEnabled: boolean
  spatialAudioRange: number
}

export interface GeminiLiveSessionSettings {
  model: string
  voice: string
  instructions: string
}

export interface GeminiLiveFunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface GeminiLiveConfigPayload {
  configured: boolean
  model: string
  models: string[]
  defaultVoice: string
  voices: string[]
  responseModalities: string[]
  promptTemplate: string
  inputSampleRate: number
  outputSampleRate: number
  websocketEndpoint: string
  toolDeclarations: GeminiLiveFunctionDeclaration[]
  docs: {
    overview: string
    websocketReference: string
    tools: string
    ephemeralTokens: string
  }
}

export interface GeminiLiveSessionPayload {
  status: 'session-ready'
  sessionId: string
  model: string
  voice: string
  configured: boolean
  transport: 'ephemeral-token'
  websocketEndpoint: string
  accessToken: string
  tokenExpiresAt: number
  setupMessage: Record<string, unknown>
  toolDeclarationNames: string[]
  note: string
}

export const DEFAULT_GEMINI_LIVE_PANEL_SETTINGS: GeminiLivePanelSettings = {
  bgColor: '#06111a',
  opacity: 0.94,
  gainDb: 8,
  spatialAudioEnabled: true,
  spatialAudioRange: 28,
}

export function clampGeminiLivePanelSettings(value: Partial<GeminiLivePanelSettings> | null | undefined): GeminiLivePanelSettings {
  return {
    bgColor: typeof value?.bgColor === 'string' && value.bgColor.trim()
      ? value.bgColor
      : DEFAULT_GEMINI_LIVE_PANEL_SETTINGS.bgColor,
    opacity: typeof value?.opacity === 'number' && Number.isFinite(value.opacity)
      ? Math.min(1, Math.max(0.25, value.opacity))
      : DEFAULT_GEMINI_LIVE_PANEL_SETTINGS.opacity,
    gainDb: typeof value?.gainDb === 'number' && Number.isFinite(value.gainDb)
      ? Math.min(20, Math.max(-12, value.gainDb))
      : DEFAULT_GEMINI_LIVE_PANEL_SETTINGS.gainDb,
    spatialAudioEnabled: typeof value?.spatialAudioEnabled === 'boolean'
      ? value.spatialAudioEnabled
      : DEFAULT_GEMINI_LIVE_PANEL_SETTINGS.spatialAudioEnabled,
    spatialAudioRange: typeof value?.spatialAudioRange === 'number' && Number.isFinite(value.spatialAudioRange)
      ? Math.min(100, Math.max(6, value.spatialAudioRange))
      : DEFAULT_GEMINI_LIVE_PANEL_SETTINGS.spatialAudioRange,
  }
}
