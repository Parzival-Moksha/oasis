export const REALTIME_AGENT_TYPE = 'realtime'
export const REALTIME_STORAGE_KEY = 'oasis-realtime-voice-store-v1'
export const REALTIME_ACTIVE_SESSION_KEY = 'oasis-realtime-active-session'
export const REALTIME_PANEL_POS_KEY = 'oasis-realtime-panel-pos'
export const REALTIME_PANEL_SIZE_KEY = 'oasis-realtime-panel-size'
export const REALTIME_PANEL_SETTINGS_KEY = 'oasis-realtime-panel-settings'

export const REALTIME_VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const

export const REALTIME_MODELS = [
  'gpt-realtime',
  'gpt-realtime-mini',
] as const

export const REALTIME_VAD_MODES = ['semantic_vad', 'server_vad'] as const
export const REALTIME_VAD_EAGERNESS = ['auto', 'low', 'medium', 'high'] as const

export type RealtimeModel = typeof REALTIME_MODELS[number]
export type RealtimeVoice = typeof REALTIME_VOICES[number]
export type RealtimeVadMode = typeof REALTIME_VAD_MODES[number]
export type RealtimeVadEagerness = typeof REALTIME_VAD_EAGERNESS[number]

export interface RealtimePanelSettings {
  bgColor: string
  opacity: number
  blur: number
  gainDb: number
  spatialAudioEnabled: boolean
  spatialAudioRange: number
}

export interface RealtimePanelSize {
  w: number
  h: number
}

export interface RealtimeSessionSettings {
  voice: string
  vadMode: RealtimeVadMode
  vadEagerness: RealtimeVadEagerness
  instructions: string
  model: string
}

export interface RealtimeTranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  status: 'streaming' | 'done'
  timestamp: number
  toolCallId?: string
  toolName?: string
  toolState?: 'running' | 'done' | 'failed'
  toolInputSummary?: string
  toolInput?: unknown
  toolOutput?: unknown
  toolDurationMs?: number
}

export interface RealtimeLocalSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  worldId: string
  worldName: string
  settings: RealtimeSessionSettings
  messages: RealtimeTranscriptMessage[]
}

export interface RealtimeStoreRecord {
  sessions: Record<string, RealtimeLocalSession>
}

export interface RealtimeVoiceConfigPayload {
  configured: boolean
  model: string
  models: string[]
  defaultVoice: string
  voices: string[]
  defaultVadMode: RealtimeVadMode
  defaultVadEagerness: RealtimeVadEagerness
  promptTemplate: string
  transcriptionModel: string
}

export interface RealtimeVoiceSessionPayload {
  clientSecret: string
  model: string
  voice: string
  vadMode: RealtimeVadMode
  vadEagerness: RealtimeVadEagerness
  instructions: string
  transcriptionModel: string
  sessionExpiresAt?: number | null
}

export const DEFAULT_REALTIME_PANEL_SETTINGS: RealtimePanelSettings = {
  bgColor: '#14091f',
  opacity: 0.92,
  blur: 10,
  gainDb: 10,
  spatialAudioEnabled: true,
  spatialAudioRange: 30,
}

export const DEFAULT_REALTIME_PANEL_POS = {
  x: 72,
  y: 104,
}

export const DEFAULT_REALTIME_PANEL_SIZE: RealtimePanelSize = {
  w: 470,
  h: 760,
}

export function isRealtimeVadMode(value: unknown): value is RealtimeVadMode {
  return typeof value === 'string' && (REALTIME_VAD_MODES as readonly string[]).includes(value)
}

export function isRealtimeVadEagerness(value: unknown): value is RealtimeVadEagerness {
  return typeof value === 'string' && (REALTIME_VAD_EAGERNESS as readonly string[]).includes(value)
}

export function clampRealtimePanelSettings(value: Partial<RealtimePanelSettings> | null | undefined): RealtimePanelSettings {
  return {
    bgColor: typeof value?.bgColor === 'string' && value.bgColor.trim() ? value.bgColor : DEFAULT_REALTIME_PANEL_SETTINGS.bgColor,
    opacity: typeof value?.opacity === 'number' && Number.isFinite(value.opacity)
      ? Math.min(1, Math.max(0.2, value.opacity))
      : DEFAULT_REALTIME_PANEL_SETTINGS.opacity,
    blur: typeof value?.blur === 'number' && Number.isFinite(value.blur)
      ? Math.min(20, Math.max(0, value.blur))
      : DEFAULT_REALTIME_PANEL_SETTINGS.blur,
    gainDb: typeof value?.gainDb === 'number' && Number.isFinite(value.gainDb)
      ? Math.min(20, Math.max(0, value.gainDb))
      : DEFAULT_REALTIME_PANEL_SETTINGS.gainDb,
    spatialAudioEnabled: typeof value?.spatialAudioEnabled === 'boolean'
      ? value.spatialAudioEnabled
      : DEFAULT_REALTIME_PANEL_SETTINGS.spatialAudioEnabled,
    spatialAudioRange: typeof value?.spatialAudioRange === 'number' && Number.isFinite(value.spatialAudioRange)
      ? Math.min(100, Math.max(10, value.spatialAudioRange))
      : DEFAULT_REALTIME_PANEL_SETTINGS.spatialAudioRange,
  }
}

export function normalizeRealtimeVoice(value: unknown, fallback = 'marin'): string {
  const next = typeof value === 'string' ? value.trim() : ''
  return next || fallback
}
