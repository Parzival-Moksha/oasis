'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MERLIN PANEL — The World-Builder Agent's Consciousness Stream
// ─═̷─═̷─ॐ─═̷─═̷─ Words → Tools → World ─═̷─═̷─ॐ─═̷─═̷─
//
// Chat-style interface that invokes POST /api/merlin with SSE streaming.
// Displays text thoughts, tool calls, results, and save confirmations.
// World updates arrive via polling after Merlin saves to Prisma/SQLite.
//
// Pattern: Chat + SSE streaming + tool call display.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useOasisStore } from '@/store/oasisStore'
import { SettingsContext } from '../scene-lib'
import { useUILayer } from '@/lib/input-manager'
import { AvatarGallery } from './AvatarGallery'
import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { MediaBubble, type MediaType } from './MediaBubble'
import { renderMarkdown } from '@/lib/anorak-renderers'
import {
  clampMerlinGeometry,
  type MerlinPanelPosition,
  type MerlinPanelSize,
} from '@/lib/merlin-panel-geometry'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AgentVoiceInputButton } from './AgentVoiceInputButton'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { getCameraSnapshot } from '@/lib/camera-bridge'
import { type TokenUsagePayload } from '@/lib/token-usage'
import {
  getClientAgentSessionCache,
  listClientAgentSessionCaches,
  saveClientAgentSessionCache,
  saveClientAgentSessionCaches,
  type ClientAgentSessionCacheRecord,
} from '@/lib/agent-session-cache-client'
import { removeBrowserStorage, writeBrowserStorage } from '@/lib/browser-storage'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES — Merlin SSE event shapes
// ═══════════════════════════════════════════════════════════════════════════

interface MerlinTextEvent { type: 'text'; content: string }
interface MerlinThinkingEvent { type: 'thinking'; content: string }
interface MerlinSessionEvent { type: 'session'; sessionId: string }
interface MerlinToolEvent { type: 'tool'; name: string; args: Record<string, unknown>; toolId?: string }
interface MerlinResultEvent { type: 'result'; name: string; ok: boolean; message: string; mediaUrls?: string[]; toolId?: string }
interface MerlinSaveEvent { type: 'save'; savedAt: string }
interface MerlinUsageEvent extends TokenUsagePayload { type: 'usage' }
interface MerlinDoneEvent extends Partial<TokenUsagePayload> { type: 'done'; worldId?: string; sessionId?: string; success?: boolean }
interface MerlinErrorEvent { type: 'error'; message: string }

type MerlinEvent =
  | MerlinSessionEvent
  | MerlinTextEvent
  | MerlinThinkingEvent
  | MerlinToolEvent
  | MerlinResultEvent
  | MerlinUsageEvent
  | MerlinSaveEvent
  | MerlinDoneEvent
  | MerlinErrorEvent

// Chat-level message (aggregated from events)
interface MerlinMessage {
  id: string
  role: 'user' | 'merlin'
  content: string
  events?: MerlinEvent[]
  timestamp: number
}

interface MerlinSessionSummary {
  id: string
  label: string
  timestamp: string
  turnCount: number
  fileSize: number
  model?: string
}

const MERLIN_SESSION_KEY = 'oasis-merlin-session'
const MERLIN_MODEL_KEY = 'oasis-merlin-model'
const MERLIN_SESSION_CACHE_KEY = 'oasis-merlin-session-cache'
const MERLIN_LEGACY_SESSIONS_KEY = 'oasis-merlin-sessions'
const MERLIN_AGENT_CACHE_TYPE = 'merlin'
const NEW_SESSION_VALUE = '__new__'
const DEFAULT_MERLIN_MODEL = 'opus'
// See HermesPanel.tsx — translateZ/backfaceVisibility nuke inner content when
// stacked inside drei's CSS3D <Html transform>. Removed for the embedded case.
const EMBEDDED_SCROLL_SURFACE_STYLE = {
  overscrollBehavior: 'contain' as const,
  WebkitOverflowScrolling: 'touch' as const,
}
const MERLIN_MODELS = [
  { id: 'sonnet', label: 'Sonnet 4.7' },
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'haiku', label: 'Haiku 4.5' },
] as const
const MERLIN_VISION_TOOL_NAMES = new Set(['screenshot_viewport', 'screenshot_avatar', 'avatarpic_merlin', 'avatarpic_user'])

function countToolEvents(messages: MerlinMessage[]): number {
  return messages.reduce((count, message) => (
    count + (message.events?.filter(event => event.type === 'tool').length || 0)
  ), 0)
}

function sanitizeMerlinMessage(value: unknown): MerlinMessage | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<MerlinMessage>
  if (entry.role !== 'user' && entry.role !== 'merlin') return null
  if (typeof entry.content !== 'string') return null
  if (typeof entry.id !== 'string') return null
  if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return null
  const events = Array.isArray(entry.events)
    ? entry.events.filter((event): event is MerlinEvent => !!event && typeof event === 'object' && typeof (event as { type?: unknown }).type === 'string')
    : undefined
  return {
    id: entry.id,
    role: entry.role,
    content: entry.content,
    events,
    timestamp: entry.timestamp,
  }
}

function sanitizeCachedMerlinMessages(raw: unknown): MerlinMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(sanitizeMerlinMessage)
    .filter((message): message is MerlinMessage => !!message)
    .slice(-120)
}

function getMerlinMessagesLastActiveAt(messages: MerlinMessage[]): number {
  return messages.reduce((latest, message) => Math.max(latest, message.timestamp || 0), 0) || Date.now()
}

function getMerlinSessionTitle(sessionId: string, messages: MerlinMessage[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim())
  if (firstUserMessage) return firstUserMessage.content.trim().replace(/\s+/g, ' ').slice(0, 80)
  return `Merlin ${sessionId.slice(-8)}`
}

function readMerlinSessionCache(sessionId: string): MerlinMessage[] {
  if (typeof window === 'undefined' || !sessionId) return []
  try {
    const raw = localStorage.getItem(MERLIN_SESSION_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    return sanitizeCachedMerlinMessages((parsed as Record<string, unknown>)[sessionId])
  } catch {
    return []
  }
}

function readLegacyMerlinSessionCaches(): Map<string, {
  messages: MerlinMessage[]
  title?: string
  model?: string
  createdAt?: string | number
  lastActiveAt?: string | number
}> {
  const sessions = new Map<string, {
    messages: MerlinMessage[]
    title?: string
    model?: string
    createdAt?: string | number
    lastActiveAt?: string | number
  }>()
  if (typeof window === 'undefined') return sessions

  try {
    const raw = localStorage.getItem(MERLIN_SESSION_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
        const messages = sanitizeCachedMerlinMessages(value)
        if (sessionId && messages.length > 0) {
          sessions.set(sessionId, { messages, lastActiveAt: getMerlinMessagesLastActiveAt(messages) })
        }
      }
    }
  } catch {
    // Ignore malformed legacy cache.
  }

  try {
    const raw = localStorage.getItem(MERLIN_LEGACY_SESSIONS_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        const sessionId = typeof record.id === 'string' ? record.id : ''
        if (!sessionId) continue
        const messages = sanitizeCachedMerlinMessages(record.messages)
        if (messages.length === 0) continue
        const existing = sessions.get(sessionId)
        const next = chooseRicherMerlinMessages(existing?.messages || [], messages)
        sessions.set(sessionId, {
          messages: next,
          title: typeof record.label === 'string' ? record.label : typeof record.name === 'string' ? record.name : existing?.title,
          model: typeof record.model === 'string' ? record.model : existing?.model,
          createdAt: typeof record.createdAt === 'string' || typeof record.createdAt === 'number' ? record.createdAt : existing?.createdAt,
          lastActiveAt: typeof record.updatedAt === 'string' || typeof record.updatedAt === 'number'
            ? record.updatedAt
            : existing?.lastActiveAt || getMerlinMessagesLastActiveAt(next),
        })
      }
    }
  } catch {
    // Ignore malformed legacy sessions.
  }

  return sessions
}

let merlinLegacyMigrationPromise: Promise<void> | null = null
const merlinSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function migrateLegacyMerlinStorage(): Promise<void> {
  if (typeof window === 'undefined') return
  if (merlinLegacyMigrationPromise) return merlinLegacyMigrationPromise

  merlinLegacyMigrationPromise = (async () => {
    const legacy = readLegacyMerlinSessionCaches()
    if (legacy.size === 0) return

    const ok = await saveClientAgentSessionCaches(MERLIN_AGENT_CACHE_TYPE, [...legacy.entries()].map(([sessionId, value]) => ({
      sessionId,
      title: value.title || getMerlinSessionTitle(sessionId, value.messages),
      model: value.model,
      payload: value.messages,
      messageCount: value.messages.length,
      source: 'legacy-localStorage',
      createdAt: value.createdAt,
      lastActiveAt: value.lastActiveAt || getMerlinMessagesLastActiveAt(value.messages),
    })))

    if (ok) {
      removeBrowserStorage(MERLIN_SESSION_CACHE_KEY)
      removeBrowserStorage(MERLIN_LEGACY_SESSIONS_KEY)
    }
  })()

  try {
    await merlinLegacyMigrationPromise
  } finally {
    merlinLegacyMigrationPromise = null
  }
}

async function readPersistedMerlinSessionCache(sessionId: string): Promise<MerlinMessage[]> {
  if (!sessionId) return []
  await migrateLegacyMerlinStorage()

  const record = await getClientAgentSessionCache<MerlinMessage[]>(MERLIN_AGENT_CACHE_TYPE, sessionId)
  const persisted = sanitizeCachedMerlinMessages(record?.payload)
  if (persisted.length > 0) return persisted

  return readMerlinSessionCache(sessionId)
}

function writeMerlinSessionCache(sessionId: string, messages: MerlinMessage[], model?: string) {
  if (typeof window === 'undefined' || !sessionId || messages.length === 0) return
  const sanitized = sanitizeCachedMerlinMessages(messages)
  if (sanitized.length === 0) return

  const previous = merlinSaveTimers.get(sessionId)
  if (previous) clearTimeout(previous)

  merlinSaveTimers.set(sessionId, setTimeout(() => {
    merlinSaveTimers.delete(sessionId)
    void saveClientAgentSessionCache(MERLIN_AGENT_CACHE_TYPE, {
      sessionId,
      title: getMerlinSessionTitle(sessionId, sanitized),
      model,
      payload: sanitized,
      messageCount: sanitized.length,
      source: 'oasis-panel',
      lastActiveAt: getMerlinMessagesLastActiveAt(sanitized),
    }).catch(() => {
      // Ignore persistence errors.
    })
  }, 500))
}

function chooseRicherMerlinMessages(primary: MerlinMessage[], secondary: MerlinMessage[]): MerlinMessage[] {
  if (primary.length === 0) return secondary
  if (secondary.length === 0) return primary

  const score = (messages: MerlinMessage[]) => messages.reduce((total, message) => {
    return total + 10 + (message.events?.length || 0) * 3 + (message.content.trim() ? 1 : 0)
  }, 0)

  return score(primary) >= score(secondary) ? primary : secondary
}

function readInitialMerlinMessages(): MerlinMessage[] {
  const rememberedSessionId = readRememberedMerlinSessionId()
  if (!rememberedSessionId) return []
  return readMerlinSessionCache(rememberedSessionId)
}

function sanitizeMerlinSessionSummary(value: unknown): MerlinSessionSummary | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<MerlinSessionSummary>
  if (typeof entry.id !== 'string') return null
  if (typeof entry.label !== 'string') return null
  if (typeof entry.timestamp !== 'string') return null
  if (typeof entry.turnCount !== 'number' || !Number.isFinite(entry.turnCount)) return null
  if (typeof entry.fileSize !== 'number' || !Number.isFinite(entry.fileSize)) return null
  return {
    id: entry.id,
    label: entry.label,
    timestamp: entry.timestamp,
    turnCount: entry.turnCount,
    fileSize: entry.fileSize,
    model: typeof entry.model === 'string' ? entry.model : undefined,
  }
}

function formatMerlinSessionLabel(session: MerlinSessionSummary): string {
  return session.label
}

function buildCachedMerlinSessionSummary(
  record: ClientAgentSessionCacheRecord<MerlinMessage[]>,
): MerlinSessionSummary | null {
  const messages = sanitizeCachedMerlinMessages(record.payload)
  if (messages.length === 0) return null
  const timestamp = record.lastActiveAt || new Date(getMerlinMessagesLastActiveAt(messages)).toISOString()
  return {
    id: record.sessionId,
    label: record.title || getMerlinSessionTitle(record.sessionId, messages),
    timestamp,
    turnCount: messages.filter(message => message.role === 'user').length,
    fileSize: JSON.stringify(messages).length,
    model: record.model,
  }
}

function mergeMerlinSessionSummaries(
  primary: MerlinSessionSummary[],
  cached: MerlinSessionSummary[],
): MerlinSessionSummary[] {
  const byId = new Map<string, MerlinSessionSummary>()
  for (const session of cached) byId.set(session.id, session)
  for (const session of primary) byId.set(session.id, session)
  return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

function readRememberedMerlinSessionId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(MERLIN_SESSION_KEY) || ''
  } catch {
    return ''
  }
}

function readRememberedMerlinModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MERLIN_MODEL
  try {
    return localStorage.getItem(MERLIN_MODEL_KEY) || DEFAULT_MERLIN_MODEL
  } catch {
    return DEFAULT_MERLIN_MODEL
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL ICONS — visual shorthand for each Merlin tool
// ═══════════════════════════════════════════════════════════════════════════

const TOOL_ICONS: Record<string, string> = {
  get_world_info: '🌍',
  get_asset_catalog: '📚',
  place_object: '📦',
  craft_scene: '⚒️',
  set_ground_preset: '🌿',
  paint_ground_tiles: '🧱',
  set_avatar: '🪄',
  walk_avatar_to: '🚶',
  play_avatar_animation: '🎞️',
  get_world_state: '🗺️',
  query_objects: '🧭',
  search_assets: '🔎',
  modify_object: '🛠️',
  add_catalog_object: '📦',
  remove_object: '🗑️',
  add_crafted_scene: '⚒️',
  add_light: '💡',
  set_sky: '🌅',
  set_ground: '🌿',
  set_behavior: '🎭',
  clear_world: '💀',
  screenshot_viewport: '👁️',
  screenshot_avatar: '🖼️',
  avatarpic_merlin: '🪞',
  avatarpic_user: '🧍',
  generate_image: '🎨',
  generate_voice: '🔊',
  generate_video: '🎬',
}

const TOOL_LABELS: Record<string, string> = {
  get_world_info: 'Info',
  get_asset_catalog: 'Catalog',
  place_object: 'Place',
  craft_scene: 'Craft',
  set_ground_preset: 'Ground',
  paint_ground_tiles: 'Paint',
  get_world_state: 'World',
  query_objects: 'Query',
  search_assets: 'Assets',
  modify_object: 'Modify',
  add_catalog_object: 'Place',
  remove_object: 'Remove',
  add_crafted_scene: 'Craft',
  add_light: 'Light',
  set_sky: 'Sky',
  set_ground: 'Ground',
  set_behavior: 'Animate',
  set_avatar: 'Avatar',
  walk_avatar_to: 'Walk',
  play_avatar_animation: 'Clip',
  clear_world: 'Clear',
  screenshot_viewport: 'Look',
  screenshot_avatar: 'Avatar',
  avatarpic_merlin: 'Merlin Pic',
  avatarpic_user: 'User Pic',
  generate_image: 'Image',
  generate_voice: 'Voice',
  generate_video: 'Video',
}

const MERLIN_STANDALONE_MEDIA_URL_RE = /(?:https?:\/\/[^\s)]+|\/(?:generated-(?:images|voices|videos|music)|merlin\/screenshots)\/[^\s)]+)/gi

export function detectMerlinMediaType(path: string): MediaType | null {
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
    // Trusted media services — infer type from domain when extension is missing
    if (/(?:fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)/i.test(normalized)) {
      if (/video|mp4|webm/i.test(normalized)) return 'video'
      return 'image' // fal/replicate/dalle default to image
    }
    if (/(?:api\.elevenlabs\.io|elevenlabs\.io\/)/i.test(normalized)) return 'audio'
  }
  return null
}

function normalizeMerlinMediaPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed, 'http://oasis.local')
    return `${parsed.pathname}${parsed.search}`.toLowerCase()
  } catch {
    return trimmed.toLowerCase()
  }
}

function isStandaloneMerlinMediaPath(value: string): boolean {
  return !/\s/.test(value) && detectMerlinMediaType(value) !== null
}

function extractMerlinMediaReferences(content: string): Array<{ path: string; mediaType: MediaType }> {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('MEDIA:'))
    .map(line => line.slice('MEDIA:'.length).trim())
    .map(path => ({ path, mediaType: detectMerlinMediaType(path) }))
    .filter((entry): entry is { path: string; mediaType: MediaType } => !!entry.path && !!entry.mediaType)
}

function extractMerlinResultMediaReferences(result?: MerlinResultEvent): Array<{ path: string; mediaType: MediaType }> {
  if (!Array.isArray(result?.mediaUrls)) return []
  return result.mediaUrls
    .map(path => path.trim())
    .map(path => ({ path, mediaType: detectMerlinMediaType(path) }))
    .filter((entry): entry is { path: string; mediaType: MediaType } => !!entry.path && !!entry.mediaType)
}

function buildSuppressedMerlinMediaPathSet(events: MerlinEvent[]): Set<string> {
  const suppressed = new Set<string>()
  for (const event of events) {
    if (event.type !== 'result') continue
    for (const ref of extractMerlinResultMediaReferences(event as MerlinResultEvent)) {
      const normalized = normalizeMerlinMediaPath(ref.path)
      if (normalized) suppressed.add(normalized)
    }
  }
  return suppressed
}

function merlinMessageHasAudio(message: MerlinMessage): boolean {
  if (extractMerlinMediaReferences(message.content).some(ref => ref.mediaType === 'audio')) return true
  return (message.events || []).some(event =>
    event.type === 'result' && extractMerlinResultMediaReferences(event as MerlinResultEvent).some(ref => ref.mediaType === 'audio')
  )
}

function renderMerlinAssistantContent(
  content: string,
  autoPlayAudio: boolean,
  audioTargetAvatarId?: string | null,
  suppressedMediaPaths: Set<string> = new Set(),
): React.ReactNode {
  const blocks: React.ReactNode[] = []
  const textBuffer: string[] = []
  let key = 0

  const flushText = () => {
    const text = textBuffer.join('\n').trim()
    textBuffer.length = 0
    if (!text) return
    blocks.push(
      <div key={`text-${key += 1}`}>
        {renderMarkdown(text)}
      </div>
    )
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('MEDIA:')) {
      const path = trimmed.slice('MEDIA:'.length).trim()
      if (suppressedMediaPaths.has(normalizeMerlinMediaPath(path))) {
        continue
      }
      const mediaType = detectMerlinMediaType(path)
      if (mediaType) {
        flushText()
        blocks.push(
          <MediaBubble
            key={`media-${key += 1}`}
            url={path}
            mediaType={mediaType}
            prompt={`Merlin ${mediaType}`}
            compact
            autoPlay={mediaType === 'audio' ? autoPlayAudio : false}
            avatarLipSyncTargetId={mediaType === 'audio' ? audioTargetAvatarId : undefined}
          />
        )
        continue
      }
    }

    if (isStandaloneMerlinMediaPath(trimmed)) {
      if (suppressedMediaPaths.has(normalizeMerlinMediaPath(trimmed))) {
        continue
      }
      const mediaType = detectMerlinMediaType(trimmed)
      if (mediaType) {
        flushText()
        blocks.push(
          <MediaBubble
            key={`media-${key += 1}`}
            url={trimmed}
            mediaType={mediaType}
            prompt={`Merlin ${mediaType}`}
            compact
            autoPlay={mediaType === 'audio' ? autoPlayAudio : false}
            avatarLipSyncTargetId={mediaType === 'audio' ? audioTargetAvatarId : undefined}
          />
        )
        continue
      }
    }

    const sanitizedLine = line.replace(MERLIN_STANDALONE_MEDIA_URL_RE, (match) => (
      suppressedMediaPaths.has(normalizeMerlinMediaPath(match)) ? '' : match
    ))
    if (!sanitizedLine.trim()) continue

    textBuffer.push(sanitizedLine)
  }

  flushText()
  return blocks.length > 0 ? blocks : renderMarkdown(content)
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE PARSER — reads the ReadableStream from /api/merlin
// ═══════════════════════════════════════════════════════════════════════════

export async function* parseMerlinSSE(response: Response): AsyncGenerator<MerlinEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'data: [DONE]') return
      if (!trimmed.startsWith('data: ')) continue
      const json = trimmed.slice(6)
      try {
        yield JSON.parse(json) as MerlinEvent
      } catch {
        // malformed JSON chunk — skip
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim().startsWith('data: ')) {
    try {
      yield JSON.parse(buffer.trim().slice(6)) as MerlinEvent
    } catch { /* skip */ }
  }
}

function summarizeMerlinTool(event: MerlinToolEvent): string {
  let summary = ''
  switch (event.name) {
    case 'add_catalog_object':
    case 'place_object':
      summary = (event.args.catalogId as string) || (event.args.assetId as string) || ''
      break
    case 'modify_object':
      summary = (event.args.objectId as string) || ''
      break
    case 'query_objects':
    case 'search_assets':
      summary = (event.args.query as string) || ''
      break
    case 'walk_avatar_to':
      summary = (event.args.avatarId as string) || (event.args.agentType as string) || ''
      break
    case 'play_avatar_animation':
      summary = (event.args.clipName as string) || ''
      break
    case 'set_avatar':
      summary = (event.args.avatarId as string) || (event.args.agentType as string) || ''
      break
    case 'set_sky':
    case 'set_ground':
    case 'set_ground_preset':
      summary = (event.args.presetId as string) || ''
      break
    case 'add_crafted_scene':
    case 'craft_scene':
      summary = (event.args.name as string) || ''
      break
    case 'add_light':
      summary = (event.args.type as string) || ''
      break
  }
  return summary
}

function MerlinThinkingPill({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1">
      <button
        data-no-drag
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono transition-colors"
        style={{
          background: expanded ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.08)',
          border: '1px solid rgba(168,85,247,0.25)',
          color: 'rgba(168,85,247,0.7)',
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
        {expanded ? '▾' : '▸'} thinking ({content.length} chars)
      </button>
      {expanded && (
        <div
          className="mt-1 px-3 py-2 rounded-lg text-[10px] font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap"
          style={{
            background: 'rgba(168,85,247,0.06)',
            border: '1px solid rgba(168,85,247,0.15)',
            color: 'rgba(168,85,247,0.55)',
            maxHeight: 200,
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

function renderMerlinEventTimeline(
  events: MerlinEvent[],
  autoPlayAudio: boolean,
  audioTargetAvatarId?: string | null,
): React.ReactNode[] {
  const blocks: React.ReactNode[] = []
  const textBuffer: string[] = []
  let key = 0
  let audioPlaybackSpent = false
  const suppressedMediaPaths = buildSuppressedMerlinMediaPathSet(events)

  const flushText = () => {
    const text = textBuffer.join('\n').trim()
    textBuffer.length = 0
    if (!text) return
    blocks.push(
      <div
        key={`timeline-text-${key += 1}`}
        className="text-xs text-gray-200 leading-relaxed px-3 py-2 rounded-lg"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      >
        {renderMerlinAssistantContent(text, false, audioTargetAvatarId, suppressedMediaPaths)}
      </div>
    )
  }

  // Build a result lookup by toolId and name for proper pairing
  // Build result lookup: prefer toolId matching, fall back to name matching
  const resultByToolId = new Map<string, MerlinResultEvent>()
  const resultsByName = new Map<string, MerlinResultEvent[]>()
  for (const event of events) {
    if (event.type !== 'result') continue
    const re = event as MerlinResultEvent
    if (re.toolId) {
      resultByToolId.set(re.toolId, re)
    } else {
      const list = resultsByName.get(re.name) || []
      list.push(re)
      resultsByName.set(re.name, list)
    }
  }

  let thinkingBuffer: string[] = []
  const flushThinking = () => {
    const thinking = thinkingBuffer.join('')
    thinkingBuffer = []
    if (!thinking) return
    blocks.push(
      <MerlinThinkingPill key={`timeline-thinking-${key += 1}`} content={thinking} />
    )
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    if (event.type === 'text') {
      flushThinking()
      textBuffer.push(event.content)
      continue
    }
    if (event.type === 'thinking') {
      thinkingBuffer.push(event.content)
      continue
    }
    if (event.type === 'error') {
      flushThinking()
      textBuffer.push(`⚠️ ${event.message}`)
      continue
    }
    if (event.type === 'result') {
      // Results are consumed by tool pairing above — skip in main loop
      continue
    }
    if (event.type === 'tool') {
      flushThinking()
      flushText()
      const toolEvent = event as MerlinToolEvent
      // Match result by toolId first, then fall back to next unmatched result by name
      let result: MerlinResultEvent | undefined
      if (toolEvent.toolId && resultByToolId.has(toolEvent.toolId)) {
        result = resultByToolId.get(toolEvent.toolId)
      } else {
        // Fall back: pop next result matching this tool name
        const nameQueue = resultsByName.get(toolEvent.name)
        if (nameQueue?.length) {
          result = nameQueue.shift()
        }
      }
      const hasAudio = extractMerlinResultMediaReferences(result).some(ref => ref.mediaType === 'audio')
      const shouldAutoPlay = autoPlayAudio && hasAudio && !audioPlaybackSpent
      if (shouldAutoPlay) audioPlaybackSpent = true
      blocks.push(
        <AgentToolCallCard
          key={`timeline-tool-${key += 1}`}
          name={toolEvent.name}
          label={TOOL_LABELS[toolEvent.name] || toolEvent.name}
          icon={TOOL_ICONS[toolEvent.name] || '🔧'}
          summary={summarizeMerlinTool(toolEvent)}
          input={toolEvent.args}
          result={result ? {
            ok: result.ok,
            message: result.message,
            detail: result.message,
          } : undefined}
          media={extractMerlinResultMediaReferences(result)}
          autoPlayAudio={shouldAutoPlay}
          audioTargetAvatarId={audioTargetAvatarId}
          showResultMessage={Boolean(result?.message && result.ok === false)}
          mediaCompact={!['screenshot_viewport', 'screenshot_avatar', 'avatarpic_merlin', 'avatarpic_user'].includes(toolEvent.name)}
        />
      )
    }
  }
  flushThinking()

  flushText()
  return blocks
}

// ═══════════════════════════════════════════════════════════════════════════
// MERLIN PANEL — Main component
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 16, y: 120 }
const MIN_WIDTH = 320
const MIN_HEIGHT = 300
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 520

function getViewportBounds() {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function MerlinPanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
}: {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}) {
  useUILayer('merlin', isOpen && !embedded)
  const { settings } = useContext(SettingsContext)
  const [messages, setMessages] = useState<MerlinMessage[]>(() => readInitialMerlinMessages())
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingAccumulator, setThinkingAccumulator] = useState('')
  const [toolCount, setToolCount] = useState(() => countToolEvents(readInitialMerlinMessages()))
  const [selectedSessionId, setSelectedSessionId] = useState(readRememberedMerlinSessionId)
  const [sessionHistory, setSessionHistory] = useState<MerlinSessionSummary[]>([])
  const [model, setModel] = useState(readRememberedMerlinModel)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [autoPlayMediaMessageId, setAutoPlayMediaMessageId] = useState('')
  const [visionCaptureUrl, setVisionCaptureUrl] = useState('')
  const [visionCaptureError, setVisionCaptureError] = useState('')
  const [visionCapturedAt, setVisionCapturedAt] = useState<number | null>(null)
  const [isCapturingVision, setIsCapturingVision] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loadRequestIdRef = useRef(0)
  const hydratedSessionIdRef = useRef('')
  const activityRunIdRef = useRef<string | null>(null)
  const activeWorldName = useOasisStore(s => s.worldRegistry.find((w: { id: string; name: string }) => w.id === s.activeWorldId)?.name || 'unknown')
  const activeSession = sessionHistory.find(session => session.id === selectedSessionId) || null
  const merlinAvatar = useOasisStore(state => state.placedAgentAvatars.find(entry => entry.agentType === 'merlin') || null)
  const assignMerlinAvatar = useOasisStore(state => state.assignMerlinAvatar)
  const startAgentWork = useOasisStore(state => state.startAgentWork)
  const setAgentWorkTool = useOasisStore(state => state.setAgentWorkTool)
  const finishAgentWork = useOasisStore(state => state.finishAgentWork)
  const failAgentWork = useOasisStore(state => state.failAgentWork)
  const voiceInput = useAgentVoiceInput({
    enabled: isOpen,
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => {
      setInput(current => (current ? `${current} ${transcript}`.trim() : transcript))
    },
    focusTargetRef: inputRef as React.RefObject<HTMLElement>,
    enablePlayerLipSync: true,
  })

  useEffect(() => () => {
    const runId = activityRunIdRef.current
    if (!runId) return
    activityRunIdRef.current = null
    finishAgentWork('merlin', runId)
  }, [finishAgentWork])

  // Textarea grows with content (oasisspec3)
  useAutoresizeTextarea(inputRef, input, { minPx: 36, maxPx: 160 })

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState<MerlinPanelPosition>(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-merlin-pos')
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const positionRef = useRef(position)

  // ─═̷─ Resize state ─═̷─
  const [size, setSize] = useState<MerlinPanelSize>(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem('oasis-merlin-size')
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const sizeRef = useRef(size)

  const persistGeometry = useCallback((nextPosition: MerlinPanelPosition, nextSize: MerlinPanelSize) => {
    writeBrowserStorage('oasis-merlin-pos', JSON.stringify(nextPosition))
    writeBrowserStorage('oasis-merlin-size', JSON.stringify(nextSize))
  }, [])

  const applyGeometry = useCallback((nextPosition: MerlinPanelPosition, nextSize: MerlinPanelSize) => {
    if (typeof window === 'undefined') return { position: nextPosition, size: nextSize }
    const clamped = clampMerlinGeometry(
      nextPosition,
      nextSize,
      getViewportBounds(),
      MIN_WIDTH,
      MIN_HEIGHT,
    )
    positionRef.current = clamped.position
    sizeRef.current = clamped.size
    setPosition(prev => prev.x === clamped.position.x && prev.y === clamped.position.y ? prev : clamped.position)
    setSize(prev => prev.w === clamped.size.w && prev.h === clamped.size.h ? prev : clamped.size)
    persistGeometry(clamped.position, clamped.size)
    return clamped
  }, [persistGeometry])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - positionRef.current.x, y: e.clientY - positionRef.current.y }
  }, [])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    applyGeometry(
      { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y },
      sizeRef.current,
    )
  }, [applyGeometry, isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // ─═̷─ Resize handlers ─═̷─
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const newW = Math.max(MIN_WIDTH, resizeStart.current.w + (e.clientX - resizeStart.current.x))
    const newH = Math.max(MIN_HEIGHT, resizeStart.current.h + (e.clientY - resizeStart.current.y))
    applyGeometry(positionRef.current, { w: newW, h: newH })
  }, [applyGeometry, isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd, isResizing, handleResize, handleResizeEnd])

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    sizeRef.current = size
  }, [size])

  useEffect(() => {
    if (typeof window === 'undefined') return
    applyGeometry(positionRef.current, sizeRef.current)

    const handleWindowResize = () => {
      applyGeometry(positionRef.current, sizeRef.current)
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [applyGeometry])

  // Auto-scroll on new messages — imperative scrollTop matches AnorakProPanel
  // and avoids the scrollIntoView bug that nukes drei CSS3D matrix3d wrappers.
  // See matching comment in HermesPanel.tsx for the full root-cause writeup.
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [messages, isStreaming, autoScroll])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(atBottom)
    }

    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [messages.length, isOpen])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100)
  }, [isOpen])

  useEffect(() => {
    if (selectedSessionId) writeBrowserStorage(MERLIN_SESSION_KEY, selectedSessionId)
    else removeBrowserStorage(MERLIN_SESSION_KEY)
  }, [selectedSessionId])

  useEffect(() => {
    writeBrowserStorage(MERLIN_MODEL_KEY, model)
  }, [model])

  useEffect(() => {
    if (!selectedSessionId || messages.length === 0) return
    writeMerlinSessionCache(selectedSessionId, messages, model)
  }, [messages, model, selectedSessionId])

  useEffect(() => {
    void migrateLegacyMerlinStorage()
  }, [])

  const fetchSessions = useCallback(async (preferredSessionId?: string) => {
    try {
      const [response, cachedRecords] = await Promise.all([
        fetch('/api/merlin/sessions', { cache: 'no-store' }),
        listClientAgentSessionCaches<MerlinMessage[]>(MERLIN_AGENT_CACHE_TYPE, 100),
      ])
      const data = await response.json().catch(() => null) as {
        available?: boolean
        sessions?: unknown[]
      } | null
      const remoteSessions = response.ok && Array.isArray(data?.sessions)
        ? data.sessions
          .map(sanitizeMerlinSessionSummary)
          .filter((session): session is MerlinSessionSummary => !!session)
        : []
      const cachedSessions = cachedRecords
        .map(buildCachedMerlinSessionSummary)
        .filter((session): session is MerlinSessionSummary => !!session)
      const sessions = mergeMerlinSessionSummaries(remoteSessions, cachedSessions)
      setSessionHistory(sessions)
      setSelectedSessionId(current => {
        let next = current
        if (preferredSessionId !== undefined) {
          next = preferredSessionId
        }
        if (next && sessions.some(session => session.id === next)) return next
        if (!next) return ''
        if (next === NEW_SESSION_VALUE) return ''
        return sessions[0]?.id || ''
      })
      setSessionsLoaded(true)
    } catch (error) {
      console.error('[Merlin] Failed to fetch sessions:', error)
    }
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    if (isStreaming || !sessionId) return
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    hydratedSessionIdRef.current = ''
    setIsLoadingSession(true)
    setSelectedSessionId(sessionId)
    let cachedMessages: MerlinMessage[] = []
    try {
      cachedMessages = await readPersistedMerlinSessionCache(sessionId)
    } catch {
      cachedMessages = readMerlinSessionCache(sessionId)
    }
    if (requestId !== loadRequestIdRef.current) {
      setIsLoadingSession(false)
      return
    }
    setMessages(cachedMessages)
    setAutoScroll(true)
    setToolCount(countToolEvents(cachedMessages))
    setInput('')
    setAutoPlayMediaMessageId('')
    try {
      const response = await fetch(`/api/merlin/sessions?id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as {
        available?: boolean
        model?: string
        messages?: unknown[]
      } | null
      if (requestId !== loadRequestIdRef.current) return
      if (!response.ok || !Array.isArray(data?.messages)) {
        // Mark this session as "attempted" even on 404/invalid so the
        // hydrate effect's guard (hydratedSessionIdRef.current === selectedSessionId)
        // trips on next fire and we don't loop. Without this, the finally block
        // flips isLoadingSession false -> effect re-fires -> loadSession -> 404 -> repeat
        // at HTTP-latency cadence, wiping the input field and flickering the UI.
        hydratedSessionIdRef.current = sessionId
        return
      }

      const remoteMessages = data.messages
        .map(sanitizeMerlinMessage)
        .filter((message): message is MerlinMessage => !!message)
      const nextMessages = chooseRicherMerlinMessages(remoteMessages, cachedMessages)
      setMessages(nextMessages)
      setToolCount(countToolEvents(nextMessages))
      setModel(typeof data.model === 'string' ? data.model : DEFAULT_MERLIN_MODEL)
      writeMerlinSessionCache(sessionId, nextMessages, typeof data.model === 'string' ? data.model : DEFAULT_MERLIN_MODEL)
      hydratedSessionIdRef.current = sessionId
    } catch (error) {
      console.error('[Merlin] Failed to load session:', error)
      if (requestId !== loadRequestIdRef.current) return
      hydratedSessionIdRef.current = sessionId
      if (cachedMessages.length > 0) {
        setMessages(cachedMessages)
        setToolCount(countToolEvents(cachedMessages))
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setIsLoadingSession(false)
      }
    }
  }, [isStreaming])

  useEffect(() => {
    if (!isOpen || sessionsLoaded) return
    void fetchSessions()
  }, [fetchSessions, isOpen, sessionsLoaded])

  useEffect(() => {
    if (!isOpen || !selectedSessionId || isStreaming || isLoadingSession) return
    if (hydratedSessionIdRef.current === selectedSessionId) return
    void loadSession(selectedSessionId)
  }, [isLoadingSession, isOpen, selectedSessionId, isStreaming, loadSession])

  const startFreshSession = useCallback(() => {
    if (isStreaming) return
    loadRequestIdRef.current += 1
    hydratedSessionIdRef.current = ''
    setSelectedSessionId('')
    setMessages([])
    setAutoScroll(true)
    setToolCount(0)
    setInput('')
    setAutoPlayMediaMessageId('')
  }, [isStreaming])

  const clearCurrentSession = useCallback(() => {
    if (isStreaming) return
    loadRequestIdRef.current += 1
    hydratedSessionIdRef.current = ''
    setSelectedSessionId('')
    setMessages([])
    setAutoScroll(true)
    setToolCount(0)
    setInput('')
    setAutoPlayMediaMessageId('')
  }, [isStreaming])

  const captureMerlinVision = useCallback(async () => {
    if (isCapturingVision) return
    if (!merlinAvatar?.id) {
      setVisionCaptureError('Give Merlin an avatar first so he has a body to see from.')
      return
    }

    setIsCapturingVision(true)
    setVisionCaptureError('')

    try {
      const response = await fetch('/api/oasis-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'screenshot_viewport',
          args: {
            format: 'jpeg',
            quality: 0.82,
            width: 960,
            height: 540,
            views: [{
              id: 'merlin-phantom',
              mode: 'agent-avatar-phantom',
              agentType: 'merlin',
              distance: 1,
              heightOffset: 1.55,
              lookAhead: 6,
              fov: 100,
            }],
          },
        }),
      })

      const data = await response.json().catch(() => null) as {
        ok?: boolean
        error?: string
        message?: string
        data?: {
          format?: 'jpeg' | 'png' | 'webp'
          base64?: string
          captures?: Array<{ format?: 'jpeg' | 'png' | 'webp'; base64?: string; url?: string }>
        }
      } | null

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`)
      }

      const capture = Array.isArray(data.data?.captures)
        ? data.data?.captures.find(entry => (typeof entry?.url === 'string' && entry.url.length > 0) || (typeof entry?.base64 === 'string' && entry.base64.length > 0)) || null
        : typeof data.data?.base64 === 'string' && data.data.base64.length > 0
          ? { base64: data.data.base64, format: data.data.format }
          : null

      if (!capture?.url && !capture?.base64) {
        throw new Error('Merlin could not see anything yet.')
      }

      if (capture.url) {
        setVisionCaptureUrl(capture.url)
        setVisionCapturedAt(Date.now())
        return
      }

      const format = capture.format === 'png' || capture.format === 'webp' || capture.format === 'jpeg'
        ? capture.format
        : 'jpeg'

      setVisionCaptureUrl(`data:image/${format};base64,${capture.base64}`)
      setVisionCapturedAt(Date.now())
    } catch (error) {
      setVisionCaptureError(error instanceof Error ? error.message : 'Merlin vision failed.')
    } finally {
      setIsCapturingVision(false)
    }
  }, [isCapturingVision, merlinAvatar?.id])

  // ─═̷─═̷─ INVOKE MERLIN ─═̷─═̷─
  const invoke = useCallback(async () => {
    const worldId = useOasisStore.getState().activeWorldId
    if (!input.trim() || !worldId || isStreaming) return

    const userPrompt = input.trim()
    const activeSessionId = selectedSessionId || undefined
    setAutoScroll(true)
    setInput('')
    setToolCount(0)
    setAutoPlayMediaMessageId('')

    const userId = `user-${Date.now()}`
    const userMessage: MerlinMessage = {
      id: userId,
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    }

    const merlinId = `merlin-${Date.now()}`
    const merlinMsg: MerlinMessage = {
      id: merlinId,
      role: 'merlin',
      content: '',
      events: [],
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMessage, merlinMsg])
    setIsStreaming(true)
    const activityRunId = `merlin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    activityRunIdRef.current = activityRunId
    startAgentWork('merlin', activityRunId, activeSessionId)
    const finishActivity = () => {
      if (activityRunIdRef.current !== activityRunId) return
      activityRunIdRef.current = null
      finishAgentWork('merlin', activityRunId)
    }
    const failActivity = () => {
      if (activityRunIdRef.current !== activityRunId) return
      activityRunIdRef.current = null
      failAgentWork('merlin', activityRunId)
    }

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/merlin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worldId,
          prompt: userPrompt,
          model,
          sessionId: activeSessionId,
          playerContext: {
            avatar: getPlayerAvatarPose(),
            camera: getCameraSnapshot(),
          },
        }),
        signal: abort.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: `Error ${res.status}: ${errText}` } : m
        ))
        failActivity()
        return
      }

      let textAccumulator = ''
      let thinkingAcc = ''
      let streamEvents: MerlinEvent[] = []
      let tools = 0
      setIsThinking(false)
      setThinkingAccumulator('')
      let resolvedSessionId = activeSessionId || ''
      for await (const event of parseMerlinSSE(res)) {
        if (abort.signal.aborted) break

        switch (event.type) {
          case 'session':
            if (event.sessionId) {
              resolvedSessionId = event.sessionId
              hydratedSessionIdRef.current = event.sessionId
              setSelectedSessionId(event.sessionId)
              void fetchSessions(event.sessionId)
            }
            streamEvents = [...streamEvents, event]
            break
          case 'thinking':
            thinkingAcc += event.content
            setThinkingAccumulator(thinkingAcc)
            setIsThinking(true)
            streamEvents = [...streamEvents, event]
            break
          case 'text':
            setIsThinking(false)
            textAccumulator += event.content
            setAgentWorkTool('merlin', activityRunId, null)
            streamEvents = [...streamEvents, event]
            break
          case 'tool':
            tools++
            setToolCount(tools)
            setAgentWorkTool('merlin', activityRunId, event.name || 'tool')
            streamEvents = [...streamEvents, event]
            break
          case 'usage':
            streamEvents = [...streamEvents, event]
            break
          case 'result':
            streamEvents = [...streamEvents, event]
            setAgentWorkTool('merlin', activityRunId, null)
            if (event.ok && MERLIN_VISION_TOOL_NAMES.has(event.name)) {
              const firstImageRef = extractMerlinResultMediaReferences(event).find(ref => ref.mediaType === 'image')
              if (firstImageRef?.path) {
                setVisionCaptureError('')
                setVisionCaptureUrl(firstImageRef.path)
                setVisionCapturedAt(Date.now())
              }
            }
            if (
              event.ok
              && autoPlayMediaMessageId !== merlinId
              && extractMerlinResultMediaReferences(event).some(ref => ref.mediaType === 'audio')
            ) {
              setAutoPlayMediaMessageId(merlinId)
            }
            break
          case 'error':
            textAccumulator += `\n⚠️ ${event.message}`
            break
          case 'done':
            if (event.sessionId) {
              resolvedSessionId = event.sessionId
              hydratedSessionIdRef.current = event.sessionId
              setSelectedSessionId(event.sessionId)
            } else if (resolvedSessionId) {
              hydratedSessionIdRef.current = resolvedSessionId
              setSelectedSessionId(resolvedSessionId)
            }
            void fetchSessions(event.sessionId || resolvedSessionId || undefined)
            break
        }

        // Update the Merlin message in place
        const updatedEvents = [...streamEvents]
        const updatedText = textAccumulator
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: updatedText, events: updatedEvents } : m
        ))
      }

      if (!abort.signal.aborted) {
        const hasAudio = merlinMessageHasAudio({
          id: merlinId,
          role: 'merlin',
          content: textAccumulator,
          events: streamEvents,
          timestamp: Date.now(),
        })
        setAutoPlayMediaMessageId(hasAudio ? merlinId : '')
      }
      finishActivity()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: m.content + `\n⚠️ ${(err as Error).message}` } : m
        ))
        failActivity()
      } else {
        finishActivity()
      }
    } finally {
      finishActivity()
      setIsStreaming(false)
      setIsThinking(false)
      abortRef.current = null
    }
  }, [autoPlayMediaMessageId, failAgentWork, fetchSessions, finishAgentWork, input, isStreaming, model, selectedSessionId, setAgentWorkTool, startAgentWork])

  // Cancel streaming
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    const runId = activityRunIdRef.current
    if (runId) {
      activityRunIdRef.current = null
      finishAgentWork('merlin', runId)
    }
    setIsStreaming(false)
  }, [finishAgentWork])

  const renderedMessages = useMemo(() => messages.map(msg => (
    <div key={msg.id}>
      {msg.role === 'user' ? (
        <div className="flex justify-end">
          <div
            className="max-w-[85%] px-3 py-2 rounded-lg text-xs text-gray-200"
            style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.2)' }}
          >
            {msg.content}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {msg.events && msg.events.some(event => event.type === 'text') ? (
            <div className="space-y-1.5">
              {renderMerlinEventTimeline(
                msg.events,
                autoPlayMediaMessageId === msg.id,
                merlinAvatar?.id,
              )}
            </div>
          ) : msg.content && (
            <div className="text-xs text-gray-200 leading-relaxed px-3 py-2 rounded-lg"
              style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
              {renderMerlinAssistantContent(
                msg.content,
                autoPlayMediaMessageId === msg.id,
                merlinAvatar?.id,
              )}
            </div>
          )}

          {msg.events && msg.events.length > 0 && !msg.events.some(event => event.type === 'text') && (
            <div className="space-y-1.5">
              {renderMerlinEventTimeline(
                msg.events,
                autoPlayMediaMessageId === msg.id,
                merlinAvatar?.id,
              )}
            </div>
          )}

          {isStreaming && msg === messages[messages.length - 1] && (
            isThinking && thinkingAccumulator ? (
              <MerlinThinkingPill content={thinkingAccumulator} />
            ) : (
              <div className="flex items-center gap-2 text-[10px] text-purple-400/60 font-mono">
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                {isThinking ? 'thinking...' : 'streaming...'}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )), [autoPlayMediaMessageId, isStreaming, isThinking, thinkingAccumulator, merlinAvatar?.id, messages])

  const isVisible = embedded || isOpen
  if (!isVisible || typeof document === 'undefined') return null

  // ─═̷─═̷─ RENDER ─═̷─═̷─
  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'merlin-panel'}
      data-ui-panel={embedded ? '' : undefined}
      className={`${embedded ? 'relative w-full h-full' : 'fixed z-[9998]'} rounded-xl flex flex-col overflow-hidden`}
      style={{
        ...(embedded ? {} : { left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        backgroundColor: `rgba(0, 0, 0, ${settings.uiOpacity})`,
        border: `1px solid ${isStreaming ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.25)'}`,
        boxShadow: isStreaming
          ? '0 0 30px rgba(168,85,247,0.3), inset 0 0 40px rgba(168,85,247,0.05)'
          : '0 8px 32px rgba(0,0,0,0.6)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
        ...(embedded ? EMBEDDED_SCROLL_SURFACE_STYLE : {}),
      }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div
        onMouseDown={embedded ? undefined : handleDragStart}
        className={`flex items-center justify-between px-3 py-2 border-b border-white/10 select-none ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(30,30,30,0.3)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-lg ${isStreaming ? 'animate-pulse' : ''}`}>🧙</span>
          <span className="text-purple-400 font-bold text-sm">Merlin</span>
          <span className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]" title={activeWorldName}>
            → {activeWorldName}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-purple-300 animate-pulse font-mono">
              ● building ({toolCount} tools)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isStreaming && (
            <button
              onClick={cancel}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer"
            >
              stop
            </button>
          )}
          <button
            onClick={captureMerlinVision}
            disabled={isCapturingVision}
            className="px-2 py-0.5 rounded text-[10px] font-mono text-sky-200 border border-sky-400/25 hover:bg-sky-400/10 transition-all cursor-pointer disabled:opacity-50"
            title={merlinAvatar ? 'Capture Merlin phantom view' : 'Give Merlin an avatar first'}
          >
            {isCapturingVision ? 'seeing...' : 'view'}
          </button>
          <button
            onClick={() => setShowAvatarGallery(true)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer ${
              merlinAvatar
                ? 'text-amber-200 border-amber-400/35 hover:bg-amber-400/10'
                : 'text-gray-300 border-white/10 hover:bg-white/5'
            }`}
            title={merlinAvatar ? 'Change Merlin avatar' : 'Choose Merlin avatar'}
          >
            avatar
          </button>
          <button
            onClick={clearCurrentSession}
            className="text-gray-500 hover:text-red-400 text-xs transition-colors cursor-pointer"
            title="Detach from the current Merlin session and clear this window"
          >
            🗑️
          </button>
          {!hideCloseButton && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ═══ MESSAGES ═══ */}
      <div
        className="px-3 py-2 border-b border-white/10 flex flex-col gap-2 text-[10px] font-mono"
        style={{ background: 'rgba(10,10,16,0.55)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-purple-300/70 uppercase">session</span>
          <select
            value={selectedSessionId || NEW_SESSION_VALUE}
            onChange={event => {
              const next = event.target.value
              if (next === NEW_SESSION_VALUE) startFreshSession()
              else void loadSession(next)
            }}
            disabled={isStreaming}
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-purple-100 outline-none disabled:opacity-50"
          >
            <option value={NEW_SESSION_VALUE}>+ new chat</option>
            {sessionHistory.map(session => (
              <option key={session.id} value={session.id}>
                {formatMerlinSessionLabel(session)}
              </option>
            ))}
          </select>
          <button
            onClick={startFreshSession}
            disabled={isStreaming}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-purple-200/80 hover:text-purple-100 border border-purple-500/25 hover:border-purple-400/50 transition-all cursor-pointer disabled:opacity-50"
            title="Start a fresh Merlin session"
          >
            + new
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-purple-300/70 uppercase">model</span>
          <select
            value={model}
            onChange={event => setModel(event.target.value)}
            disabled={isStreaming}
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-purple-100 outline-none disabled:opacity-50"
          >
            {MERLIN_MODELS.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-gray-500 truncate max-w-[160px]" title={activeSession?.id || 'Merlin attaches to Claude Code CLI sessions'}>
            {isLoadingSession
              ? 'loading...'
              : activeSession
                ? formatMerlinSessionLabel(activeSession)
                : selectedSessionId
                  ? `${selectedSessionId.slice(0, 8)}...`
                  : 'new Claude session'}
          </span>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        data-agent-window-scroll-root=""
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent', ...EMBEDDED_SCROLL_SURFACE_STYLE }}
      >
        {(visionCaptureUrl || visionCaptureError || merlinAvatar) && (
          <div
            className="rounded-xl border px-3 py-2 space-y-2"
            style={{
              borderColor: visionCaptureError ? 'rgba(239,68,68,0.35)' : 'rgba(56,189,248,0.25)',
              background: 'rgba(7,12,20,0.75)',
            }}
          >
            <div className="flex items-center justify-between gap-3 text-[10px] font-mono">
              <span className="text-sky-200">Merlin vision</span>
              <span className="text-gray-500">
                {merlinAvatar ? 'avatar online' : 'no avatar'}
                {visionCapturedAt ? ` - ${new Date(visionCapturedAt).toLocaleTimeString()}` : ''}
              </span>
            </div>
            {visionCaptureUrl && (
              <img
                src={visionCaptureUrl}
                alt="Merlin phantom view"
                className="w-full rounded-lg border border-white/10"
                style={{ maxHeight: 220, objectFit: 'cover' }}
              />
            )}
            {!visionCaptureUrl && merlinAvatar && !visionCaptureError && (
              <div className="text-[11px] text-gray-400">Tap `view` and Merlin will show you what his phantom camera sees.</div>
            )}
            {visionCaptureError && (
              <div className="text-[11px] text-red-300">{visionCaptureError}</div>
            )}
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-4xl mb-3" style={{ animation: 'merlinFloat 3s ease-in-out infinite' }}>🧙</span>
            <p className="text-sm mb-1">I am Merlin.</p>
            <p className="text-xs text-gray-600 text-center px-4">
              Tell me what to build and I shall conjure it into existence.
            </p>
            <div className="mt-4 space-y-1 text-[10px] text-gray-600 font-mono">
              <p className="text-purple-500/60">try:</p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('build a medieval village with a central fountain')}>
                &quot;build a medieval village with a fountain&quot;
              </p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('create a cozy forest clearing with campfire and lanterns')}>
                &quot;forest clearing with campfire and lanterns&quot;
              </p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('set the sky to sunset and ground to grass, then place 10 random trees')}>
                &quot;sunset sky, grass, 10 random trees&quot;
              </p>
            </div>
          </div>
        )}

        {renderedMessages}

        <div ref={messagesEndRef} />
      </div>

      {!autoScroll && messages.length > 0 && (
        <div className="pointer-events-none absolute bottom-20 right-3">
          <button
            type="button"
            data-no-drag
            className="pointer-events-auto px-2 py-1 rounded-full text-[10px] font-mono border border-purple-500/25 bg-black/70 text-purple-100 hover:border-purple-400/50"
            onClick={() => {
              setAutoScroll(true)
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
              }
            }}
          >
            v auto-scroll
          </button>
        </div>
      )}

      {/* ═══ INPUT ═══ */}
      <div className="px-3 py-2 border-t border-white/10">
        {!voiceInput.error && voiceInput.backendState === 'loading' && voiceInput.backendMessage && (
          <div className="mb-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-mono text-sky-100">
            {voiceInput.backendMessage}
          </div>
        )}
        {voiceInput.error && (
          <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-mono text-amber-100">
            {voiceInput.error}
          </div>
        )}
        <div className="flex gap-2">
          <AgentVoiceInputButton
            controller={voiceInput}
            disabled={isStreaming}
            className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-purple-100 disabled:opacity-30 disabled:cursor-not-allowed"
            titleReady="Record from your device mic and drop the local Whisper transcript into Merlin's prompt."
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invoke() } }}
            maxLength={4000}
            rows={1}
            placeholder={isStreaming ? 'Merlin is building...' : 'Tell Merlin what to build...'}
            className="flex-1 px-3 py-2 rounded-lg text-white text-xs outline-none placeholder-gray-600 resize-none font-mono"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${isStreaming ? 'rgba(168,85,247,0.3)' : 'rgba(168,85,247,0.15)'}`,
              // Height managed by useAutoresizeTextarea
            }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : invoke}
            disabled={!isStreaming && !input.trim()}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
            style={{
              background: isStreaming
                ? 'rgba(239,68,68,0.4)'
                : 'linear-gradient(135deg, rgba(168,85,247,0.5) 0%, rgba(139,92,246,0.5) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.5)' : 'rgba(168,85,247,0.4)'}`,
            }}
          >
            {isStreaming ? '■' : '▸'}
          </button>
        </div>
      </div>

      {/* ═══ RESIZE HANDLE ═══ */}
      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(168,85,247,0.4) 50%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      )}
      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={merlinAvatar?.avatar3dUrl || null}
          onSelect={(avatarUrl) => {
            assignMerlinAvatar(avatarUrl)
            setShowAvatarGallery(false)
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}

      {/* ═══ ANIMATIONS ═══ */}
      <style>{`
        @keyframes merlinFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
