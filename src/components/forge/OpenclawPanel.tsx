'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import {
  createLipSyncController,
  registerLipSync,
  resumeLipSyncContext,
  unregisterLipSync,
  type LipSyncController,
} from '@/lib/lip-sync'
import { useOasisStore } from '@/store/oasisStore'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { useOpenclawRelayBridge } from '@/hooks/useOpenclawRelayBridge'
import { base64ToBytes, bytesToBase64, decodeMuLawToFloat32, encodeFloat32ToMuLaw } from '@/lib/audio-mulaw'
import { renderMarkdown } from '@/lib/anorak-renderers'
import { describeOpenclawSshHostIssue, sanitizeOpenclawSshHost } from '@/lib/openclaw-ssh-host'
import { useIsHostedOasis } from '@/lib/oasis-mode-client'
import { AvatarGallery } from './AvatarGallery'
import { MediaBubble, type MediaType } from './MediaBubble'

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
  voiceModel: string
  voiceName: string
  vadThreshold: number
  silenceDurationMs: number
  prefixPaddingMs: number
}

interface OpenclawStatus {
  savedConfig: boolean
  source: 'local' | 'none'
  gatewayUrl: string
  controlUiUrl: string
  browserControlUrl: string
  sshHost: string
  hasDeviceToken: boolean
  defaultSessionId: string
  lastSessionId: string
  gatewayClient?: {
    state: 'idle' | 'connecting' | 'pairing-required' | 'ready' | 'closed' | 'error'
    detail?: string
    gatewayUrl: string
    hasDeviceToken: boolean
    deviceId?: string
    lastError?: string
    connectedAt?: number
  }
  gateway: ProbeState
  controlUi: ProbeState
  browserControl: ProbeState
  gatewayCli: {
    state: 'ready' | 'pairing-required' | 'offline' | 'error' | 'unknown'
    label: string
    detail: string
    checkedAt: number
  }
  pendingDeviceCount: number
  pairedDeviceCount: number
  pendingDevices?: Array<{
    requestId: string
    deviceId: string
    clientId: string
    clientMode: string
    platform: string
    deviceFamily: string
    role: string
    createdAtMs?: number
  }>
  sessionCount: number
  mcpUrl: string
  mcpInstalled: boolean
  runtimeMcpConfigPath: string
  pairingHint: string
  approveCommandHint: string
  recommendedTalkSurface: 'control-ui' | 'telegram-or-cli'
}

interface ProbeState {
  reachable: boolean
  status: number | null
  ok: boolean
  label: string
  error?: string
}

interface OpenclawSessionSummary {
  id: string
  title: string
  preview: string
  source: 'draft' | 'gateway' | 'cache'
  createdAt: number
  updatedAt: number
  messageCount: number
}

interface OpenclawMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  state?: 'streaming' | 'done' | 'failed'
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  toolState?: 'running' | 'done' | 'failed'
  toolDurationMs?: number
  toolInputSummary?: string
}

interface OpenclawMediaReference {
  path: string
  mediaType: MediaType
}

interface ProfileResponse {
  displayName?: string
}

type OpenclawVoiceState = 'idle' | 'connecting' | 'live' | 'thinking' | 'error'

interface OpenclawMcpInfo {
  command: string
  configPath: string
  definition: {
    url: string
    transport: 'streamable-http'
    headers?: Record<string, string>
  }
  installed: boolean
}

interface RelayPairingResult {
  code: string
  expiresAt: number
  worldId: string
  scopes: string[]
}

type SmokeMode = 'core' | 'live' | 'external'
type SmokeStatus = 'passed' | 'failed' | 'skipped'
type SmokeCategory = 'transport' | 'world' | 'avatar' | 'craft' | 'live-bridge' | 'conjure'
type OpenclawPanelTab = 'stream' | 'voice' | 'config' | 'settings' | 'diagnostics'

interface OpenclawSmokeTestCase {
  name: string
  toolName?: string
  category: SmokeCategory
  status: SmokeStatus
  detail: string
  args?: Record<string, unknown>
  data?: unknown
  durationMs?: number
}

interface OpenclawSmokeReport {
  mode: SmokeMode
  startedAt: number
  finishedAt: number
  durationMs: number
  endpoint: string
  worldId?: string
  worldName?: string
  counts: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
  tests: OpenclawSmokeTestCase[]
}

const DEFAULT_POS = { x: 44, y: 96 }
const DEFAULT_SIZE = { w: 460, h: 720 }
const MIN_WIDTH = 380
const MIN_HEIGHT = 420
const EMBEDDED_SCROLL_SURFACE_STYLE = {
  overscrollBehavior: 'contain' as const,
  WebkitOverflowScrolling: 'touch' as const,
}
const OPENCLAW_VOICE_MODELS = ['gpt-realtime', 'gpt-realtime-mini'] as const
const OPENCLAW_VOICE_OPTIONS = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'] as const
const OPENCLAW_AUDIO_SAMPLE_RATE = 8000
const OPENCLAW_RELAY_SCOPES = ['world.read', 'world.write.safe', 'screenshot.request', 'chat.stream'] as const
const OPENCLAW_RELAY_TOOLS: readonly string[] = Object.freeze([
  'get_world_state',
  'get_world_info',
  'query_objects',
  'search_assets',
  'get_asset_catalog',
  'place_object',
  'modify_object',
  'remove_object',
  'set_sky',
  'set_ground_preset',
  'paint_ground_tiles',
  'add_light',
  'modify_light',
  'set_behavior',
  'set_avatar',
  'walk_avatar_to',
  'list_avatar_animations',
  'play_avatar_animation',
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_user',
])
const DEFAULT_SETTINGS: PanelSettings = {
  bgColor: '#06161d',
  opacity: 0.92,
  blur: 8,
  voiceModel: 'gpt-realtime',
  voiceName: 'alloy',
  vadThreshold: 0.5,
  silenceDurationMs: 500,
  prefixPaddingMs: 300,
}
const DEFAULT_STATUS: OpenclawStatus = {
  savedConfig: false,
  source: 'none',
  gatewayUrl: 'ws://127.0.0.1:18789',
  controlUiUrl: 'http://127.0.0.1:18789',
  browserControlUrl: 'http://127.0.0.1:18791',
  sshHost: '',
  hasDeviceToken: false,
  defaultSessionId: '',
  lastSessionId: '',
  gatewayClient: {
    state: 'idle',
    gatewayUrl: 'ws://127.0.0.1:18789',
    hasDeviceToken: false,
  },
  gateway: { reachable: false, status: null, ok: false, label: 'offline' },
  controlUi: { reachable: false, status: null, ok: false, label: 'offline' },
  browserControl: { reachable: false, status: null, ok: false, label: 'offline' },
  gatewayCli: { state: 'unknown', label: 'unknown', detail: '', checkedAt: 0 },
  pendingDeviceCount: 0,
  pairedDeviceCount: 0,
  sessionCount: 0,
  mcpUrl: 'http://127.0.0.1:4516/api/mcp/oasis?agentType=openclaw',
  mcpInstalled: false,
  runtimeMcpConfigPath: '~/.openclaw/openclaw.json',
  pairingHint: 'If pairing is required, approve it on the machine running the Gateway.',
  approveCommandHint: 'openclaw devices list && openclaw devices approve <requestId>',
  recommendedTalkSurface: 'control-ui',
}
const POS_KEY = 'oasis-openclaw-pos'
const SIZE_KEY = 'oasis-openclaw-size'
const SETTINGS_KEY = 'oasis-openclaw-settings'
const SESSION_KEY = 'oasis-openclaw-session'
const TRANSCRIPT_KEY_PREFIX = 'oasis-openclaw-transcript:'
const MAX_LOCAL_TRANSCRIPT_MESSAGES = 200
const OPENCLAW_DB_NAME = 'oasis-openclaw-panel'
const OPENCLAW_DB_VERSION = 1
const OPENCLAW_DB_STORE = 'transcripts'
const OPENCLAW_MEDIA_URL_RE = /(?:https?:\/\/[^\s"'<>]+|\/(?:generated-(?:images|voices|videos|music)|merlin\/screenshots)\/[^\s"'<>]+)/gi

let openclawDbPromise: Promise<IDBDatabase> | null = null
let openclawTranscriptMigrationPromise: Promise<void> | null = null

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'QuotaExceededError' || /quota/i.test(error.message)
}

function collectLegacyTranscriptKeys(): string[] {
  if (!hasWindow()) return []
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key && key.startsWith(TRANSCRIPT_KEY_PREFIX)) keys.push(key)
  }
  return keys
}

function clearLegacyTranscriptStorage(): boolean {
  if (!hasWindow()) return false
  const keys = collectLegacyTranscriptKeys()
  if (keys.length === 0) return false
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Ignore cleanup failures.
    }
  }
  return true
}

function writeLocalStorageSafely(write: () => void) {
  if (!hasWindow()) return
  try {
    write()
  } catch (error) {
    if (isQuotaExceededError(error) && clearLegacyTranscriptStorage()) {
      try {
        write()
        return
      } catch {
        // Ignore after cleanup retry.
      }
    }
  }
}

function openOpenclawDb(): Promise<IDBDatabase> {
  if (!hasWindow() || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  }
  if (openclawDbPromise) return openclawDbPromise
  openclawDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(OPENCLAW_DB_NAME, OPENCLAW_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OPENCLAW_DB_STORE)) {
        db.createObjectStore(OPENCLAW_DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open OpenClaw transcript database.'))
  })
  return openclawDbPromise
}

function loadStored<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizePanelSettings(value: Partial<PanelSettings> | null | undefined): PanelSettings {
  return {
    bgColor: typeof value?.bgColor === 'string' ? value.bgColor : DEFAULT_SETTINGS.bgColor,
    opacity: clamp(typeof value?.opacity === 'number' ? value.opacity : DEFAULT_SETTINGS.opacity, 0.25, 1),
    blur: clamp(typeof value?.blur === 'number' ? value.blur : DEFAULT_SETTINGS.blur, 0, 20),
    voiceModel: OPENCLAW_VOICE_MODELS.includes(value?.voiceModel as typeof OPENCLAW_VOICE_MODELS[number])
      ? value!.voiceModel!
      : DEFAULT_SETTINGS.voiceModel,
    voiceName: OPENCLAW_VOICE_OPTIONS.includes(value?.voiceName as typeof OPENCLAW_VOICE_OPTIONS[number])
      ? value!.voiceName!
      : DEFAULT_SETTINGS.voiceName,
    vadThreshold: clamp(typeof value?.vadThreshold === 'number' ? value.vadThreshold : DEFAULT_SETTINGS.vadThreshold, 0.1, 0.9),
    silenceDurationMs: clamp(typeof value?.silenceDurationMs === 'number' ? value.silenceDurationMs : DEFAULT_SETTINGS.silenceDurationMs, 200, 1200),
    prefixPaddingMs: clamp(typeof value?.prefixPaddingMs === 'number' ? value.prefixPaddingMs : DEFAULT_SETTINGS.prefixPaddingMs, 100, 1000),
  }
}

function saveStored<T>(key: string, value: T) {
  if (!hasWindow()) return
  writeLocalStorageSafely(() => {
    window.localStorage.setItem(key, JSON.stringify(value))
  })
}

function saveStoredString(key: string, value: string) {
  if (!hasWindow()) return
  if (!value) {
    window.localStorage.removeItem(key)
    return
  }
  writeLocalStorageSafely(() => {
    window.localStorage.setItem(key, value)
  })
}

function transcriptStorageKey(sessionId: string): string {
  return `${TRANSCRIPT_KEY_PREFIX}${sessionId}`
}

function isLocalDraftSession(sessionId: string): boolean {
  return Boolean(sessionId) && !sessionId.includes(':')
}

function createClientDraftSessionSummary(title = 'New OpenClaw session'): OpenclawSessionSummary {
  const now = Date.now()
  return {
    id: `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    preview: '',
    source: 'draft',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }
}

function sanitizeMessage(raw: unknown): OpenclawMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const role = typeof record.role === 'string' ? record.role : 'system'
  if (!['user', 'assistant', 'system', 'tool'].includes(role)) return null
  const timestamp = typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
    ? record.timestamp
    : Date.now()
  const state = typeof record.state === 'string' && ['streaming', 'done', 'failed'].includes(record.state)
    ? record.state as OpenclawMessage['state']
    : undefined
  const toolState = typeof record.toolState === 'string' && ['running', 'done', 'failed'].includes(record.toolState)
    ? record.toolState as OpenclawMessage['toolState']
    : undefined

  return {
    id: typeof record.id === 'string' && record.id ? record.id : makeId(role),
    role: role as OpenclawMessage['role'],
    content: typeof record.content === 'string' ? record.content : '',
    timestamp,
    ...(state ? { state } : {}),
    ...(typeof record.toolName === 'string' ? { toolName: record.toolName } : {}),
    ...('toolInput' in record ? { toolInput: record.toolInput } : {}),
    ...('toolOutput' in record ? { toolOutput: record.toolOutput } : {}),
    ...(toolState ? { toolState } : {}),
    ...(typeof record.toolDurationMs === 'number' && Number.isFinite(record.toolDurationMs) ? { toolDurationMs: record.toolDurationMs } : {}),
    ...(typeof record.toolInputSummary === 'string' ? { toolInputSummary: record.toolInputSummary } : {}),
  }
}

function readLegacyTranscript(sessionId: string): OpenclawMessage[] {
  if (!hasWindow() || !sessionId) return []
  try {
    const raw = window.localStorage.getItem(transcriptStorageKey(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeMessage)
      .filter((value): value is OpenclawMessage => Boolean(value))
      .slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
  } catch {
    return []
  }
}

async function readPersistedTranscript(sessionId: string): Promise<OpenclawMessage[]> {
  if (!hasWindow() || !sessionId) return []
  try {
    const db = await openOpenclawDb()
    const persisted = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(OPENCLAW_DB_STORE, 'readonly')
      const store = tx.objectStore(OPENCLAW_DB_STORE)
      const request = store.get(sessionId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Failed to read OpenClaw transcript.'))
    })
    if (!Array.isArray(persisted)) return []
    return persisted
      .map(sanitizeMessage)
      .filter((value): value is OpenclawMessage => Boolean(value))
      .slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
  } catch {
    return []
  }
}

async function saveStoredTranscript(sessionId: string, messages: OpenclawMessage[]) {
  if (!hasWindow() || !sessionId) return
  try {
    const db = await openOpenclawDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OPENCLAW_DB_STORE, 'readwrite')
      tx.objectStore(OPENCLAW_DB_STORE).put(messages.slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES), sessionId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('Failed to persist OpenClaw transcript.'))
      tx.onabort = () => reject(tx.error || new Error('OpenClaw transcript persistence aborted.'))
    })
  } catch {
    // Ignore persistence failures; the live panel state still works.
  }
}

async function migrateLegacyTranscriptStorage() {
  if (!hasWindow()) return
  if (openclawTranscriptMigrationPromise) return openclawTranscriptMigrationPromise
  openclawTranscriptMigrationPromise = (async () => {
    const keys = collectLegacyTranscriptKeys()
    for (const key of keys) {
      const sessionId = key.slice(TRANSCRIPT_KEY_PREFIX.length)
      if (!sessionId) continue
      const legacyMessages = readLegacyTranscript(sessionId)
      if (legacyMessages.length > 0) {
        await saveStoredTranscript(sessionId, legacyMessages)
      }
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore cleanup failures.
      }
    }
  })()

  try {
    await openclawTranscriptMigrationPromise
  } finally {
    openclawTranscriptMigrationPromise = null
  }
}

async function loadStoredTranscript(sessionId: string): Promise<OpenclawMessage[]> {
  if (!sessionId) return []
  const persisted = await readPersistedTranscript(sessionId)
  if (persisted.length > 0) return persisted

  const legacy = readLegacyTranscript(sessionId)
  if (legacy.length > 0) {
    await saveStoredTranscript(sessionId, legacy)
    try {
      window.localStorage.removeItem(transcriptStorageKey(sessionId))
    } catch {
      // Ignore cleanup failures.
    }
  }
  return legacy
}

function summarizeText(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function summarizeJson(value: unknown, maxLength = 120): string {
  if (value == null) return 'no args'
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return 'no args'
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw
}

function normalizeCompactText(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
}

function shouldJoinStreamingText(previous: string, incoming: string): boolean {
  const left = previous.at(-1) || ''
  const right = incoming.at(0) || ''
  if (!left || !right || /\s/.test(left) || /\s/.test(right)) return false
  if (/[,;:!?]/.test(left) && /[A-Za-z0-9]/.test(right)) return true
  if (!/[A-Za-z0-9]/.test(left) || !/[A-Za-z0-9]/.test(right)) return false

  const leftWord = previous.match(/[A-Za-z0-9]+$/)?.[0] || ''
  const rightWord = incoming.match(/^[A-Za-z0-9]+/)?.[0] || ''
  return leftWord.length + rightWord.length > 3 && rightWord.length > 1
}

function mergeStreamingText(previous: string, incoming: string, isFinal = false): string {
  const earlier = previous || ''
  const next = incoming || ''
  if (!earlier) return next
  if (!next) return earlier
  if (next === earlier) return earlier
  if (next.startsWith(earlier)) return next
  if (earlier.startsWith(next)) return earlier

  const compactEarlier = normalizeCompactText(earlier)
  const compactNext = normalizeCompactText(next)
  if (compactEarlier && compactEarlier === compactNext) {
    return next.length >= earlier.length ? next : earlier
  }
  if (isFinal && compactEarlier.length > 6 && compactNext.startsWith(compactEarlier)) {
    return next
  }

  return `${earlier}${shouldJoinStreamingText(earlier, next) ? ' ' : ''}${next}`
}

function summarizeToolInput(toolName: string, value: unknown, maxLength = 120): string {
  const summary = summarizeJson(value, maxLength)
  if (!summary || summary === 'no args') return summary
  const normalizedSummary = normalizeCompactText(summary.replace(/^"|"$/g, ''))
  const normalizedToolName = normalizeCompactText(toolName)
  return normalizedSummary === normalizedToolName ? '' : summary
}

function formatToolValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    return value
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  }
  try {
    return JSON.stringify(value, null, 2) || ''
  } catch {
    return String(value)
  }
}

function detectOpenclawMediaType(path: string): MediaType | null {
  const normalized = path.trim()
  if (!normalized) return null
  if (/^data:image\//i.test(normalized)) return 'image'
  if (/^data:audio\//i.test(normalized)) return 'audio'
  if (/^data:video\//i.test(normalized)) return 'video'
  if (/\/generated-images\/|\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
  if (/\/generated-(?:voices|music)\/|\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
  if (/\/generated-videos\/|\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
  if (/^(?:https?:\/\/|blob:)/i.test(normalized)) {
    if (/\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
    if (/\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
    if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
    if (/(?:fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)/i.test(normalized)) {
      if (/video|mp4|webm/i.test(normalized)) return 'video'
      return 'image'
    }
    if (/(?:api\.elevenlabs\.io|elevenlabs\.io\/)/i.test(normalized)) return 'audio'
  }
  return null
}

function pushOpenclawMediaReference(
  refs: OpenclawMediaReference[],
  seen: Set<string>,
  path: string,
  mediaType: MediaType | null = detectOpenclawMediaType(path),
) {
  const trimmed = path.trim()
  if (!trimmed || !mediaType) return
  const key = `${mediaType}:${trimmed}`
  if (seen.has(key)) return
  seen.add(key)
  refs.push({ path: trimmed, mediaType })
}

function collectOpenclawMediaReferences(value: unknown, refs: OpenclawMediaReference[] = [], seen = new Set<string>()): OpenclawMediaReference[] {
  if (typeof value === 'string') {
    const matches = value.match(OPENCLAW_MEDIA_URL_RE) || []
    for (const match of matches) pushOpenclawMediaReference(refs, seen, match)

    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 1) {
      try {
        collectOpenclawMediaReferences(JSON.parse(trimmed) as unknown, refs, seen)
      } catch {
        // Keep regex-discovered URLs from the raw string.
      }
    }
    return refs
  }

  if (Array.isArray(value)) {
    for (const item of value) collectOpenclawMediaReferences(item, refs, seen)
    return refs
  }

  if (!value || typeof value !== 'object') return refs
  const record = value as Record<string, unknown>

  if (record.type === 'image' && typeof record.data === 'string') {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : 'image/png'
    pushOpenclawMediaReference(refs, seen, `data:${mimeType};base64,${record.data}`, 'image')
  }

  const url = typeof record.url === 'string' ? record.url : ''
  if (url) pushOpenclawMediaReference(refs, seen, url)

  for (const nested of Object.values(record)) {
    collectOpenclawMediaReferences(nested, refs, seen)
  }
  return refs
}

function OpenclawToolMediaBubbles({
  message,
  avatarId,
  autoPlayAudio = false,
  galleryScopeId,
}: {
  message: OpenclawMessage
  avatarId?: string | null
  autoPlayAudio?: boolean
  galleryScopeId: string
}) {
  const media = collectOpenclawMediaReferences(message.toolOutput)
  if (media.length === 0) return null

  let audioConsumed = false
  return (
    <div className="space-y-1 pl-2">
      {media.map((entry, index) => {
        const shouldAutoPlay = entry.mediaType === 'audio' && autoPlayAudio && !audioConsumed
        if (shouldAutoPlay) audioConsumed = true
        return (
          <MediaBubble
            key={`${message.id}-media-${index}-${entry.path}`}
            url={entry.path}
            mediaType={entry.mediaType}
            prompt={`OpenClaw ${entry.mediaType}`}
            compact={entry.mediaType !== 'image'}
            autoPlay={shouldAutoPlay}
            avatarLipSyncTargetId={entry.mediaType === 'audio' ? avatarId || undefined : undefined}
            galleryScopeId={galleryScopeId}
          />
        )
      })}
    </div>
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function extractGatewayChatText(payload: unknown): string {
  const record = asRecord(payload)
  const direct = stringField(record, 'text', 'content')
  if (direct) return direct

  const message = asRecord(record.message)
  const messageDirect = stringField(message, 'text')
  if (messageDirect) return messageDirect

  const contentBlocks = Array.isArray(message.content) ? message.content : []
  const textParts = contentBlocks
    .map(block => {
      if (typeof block === 'string') return block
      const blockRecord = asRecord(block)
      const blockType = stringField(blockRecord, 'type')
      if (blockType && blockType !== 'text') return ''
      return stringField(blockRecord, 'text', 'content')
    })
    .filter(Boolean)

  return textParts.join('\n').trim()
}

function formatTimestamp(value: number): string {
  if (!Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function buildOpenclawSshBridgeCommand(sshHost: string): string {
  const host = sshHost.trim() || 'user@openclaw-host'
  return `ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 -R 4516:127.0.0.1:4516 ${host}`
}

function normalizeCommandOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '')
}

function localRelayHostFromOrigin(origin: string): string {
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
    if (host === '127.0.0.1') return '127.0.0.1'
    if (host === '::1') return '[::1]'
  } catch {
    // Fall through to the common local dev hostname.
  }
  return 'localhost'
}

function isLocalOasisOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

function buildOpenclawRelayPairingCommand(pairing: RelayPairingResult | null, origin: string): string {
  if (!pairing) return ''
  const normalizedOrigin = normalizeCommandOrigin(origin)
  const pairingRef = normalizedOrigin
    ? `${normalizedOrigin}/pair/${encodeURIComponent(pairing.code)}`
    : pairing.code
  const base = `node scripts/openclaw-oasis-bridge.mjs ${pairingRef}`
  if (!isLocalOasisOrigin(normalizedOrigin)) return base
  const relayHost = localRelayHostFromOrigin(normalizedOrigin)
  return `${base} --relay-url="ws://${relayHost}:4517/?role=agent"`
}

function formatSessionSource(source: OpenclawSessionSummary['source']): string {
  switch (source) {
    case 'gateway':
      return 'gateway'
    case 'cache':
      return 'cache'
    default:
      return 'draft'
  }
}

function formatSessionOptionLabel(session: OpenclawSessionSummary): string {
  const count = `${session.messageCount} ${session.messageCount === 1 ? 'msg' : 'msgs'}`
  const stamp = formatTimestamp(session.updatedAt || session.createdAt)
  return `${session.title} [${formatSessionSource(session.source)}] · ${count}${stamp ? ` · ${stamp}` : ''}`
}

function dedupeOpenclawSessions(sessions: OpenclawSessionSummary[]): OpenclawSessionSummary[] {
  const byId = new Map<string, OpenclawSessionSummary>()
  for (const session of sessions) {
    if (!session.id) continue
    const existing = byId.get(session.id)
    if (!existing || session.updatedAt >= existing.updatedAt) {
      byId.set(session.id, session)
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

function roleLabel(role: OpenclawMessage['role'], profileName: string): string {
  if (role === 'assistant') return 'OPENCLAW'
  if (role === 'user') return profileName || 'USER'
  if (role === 'system') return 'SYSTEM'
  return 'TOOL'
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`
}

function probeTone(probe: ProbeState): 'online' | 'warn' | 'offline' {
  if (!probe.reachable) return 'offline'
  if (probe.ok) return 'online'
  return 'warn'
}

function smokeTone(status: SmokeStatus): 'online' | 'warn' | 'offline' {
  if (status === 'passed') return 'online'
  if (status === 'skipped') return 'warn'
  return 'offline'
}

function toneStyles(tone: 'online' | 'warn' | 'offline') {
  switch (tone) {
    case 'online':
      return {
        color: '#6ee7b7',
        background: 'rgba(16,185,129,0.12)',
        border: 'rgba(16,185,129,0.3)',
      }
    case 'warn':
      return {
        color: '#fbbf24',
        background: 'rgba(245,158,11,0.12)',
        border: 'rgba(245,158,11,0.3)',
      }
    default:
      return {
        color: '#fda4af',
        background: 'rgba(244,63,94,0.12)',
        border: 'rgba(244,63,94,0.28)',
      }
  }
}

function StatusBadge({ label, tone, title }: { label: string; tone: 'online' | 'warn' | 'offline'; title?: string }) {
  const styles = toneStyles(tone)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em]"
      title={title}
      style={{
        color: styles.color,
        background: styles.background,
        borderColor: styles.border,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: styles.color }}
      />
      {label}
    </span>
  )
}

async function copyText(value: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Ignore clipboard failures in insecure contexts.
  }
}

export function OpenclawPanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
  ownRelayConnection = !embedded,
}: {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
  ownRelayConnection?: boolean
}) {
  useUILayer('openclaw', isOpen && !embedded)
  const hostedMode = useIsHostedOasis()

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('openclaw', 9998))
  const bringPanelToFront = useOasisStore(state => state.bringPanelToFront)
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const openclawAvatar = useOasisStore(state =>
    state.placedAgentAvatars.find(entry => entry.agentType === 'openclaw' || entry.label === 'Clawdling') || null,
  )
  const assignSharedAgentAvatar = useOasisStore(state => state.assignSharedAgentAvatar)

  const [position, setPosition] = useState(() => embedded ? DEFAULT_POS : loadStored(POS_KEY, DEFAULT_POS))
  const [size, setSize] = useState(() => embedded ? DEFAULT_SIZE : loadStored(SIZE_KEY, DEFAULT_SIZE))
  const [panelSettings, setPanelSettings] = useState(() => normalizePanelSettings(loadStored<Partial<PanelSettings>>(SETTINGS_KEY, DEFAULT_SETTINGS)))
  const [status, setStatus] = useState<OpenclawStatus>(DEFAULT_STATUS)
  const [configDraft, setConfigDraft] = useState({
    gatewayUrl: DEFAULT_STATUS.gatewayUrl,
    controlUiUrl: DEFAULT_STATUS.controlUiUrl,
    browserControlUrl: DEFAULT_STATUS.browserControlUrl,
    sshHost: '',
    deviceToken: '',
  })
  const [browserOrigin, setBrowserOrigin] = useState('')
  const [sessions, setSessions] = useState<OpenclawSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(SESSION_KEY) || ''
  })
  const [messages, setMessages] = useState<OpenclawMessage[]>([])
  const [voiceMessages, setVoiceMessages] = useState<OpenclawMessage[]>([])
  const [composer, setComposer] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [mcpInfo, setMcpInfo] = useState<OpenclawMcpInfo | null>(null)
  const [loadingMcp, setLoadingMcp] = useState(false)
  const [installingMcp, setInstallingMcp] = useState(false)
  const [smokeReport, setSmokeReport] = useState<OpenclawSmokeReport | null>(null)
  const [runningSmokeMode, setRunningSmokeMode] = useState<SmokeMode | ''>('')
  const [copiedKey, setCopiedKey] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [sending, setSending] = useState(false)
  const [activeTab, setActiveTab] = useState<OpenclawPanelTab>(() => hostedMode ? 'config' : 'stream')
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [expandedToolIds, setExpandedToolIds] = useState<string[]>([])
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [showVoiceJumpToLatest, setShowVoiceJumpToLatest] = useState(false)
  const [profileName, setProfileName] = useState('Vibedev')
  const [voiceState, setVoiceState] = useState<OpenclawVoiceState>('idle')
  const [voiceDetail, setVoiceDetail] = useState('OpenClaw voice portal sleeps until you wake it.')
  const [voiceSessionId, setVoiceSessionId] = useState('')
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [relayPairing, setRelayPairing] = useState<RelayPairingResult | null>(null)
  const [relayPairingBusy, setRelayPairingBusy] = useState(false)
  const [relayPairingError, setRelayPairingError] = useState('')

  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusHandleRef = useRef<{ focus: () => void } | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)
  const voiceTranscriptRef = useRef<HTMLDivElement | null>(null)
  const voiceAutoScrollRef = useRef(true)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const voiceLipSyncRef = useRef<LipSyncController | null>(null)
  const voiceEventSourceRef = useRef<EventSource | null>(null)
  const voiceMediaStreamRef = useRef<MediaStream | null>(null)
  const voiceAudioContextRef = useRef<AudioContext | null>(null)
  const voiceInputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const voiceInputProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const voiceInputSinkRef = useRef<GainNode | null>(null)
  const voiceUploadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceUploadInFlightRef = useRef(false)
  const voiceChunkQueueRef = useRef<Uint8Array[]>([])
  const voiceLiveUserMessageIdRef = useRef<string>('')
  const voiceLiveAssistantMessageIdRef = useRef<string>('')
  const voiceOutputAudioContextRef = useRef<AudioContext | null>(null)
  const voiceOutputGainRef = useRef<GainNode | null>(null)
  const voiceOutputSourceRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const voiceOutputScheduledAtRef = useRef(0)
  const voiceOutputNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const voiceMarkTimersRef = useRef<Set<number>>(new Set())
  const voiceInputTimestampRef = useRef(0)
  const voiceSessionIdRef = useRef('')
  const stopOpenclawVoiceRef = useRef<(opts?: { remote?: boolean; nextDetail?: string }) => Promise<void>>(async () => {})
  const openclawActivityRunIdRef = useRef<string | null>(null)
  const relayChatPendingRef = useRef(new Map<string, {
    assistantMessageId: string
    activityRunId: string
    sessionTitle: string
  }>())
  const relayChatTimeoutRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    focusHandleRef.current = { focus: () => inputRef.current?.focus() }
  }, [])

  useEffect(() => {
    if (hasWindow()) setBrowserOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (hostedMode) setActiveTab(tab => (tab === 'voice' ? 'config' : tab))
  }, [hostedMode])

  useEffect(() => {
    if (hostedMode && activeWorldId && ownRelayConnection) setRelayEnabled(true)
  }, [activeWorldId, hostedMode, ownRelayConnection])

  useEffect(() => {
    return () => {
      if (!openclawActivityRunIdRef.current) return
      useOasisStore.getState().finishAgentWork('openclaw', openclawActivityRunIdRef.current)
      openclawActivityRunIdRef.current = null
    }
  }, [])

  useAutoresizeTextarea(inputRef, composer, { minPx: 42, maxPx: 180 })

  const voice = useAgentVoiceInput({
    enabled: !hostedMode && (embedded || isOpen),
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => {
      setComposer(current => current ? `${current}\n${transcript}` : transcript)
    },
    focusTargetRef: focusHandleRef,
    enablePlayerLipSync: true,
  })

  const isVisible = embedded || isOpen
  const currentSession = useMemo(
    () => sessions.find(entry => entry.id === selectedSessionId) || null,
    [selectedSessionId, sessions],
  )

  const resolveVoiceSessionKey = useCallback(() => {
    if (selectedSessionId && !isLocalDraftSession(selectedSessionId)) return selectedSessionId
    if (status.lastSessionId && !isLocalDraftSession(status.lastSessionId)) return status.lastSessionId
    if (status.defaultSessionId && !isLocalDraftSession(status.defaultSessionId)) return status.defaultSessionId
    return 'agent:main:main'
  }, [selectedSessionId, status.defaultSessionId, status.lastSessionId])

  const ensureVoiceOutputContext = useCallback(async () => {
    if (typeof window === 'undefined') return null

    let ctx = voiceOutputAudioContextRef.current
    if (!ctx || ctx.state === 'closed') {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      voiceOutputAudioContextRef.current = ctx
    }

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }

    if (!voiceOutputGainRef.current) {
      const gainNode = ctx.createGain()
      gainNode.gain.value = 1
      gainNode.connect(ctx.destination)
      voiceOutputGainRef.current = gainNode
    }

    if (!voiceOutputSourceRef.current) {
      const destination = ctx.createMediaStreamDestination()
      voiceOutputGainRef.current.connect(destination)
      voiceOutputSourceRef.current = destination
    }

    return ctx
  }, [])

  const activateVoiceLipSync = useCallback(() => {
    if (!openclawAvatar?.id || !voiceLipSyncRef.current) return
    const ctrl = voiceLipSyncRef.current
    void resumeLipSyncContext().finally(() => {
      if (voiceOutputSourceRef.current) {
        ctrl.attachStream(voiceOutputSourceRef.current.stream)
      } else if (voiceAudioRef.current && !ctrl.isActive) {
        ctrl.attachAudio(voiceAudioRef.current)
      }
      registerLipSync(openclawAvatar.id, ctrl)
    })
  }, [openclawAvatar?.id])

  const deactivateVoiceLipSync = useCallback(() => {
    if (!openclawAvatar?.id || !voiceLipSyncRef.current) return
    unregisterLipSync(openclawAvatar.id, voiceLipSyncRef.current, { detach: false })
  }, [openclawAvatar?.id])

  useEffect(() => {
    if (!openclawAvatar?.id) return
    const ctrl = createLipSyncController()
    voiceLipSyncRef.current = ctrl
    return () => {
      unregisterLipSync(openclawAvatar.id, ctrl)
      ctrl.detach()
      if (voiceLipSyncRef.current === ctrl) {
        voiceLipSyncRef.current = null
      }
    }
  }, [openclawAvatar?.id])

  const stopVoicePlayback = useCallback(() => {
    for (const source of voiceOutputNodesRef.current) {
      try {
        source.stop()
      } catch {
        // ignore
      }
      try {
        source.disconnect()
      } catch {
        // ignore
      }
    }
    voiceOutputNodesRef.current.clear()
    voiceOutputScheduledAtRef.current = 0

    for (const timer of voiceMarkTimersRef.current) {
      clearTimeout(timer)
    }
    voiceMarkTimersRef.current.clear()
  }, [])

  const acknowledgeVoiceMark = useCallback(async (markName: string) => {
    const activeVoiceSessionId = voiceSessionIdRef.current || voiceSessionId
    if (!activeVoiceSessionId || !markName) return
    try {
      await fetch('/api/openclaw/voice/mark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voiceSessionId: activeVoiceSessionId,
          markName,
        }),
      })
    } catch {
      // Ignore mark ack failures; the voice line can keep going.
    }
  }, [voiceSessionId])

  const queueVoiceAudioChunk = useCallback(async (audioBase64: string) => {
    if (!audioBase64) return
    const ctx = await ensureVoiceOutputContext()
    const gainNode = voiceOutputGainRef.current
    if (!ctx || !gainNode) return

    const bytes = base64ToBytes(audioBase64)
    if (bytes.length === 0) return
    const channel = decodeMuLawToFloat32(bytes)
    if (channel.length === 0) return

    const buffer = ctx.createBuffer(1, channel.length, OPENCLAW_AUDIO_SAMPLE_RATE)
    buffer.getChannelData(0).set(channel)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gainNode)

    const startAt = Math.max(ctx.currentTime + 0.01, voiceOutputScheduledAtRef.current || ctx.currentTime)
    voiceOutputScheduledAtRef.current = startAt + buffer.duration
    voiceOutputNodesRef.current.add(source)
    source.onended = () => {
      voiceOutputNodesRef.current.delete(source)
      try {
        source.disconnect()
      } catch {
        // ignore
      }
    }

    activateVoiceLipSync()
    source.start(startAt)
  }, [activateVoiceLipSync, ensureVoiceOutputContext])

  const scheduleVoiceMarkAck = useCallback((markName: string) => {
    const ctx = voiceOutputAudioContextRef.current
    if (!ctx || !markName) {
      void acknowledgeVoiceMark(markName)
      return
    }
    const delayMs = Math.max(0, Math.round((Math.max(voiceOutputScheduledAtRef.current, ctx.currentTime) - ctx.currentTime) * 1000))
    const timer = window.setTimeout(() => {
      voiceMarkTimersRef.current.delete(timer)
      void acknowledgeVoiceMark(markName)
    }, delayMs)
    voiceMarkTimersRef.current.add(timer)
  }, [acknowledgeVoiceMark])

  const stopVoiceCapture = useCallback(() => {
    if (voiceUploadTimerRef.current) {
      clearInterval(voiceUploadTimerRef.current)
      voiceUploadTimerRef.current = null
    }
    voiceUploadInFlightRef.current = false
    voiceChunkQueueRef.current = []

    try {
      voiceInputProcessorRef.current?.disconnect()
    } catch {
      // ignore
    }
    try {
      voiceInputSourceRef.current?.disconnect()
    } catch {
      // ignore
    }
    try {
      voiceInputSinkRef.current?.disconnect()
    } catch {
      // ignore
    }

    voiceInputProcessorRef.current = null
    voiceInputSourceRef.current = null
    voiceInputSinkRef.current = null

    voiceMediaStreamRef.current?.getTracks().forEach(track => track.stop())
    voiceMediaStreamRef.current = null

    void voiceAudioContextRef.current?.close().catch(() => {})
    voiceAudioContextRef.current = null
    voiceInputTimestampRef.current = 0
  }, [])

  const flushVoiceAudio = useCallback(async () => {
    const activeVoiceSessionId = voiceSessionIdRef.current || voiceSessionId
    if (!activeVoiceSessionId || voiceUploadInFlightRef.current || voiceChunkQueueRef.current.length === 0) return
    const chunks = voiceChunkQueueRef.current
    voiceChunkQueueRef.current = []

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    voiceInputTimestampRef.current += (merged.length / OPENCLAW_AUDIO_SAMPLE_RATE) * 1000

    voiceUploadInFlightRef.current = true
    try {
      await fetch('/api/openclaw/voice/input', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voiceSessionId: activeVoiceSessionId,
          audioBase64: bytesToBase64(merged),
          mediaTimestampMs: Math.round(voiceInputTimestampRef.current),
        }),
      })
    } catch {
      setVoiceState('error')
      setVoiceDetail('OpenClaw voice portal lost the audio stream to the Gateway.')
    } finally {
      voiceUploadInFlightRef.current = false
    }
  }, [voiceSessionId])

  const startVoiceCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const audioContext = new AudioContext()
    await audioContext.resume()
    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const sink = audioContext.createGain()
    sink.gain.value = 0

    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      const encoded = encodeFloat32ToMuLaw(new Float32Array(input), audioContext.sampleRate, 8000)
      if (encoded.length > 0) {
        voiceChunkQueueRef.current.push(encoded)
      }
    }

    source.connect(processor)
    processor.connect(sink)
    sink.connect(audioContext.destination)

    voiceMediaStreamRef.current = stream
    voiceAudioContextRef.current = audioContext
    voiceInputSourceRef.current = source
    voiceInputProcessorRef.current = processor
    voiceInputSinkRef.current = sink
    voiceUploadTimerRef.current = setInterval(() => {
      void flushVoiceAudio()
    }, 160)
  }, [flushVoiceAudio])

  const focusPanelUi = useCallback(() => {
    const input = useInputManager.getState()
    if (input.pointerLocked) input.releasePointerLock()
    if (input.inputState === 'orbit' || input.inputState === 'noclip' || input.inputState === 'third-person') {
      input.enterUIFocus()
    }
  }, [])

  const updatePanelSettings = useCallback((next: PanelSettings) => {
    const normalized = normalizePanelSettings(next)
    setPanelSettings(normalized)
    saveStored(SETTINGS_KEY, normalized)
  }, [])

  const scrollTranscriptToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    autoScrollRef.current = true
    setShowJumpToLatest(false)
  }, [])

  const scrollVoiceTranscriptToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = voiceTranscriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    voiceAutoScrollRef.current = true
    setShowVoiceJumpToLatest(false)
  }, [])

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setCopiedKey(''), 1400)
  }, [])

  const persistMessages = useCallback((sessionId: string, nextMessages: OpenclawMessage[]) => {
    if (hostedMode || isLocalDraftSession(sessionId)) {
      void saveStoredTranscript(sessionId, nextMessages)
    }
    setMessages(nextMessages)
  }, [hostedMode])

  const syncSessionSummary = useCallback(async (sessionId: string, nextMessages: OpenclawMessage[], fallbackTitle?: string) => {
    const previous = sessions.find(entry => entry.id === sessionId)
    const latestText = [...nextMessages]
      .reverse()
      .find(entry => (entry.role === 'assistant' || entry.role === 'user') && entry.content.trim())
    const firstUser = nextMessages.find(entry => entry.role === 'user' && entry.content.trim())
    const title = previous?.title && previous.title !== 'New OpenClaw session'
      ? previous.title
      : summarizeText(firstUser?.content || fallbackTitle || 'OpenClaw session', 44) || 'OpenClaw session'
    const summary: OpenclawSessionSummary = {
      id: sessionId,
      title,
      preview: summarizeText(latestText?.content || ''),
      source: hostedMode ? 'draft' : nextMessages.length > 0 ? 'gateway' : previous?.source || 'draft',
      createdAt: previous?.createdAt || nextMessages[0]?.timestamp || Date.now(),
      updatedAt: nextMessages[nextMessages.length - 1]?.timestamp || Date.now(),
      messageCount: nextMessages.filter(entry => entry.role === 'user' || entry.role === 'assistant').length,
    }

    setSessions(current => [summary, ...current.filter(entry => entry.id !== summary.id)].sort((a, b) => b.updatedAt - a.updatedAt))
    if (hostedMode) return

    try {
      await fetch('/api/openclaw/sessions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(summary),
      })
    } catch {
      // Local session summary is already updated optimistically.
    }
  }, [hostedMode, sessions])

  const upsertSessionMessage = useCallback(async (sessionId: string, nextMessage: OpenclawMessage, fallbackTitle?: string) => {
    let nextMessages: OpenclawMessage[] = []
    setMessages(current => {
      const existingIndex = current.findIndex(entry => entry.id === nextMessage.id)
      if (existingIndex >= 0) {
        nextMessages = [...current]
        nextMessages[existingIndex] = {
          ...nextMessages[existingIndex],
          ...nextMessage,
        }
      } else {
        nextMessages = [...current, nextMessage].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
      }
      return nextMessages
    })

    if (!sessionId) return
    await saveStoredTranscript(sessionId, nextMessages)
    await syncSessionSummary(sessionId, nextMessages, fallbackTitle)
  }, [syncSessionSummary])

  const appendSessionMessageDelta = useCallback(async (sessionId: string, nextMessage: OpenclawMessage, fallbackTitle?: string) => {
    let nextMessages: OpenclawMessage[] = []
    setMessages(current => {
      const existingIndex = current.findIndex(entry => entry.id === nextMessage.id)
      if (existingIndex >= 0) {
        nextMessages = [...current]
        const existing = nextMessages[existingIndex]
        nextMessages[existingIndex] = {
          ...existing,
          ...nextMessage,
          content: mergeStreamingText(existing.content, nextMessage.content, nextMessage.state === 'done'),
        }
      } else {
        nextMessages = [...current, nextMessage].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
      }
      return nextMessages
    })

    if (!sessionId) return
    await saveStoredTranscript(sessionId, nextMessages)
    await syncSessionSummary(sessionId, nextMessages, fallbackTitle)
  }, [syncSessionSummary])

  const clearRelayChatPending = useCallback((sessionId: string, failed: boolean) => {
    const pending = relayChatPendingRef.current.get(sessionId)
    relayChatPendingRef.current.delete(sessionId)
    const timeout = relayChatTimeoutRef.current.get(sessionId)
    if (timeout) clearTimeout(timeout)
    relayChatTimeoutRef.current.delete(sessionId)
    if (!pending) return
    openclawActivityRunIdRef.current = null
    if (failed) {
      useOasisStore.getState().failAgentWork('openclaw', pending.activityRunId)
    } else {
      useOasisStore.getState().finishAgentWork('openclaw', pending.activityRunId)
    }
    setSending(false)
  }, [])

  const handleRelayChatDelta = useCallback((event: { sessionId: string; text: string }) => {
    const pending = relayChatPendingRef.current.get(event.sessionId)
    const assistantMessageId = pending?.assistantMessageId || `relay-assistant-${event.sessionId}`
    void appendSessionMessageDelta(event.sessionId, {
      id: assistantMessageId,
      role: 'assistant',
      content: event.text,
      timestamp: Date.now(),
      state: 'streaming',
    }, pending?.sessionTitle || 'OpenClaw session')
  }, [appendSessionMessageDelta])

  const handleRelayChatFinal = useCallback((event: { sessionId: string; text: string }) => {
    const pending = relayChatPendingRef.current.get(event.sessionId)
    const assistantMessageId = pending?.assistantMessageId || `relay-assistant-${event.sessionId}`
    void appendSessionMessageDelta(event.sessionId, {
      id: assistantMessageId,
      role: 'assistant',
      content: event.text,
      timestamp: Date.now(),
      state: 'done',
    }, pending?.sessionTitle || 'OpenClaw session').finally(() => {
      clearRelayChatPending(event.sessionId, false)
    })
  }, [appendSessionMessageDelta, clearRelayChatPending])

  const relayBridge = useOpenclawRelayBridge({
    enabled: ownRelayConnection && isVisible && relayEnabled && Boolean(activeWorldId),
    worldId: activeWorldId || '__active__',
    agentType: 'openclaw',
    availableTools: OPENCLAW_RELAY_TOOLS,
    onChatAgentDelta: handleRelayChatDelta,
    onChatAgentFinal: handleRelayChatFinal,
  })

  const upsertVoiceMessage = useCallback((nextMessage: OpenclawMessage) => {
    setVoiceMessages(current => {
      const existingIndex = current.findIndex(entry => entry.id === nextMessage.id)
      if (existingIndex < 0) return [...current, nextMessage].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
      const next = [...current]
      next[existingIndex] = {
        ...next[existingIndex],
        ...nextMessage,
        toolInput: next[existingIndex].toolInput ?? nextMessage.toolInput,
        toolOutput: nextMessage.toolOutput ?? next[existingIndex].toolOutput,
      }
      return next
    })
  }, [])

  const appendVoiceMessageDelta = useCallback((nextMessage: OpenclawMessage) => {
    setVoiceMessages(current => {
      const existingIndex = current.findIndex(entry => entry.id === nextMessage.id)
      if (existingIndex < 0) return [...current, nextMessage].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
      const next = [...current]
      const existing = next[existingIndex]
      next[existingIndex] = {
        ...existing,
        ...nextMessage,
        content: mergeStreamingText(existing.content, nextMessage.content, nextMessage.state === 'done'),
      }
      return next
    })
  }, [])

  const toggleToolExpanded = useCallback((messageId: string) => {
    setExpandedToolIds(current =>
      current.includes(messageId)
        ? current.filter(id => id !== messageId)
        : [...current, messageId],
    )
  }, [])

  const loadStatus = useCallback(async () => {
    if (hostedMode) {
      setStatus(DEFAULT_STATUS)
      setConfigDraft({
        gatewayUrl: DEFAULT_STATUS.gatewayUrl,
        controlUiUrl: DEFAULT_STATUS.controlUiUrl,
        browserControlUrl: DEFAULT_STATUS.browserControlUrl,
        sshHost: '',
        deviceToken: '',
      })
      setLoadingStatus(false)
      return
    }

    setLoadingStatus(true)
    try {
      const response = await fetch('/api/openclaw/status', { cache: 'no-store' })
      const next = await response.json() as OpenclawStatus
      setStatus(next)
      setConfigDraft({
        gatewayUrl: next.gatewayUrl,
        controlUiUrl: next.controlUiUrl,
        browserControlUrl: next.browserControlUrl,
        sshHost: next.sshHost,
        deviceToken: '',
      })
    } catch {
      // Keep last known state.
    } finally {
      setLoadingStatus(false)
    }
  }, [hostedMode])

  const loadProfileName = useCallback(async () => {
    try {
      const response = await fetch('/api/profile', { cache: 'no-store' })
      const payload = await response.json() as ProfileResponse
      if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
        setProfileName(payload.displayName.trim())
      }
    } catch {
      // Keep fallback label.
    }
  }, [])

  const loadMcpInfo = useCallback(async () => {
    if (hostedMode) {
      setMcpInfo(null)
      setLoadingMcp(false)
      return
    }

    setLoadingMcp(true)
    try {
      const response = await fetch('/api/openclaw/mcp', { cache: 'no-store' })
      const next = await response.json() as OpenclawMcpInfo
      setMcpInfo(next)
    } catch {
      // Keep last known info.
    } finally {
      setLoadingMcp(false)
    }
  }, [hostedMode])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      if (hostedMode) {
        const remembered = typeof window === 'undefined' ? '' : window.localStorage.getItem(SESSION_KEY) || ''
        if (!remembered) {
          setSessions([])
          setSelectedSessionId('')
          return
        }
        const storedMessages = await loadStoredTranscript(remembered)
        const latestText = [...storedMessages]
          .reverse()
          .find(entry => (entry.role === 'assistant' || entry.role === 'user') && entry.content.trim())
        const firstUser = storedMessages.find(entry => entry.role === 'user' && entry.content.trim())
        const summary: OpenclawSessionSummary = {
          id: remembered,
          title: summarizeText(firstUser?.content || 'OpenClaw session', 44) || 'OpenClaw session',
          preview: summarizeText(latestText?.content || ''),
          source: 'draft',
          createdAt: storedMessages[0]?.timestamp || Date.now(),
          updatedAt: storedMessages[storedMessages.length - 1]?.timestamp || Date.now(),
          messageCount: storedMessages.filter(entry => entry.role === 'user' || entry.role === 'assistant').length,
        }
        setSessions([summary])
        setSelectedSessionId(remembered)
        return
      }

      const response = await fetch('/api/openclaw/sessions', { cache: 'no-store' })
      const payload = await response.json() as { sessions?: OpenclawSessionSummary[] }
      const nextSessions = dedupeOpenclawSessions(Array.isArray(payload.sessions) ? payload.sessions : [])
      setSessions(nextSessions)

      const remembered = typeof window === 'undefined' ? '' : window.localStorage.getItem(SESSION_KEY) || ''
      if (nextSessions.length === 0) {
        setSelectedSessionId('')
        return
      }

      const preferred = remembered || status.lastSessionId || status.defaultSessionId
      const fallbackId = nextSessions[0]?.id || ''
      const nextSelected = nextSessions.some(entry => entry.id === selectedSessionId)
        ? selectedSessionId
        : (preferred && nextSessions.some(entry => entry.id === preferred) ? preferred : fallbackId)

      setSelectedSessionId(nextSelected)
      saveStoredString(SESSION_KEY, nextSelected)
    } catch {
      // Keep last known list.
    } finally {
      setLoadingSessions(false)
    }
  }, [hostedMode, selectedSessionId, status.defaultSessionId, status.lastSessionId])

  const loadMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setMessages([])
      setExpandedToolIds([])
      return
    }

    setLoadingMessages(true)
    try {
      if (hostedMode) {
        setMessages(await loadStoredTranscript(sessionId))
        setExpandedToolIds([])
        return
      }

      const response = await fetch(`/api/openclaw/sessions?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`OpenClaw session load failed (${response.status}).`)
      }
      const payload = await response.json() as {
        session?: OpenclawSessionSummary | null
        messages?: OpenclawMessage[]
      }
      const nextMessages = Array.isArray(payload.messages) ? payload.messages : []
      if (payload.session) {
        setSessions(current => {
          const next = [payload.session!, ...current.filter(entry => entry.id !== payload.session!.id)]
          return next.sort((a, b) => b.updatedAt - a.updatedAt)
        })
      }
      if (nextMessages.length > 0) {
        if (!isLocalDraftSession(sessionId)) {
          try {
            window.localStorage.removeItem(transcriptStorageKey(sessionId))
          } catch {
            // Ignore cleanup failures.
          }
        } else {
          void saveStoredTranscript(sessionId, nextMessages)
        }
      }
      setMessages(nextMessages)
      setExpandedToolIds([])
    } catch {
      if (isLocalDraftSession(sessionId)) {
        setMessages(await loadStoredTranscript(sessionId))
      } else {
        setMessages([])
      }
      setExpandedToolIds([])
    } finally {
      setLoadingMessages(false)
    }
  }, [hostedMode])

  useEffect(() => {
    if (!isVisible) return

    void migrateLegacyTranscriptStorage()
    void loadStatus()
    void loadSessions()
    void loadMcpInfo()
    void loadProfileName()

    const interval = window.setInterval(() => {
      void loadStatus()
    }, 30000)

    return () => {
      window.clearInterval(interval)
    }
  }, [isVisible, loadMcpInfo, loadProfileName, loadSessions, loadStatus])

  useEffect(() => {
    if (!isVisible) return
    if (sending) return
    if (!selectedSessionId) {
      setMessages([])
      return
    }
    saveStoredString(SESSION_KEY, selectedSessionId)
    void loadMessages(selectedSessionId)
  }, [isVisible, loadMessages, selectedSessionId])

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollTranscriptToBottom()
    }
  }, [messages, scrollTranscriptToBottom])

  useEffect(() => {
    scrollTranscriptToBottom()
  }, [selectedSessionId, scrollTranscriptToBottom])

  useEffect(() => {
    if (activeTab !== 'voice') return
    if (voiceAutoScrollRef.current) {
      scrollVoiceTranscriptToBottom()
    }
  }, [activeTab, scrollVoiceTranscriptToBottom, voiceMessages])

  useEffect(() => {
    if (activeTab === 'voice') {
      scrollVoiceTranscriptToBottom()
    }
  }, [activeTab, scrollVoiceTranscriptToBottom])

  useEffect(() => {
    const audio = voiceAudioRef.current
    if (!audio) return

    const handleEnded = () => {
      deactivateVoiceLipSync()
    }

    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('pause', handleEnded)
    return () => {
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('pause', handleEnded)
    }
  }, [deactivateVoiceLipSync])

  const stopOpenclawVoice = useCallback(async (opts?: { remote?: boolean; nextDetail?: string }) => {
    const remote = opts?.remote ?? true
    const nextDetail = opts?.nextDetail ?? 'OpenClaw voice portal sleeps until you wake it.'
    const activeVoiceSessionId = voiceSessionIdRef.current || voiceSessionId

    voiceEventSourceRef.current?.close()
    voiceEventSourceRef.current = null
    stopVoiceCapture()
    stopVoicePlayback()
    deactivateVoiceLipSync()

    if (voiceAudioRef.current) {
      try {
        voiceAudioRef.current.pause()
      } catch {
        // ignore
      }
      voiceAudioRef.current.removeAttribute('src')
      voiceAudioRef.current.load()
    }
    if (voiceOutputGainRef.current) {
      try {
        voiceOutputGainRef.current.disconnect()
      } catch {
        // ignore
      }
      voiceOutputGainRef.current = null
    }
    if (voiceOutputSourceRef.current) {
      try {
        voiceOutputSourceRef.current.disconnect()
      } catch {
        // ignore
      }
      voiceOutputSourceRef.current = null
    }
    if (voiceOutputAudioContextRef.current) {
      void voiceOutputAudioContextRef.current.close().catch(() => {})
      voiceOutputAudioContextRef.current = null
    }

    if (remote && activeVoiceSessionId) {
      try {
        await fetch('/api/openclaw/voice/stop', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voiceSessionId: activeVoiceSessionId }),
        })
      } catch {
        // Ignore stop failures; local teardown already happened.
      }
    }

    voiceLiveUserMessageIdRef.current = ''
    voiceLiveAssistantMessageIdRef.current = ''
    voiceSessionIdRef.current = ''
    setVoiceSessionId('')
    setVoiceState('idle')
    setVoiceDetail(nextDetail)
  }, [deactivateVoiceLipSync, stopVoiceCapture, stopVoicePlayback, voiceSessionId])

  useEffect(() => {
    stopOpenclawVoiceRef.current = stopOpenclawVoice
  }, [stopOpenclawVoice])

  useEffect(() => () => {
    void stopOpenclawVoiceRef.current({ remote: true })
  }, [])

  const handleVoiceEvent = useCallback((payload: Record<string, unknown>) => {
    const type = stringField(payload, 'type')
    const timestamp = numberField(payload, 'timestamp') || Date.now()

    if (type === 'ready') {
      setVoiceState('live')
      setVoiceDetail('OpenClaw voice line is live. Start speaking when you are ready.')
      return
    }

    if (type === 'speech.start') {
      setVoiceState('live')
      setVoiceDetail('OpenClaw is listening...')
      return
    }

    if (type === 'user.partial') {
      const text = stringField(payload, 'text')
      if (!text) return
      const messageId = voiceLiveUserMessageIdRef.current || makeId('openclaw-voice-user')
      voiceLiveUserMessageIdRef.current = messageId
      appendVoiceMessageDelta({
        id: messageId,
        role: 'user',
        content: text,
        timestamp,
        state: 'streaming',
      })
      return
    }

    if (type === 'user.final') {
      const text = stringField(payload, 'text')
      if (!text) return
      const messageId = voiceLiveUserMessageIdRef.current || makeId('openclaw-voice-user')
      voiceLiveUserMessageIdRef.current = ''
      appendVoiceMessageDelta({
        id: messageId,
        role: 'user',
        content: text,
        timestamp,
        state: 'done',
      })
      setVoiceState('thinking')
      setVoiceDetail('OpenClaw heard you. The lobster is thinking...')
      return
    }

    if (type === 'assistant.partial') {
      const text = stringField(payload, 'text')
      if (!text) return
      const messageId = voiceLiveAssistantMessageIdRef.current || makeId('openclaw-voice-assistant')
      voiceLiveAssistantMessageIdRef.current = messageId
      appendVoiceMessageDelta({
        id: messageId,
        role: 'assistant',
        content: text,
        timestamp,
        state: 'streaming',
      })
      setVoiceState('thinking')
      setVoiceDetail('OpenClaw is shaping the next reply...')
      return
    }

    if (type === 'assistant.final') {
      const text = stringField(payload, 'text')
      if (!text) return
      const messageId = voiceLiveAssistantMessageIdRef.current || makeId('openclaw-voice-assistant')
      voiceLiveAssistantMessageIdRef.current = ''
      appendVoiceMessageDelta({
        id: messageId,
        role: 'assistant',
        content: text,
        timestamp,
        state: 'done',
      })
      setVoiceState('live')
      setVoiceDetail('OpenClaw voice line is live. Start speaking when you are ready.')
      return
    }

    if (type === 'assistant.audio.chunk') {
      const audioBase64 = stringField(payload, 'audioBase64')
      setVoiceState('live')
      setVoiceDetail('OpenClaw is speaking through the Oasis body.')
      if (audioBase64) {
        void queueVoiceAudioChunk(audioBase64)
      }
      return
    }

    if (type === 'assistant.clear') {
      stopVoicePlayback()
      setVoiceState('live')
      setVoiceDetail('OpenClaw heard you cut in. Clearing the tail of the previous reply...')
      return
    }

    if (type === 'assistant.mark') {
      const markName = stringField(payload, 'markName')
      if (markName) {
        scheduleVoiceMarkAck(markName)
      }
      return
    }

    if (type === 'tool.start' || type === 'tool.done' || type === 'tool.error') {
      const toolId = stringField(payload, 'callId', 'id') || makeId('openclaw-voice-tool')
      const toolName = stringField(payload, 'toolName', 'name') || 'tool'
      const toolInput = payload.args ?? payload.input ?? {}
      const summaryValue = stringField(payload, 'argsSummary') || toolInput
      const toolState: OpenclawMessage['toolState'] = type === 'tool.start'
        ? 'running'
        : type === 'tool.done'
          ? 'done'
          : 'failed'
      upsertVoiceMessage({
        id: toolId,
        role: 'tool',
        content: '',
        timestamp,
        toolName,
        toolInput,
        toolOutput: payload.result ?? payload.output ?? null,
        toolState,
        toolDurationMs: numberField(payload, 'durationMs'),
        toolInputSummary: summarizeToolInput(toolName, summaryValue),
      })
      return
    }

    if (type === 'error') {
      const message = stringField(payload, 'message') || 'OpenClaw voice portal hit an error.'
      setVoiceState('error')
      setVoiceDetail(message)
      upsertVoiceMessage({
        id: makeId('openclaw-voice-error'),
        role: 'system',
        content: message,
        timestamp,
        state: 'failed',
      })
      return
    }

      if (type === 'closed') {
        void stopOpenclawVoice({
          remote: false,
          nextDetail: 'OpenClaw voice portal sleeps until you wake it.',
        })
      }
  }, [appendVoiceMessageDelta, queueVoiceAudioChunk, scheduleVoiceMarkAck, stopOpenclawVoice, stopVoicePlayback, upsertVoiceMessage])

  const handleVoiceToggle = useCallback(async () => {
    if (voiceState === 'connecting' || voiceState === 'live' || voiceState === 'thinking') {
      await stopOpenclawVoice()
      return
    }

    const sessionKey = resolveVoiceSessionKey()
    if (!sessionKey) {
      setVoiceState('error')
      setVoiceDetail('Pick an OpenClaw session before opening the voice portal.')
      return
    }

    setVoiceState('connecting')
    setVoiceDetail('Opening the OpenClaw voice portal...')

    try {
      const startResponse = await fetch('/api/openclaw/voice/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey,
          model: panelSettings.voiceModel,
          voice: panelSettings.voiceName,
          worldId: activeWorldId,
          playerName: profileName,
          vadThreshold: panelSettings.vadThreshold,
          silenceDurationMs: panelSettings.silenceDurationMs,
          prefixPaddingMs: panelSettings.prefixPaddingMs,
        }),
      })
      const startPayload = await startResponse.json() as Record<string, unknown>
      if (!startResponse.ok) {
        throw new Error(stringField(startPayload, 'error') || `Voice start failed (${startResponse.status}).`)
      }

      const nextVoiceSessionId = stringField(startPayload, 'voiceSessionId')
      if (!nextVoiceSessionId) {
        throw new Error('OpenClaw did not return a voiceSessionId.')
      }

      if (selectedSessionId !== sessionKey) {
        setSelectedSessionId(sessionKey)
        saveStoredString(SESSION_KEY, sessionKey)
      }

      const stream = new EventSource(`/api/openclaw/voice/stream?voiceSessionId=${encodeURIComponent(nextVoiceSessionId)}`)
      voiceEventSourceRef.current = stream
      stream.addEventListener('voice', event => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>
          handleVoiceEvent(payload)
        } catch {
          // ignore malformed events
        }
      })
      stream.addEventListener('closed', () => {
        void stopOpenclawVoice({
          remote: false,
          nextDetail: 'OpenClaw voice portal sleeps until you wake it.',
        })
      })
      stream.onerror = () => {
        setVoiceState('error')
        setVoiceDetail('The OpenClaw voice stream lost contact with the Gateway.')
      }

      voiceSessionIdRef.current = nextVoiceSessionId
      setVoiceSessionId(nextVoiceSessionId)
      await ensureVoiceOutputContext()
      await startVoiceCapture()
      setVoiceState('live')
      setVoiceDetail('OpenClaw voice line is live. Start speaking when you are ready.')
    } catch (error) {
      await stopOpenclawVoice({
        remote: true,
        nextDetail: error instanceof Error ? error.message : 'Could not open the OpenClaw voice portal.',
      })
      setVoiceState('error')
    }
  }, [activeWorldId, ensureVoiceOutputContext, handleVoiceEvent, panelSettings.prefixPaddingMs, panelSettings.silenceDurationMs, panelSettings.vadThreshold, panelSettings.voiceModel, panelSettings.voiceName, profileName, resolveVoiceSessionKey, selectedSessionId, startVoiceCapture, stopOpenclawVoice, voiceState])

  const handleCreateSession = useCallback(async () => {
    if (hostedMode) {
      const session = createClientDraftSessionSummary()
      setSessions(current => [session, ...current.filter(entry => entry.id !== session.id)])
      setSelectedSessionId(session.id)
      saveStoredString(SESSION_KEY, session.id)
      await saveStoredTranscript(session.id, [])
      setMessages([])
      setExpandedToolIds([])
      return
    }

    try {
      const response = await fetch('/api/openclaw/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New OpenClaw session' }),
      })
      const payload = await response.json() as { session?: OpenclawSessionSummary }
      if (!payload.session) return
      setSessions(current => [payload.session!, ...current.filter(entry => entry.id !== payload.session!.id)])
      setSelectedSessionId(payload.session.id)
      saveStoredString(SESSION_KEY, payload.session.id)
      setMessages([])
      setExpandedToolIds([])
    } catch {
      // Session creation is best effort for now.
    }
  }, [hostedMode])

  const handleSend = useCallback(async () => {
    const message = composer.trim()
    if (!message || sending) return

    setSending(true)
    setComposer('')
    const activityRunId = makeId('openclaw-work')
    openclawActivityRunIdRef.current = activityRunId
    useOasisStore.getState().startAgentWork('openclaw', activityRunId, selectedSessionId || undefined)
    const finishActivity = () => {
      if (openclawActivityRunIdRef.current !== activityRunId) return
      openclawActivityRunIdRef.current = null
      useOasisStore.getState().finishAgentWork('openclaw', activityRunId)
    }
    const failActivity = () => {
      if (openclawActivityRunIdRef.current !== activityRunId) return
      openclawActivityRunIdRef.current = null
      useOasisStore.getState().failAgentWork('openclaw', activityRunId)
    }

    let sessionId = selectedSessionId
    let sessionTitle = currentSession?.title || 'OpenClaw session'
    let keepSendingForRelay = false
    try {
      if (!sessionId) {
        if (hostedMode) {
          const session = createClientDraftSessionSummary()
          sessionId = session.id
          sessionTitle = session.title
          setSessions(current => [session, ...current.filter(entry => entry.id !== session.id)])
          setSelectedSessionId(sessionId)
          saveStoredString(SESSION_KEY, sessionId)
          await saveStoredTranscript(sessionId, [])
        } else {
        const createResponse = await fetch('/api/openclaw/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'New OpenClaw session' }),
        })
        const createPayload = await createResponse.json() as { session?: OpenclawSessionSummary }
        if (!createPayload.session) {
          throw new Error('Could not create an OpenClaw session.')
        }
        sessionId = createPayload.session.id
        sessionTitle = createPayload.session.title
        setSessions(current => [createPayload.session!, ...current.filter(entry => entry.id !== createPayload.session!.id)])
        setSelectedSessionId(sessionId)
        saveStoredString(SESSION_KEY, sessionId)
        }
      }

      const userMessage: OpenclawMessage = {
        id: makeId('openclaw-user'),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        state: 'done',
      }
      const assistantMessageId = makeId('openclaw-assistant')
      let workingMessages = [
        ...(
          selectedSessionId === sessionId
            ? messages
            : (isLocalDraftSession(sessionId) ? await loadStoredTranscript(sessionId) : [])
        ),
        userMessage,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          state: 'streaming',
        } satisfies OpenclawMessage,
      ].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)

      persistMessages(sessionId, workingMessages)
      await syncSessionSummary(sessionId, workingMessages, sessionTitle)

      if (hostedMode) {
        if (relayBridge.status !== 'paired') {
          const failedMessages = workingMessages.map(entry =>
            entry.id === assistantMessageId
              ? {
                  ...entry,
                  content: 'Pair an OpenClaw bridge from Config first, then send from this Stream tab.',
                  state: 'failed' as const,
                  timestamp: Date.now(),
                }
              : entry,
          )
          persistMessages(sessionId, failedMessages)
          await syncSessionSummary(sessionId, failedMessages, sessionTitle)
          failActivity()
          return
        }

        relayChatPendingRef.current.set(sessionId, {
          assistantMessageId,
          activityRunId,
          sessionTitle,
        })
        const timeout = setTimeout(() => {
          void appendSessionMessageDelta(sessionId, {
            id: assistantMessageId,
            role: 'assistant',
            content: 'Timed out waiting for the OpenClaw bridge to answer.',
            timestamp: Date.now(),
            state: 'failed',
          }, sessionTitle).finally(() => {
            clearRelayChatPending(sessionId, true)
          })
        }, 120_000)
        relayChatTimeoutRef.current.set(sessionId, timeout)

        if (!relayBridge.sendChatUser(sessionId, message)) {
          clearRelayChatPending(sessionId, true)
          const failedMessages = workingMessages.map(entry =>
            entry.id === assistantMessageId
              ? {
                  ...entry,
                  content: 'Relay is not ready. Re-pair the OpenClaw bridge and try again.',
                  state: 'failed' as const,
                  timestamp: Date.now(),
                }
              : entry,
          )
          persistMessages(sessionId, failedMessages)
          await syncSessionSummary(sessionId, failedMessages, sessionTitle)
          return
        }

        keepSendingForRelay = true
        return
      }

      const response = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: sessionId,
          message,
        }),
      })

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({})) as Record<string, unknown>
        const detail = stringField(errorPayload, 'error', 'detail') || `OpenClaw chat failed (${response.status}).`
        const failedMessages = workingMessages.map(entry =>
          entry.id === assistantMessageId
            ? { ...entry, content: detail, state: 'failed' as const, timestamp: Date.now() }
            : entry,
        )
        persistMessages(sessionId, failedMessages)
        await syncSessionSummary(sessionId, failedMessages, sessionTitle)
        await loadStatus()
        failActivity()
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('OpenClaw stream missing response body.')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let currentData = ''

      const updateAssistant = async (content: string, state: OpenclawMessage['state']) => {
        const currentContent = workingMessages.find(entry => entry.id === assistantMessageId)?.content || ''
        workingMessages = workingMessages.map(entry =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                content: state === 'failed'
                  ? (content || currentContent)
                  : mergeStreamingText(currentContent, content, state === 'done'),
                state,
                timestamp: Date.now(),
              }
            : entry,
        )
        persistMessages(sessionId, workingMessages)
        await syncSessionSummary(sessionId, workingMessages, sessionTitle)
      }

      const upsertToolTrace = async (payload: unknown) => {
        const record = asRecord(payload)
        const data = asRecord(record.data)
        const source = Object.keys(data).length > 0 ? data : record
        const toolName = stringField(source, 'toolName', 'name', 'tool', 'kind') || stringField(record, 'toolName', 'name', 'tool', 'kind') || 'tool'
        const toolInput = source.input ?? source.args ?? source.params ?? source.request ?? {}
        const toolOutput = source.output ?? source.result ?? source.response ?? source.error ?? null
        const toolInputSummaryValue = stringField(source, 'argsSummary') || stringField(record, 'argsSummary') || toolInput
        const phase = stringField(source, 'state', 'phase', 'status') || stringField(record, 'state', 'phase', 'status')
        const failed = /error|fail/i.test(phase) || Boolean(source.error ?? record.error)
        const done = /done|end|final|result|ok|success|complete/i.test(phase)
        const toolState: OpenclawMessage['toolState'] = failed ? 'failed' : done ? 'done' : 'running'
        useOasisStore.getState().setAgentWorkTool('openclaw', activityRunId, toolState === 'running' ? toolName : null)
        const toolId = stringField(source, 'toolUseId', 'callId', 'toolCallId', 'id') || stringField(record, 'toolUseId', 'callId', 'toolCallId', 'id') || makeId(`tool-${toolName}`)
        const existingIndex = workingMessages.findIndex(entry => entry.id === toolId)
        const nextToolMessage: OpenclawMessage = {
          id: toolId,
          role: 'tool',
          content: '',
          timestamp: Date.now(),
          toolName,
          toolInput,
          toolOutput,
          toolState,
          ...(numberField(source, 'durationMs', 'elapsedMs') || numberField(record, 'durationMs', 'elapsedMs') ? { toolDurationMs: numberField(source, 'durationMs', 'elapsedMs') || numberField(record, 'durationMs', 'elapsedMs') } : {}),
          toolInputSummary: summarizeToolInput(toolName, toolInputSummaryValue),
        }

        if (existingIndex >= 0) {
          const next = [...workingMessages]
          next[existingIndex] = {
            ...next[existingIndex],
            ...nextToolMessage,
            toolInput: next[existingIndex].toolInput ?? nextToolMessage.toolInput,
            toolOutput: nextToolMessage.toolOutput ?? next[existingIndex].toolOutput,
          }
          workingMessages = next
        } else {
          workingMessages = [...workingMessages, nextToolMessage].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
        }

        persistMessages(sessionId, workingMessages)
        await syncSessionSummary(sessionId, workingMessages, sessionTitle)
      }

      const flushEvent = async () => {
        if (!currentEvent) return
        let payload: unknown = currentData
        try {
          payload = currentData ? JSON.parse(currentData) as unknown : {}
        } catch {
          payload = { raw: currentData }
        }

        if (currentEvent === 'chat') {
          const record = asRecord(payload)
          const canonicalSessionKey = stringField(record, 'sessionKey', 'sessionId')
          if (canonicalSessionKey && canonicalSessionKey !== sessionId) {
            const previousSessionId = sessionId
            sessionId = canonicalSessionKey
            setSelectedSessionId(canonicalSessionKey)
            saveStoredString(SESSION_KEY, canonicalSessionKey)
            setSessions(current => current.map(entry => {
              if (entry.id === previousSessionId) {
                return {
                  ...entry,
                  id: canonicalSessionKey,
                  source: 'gateway' as const,
                }
              }
              return entry
            }).filter((entry, index, array) => array.findIndex(candidate => candidate.id === entry.id) === index))
          }
          const nextContent = extractGatewayChatText(record)
          const streamState = stringField(record, 'state')
          if (nextContent || streamState === 'final' || streamState === 'aborted' || streamState === 'error') {
            await updateAssistant(
              nextContent || workingMessages.find(entry => entry.id === assistantMessageId)?.content || '',
              streamState === 'error'
                ? 'failed'
                : streamState === 'final'
                  ? 'done'
                  : streamState === 'aborted'
                    ? 'failed'
                    : 'streaming',
            )
            if (streamState === 'error' || streamState === 'aborted') failActivity()
          }
        } else if (currentEvent === 'session.tool') {
          await upsertToolTrace(payload)
        } else if (currentEvent === 'error') {
          const record = asRecord(payload)
          await updateAssistant(stringField(record, 'message', 'error') || 'OpenClaw stream failed.', 'failed')
          failActivity()
        } else if (currentEvent === 'closed') {
          const record = asRecord(payload)
          const reason = stringField(record, 'reason')
          if (reason && reason !== 'final') {
            const currentContent = workingMessages.find(entry => entry.id === assistantMessageId)?.content || ''
            await updateAssistant(currentContent || `OpenClaw stream closed (${reason}).`, reason === 'error' ? 'failed' : 'done')
            if (reason === 'error') failActivity()
          }
        }

        currentEvent = ''
        currentData = ''
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const lines = chunk.split('\n')
          currentEvent = ''
          currentData = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              currentData += line.slice(5).trim()
            }
          }
          await flushEvent()
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n')
        currentEvent = ''
        currentData = ''
        for (const line of lines) {
          if (line.startsWith('event:')) currentEvent = line.slice(6).trim()
          else if (line.startsWith('data:')) currentData += line.slice(5).trim()
        }
        await flushEvent()
      }

      workingMessages = workingMessages.map(entry =>
        entry.id === assistantMessageId && entry.state === 'streaming'
          ? { ...entry, state: 'done' as const }
          : entry,
      )
      persistMessages(sessionId, workingMessages)
      await syncSessionSummary(sessionId, workingMessages, sessionTitle)
      await Promise.all([
        loadStatus(),
        loadSessions(),
      ])
      finishActivity()
    } catch (error) {
      failActivity()
      const detail = error instanceof Error ? error.message : 'OpenClaw chat failed.'
      if (sessionId) {
        const fallbackMessages = [
          ...(
            selectedSessionId === sessionId
              ? messages
              : (isLocalDraftSession(sessionId) ? await loadStoredTranscript(sessionId) : [])
          ),
          {
            id: makeId('openclaw-system'),
            role: 'system',
            content: detail,
            timestamp: Date.now(),
            state: 'failed',
          } satisfies OpenclawMessage,
        ].slice(-MAX_LOCAL_TRANSCRIPT_MESSAGES)
        persistMessages(sessionId, fallbackMessages)
        await syncSessionSummary(sessionId, fallbackMessages, sessionTitle)
      }
      await Promise.all([
        loadStatus(),
        loadSessions(),
      ])
    } finally {
      if (!keepSendingForRelay) setSending(false)
    }
  }, [appendSessionMessageDelta, clearRelayChatPending, composer, currentSession?.title, hostedMode, loadSessions, loadStatus, messages, persistMessages, relayBridge, selectedSessionId, sending, syncSessionSummary])

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true)
    const normalizedDraft = {
      ...configDraft,
      sshHost: sanitizeOpenclawSshHost(configDraft.sshHost).value,
    }
    try {
      await fetch('/api/openclaw/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(normalizedDraft),
      })
      setConfigDraft(current => ({ ...current, sshHost: normalizedDraft.sshHost }))
      await loadStatus()
    } finally {
      setSavingConfig(false)
    }
  }, [configDraft, loadStatus])

  const handleResetConfig = useCallback(async () => {
    setSavingConfig(true)
    try {
      await fetch('/api/openclaw/config', { method: 'DELETE' })
      await loadStatus()
    } finally {
      setSavingConfig(false)
    }
  }, [loadStatus])

  const handleInstallMcp = useCallback(async () => {
    setInstallingMcp(true)
    try {
      await fetch('/api/openclaw/mcp', {
        method: 'POST',
      })
      await Promise.all([loadMcpInfo(), loadStatus()])
    } finally {
      setInstallingMcp(false)
    }
  }, [loadMcpInfo, loadStatus])

  const handleRequestRelayPairing = useCallback(async () => {
    if (!activeWorldId) {
      setRelayPairingError('active world is required')
      return
    }

    setRelayPairingBusy(true)
    setRelayPairingError('')
    try {
      const sessionResponse = await fetch('/api/session/init', { credentials: 'same-origin' })
      if (!sessionResponse.ok) {
        throw new Error(`session init failed: HTTP ${sessionResponse.status}`)
      }

      const response = await fetch('/api/relay/pairings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worldId: activeWorldId,
          scopes: OPENCLAW_RELAY_SCOPES,
        }),
      })
      const json = await response.json().catch(() => null) as
        | { ok: true; code: string; expiresAt: number; worldId: string; scopes: string[] }
        | { ok: false; error: { code: string; message: string } }
        | null
      if (!json) throw new Error(`pairing failed: HTTP ${response.status}`)
      if (!json.ok) throw new Error(`${json.error.code}: ${json.error.message}`)

      setRelayPairing({
        code: json.code,
        expiresAt: json.expiresAt,
        worldId: json.worldId,
        scopes: json.scopes,
      })
      setRelayEnabled(true)
    } catch (error) {
      setRelayPairingError(error instanceof Error ? error.message : String(error))
      setRelayPairing(null)
    } finally {
      setRelayPairingBusy(false)
    }
  }, [activeWorldId])

  const handleRunSmoke = useCallback(async (mode: SmokeMode) => {
    setRunningSmokeMode(mode)
    try {
      const response = await fetch('/api/openclaw/smoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          ...(activeWorldId ? { worldId: activeWorldId } : {}),
        }),
      })
      const report = await response.json() as OpenclawSmokeReport
      setSmokeReport(report)
      await loadStatus()
    } catch {
      setSmokeReport(null)
    } finally {
      setRunningSmokeMode('')
    }
  }, [activeWorldId, loadStatus])

  const handleDragStart = useCallback((event: ReactMouseEvent) => {
    if (embedded) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, a, [data-no-drag]')) return

    event.preventDefault()
    setIsDragging(true)
    dragStart.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    }
  }, [embedded, position.x, position.y])

  const handleDrag = useCallback((event: MouseEvent) => {
    if (embedded || !isDragging) return
    const next = {
      x: Math.max(-8, event.clientX - dragStart.current.x),
      y: Math.max(-8, event.clientY - dragStart.current.y),
    }
    setPosition(next)
    saveStored(POS_KEY, next)
  }, [embedded, isDragging])

  const handleResizeStart = useCallback((event: ReactMouseEvent) => {
    if (embedded) return
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    resizeStart.current = {
      x: event.clientX,
      y: event.clientY,
      w: size.w,
      h: size.h,
    }
  }, [embedded, size.h, size.w])

  const handleResize = useCallback((event: MouseEvent) => {
    if (embedded || !isResizing) return
    const next = {
      w: Math.max(MIN_WIDTH, resizeStart.current.w + (event.clientX - resizeStart.current.x)),
      h: Math.max(MIN_HEIGHT, resizeStart.current.h + (event.clientY - resizeStart.current.y)),
    }
    setSize(next)
    saveStored(SIZE_KEY, next)
  }, [embedded, isResizing])

  useEffect(() => {
    if (embedded) return
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', () => setIsDragging(false), { once: true })
    }
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', () => setIsResizing(false), { once: true })
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mousemove', handleResize)
    }
  }, [embedded, handleDrag, handleResize, isDragging, isResizing])

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [])

  if (!isVisible || typeof document === 'undefined') return null

  const rgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(part => parseInt(part, 16)) || [6, 22, 29]
  const backgroundStyle = panelSettings.blur > 0
    ? {
        backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})`,
        backdropFilter: `blur(${panelSettings.blur}px)`,
      }
    : {
        backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})`,
      }

  const gatewayClientState = status.gatewayClient?.state || 'idle'
  const gatewayTone = probeTone(status.gateway)
  const controlTone = probeTone(status.controlUi)
  const browserTone = probeTone(status.browserControl)
  const talkSurfaceLabel = status.recommendedTalkSurface === 'control-ui'
    ? 'Control UI on 18789'
    : 'Telegram or OpenClaw CLI'
  const gatewayClientTone = gatewayClientState === 'ready'
    ? 'online'
    : gatewayClientState === 'pairing-required'
      ? 'warn'
      : gatewayClientState === 'error' || gatewayClientState === 'closed'
        ? 'offline'
        : 'warn'
  const chatReady = hostedMode ? relayBridge.status === 'paired' : gatewayClientState === 'ready'
  const transportLine = hostedMode
    ? (relayBridge.status === 'paired'
        ? 'Relay paired to the OpenClaw bridge.'
        : 'Pair an OpenClaw bridge from Config before chatting.')
    : chatReady
      ? 'Ready'
      : gatewayClientState === 'pairing-required'
        ? 'Approve the pending device on the OpenClaw host.'
        : 'Connecting to the OpenClaw Gateway.'
  const editedSshHost = configDraft.sshHost.trim()
  const rawRemoteHost = editedSshHost || status.sshHost.trim()
  const sshHostValidation = sanitizeOpenclawSshHost(rawRemoteHost)
  const draftSshHostValidation = sanitizeOpenclawSshHost(editedSshHost)
  const sshHostIssue = editedSshHost && !draftSshHostValidation.valid
    ? describeOpenclawSshHostIssue(draftSshHostValidation.reason)
    : ''
  const remoteHost = sshHostValidation.value
  const remoteMode = Boolean(remoteHost)
  const sshBridgeCommand = buildOpenclawSshBridgeCommand(remoteHost)
  const sshBridgeTone = remoteMode ? (status.gateway.reachable ? 'online' : 'warn') : 'online'
  const sshBridgeLabel = remoteMode
    ? (status.gateway.reachable ? 'ssh tunnel seen' : 'ssh tunnel needed')
    : 'local mode'
  const mcpTone = status.mcpInstalled ? 'online' : 'warn'
  const gatewayBadgeLabel = chatReady
    ? 'gateway ready'
    : gatewayClientState === 'pairing-required'
      ? 'gateway pairing'
      : `gateway ${gatewayClientState}`
  const showPairingHelp = gatewayClientState === 'pairing-required' || status.pendingDeviceCount > 0
  const relayTone = hostedMode && !ownRelayConnection
    ? 'warn'
    : !relayEnabled
    ? 'offline'
    : relayBridge.status === 'paired'
      ? 'online'
      : relayBridge.status === 'error' || relayBridge.status === 'closed'
        ? 'offline'
        : 'warn'
  const relayBadgeLabel = hostedMode && !ownRelayConnection
    ? 'relay delegated'
    : relayEnabled ? `relay ${relayBridge.status}` : 'relay off'
  const relayPairingCommand = buildOpenclawRelayPairingCommand(relayPairing, browserOrigin)
  const relayPairingExpiresInS = relayPairing
    ? Math.max(0, Math.round((relayPairing.expiresAt - Date.now()) / 1000))
    : 0
  const visibleTabs: readonly OpenclawPanelTab[] = hostedMode
    ? ['stream', 'config', 'settings', 'diagnostics']
    : ['stream', 'voice', 'config', 'settings', 'diagnostics']

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'openclaw-panel'}
      data-ui-panel
      className={`${embedded ? 'relative h-full w-full' : 'fixed'} flex flex-col overflow-hidden rounded-xl`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        userSelect: isDragging || isResizing ? 'none' : 'auto',
        ...(embedded ? EMBEDDED_SCROLL_SURFACE_STYLE : {}),
        ...backgroundStyle,
        border: `1px solid ${status.gateway.reachable ? 'rgba(110,231,183,0.22)' : 'rgba(56,189,248,0.22)'}`,
        boxShadow: status.gateway.reachable
          ? '0 0 44px rgba(16,185,129,0.12), inset 0 0 60px rgba(8,145,178,0.05)'
          : '0 0 38px rgba(8,145,178,0.14), inset 0 0 50px rgba(14,165,233,0.04)',
        color: 'rgba(232,249,252,0.96)',
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
      }}
      onMouseDown={event => {
        event.stopPropagation()
        focusPanelUi()
        if (!embedded) bringPanelToFront('openclaw')
      }}
      onPointerDown={event => event.stopPropagation()}
      onClick={embedded ? event => event.stopPropagation() : undefined}
    >
      <div
        data-drag-handle
        onMouseDown={embedded ? undefined : handleDragStart}
        className={`flex items-center justify-between border-b border-white/10 px-3 py-2 ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          background: 'linear-gradient(135deg, rgba(34,211,238,0.14) 0%, rgba(0,0,0,0) 100%)',
        }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-[0.16em] text-cyan-100 uppercase">OpenClaw</span>
            {hostedMode ? (
              <StatusBadge label="hosted oasis" tone="online" title="Public Oasis surface" />
            ) : (
              <>
                <StatusBadge
                  label={gatewayBadgeLabel}
                  tone={gatewayClientTone}
                  title={status.gatewayClient?.detail || transportLine}
                />
                <StatusBadge
                  label={status.mcpInstalled ? 'mcp installed' : 'mcp repair'}
                  tone={mcpTone}
                  title={status.mcpInstalled ? status.mcpUrl : 'Oasis MCP is not registered in the local OpenClaw config.'}
                />
              </>
            )}
            <StatusBadge
              label={relayBadgeLabel}
              tone={relayTone}
              title={relayBridge.lastError || (relayPairing ? `paired world ${relayPairing.worldId}` : activeWorldId)}
            />
            {!hostedMode && (
              <StatusBadge
                label={sshBridgeLabel}
                tone={sshBridgeTone}
                title={remoteMode ? sshBridgeCommand : 'Gateway and MCP are expected on this machine.'}
              />
            )}
          </div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          {!hideCloseButton && (
            <button
              data-no-drag
              onClick={onClose}
              className="text-lg leading-none text-cyan-50/70 transition hover:text-white"
              title="Close"
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-white/8 bg-black/18 px-3 py-2">
        {visibleTabs.map(tab => (
          <button
            key={tab}
            data-no-drag
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition ${
              activeTab === tab
                ? 'border-cyan-300/30 bg-cyan-400/12 text-cyan-50'
                : 'border-white/8 text-cyan-50/55 hover:border-cyan-300/22 hover:text-cyan-50'
            }`}
          >
            {tab === 'diagnostics' ? 'tests' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && (
        <div className="border-b border-white/8 bg-black/20 px-3 py-3 text-[11px] text-cyan-50/80">
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Bg</span>
                <input
                  data-no-drag
                  type="color"
                  value={panelSettings.bgColor}
                  onChange={event => updatePanelSettings({ ...panelSettings, bgColor: event.target.value })}
                  className="h-9 w-full cursor-pointer rounded border border-white/10 bg-transparent"
                />
              </label>
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Opacity</span>
                <input
                  data-no-drag
                  type="range"
                  min="0.45"
                  max="1"
                  step="0.01"
                  value={panelSettings.opacity}
                  onChange={event => updatePanelSettings({ ...panelSettings, opacity: Number(event.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-cyan-100/70">{panelSettings.opacity.toFixed(2)}</span>
              </label>
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Blur</span>
                <input
                  data-no-drag
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={panelSettings.blur}
                  onChange={event => updatePanelSettings({ ...panelSettings, blur: Number(event.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-cyan-100/70">{panelSettings.blur}px</span>
              </label>
              <div className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Avatar</span>
                <button
                  data-no-drag
                  type="button"
                  onClick={() => setAvatarPickerOpen(true)}
                  className="h-9 w-full rounded border border-cyan-300/25 bg-cyan-400/10 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-400/18"
                >
                  choose avatar
                </button>
                <span className="block truncate font-mono text-[10px] text-cyan-100/70">
                  {openclawAvatar?.avatar3dUrl ? openclawAvatar.avatar3dUrl.split('/').pop() : 'No dedicated body'}
                </span>
              </div>
              <label className="hidden space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Model</span>
                <select
                  data-no-drag
                  value={panelSettings.voiceModel}
                  onChange={event => updatePanelSettings({ ...panelSettings, voiceModel: event.target.value })}
                  className="h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                >
                  {OPENCLAW_VOICE_MODELS.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <span className="font-mono text-[10px] text-cyan-100/70">Applies to new voice calls</span>
              </label>
              <label className="hidden space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Voice</span>
                <select
                  data-no-drag
                  value={panelSettings.voiceName}
                  onChange={event => updatePanelSettings({ ...panelSettings, voiceName: event.target.value })}
                  className="h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                >
                  {OPENCLAW_VOICE_OPTIONS.map(voice => (
                    <option key={voice} value={voice}>{voice}</option>
                  ))}
                </select>
                <span className="font-mono text-[10px] text-cyan-100/70">The provider locks this per call</span>
              </label>
              <label className="hidden space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">VAD threshold</span>
                <input
                  data-no-drag
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={panelSettings.vadThreshold}
                  onChange={event => updatePanelSettings({ ...panelSettings, vadThreshold: Number(event.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-cyan-100/70">{panelSettings.vadThreshold.toFixed(2)}</span>
              </label>
              <label className="hidden space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Silence ms</span>
                <input
                  data-no-drag
                  type="range"
                  min="200"
                  max="1200"
                  step="50"
                  value={panelSettings.silenceDurationMs}
                  onChange={event => updatePanelSettings({ ...panelSettings, silenceDurationMs: Number(event.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-cyan-100/70">{Math.round(panelSettings.silenceDurationMs)}ms</span>
              </label>
              <label className="hidden space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Prefix ms</span>
                <input
                  data-no-drag
                  type="range"
                  min="100"
                  max="1000"
                  step="50"
                  value={panelSettings.prefixPaddingMs}
                  onChange={event => updatePanelSettings({ ...panelSettings, prefixPaddingMs: Number(event.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-cyan-100/70">{Math.round(panelSettings.prefixPaddingMs)}ms</span>
              </label>
            </div>
          )}
        </div>
      )}

      {activeTab === 'stream' && (
      <div
        data-drag-handle
        onMouseDown={embedded ? undefined : handleDragStart}
        className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.16em]"
        style={{ background: 'rgba(0,0,0,0.22)' }}
      >
        <span className="text-cyan-50/55">Session</span>
        <select
          data-no-drag
          value={selectedSessionId}
          onChange={event => setSelectedSessionId(event.target.value)}
          disabled={sending}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[11px] normal-case tracking-normal text-cyan-50 outline-none focus:border-cyan-300/40"
        >
            <option value="">No session selected</option>
            {sessions.map(session => (
              <option key={session.id} value={session.id}>
                {formatSessionOptionLabel(session)}
              </option>
            ))}
          </select>
        <button
          data-no-drag
          onClick={() => void handleCreateSession()}
          disabled={sending}
          className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
        >
          + new
        </button>
      </div>
      )}

      <div
        data-agent-window-scroll-root=""
        ref={activeTab === 'stream' ? transcriptRef : undefined}
        onScroll={activeTab === 'stream' ? event => {
          const el = event.currentTarget
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          autoScrollRef.current = nearBottom
          setShowJumpToLatest(!nearBottom)
        } : undefined}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent', ...EMBEDDED_SCROLL_SURFACE_STYLE }}
      >
        {activeTab === 'config' && (
        <>
          {!hostedMode && (
          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(2,12,18,0.42)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Connection</span>
                <div className="mt-1 text-[11px] text-cyan-50/55">
                  Leave SSH empty for a local OpenClaw. Use an SSH alias or <code>user@host</code> for remote testing.
                </div>
              </div>
              {loadingStatus && <span className="shrink-0 text-[10px] text-cyan-50/45">probing</span>}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">SSH host alias</span>
                <input
                  data-no-drag
                  value={configDraft.sshHost}
                  onChange={event => setConfigDraft(current => ({ ...current, sshHost: event.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                  placeholder="user@203.0.113.10 or my-openclaw-vps"
                />
                <span className="block text-[10px] text-cyan-50/48">Leave blank for local OpenClaw. Do not paste relay URLs here.</span>
                {sshHostIssue && (
                  <span className="block text-[10px] font-semibold text-amber-100/82">{sshHostIssue}</span>
                )}
              </label>
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Gateway WebSocket</span>
                <input
                  data-no-drag
                  value={configDraft.gatewayUrl}
                  onChange={event => setConfigDraft(current => ({ ...current, gatewayUrl: event.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                  placeholder="ws://127.0.0.1:18789"
                />
                <span className="block text-[10px] text-cyan-50/48">Normally stays on port 18789. Remote mode reaches it through SSH.</span>
              </label>
            </div>

            {remoteMode && (
              <div className="mt-3 rounded-lg border border-cyan-300/12 bg-black/24 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/75">SSH bridge</span>
                  <button
                    data-no-drag
                    onClick={() => { void copyText(sshBridgeCommand); flashCopied('ssh-bridge') }}
                    className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/75 transition hover:border-cyan-300/30 hover:text-white"
                  >
                    {copiedKey === 'ssh-bridge' ? 'copied' : 'copy'}
                  </button>
                </div>
                <div className="mt-2 break-all font-mono text-[11px] leading-5 text-cyan-50/78">{sshBridgeCommand}</div>
              </div>
            )}

            <details className="mt-3 text-[11px] text-cyan-50/60">
              <summary className="cursor-pointer uppercase tracking-[0.16em] text-cyan-100/70">advanced repair</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Control UI</span>
                  <input
                    data-no-drag
                    value={configDraft.controlUiUrl}
                    onChange={event => setConfigDraft(current => ({ ...current, controlUiUrl: event.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                    placeholder="http://127.0.0.1:18789"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Device token</span>
                  <input
                    data-no-drag
                    type="password"
                    value={configDraft.deviceToken}
                    onChange={event => setConfigDraft(current => ({ ...current, deviceToken: event.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                    placeholder={status.hasDeviceToken ? 'Saved. Paste only to rotate.' : 'Usually filled by pairing.'}
                  />
                </label>
              </div>
            </details>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                data-no-drag
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig}
                className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-400/18 disabled:cursor-wait disabled:opacity-60"
              >
                {savingConfig ? 'saving' : 'save config'}
              </button>
              <button
                data-no-drag
                onClick={() => void handleResetConfig()}
                disabled={savingConfig}
                className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50/70 transition hover:border-white/20 hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                reset to local defaults
              </button>
              <span className="self-center text-[10px] text-cyan-50/50">
                Stored in <code>data/openclaw-config.local.json</code>.
              </span>
            </div>
          </div>
          )}

          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'rgba(56,189,248,0.18)', background: 'rgba(4,18,28,0.38)' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">Hosted relay</span>
                <div className="mt-1 max-w-[640px] text-[11px] leading-5 text-sky-50/58">
                  {hostedMode
                    ? 'Relay is the WebSocket switchboard. The copied command starts the OpenClaw bridge process on the machine with OpenClaw.'
                    : 'Local dev proof of the hosted relay path. Start relay here, then run the OpenClaw bridge process command.'}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <StatusBadge label={relayBadgeLabel} tone={relayTone} title={relayBridge.lastError || undefined} />
                  <StatusBadge
                    label={activeWorldId ? `world ${activeWorldId.slice(-8)}` : 'no world'}
                    tone={activeWorldId ? 'online' : 'warn'}
                    title={activeWorldId || undefined}
                  />
                  {relayPairing && (
                    <StatusBadge
                      label={`${relayPairingExpiresInS}s code`}
                      tone={relayPairingExpiresInS > 0 ? 'warn' : 'offline'}
                      title={relayPairing.worldId}
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-no-drag
                  onClick={() => setRelayEnabled(value => !value)}
                  disabled={!activeWorldId || (hostedMode && !ownRelayConnection)}
                  className="rounded-lg border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-50 transition hover:bg-sky-400/18 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {hostedMode && !ownRelayConnection
                    ? 'relay delegated'
                    : relayEnabled ? 'stop relay' : 'start relay'}
                </button>
                <button
                  type="button"
                  data-no-drag
                  onClick={() => void handleRequestRelayPairing()}
                  disabled={relayPairingBusy || !activeWorldId}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-sky-50/78 transition hover:border-sky-300/30 hover:text-white disabled:cursor-wait disabled:opacity-45"
                >
                  {relayPairingBusy ? 'minting code' : 'mint pairing code'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-[0.16em] text-sky-50/58 sm:grid-cols-4">
              <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">
                <div>calls</div>
                <div className="mt-1 font-mono text-[12px] text-sky-50">{relayBridge.totalCalls}</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">
                <div>active</div>
                <div className="mt-1 font-mono text-[12px] text-sky-50">{relayBridge.inFlightCalls}</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">
                <div>dropped</div>
                <div className="mt-1 font-mono text-[12px] text-sky-50">{relayBridge.droppedCalls}</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">
                <div>session</div>
                <div className="mt-1 truncate font-mono text-[12px] normal-case tracking-normal text-sky-50">
                  {relayBridge.relaySessionId ? relayBridge.relaySessionId.slice(0, 8) : 'none'}
                </div>
              </div>
            </div>

            {relayPairing && (
              <div className="mt-3 space-y-2">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <button
                    type="button"
                    data-no-drag
                    onClick={() => { void copyText(relayPairing.code); flashCopied('relay-code') }}
                    className="rounded-lg border border-sky-300/18 bg-black/24 px-3 py-2 text-left font-mono text-[12px] text-sky-50 transition hover:border-sky-300/35"
                  >
                    {copiedKey === 'relay-code' ? 'copied ' : ''}{relayPairing.code}
                  </button>
                  <button
                    type="button"
                    data-no-drag
                    onClick={() => { void copyText(relayPairingCommand); flashCopied('relay-command') }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-sky-50/78 transition hover:border-sky-300/30 hover:text-white"
                  >
                    {copiedKey === 'relay-command' ? 'copied' : 'copy process cmd'}
                  </button>
                </div>
                <button
                  type="button"
                  data-no-drag
                  onClick={() => { void copyText(relayPairingCommand); flashCopied('relay-command') }}
                  className="w-full rounded-lg border border-sky-300/18 bg-black/24 px-3 py-2 text-left transition hover:border-sky-300/35"
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-100/62">
                    run this on the machine with OpenClaw
                  </span>
                  <span className="mt-1 block break-all font-mono text-[11px] leading-5 text-sky-50/88">
                    {relayPairingCommand}
                  </span>
                </button>
              </div>
            )}

            {(relayBridge.lastError || relayPairingError) && (
              <div className="mt-3 rounded-lg border border-rose-300/18 bg-rose-400/8 px-3 py-2 text-[11px] text-rose-50/80">
                {relayPairingError || relayBridge.lastError}
              </div>
            )}
          </div>

          {!hostedMode && (
          <div className="grid gap-3 md:grid-cols-3">
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: 'rgba(34,211,238,0.18)', background: 'rgba(2,12,18,0.38)' }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Local gateway</span>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge label={gatewayBadgeLabel} tone={gatewayClientTone} title={status.gatewayClient?.detail || transportLine} />
                <StatusBadge label={status.gateway.reachable ? 'port 18789 up' : 'port 18789 down'} tone={gatewayTone} title={status.gateway.status ? `HTTP ${status.gateway.status}` : status.gateway.error} />
                {showPairingHelp && <StatusBadge label={`${status.pendingDeviceCount} pending`} tone="warn" />}
              </div>
              {showPairingHelp && (
                <div className="mt-3 space-y-2 rounded-lg border border-amber-300/16 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-50/78">
                  <div>Approve from the machine running the OpenClaw Gateway.</div>
                  {status.pendingDevices && status.pendingDevices.length > 0 ? (
                    <div className="space-y-2">
                      {status.pendingDevices.map(device => (
                        <button
                          key={device.requestId}
                          type="button"
                          data-no-drag
                          onClick={() => { void copyText(`openclaw devices approve ${device.requestId}`); flashCopied(`approve-${device.requestId}`) }}
                          className="block w-full rounded-md border border-white/10 bg-black/20 px-2 py-1 text-left font-mono text-[10px] text-amber-50/85 transition hover:border-amber-300/30"
                        >
                          {copiedKey === `approve-${device.requestId}` ? 'copied ' : ''}openclaw devices approve {device.requestId}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-no-drag
                      onClick={() => { void copyText('openclaw devices list'); flashCopied('devices-list') }}
                      className="rounded-md border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px] text-amber-50/85 transition hover:border-amber-300/30"
                    >
                      {copiedKey === 'devices-list' ? 'copied' : 'copy devices list'}
                    </button>
                  )}
                </div>
              )}
              <details className="mt-3 text-[11px] text-cyan-50/55">
                <summary className="cursor-pointer uppercase tracking-[0.16em] text-cyan-100/65">support info</summary>
                <div className="mt-2 space-y-1">
                  <div>Gateway state: <span className="font-semibold text-cyan-50">{gatewayClientState}</span></div>
                  <div>Paired devices on this host: {status.pairedDeviceCount}</div>
                  {status.gatewayClient?.deviceId && <div className="break-all">Oasis device: {status.gatewayClient.deviceId}</div>}
                </div>
              </details>
            </div>

            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: 'rgba(110,231,183,0.18)', background: 'rgba(4,18,16,0.38)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100">Oasis MCP tools</span>
                <span className="text-[10px] text-emerald-50/45">{loadingMcp ? 'checking' : status.mcpInstalled ? 'ready' : 'repair'}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge label={status.mcpInstalled ? 'installed' : 'not installed'} tone={mcpTone} title={mcpInfo?.configPath || status.runtimeMcpConfigPath} />
                <StatusBadge label="streamable http" tone="online" title={status.mcpUrl} />
              </div>
              <button
                data-no-drag
                onClick={() => void handleInstallMcp()}
                disabled={installingMcp}
                className="mt-3 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-400/18 disabled:cursor-wait disabled:opacity-60"
              >
                {installingMcp ? 'installing' : status.mcpInstalled ? 'reinstall local mcp' : 'install local mcp'}
              </button>
              <details className="mt-3 text-[11px] text-emerald-50/65">
                <summary className="cursor-pointer uppercase tracking-[0.16em] text-emerald-100/70">repair details</summary>
                <div className="mt-2 space-y-2">
                  <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="uppercase tracking-[0.16em] text-emerald-100/55">url</span>
                      <button data-no-drag onClick={() => { void copyText(status.mcpUrl); flashCopied('mcp-url') }} className="text-[10px] uppercase tracking-[0.16em] text-emerald-100/75">{copiedKey === 'mcp-url' ? 'copied' : 'copy'}</button>
                    </div>
                    <div className="break-all font-mono text-[11px] text-emerald-50/82">{status.mcpUrl}</div>
                  </div>
                  {mcpInfo && (
                    <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="uppercase tracking-[0.16em] text-emerald-100/55">command</span>
                        <button data-no-drag onClick={() => { void copyText(mcpInfo.command); flashCopied('mcp-command') }} className="text-[10px] uppercase tracking-[0.16em] text-emerald-100/75">{copiedKey === 'mcp-command' ? 'copied' : 'copy'}</button>
                      </div>
                      <div className="break-all font-mono text-[11px] text-emerald-50/82">{mcpInfo.command}</div>
                    </div>
                  )}
                </div>
              </details>
            </div>

            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: 'rgba(251,191,36,0.16)', background: 'rgba(36,24,4,0.32)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">SSH tunnel</span>
                <StatusBadge label={sshBridgeLabel} tone={sshBridgeTone} />
              </div>
              <div className="mt-3 space-y-2 text-[11px] text-amber-50/68">
                <div>This is only the SSH port tunnel. The OpenClaw bridge process is the Node command copied from Hosted relay.</div>
                {remoteMode ? (
                  <button
                    data-no-drag
                    onClick={() => { void copyText(sshBridgeCommand); flashCopied('ssh-bridge-2') }}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left font-mono text-[10px] leading-5 text-amber-50/84 transition hover:border-amber-300/30"
                  >
                    {copiedKey === 'ssh-bridge-2' ? 'copied ' : ''}{sshBridgeCommand}
                  </button>
                ) : (
                  <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-amber-50/58">
                    Add an SSH host alias above to generate the SSH tunnel command.
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </>
        )}

        {false && activeTab === 'config' && (
        <>
        <div className="grid gap-3 md:grid-cols-2">
          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(2,12,18,0.42)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Local status</span>
              {loadingStatus && <span className="text-[10px] text-cyan-50/45">probing</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge label={`gateway ${status.gateway.label}`} tone={gatewayTone} title={transportLine} />
              <StatusBadge label={`ws ${gatewayClientState}`} tone={gatewayClientTone} title={status.gatewayClient?.detail || 'Native Gateway WebSocket client state.'} />
              <StatusBadge label={`ui ${status.controlUi.label}`} tone={controlTone} title={`Control UI probe: ${status.controlUi.status ?? status.controlUi.error ?? 'unknown'}`} />
              <StatusBadge label={`browser ${status.browserControl.label}`} tone={browserTone} title="Port 18791 is browser-control auth. HTTP 401 can be normal when no browser-control token is supplied." />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-cyan-50/60">
              <span>{status.pendingDeviceCount} pending</span>
              <span>{status.pairedDeviceCount} paired</span>
              {!chatReady && <span>fallback: {talkSurfaceLabel}</span>}
            </div>
            <div className="hidden">
              <div>{transportLine}</div>
              <div>
                Native Gateway state: <span className="font-semibold text-cyan-50">{gatewayClientState}</span>
                {status.gatewayClient?.detail ? <> - {status.gatewayClient?.detail}</> : null}
              </div>
              {!chatReady && (
                <div>
                  Fallback talk surface right now: <span className="font-semibold text-cyan-50">{talkSurfaceLabel}</span>.
                </div>
              )}
              <div>Port 18791 is browser control, not your normal human chat surface.</div>
              {gatewayClientState === 'pairing-required' && (
                <div>
                  Gateway auth is still blocked on pairing. That means the page is reachable, but Oasis is not yet a trusted device.
                </div>
              )}
              <div>Pair approval runs on the machine hosting the Gateway, using the OpenClaw CLI there.</div>
              <div>
                Pending devices: {status.pendingDeviceCount} • paired devices: {status.pairedDeviceCount}
              </div>
            </div>
          </div>
          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'rgba(110,231,183,0.18)', background: 'rgba(4,18,16,0.38)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100">World tools</span>
              <button
                data-no-drag
                onClick={() => { void copyText(status.mcpUrl); flashCopied('mcp') }}
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100/80 transition hover:border-emerald-300/30 hover:text-white"
              >
                {copiedKey === 'mcp' ? 'copied' : 'copy'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge label={status.mcpInstalled ? 'installed' : 'not installed'} tone={status.mcpInstalled ? 'online' : 'warn'} title={mcpInfo?.configPath || status.runtimeMcpConfigPath} />
              <StatusBadge label="streamable http" tone="online" title={status.mcpUrl} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                data-no-drag
                onClick={() => { void copyText(status.mcpUrl); flashCopied('mcp-url') }}
                className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-emerald-100/80 transition hover:border-emerald-300/30 hover:text-white"
              >
                {copiedKey === 'mcp-url' ? 'copied url' : 'copy url'}
              </button>
              <button
                data-no-drag
                onClick={() => { if (mcpInfo?.command) { void copyText(mcpInfo.command); flashCopied('mcp-command') } }}
                disabled={!mcpInfo}
                className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-emerald-100/80 transition hover:border-emerald-300/30 hover:text-white disabled:opacity-40"
              >
                {copiedKey === 'mcp-command' ? 'copied command' : 'copy openclaw cmd'}
              </button>
              <button
                data-no-drag
                onClick={() => void handleInstallMcp()}
                disabled={installingMcp}
                className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-400/18 disabled:cursor-wait disabled:opacity-60"
              >
                {installingMcp ? 'installing' : status.mcpInstalled ? 'reinstall mcp' : 'install into openclaw'}
              </button>
              <span className="self-center text-[11px] text-emerald-50/60">
                {loadingMcp ? 'reading config...' : status.mcpInstalled ? 'ready' : 'repair needed'}
              </span>
            </div>
            <details className="mt-3 text-[11px] text-emerald-50/65">
              <summary className="cursor-pointer uppercase tracking-[0.16em] text-emerald-100/70">repair details</summary>
              <div className="mt-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-emerald-50/82">
                {status.mcpUrl}
              </div>
              {mcpInfo && (
                <div className="mt-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-emerald-50/82">
                  {mcpInfo?.command}
                </div>
              )}
            </details>
          </div>
        </div>
        </>
        )}

        {false && activeTab === 'config' && (
        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Pairing</span>
            <button
              data-no-drag
              onClick={() => { void copyText(status.approveCommandHint); flashCopied('approve') }}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            >
              {copiedKey === 'approve' ? 'copied' : 'copy approve'}
            </button>
          </div>
          <div className="mt-3 space-y-3 text-[12px] text-cyan-50/72">
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={gatewayClientState} tone={gatewayClientTone} title={status.pairingHint} />
              <StatusBadge label={`${status.pendingDeviceCount} pending`} tone={status.pendingDeviceCount > 0 ? 'warn' : 'online'} />
              <StatusBadge label={`${status.pairedDeviceCount} paired`} tone="online" />
            </div>
            {!chatReady && (
              <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-cyan-50/82">
                {status.approveCommandHint}
              </div>
            )}
            {status.gatewayCli.detail && !chatReady && (
              <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 text-[11px] text-cyan-50/70">
                CLI health lane: {status.gatewayCli.detail}
              </div>
            )}
            <details className="text-[11px] text-cyan-50/60">
              <summary className="cursor-pointer uppercase tracking-[0.16em] text-cyan-100/70">why approval?</summary>
              <div className="mt-2 space-y-2">
                <div>This browser needs one-time trust from the Gateway owner before it can control the OpenClaw session.</div>
                <div>If the Gateway is on a VPS, approve from that VPS host.</div>
              </div>
            </details>
          </div>
        </div>
        )}

        {activeTab === 'diagnostics' && (
        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Tests</span>
              <div className="mt-1 text-[11px] text-cyan-50/52">
                Core tests spin up a scratch world, exercise the live MCP surface, then clear the world again.
              </div>
            </div>
            {smokeReport && (
              <div className="text-right text-[10px] text-cyan-50/45">
                Last run {formatTimestamp(smokeReport.finishedAt)} â€¢ {formatDuration(smokeReport.durationMs)}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              data-no-drag
              onClick={() => void handleRunSmoke('core')}
              disabled={!!runningSmokeMode}
              className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-400/18 disabled:cursor-wait disabled:opacity-60"
            >
              {runningSmokeMode === 'core' ? 'running core' : 'run core tests'}
            </button>
            <button
              data-no-drag
              onClick={() => void handleRunSmoke('live')}
              disabled={!!runningSmokeMode}
              className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {runningSmokeMode === 'live' ? 'running live' : 'run live tests'}
            </button>
            <button
              data-no-drag
              onClick={() => void handleRunSmoke('external')}
              disabled={!!runningSmokeMode}
              className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {runningSmokeMode === 'external' ? 'running external' : 'run external tests'}
            </button>
          </div>

          <div className="mt-3 space-y-2 text-[12px] text-cyan-50/68">
            <div>Core: safe world, avatar, craft, and registry-backed conjure checks.</div>
            <div>Live: screenshot bridge checks against the world you currently have open in Oasis.</div>
            <div>External: marks credit-burning craft/conjure surfaces for the next phase.</div>
          </div>

          {smokeReport && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <StatusBadge label={`${smokeReport.counts.passed} passed`} tone="online" />
                <StatusBadge label={`${smokeReport.counts.failed} failed`} tone={smokeReport.counts.failed > 0 ? 'offline' : 'online'} />
                <StatusBadge label={`${smokeReport.counts.skipped} skipped`} tone="warn" />
                {smokeReport.worldId && <StatusBadge label={`world ${smokeReport.worldId.slice(-8)}`} tone="warn" />}
              </div>

              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[12px] text-cyan-50/68">
                Mode: <span className="font-semibold text-cyan-50">{smokeReport.mode}</span> â€¢ endpoint <code>{smokeReport.endpoint}</code>
                {smokeReport.worldName && (
                  <>
                    <br />
                    Scratch world: <span className="font-semibold text-cyan-50">{smokeReport.worldName}</span>
                  </>
                )}
              </div>

              <div className="space-y-2">
                {smokeReport.tests.map((test, index) => (
                  <div
                    key={`${test.name}-${index}`}
                    className="rounded-lg border border-white/8 bg-black/18 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={test.status} tone={smokeTone(test.status)} />
                          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-50/46">{test.category}</span>
                          {test.toolName && <span className="text-[10px] font-mono text-cyan-50/38">{test.toolName}</span>}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold text-cyan-50">{test.name}</div>
                        <div className="mt-1 text-[12px] text-cyan-50/68">{test.detail}</div>
                      </div>
                      {typeof test.durationMs === 'number' && (
                        <span className="shrink-0 text-[10px] text-cyan-50/40">{formatDuration(test.durationMs)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {activeTab === 'voice' && (
        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(110,231,183,0.18)', background: 'rgba(4,18,16,0.38)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100">Realtime voice</span>
              <div className="mt-1 text-[11px] text-emerald-50/55">{voiceDetail}</div>
            </div>
            <StatusBadge
              label={voiceState === 'connecting' ? 'opening' : voiceState === 'thinking' ? 'thinking' : voiceState === 'live' ? 'live' : voiceState}
              tone={voiceState === 'error' ? 'offline' : voiceState === 'idle' ? 'warn' : 'online'}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              data-no-drag
              type="button"
              onClick={() => void handleVoiceToggle()}
              disabled={voiceState === 'connecting'}
              className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-50 transition hover:bg-emerald-400/18 disabled:cursor-wait disabled:opacity-60"
              title={voiceState === 'idle' || voiceState === 'error' ? 'Open the native OpenClaw realtime voice line.' : 'Hang up the OpenClaw realtime voice line.'}
            >
              {voiceState === 'connecting' ? 'opening' : voiceState === 'live' || voiceState === 'thinking' ? 'hang up' : 'start voice'}
            </button>
            <StatusBadge label={panelSettings.voiceModel} tone="warn" />
            <StatusBadge label={panelSettings.voiceName} tone="warn" />
          </div>
          <div className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-emerald-50/65">
            Session: <span className="font-mono text-emerald-50/85">{resolveVoiceSessionKey()}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-white/8 bg-black/18 px-3 py-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="block uppercase tracking-[0.16em] text-emerald-100/70">Model</span>
              <select
                data-no-drag
                value={panelSettings.voiceModel}
                onChange={event => updatePanelSettings({ ...panelSettings, voiceModel: event.target.value })}
                className="h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-emerald-50 outline-none focus:border-emerald-300/40"
              >
                {OPENCLAW_VOICE_MODELS.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block uppercase tracking-[0.16em] text-emerald-100/70">Voice</span>
              <select
                data-no-drag
                value={panelSettings.voiceName}
                onChange={event => updatePanelSettings({ ...panelSettings, voiceName: event.target.value })}
                className="h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-emerald-50 outline-none focus:border-emerald-300/40"
              >
                {OPENCLAW_VOICE_OPTIONS.map(voice => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block uppercase tracking-[0.16em] text-emerald-100/70">VAD</span>
              <input
                data-no-drag
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={panelSettings.vadThreshold}
                onChange={event => updatePanelSettings({ ...panelSettings, vadThreshold: Number(event.target.value) })}
                className="w-full accent-emerald-400"
              />
              <span className="font-mono text-[10px] text-emerald-100/70">{panelSettings.vadThreshold.toFixed(2)}</span>
            </label>
            <label className="space-y-1">
              <span className="block uppercase tracking-[0.16em] text-emerald-100/70">Silence</span>
              <input
                data-no-drag
                type="range"
                min="200"
                max="1200"
                step="50"
                value={panelSettings.silenceDurationMs}
                onChange={event => updatePanelSettings({ ...panelSettings, silenceDurationMs: Number(event.target.value) })}
                className="w-full accent-emerald-400"
              />
              <span className="font-mono text-[10px] text-emerald-100/70">{Math.round(panelSettings.silenceDurationMs)}ms</span>
            </label>
            <label className="space-y-1">
              <span className="block uppercase tracking-[0.16em] text-emerald-100/70">Prefix</span>
              <input
                data-no-drag
                type="range"
                min="100"
                max="1000"
                step="50"
                value={panelSettings.prefixPaddingMs}
                onChange={event => updatePanelSettings({ ...panelSettings, prefixPaddingMs: Number(event.target.value) })}
                className="w-full accent-emerald-400"
              />
              <span className="font-mono text-[10px] text-emerald-100/70">{Math.round(panelSettings.prefixPaddingMs)}ms</span>
            </label>
          </div>
          <div className="mt-3 rounded-xl border border-white/8 bg-black/18 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/80">Voice transcript</span>
              <span className="text-[10px] text-emerald-50/42">{voiceMessages.length} events</span>
            </div>
            <div
              ref={voiceTranscriptRef}
              onScroll={event => {
                const el = event.currentTarget
                const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
                voiceAutoScrollRef.current = nearBottom
                setShowVoiceJumpToLatest(!nearBottom)
              }}
              className="relative mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}
            >
              {voiceMessages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-emerald-50/50">
                  Voice turns will stay here instead of polluting the text stream.
                </div>
              ) : voiceMessages.map(message => message.role === 'tool' ? (
                <div key={message.id} className="space-y-2">
                <button
                  key={message.id}
                  type="button"
                  onClick={() => toggleToolExpanded(message.id)}
                  className="w-full rounded-lg border border-emerald-300/16 bg-emerald-400/8 px-3 py-2 text-left"
                >
                  <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-emerald-50/75">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true">{message.toolState === 'done' ? '[ok]' : message.toolState === 'failed' ? '[x]' : '[...]'}</span>
                      <span className="truncate">{message.toolName || 'tool'}</span>
                      {message.toolInputSummary && message.toolInputSummary !== 'no args' && (
                        <span className="truncate text-emerald-50/45">{message.toolInputSummary}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-emerald-50/36">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  {expandedToolIds.includes(message.id) && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <pre className="whitespace-pre-wrap overflow-x-auto rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-[11px] leading-5 text-emerald-50/80">
{formatToolValue(message.toolInput ?? {})}
                      </pre>
                      <pre className="whitespace-pre-wrap overflow-x-auto rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-[11px] leading-5 text-emerald-50/80">
{formatToolValue(message.toolOutput ?? {})}
                      </pre>
                    </div>
                  )}
                </button>
                <OpenclawToolMediaBubbles
                  message={message}
                  avatarId={openclawAvatar?.id}
                  autoPlayAudio={false}
                  galleryScopeId="openclaw-voice"
                />
                </div>
              ) : (
                <div
                  key={message.id}
                  className="rounded-lg border border-white/8 bg-black/18 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-100/75">{roleLabel(message.role, profileName)}</span>
                    <span className="text-[10px] text-emerald-50/36">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-emerald-50/82">
                    {message.content ? renderMarkdown(message.content) : (message.state === 'streaming' ? '...' : '')}
                  </div>
                </div>
              ))}
              {showVoiceJumpToLatest && voiceMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => scrollVoiceTranscriptToBottom('smooth')}
                  className="sticky bottom-0 ml-auto mt-3 rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.16em]"
                  style={{
                    borderColor: 'rgba(110,231,183,0.28)',
                    background: 'rgba(6,78,59,0.84)',
                    color: '#bbf7d0',
                  }}
                >
                  auto-scroll
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {activeTab === 'stream' && (
        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Transcript</span>
            <span className="text-[10px] text-cyan-50/45">
              {loadingMessages ? 'loading history' : `${messages.length} messages`}
            </span>
          </div>

          <div className="relative mt-3 space-y-2 pr-1">
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-cyan-50/55">
                No transcript yet. When you send the first line, the assistant stream will start painting itself here.
              </div>
            ) : (
              messages.map(message => message.role === 'tool' ? (
                <div key={message.id} className="space-y-2">
                <button
                  key={message.id}
                  type="button"
                  onClick={() => toggleToolExpanded(message.id)}
                  className="w-full rounded-xl border px-3 py-3 text-left transition"
                  style={{
                    borderColor: message.toolState === 'done'
                      ? 'rgba(16,185,129,0.26)'
                      : message.toolState === 'failed'
                        ? 'rgba(244,63,94,0.26)'
                        : 'rgba(250,204,21,0.24)',
                    background: message.toolState === 'done'
                      ? 'rgba(6,78,59,0.16)'
                      : message.toolState === 'failed'
                        ? 'rgba(127,29,29,0.16)'
                        : 'rgba(120,53,15,0.16)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em]">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true">{message.toolState === 'done' ? '[ok]' : message.toolState === 'failed' ? '[x]' : '[...]'}</span>
                      <span className="truncate text-cyan-50/90">{message.toolName || 'tool'}</span>
                      {message.toolInputSummary && message.toolInputSummary !== 'no args' && (
                        <span className="truncate text-cyan-50/46">{message.toolInputSummary}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-cyan-50/38">
                      {typeof message.toolDurationMs === 'number' && <span>{message.toolDurationMs}ms</span>}
                      <span>{formatTimestamp(message.timestamp)}</span>
                    </div>
                  </div>
                  {expandedToolIds.includes(message.id) && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/46">input</div>
                        <pre className="whitespace-pre-wrap overflow-x-auto rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-[11px] leading-5 text-cyan-50/82">
{formatToolValue(message.toolInput ?? {})}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/46">output</div>
                        <pre className="whitespace-pre-wrap overflow-x-auto rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-[11px] leading-5 text-cyan-50/82">
{formatToolValue(message.toolOutput ?? {})}
                        </pre>
                      </div>
                    </div>
                  )}
                </button>
                <OpenclawToolMediaBubbles
                  message={message}
                  avatarId={openclawAvatar?.id}
                  autoPlayAudio={false}
                  galleryScopeId="openclaw-stream"
                />
                </div>
              ) : (
                <div
                  key={message.id}
                  className="rounded-xl border px-3 py-2"
                  style={{
                    borderColor: message.role === 'assistant'
                      ? 'rgba(110,231,183,0.28)'
                      : message.role === 'system'
                        ? 'rgba(251,191,36,0.28)'
                        : 'rgba(34,211,238,0.28)',
                    background: message.role === 'assistant'
                      ? 'rgba(4,28,22,0.5)'
                      : message.role === 'system'
                        ? 'rgba(36,24,4,0.4)'
                        : 'rgba(4,16,28,0.5)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className="text-[10px] font-mono uppercase tracking-[0.16em]"
                      style={{
                        color: message.role === 'assistant'
                          ? '#86efac'
                          : message.role === 'system'
                            ? '#fde68a'
                            : '#67e8f9',
                      }}
                    >
                      {roleLabel(message.role, profileName)}
                    </span>
                    <span className="text-[10px] text-cyan-50/38">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-cyan-50/82">
                    {message.content
                      ? renderMarkdown(message.content)
                      : (message.state === 'streaming' ? '...' : '')}
                  </div>
                </div>
              ))
            )}
            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => scrollTranscriptToBottom('smooth')}
                className="sticky bottom-0 ml-auto mt-3 rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.16em]"
                style={{
                  borderColor: 'rgba(34,211,238,0.26)',
                  background: 'rgba(8,51,68,0.84)',
                  color: '#a5f3fc',
                }}
              >
                auto-scroll
              </button>
            )}
          </div>
        </div>
        )}
      </div>

      {activeTab === 'stream' && (
      <div className="border-t border-white/8 bg-black/20 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-cyan-50/55">
          <span>{sending ? 'OpenClaw is answering...' : chatReady ? 'Ready' : transportLine}</span>
          <span>{sending ? 'streaming' : chatReady ? 'ready' : hostedMode ? relayBridge.status : gatewayClientState}</span>
        </div>
        <div className="flex items-end gap-2">
          {!hostedMode && (
          <button
            data-no-drag
            type="button"
            onClick={() => void voice.toggle()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-sm text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            title={voice.listening ? 'Stop microphone capture' : voice.ready ? 'Record voice and transcribe into the composer' : voice.backendMessage || 'Warm up local STT first'}
          >
            {voice.listening ? 'stop' : voice.transcribing ? '...' : 'mic'}
          </button>
          )}
          <div className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
            <textarea
              data-no-drag
              ref={inputRef}
              value={composer}
              onChange={event => setComposer(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              rows={1}
              placeholder={chatReady ? 'Message OpenClaw...' : 'Type here. If pairing is still pending, the error will tell you what to approve.'}
              className="w-full resize-none bg-transparent text-[13px] leading-6 text-cyan-50 outline-none placeholder:text-cyan-50/35"
              style={{ minHeight: 42 }}
            />
          </div>
          <button
            data-no-drag
            type="button"
            onClick={() => void handleSend()}
            disabled={!composer.trim() || sending}
            className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50 transition hover:bg-cyan-400/16 disabled:cursor-not-allowed disabled:border-cyan-300/12 disabled:bg-cyan-400/8 disabled:text-cyan-50/45"
            title={sending ? 'OpenClaw is answering...' : hostedMode ? 'Send through the hosted relay.' : 'Send through the Gateway WebSocket transport.'}
          >
            {sending ? 'live...' : 'send'}
          </button>
        </div>
        {!hostedMode && (voice.error || voice.backendMessage) && (
          <div className="mt-2 text-[11px] text-cyan-50/55">
            {voice.error || voice.backendMessage}
          </div>
        )}
      </div>
      )}
      <audio ref={voiceAudioRef} className="hidden" preload="auto" />

      {avatarPickerOpen && (
        <AvatarGallery
          currentAvatarUrl={openclawAvatar?.avatar3dUrl || null}
          onSelect={(avatarUrl) => {
            assignSharedAgentAvatar('openclaw', avatarUrl)
            setAvatarPickerOpen(false)
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}

      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 h-6 w-6 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(34,211,238,0.42) 50%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody

  return createPortal(panelBody, document.body)
}
