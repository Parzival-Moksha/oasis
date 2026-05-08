export const GEMINI_AGENT_TYPE = 'gemini'

export const GEMINI_LIVE_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
] as const

export const GEMINI_LIVE_RESPONSE_MODALITIES = ['AUDIO'] as const

export type GeminiLiveModel = typeof GEMINI_LIVE_MODELS[number]
export type GeminiLiveConnectionState = 'idle' | 'starting' | 'ready' | 'stopped' | 'error'

export interface GeminiLiveFunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface GeminiLiveConfigPayload {
  configured: boolean
  model: string
  models: string[]
  responseModalities: string[]
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
  status: 'manifest-ready'
  sessionId: string
  model: string
  configured: boolean
  transport: 'manifest-only'
  websocketEndpoint: string
  setupMessage: Record<string, unknown>
  toolDeclarationNames: string[]
  note: string
}
