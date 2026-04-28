'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

import { useOasisStore } from '@/store/oasisStore'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { CollapsibleBlock, renderMarkdown } from '@/lib/anorak-renderers'
import {
  collapseConsecutiveHermesAssistantTurns,
  collapseDuplicateHermesMessages,
  mergeHydratedHermesMessages,
  shouldPreferHydratedHermesMessages,
} from '@/lib/hermes-message-merge'
import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { getPlayerAvatarPose } from '@/lib/player-avatar-runtime'
import { getCameraSnapshot } from '@/lib/camera-bridge'
import { MediaBubble, type MediaType } from './MediaBubble'
import { AvatarGallery } from './AvatarGallery'
import { AgentToolCallCard } from './AgentToolCallCard'
import { AgentVoiceInputButton } from './AgentVoiceInputButton'
import {
  getClientAgentSessionCache,
  listClientAgentSessionCaches,
  saveClientAgentSessionCache,
  saveClientAgentSessionCaches,
  type ClientAgentSessionCacheRecord,
} from '@/lib/agent-session-cache-client'
import { removeBrowserStorage, writeBrowserStorage } from '@/lib/browser-storage'

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
}

interface HermesStatus {
  configured: boolean
  connected: boolean
  base: string | null
  apiKey?: string | null
  defaultModel: string | null
  systemPrompt?: string | null
  models: string[]
  source?: 'pairing' | 'env' | 'none'
  canMutateConfig?: boolean
  error?: string
}

interface HermesTunnelStatus {
  configured: boolean
  running: boolean
  processAlive: boolean
  processMatches: boolean
  healthy: boolean
  health: 'unconfigured' | 'saved' | 'stopped' | 'stale' | 'partial' | 'healthy'
  apiForwardReachable: boolean
  apiForwardConfigured: boolean
  reverseForwardConfigured: boolean
  issues: string[]
  command: string
  commandPreview?: string
  autoStart: boolean
  canMutateConfig?: boolean
  updatedAt?: string | null
  lastStartedAt?: string | null
  error?: string
}

interface HermesToolCall {
  index: number
  id?: string
  name: string
  arguments: string
  resultOk?: boolean
  resultMessage?: string
  resultDetail?: string
  mediaPaths?: string[]
}

interface HermesVisionCapture {
  displayUrl: string
  threadMediaRef?: string
}

interface HermesUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

interface HermesNativeSessionSummary {
  id: string
  title: string | null
  preview: string
  source: string
  model: string | null
  startedAt: number | null
  lastActiveAt: number | null
  messageCount: number
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  tools?: HermesToolCall[]
  usage?: HermesUsage
  finishReason?: string
  error?: string
  timestamp: number
}

interface HermesTextEvent { type: 'text'; content: string }
interface HermesReasoningEvent { type: 'reasoning'; content: string }
interface HermesToolEvent { type: 'tool'; index: number; id?: string; name?: string; argumentsChunk?: string }
interface HermesUsageEvent { type: 'usage'; promptTokens?: number; completionTokens?: number; totalTokens?: number }
interface HermesDoneEvent { type: 'done'; finishReason?: string }
interface HermesMetaEvent { type: 'meta'; model?: string; upstream?: string; sessionId?: string; sessionMode?: 'compat' | 'native' }
interface HermesErrorEvent { type: 'error'; message: string }

type HermesEvent =
  | HermesTextEvent
  | HermesReasoningEvent
  | HermesToolEvent
  | HermesUsageEvent
  | HermesDoneEvent
  | HermesMetaEvent
  | HermesErrorEvent

const DEFAULT_POS = { x: 16, y: 120 }
const DEFAULT_SIZE = { w: 420, h: 620 }
const MIN_WIDTH = 360
const MIN_HEIGHT = 360
// ░▒▓ VANISH-ON-SCROLL FIX (oasisspec3): `transform: translateZ(0)` +
// `backfaceVisibility: hidden` are the classic mobile-Safari smooth-scroll
// GPU hints. They are ACTIVELY HARMFUL when this panel is embedded inside
// drei's <Html transform> CSS3DObject: they stack a second (and third, when
// applied to the inner scroll container) transform context on top of the
// CSS3D transform. Chrome's compositor invalidates the innermost layer when
// scroll hits end, leaving only the outer panel background painted — exactly
// the "orange bg visible, inner content gone" symptom. Keep overscrollBehavior
// + WebkitOverflowScrolling (those don't create new transform contexts). ▓▒░
const EMBEDDED_SCROLL_SURFACE_STYLE = {
  overscrollBehavior: 'contain' as const,
  WebkitOverflowScrolling: 'touch' as const,
}
const DEFAULT_SETTINGS: PanelSettings = { bgColor: '#120c04', opacity: 0.92, blur: 0 }
const DEFAULT_STATUS: HermesStatus = { configured: false, connected: false, base: null, apiKey: null, defaultModel: null, systemPrompt: null, models: [] }
const DEFAULT_TUNNEL_STATUS: HermesTunnelStatus = {
  configured: false,
  running: false,
  processAlive: false,
  processMatches: false,
  healthy: false,
  health: 'unconfigured',
  apiForwardReachable: false,
  apiForwardConfigured: false,
  reverseForwardConfigured: false,
  issues: [],
  command: '',
  autoStart: true,
}

const POS_KEY = 'oasis-hermes-pos'
const SIZE_KEY = 'oasis-hermes-size'
const SETTINGS_KEY = 'oasis-hermes-settings'
const DETAILS_KEY = 'oasis-hermes-details'
const CHAT_KEY = 'oasis-hermes-chat-history'
const SESSION_KEY = 'oasis-hermes-session'
const VOICE_OUTPUT_KEY = 'oasis-hermes-voice-output'
const NATIVE_SESSION_CACHE_KEY = 'oasis-hermes-native-session-cache'
const HERMES_NATIVE_AGENT_CACHE_TYPE = 'hermes-native'
const NEW_SESSION_VALUE = '__oasis_new__'
const HERMES_USER_REQUEST_MARKER = /User request:\s*/i
const STREAM_RENDER_INTERVAL_MS = 33
const CONNECTION_HINT = `HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=your_secret_here
HERMES_MODEL=optional_model_id`
const TUNNEL_HINT = 'ssh -o ExitOnForwardFailure=yes -L 8642:127.0.0.1:8642 -R 4516:127.0.0.1:4516 user@your-vps -N'

function readStoredMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return sanitizeCachedMessages(parsed).slice(-60)
  } catch {
    return []
  }
}

function sanitizeCachedMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((entry): entry is ChatMessage => {
      if (!entry || typeof entry !== 'object') return false
      const obj = entry as Record<string, unknown>
      return (
        (obj.role === 'user' || obj.role === 'assistant') &&
        typeof obj.id === 'string' &&
        typeof obj.content === 'string'
      )
    })
    .map((entry: ChatMessage) => ({
      id: entry.id,
      role: entry.role,
      content: entry.role === 'assistant'
        ? sanitizeHermesAssistantText(entry.content)
        : sanitizeHermesUserText(entry.content),
      reasoning: entry.reasoning,
      tools: Array.isArray(entry.tools) ? entry.tools : undefined,
      usage: entry.usage,
      finishReason: entry.finishReason,
      error: entry.error,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    }))
    .slice(-80)
}

function getHermesMessagesLastActiveAt(messages: ChatMessage[]): number {
  return messages.reduce((latest, message) => Math.max(latest, message.timestamp || 0), 0) || Date.now()
}

function readLegacyNativeSessionCache(sessionId: string): ChatMessage[] {
  if (typeof window === 'undefined' || !sessionId) return []

  try {
    const raw = localStorage.getItem(NATIVE_SESSION_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const entry = (parsed as Record<string, unknown>)[sessionId]
    return sanitizeCachedMessages(entry)
  } catch {
    return []
  }
}

function readLegacyNativeSessionCaches(): Map<string, ChatMessage[]> {
  const sessions = new Map<string, ChatMessage[]>()
  if (typeof window === 'undefined') return sessions

  try {
    const raw = localStorage.getItem(NATIVE_SESSION_CACHE_KEY)
    if (!raw) return sessions
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return sessions

    for (const [sessionId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const messages = sanitizeCachedMessages(entry)
      if (sessionId && messages.length > 0) sessions.set(sessionId, messages)
    }
  } catch {
    // Ignore malformed legacy cache.
  }

  return sessions
}

let hermesNativeLegacyMigrationPromise: Promise<void> | null = null
const hermesNativeSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function migrateLegacyHermesNativeSessionCache(): Promise<void> {
  if (typeof window === 'undefined') return
  if (hermesNativeLegacyMigrationPromise) return hermesNativeLegacyMigrationPromise

  hermesNativeLegacyMigrationPromise = (async () => {
    const legacy = readLegacyNativeSessionCaches()
    if (legacy.size === 0) return

    const ok = await saveClientAgentSessionCaches(
      HERMES_NATIVE_AGENT_CACHE_TYPE,
      [...legacy.entries()].map(([sessionId, messages]) => {
        const summary = buildSyntheticHermesSessionSummary(sessionId, messages)
        return {
          sessionId,
          title: summary?.title || `Hermes ${sessionId.slice(-8)}`,
          model: summary?.model || undefined,
          payload: messages,
          messageCount: messages.length,
          source: 'legacy-localStorage',
          lastActiveAt: summary?.lastActiveAt || getHermesMessagesLastActiveAt(messages),
        }
      }),
    )

    if (ok) removeBrowserStorage(NATIVE_SESSION_CACHE_KEY)
  })()

  try {
    await hermesNativeLegacyMigrationPromise
  } finally {
    hermesNativeLegacyMigrationPromise = null
  }
}

async function readPersistedNativeSessionCache(sessionId: string): Promise<ChatMessage[]> {
  if (!sessionId) return []
  await migrateLegacyHermesNativeSessionCache()

  const record = await getClientAgentSessionCache<ChatMessage[]>(HERMES_NATIVE_AGENT_CACHE_TYPE, sessionId)
  const persisted = sanitizeCachedMessages(record?.payload)
  if (persisted.length > 0) return persisted

  return readLegacyNativeSessionCache(sessionId)
}

function buildCachedHermesSessionSummary(
  record: ClientAgentSessionCacheRecord<ChatMessage[]>,
): HermesNativeSessionSummary | null {
  const messages = sanitizeCachedMessages(record.payload)
  const summary = buildSyntheticHermesSessionSummary(record.sessionId, messages)
  if (!summary) return null
  return {
    ...summary,
    title: record.title || summary.title,
    model: record.model || summary.model,
    source: record.source || summary.source,
    lastActiveAt: Date.parse(record.lastActiveAt) || summary.lastActiveAt,
  }
}

async function readCachedNativeSessionSummaries(): Promise<HermesNativeSessionSummary[]> {
  await migrateLegacyHermesNativeSessionCache()

  const records = await listClientAgentSessionCaches<ChatMessage[]>(HERMES_NATIVE_AGENT_CACHE_TYPE, 100)
  const persistedSummaries = records
    .map(buildCachedHermesSessionSummary)
    .filter((entry): entry is HermesNativeSessionSummary => Boolean(entry))

  const legacySummaries = [...readLegacyNativeSessionCaches().entries()]
    .map(([sessionId, entry]) => buildSyntheticHermesSessionSummary(sessionId, entry))
    .filter((entry): entry is HermesNativeSessionSummary => Boolean(entry))

  return mergeHermesSessionSummaries(persistedSummaries, legacySummaries)
}

function writeNativeSessionCache(sessionId: string, messages: ChatMessage[]) {
  if (typeof window === 'undefined' || !sessionId || messages.length === 0) return
  const sanitized = sanitizeCachedMessages(messages)
  if (sanitized.length === 0) return

  const previous = hermesNativeSaveTimers.get(sessionId)
  if (previous) clearTimeout(previous)

  hermesNativeSaveTimers.set(sessionId, setTimeout(() => {
    hermesNativeSaveTimers.delete(sessionId)
    const summary = buildSyntheticHermesSessionSummary(sessionId, sanitized)
    void saveClientAgentSessionCache(HERMES_NATIVE_AGENT_CACHE_TYPE, {
      sessionId,
      title: summary?.title || `Hermes ${sessionId.slice(-8)}`,
      model: summary?.model || undefined,
      payload: sanitized,
      messageCount: sanitized.length,
      source: 'oasis-panel',
      lastActiveAt: summary?.lastActiveAt || getHermesMessagesLastActiveAt(sanitized),
    }).catch(() => {
      // Ignore persistence errors; live React state remains authoritative.
    })
  }, 500))
}

function formatToolName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function prettyToolArguments(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '(tool arguments are still syncing from Hermes native history...)'
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

function summarizeToolArguments(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const firstEntry = Object.entries(parsed).find(([, value]) =>
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    )
    if (!firstEntry) return trimmed.slice(0, 80)
    const [key, value] = firstEntry
    return `${key}=${String(value).slice(0, 48)}`
  } catch {
    return trimmed.slice(0, 80)
  }
}

function parseToolArguments(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function normalizeHermesToolName(name: string): string {
  return name
    .replace(/^mcp_mcp_oasis_/, '')
    .replace(/^mcp__oasis__/, '')
    .replace(/^mcp_oasis_/, '')
    .replace(/^oasis_/, '')
    .trim()
}

function extractPreparedToolName(line: string): string | null {
  const match = line.match(/preparing\s+([A-Za-z0-9_]+)/i)
  return match?.[1] || null
}

function extractRepairedToolName(line: string): string | null {
  const match = line.match(/->\s*'([^']+)'/i)
  return match?.[1] || null
}

function isHermesToolProgressLine(line: string): boolean {
  return Boolean(extractPreparedToolName(line) || /auto-repaired tool name/i.test(line))
}

function extractHermesProgressToolCalls(content: string): HermesToolCall[] {
  if (!content) return []

  const tools: HermesToolCall[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const prepared = extractPreparedToolName(rawLine)
    if (prepared) {
      tools.push({
        index: tools.length,
        name: prepared,
        arguments: '',
      })
      continue
    }

    const repaired = extractRepairedToolName(rawLine)
    if (repaired && tools.length > 0) {
      tools[tools.length - 1] = {
        ...tools[tools.length - 1],
        name: repaired,
      }
    }
  }

  return tools
}

function isHermesVisionTool(name: string): boolean {
  return ['screenshot_viewport', 'screenshot_avatar', 'avatarpic_merlin', 'avatarpic_user'].includes(normalizeHermesToolName(name))
}

function formatSessionLabel(session: HermesNativeSessionSummary): string {
  const primary = (session.title || session.preview || `Session ${session.id.slice(-8)}`).replace(/\s+/g, ' ').trim()
  const source = session.source || 'unknown'
  const preview = primary.length > 56 ? `${primary.slice(0, 56)}...` : primary
  return `${preview} • ${source}`
}

function isHermesControlLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return /^finish_reason[-:=]/i.test(trimmed) || /^session_id:/i.test(trimmed)
}

function normalizeHermesLineForMatch(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/\[\/?[a-z]+\]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .trim()
}

function isHermesNoiseLine(line: string): boolean {
  const normalized = normalizeHermesLineForMatch(line)
  if (!normalized) return false
  return (
    normalized.startsWith('normalized model') ||
    normalized.startsWith('normalized m') ||
    isHermesToolProgressLine(line) ||
    normalized === 'anthropic' ||
    normalized === 'anthropic.' ||
    normalized === 'hermes'
  )
}

function isHermesIgnorableLine(line: string): boolean {
  return isHermesControlLine(line) || isHermesNoiseLine(line)
}

function normalizeHermesDuplicateLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

function collapseAdjacentRepeatedLineBlocks(lines: string[]): string[] {
  const next = [...lines]

  for (let size = Math.floor(next.length / 2); size >= 1; size -= 1) {
    for (let start = 0; start + size * 2 <= next.length; start += 1) {
      const left = next.slice(start, start + size).map(normalizeHermesDuplicateLine)
      const right = next.slice(start + size, start + size * 2).map(normalizeHermesDuplicateLine)
      if (!left.some(line => line.length > 0)) continue
      const minimumBlockLength = size === 1 ? 8 : 32
      if (left.join('\n').length < minimumBlockLength) continue
      if (left.every((line, index) => line === right[index])) {
        next.splice(start + size, size)
        return collapseAdjacentRepeatedLineBlocks(next)
      }
    }
  }

  return next
}

function sanitizeHermesAssistantText(content: string): string {
  if (!content) return ''

  const lines: string[] = []
  let previousBlank = false

  for (const line of content.split(/\r?\n/)) {
    if (isHermesIgnorableLine(line)) continue

    if (!line.trim()) {
      if (lines.length > 0 && !previousBlank) {
        lines.push('')
        previousBlank = true
      }
      continue
    }

    lines.push(line)
    previousBlank = false
  }

  const collapsed = collapseAdjacentRepeatedLineBlocks(lines)

  return collapsed.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function stripHermesMediaLines(content: string): string {
  return content
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('MEDIA:'))
    .join('\n')
    .trim()
}

function normalizeHermesAssistantComparisonText(content: string): string {
  return stripHermesMediaLines(sanitizeHermesAssistantText(content))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseHydratedHermesMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((entry): entry is ChatMessage => {
      if (!entry || typeof entry !== 'object') return false
      const item = entry as Record<string, unknown>
      return (
        typeof item.id === 'string' &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string'
      )
    })
    .map((entry: ChatMessage) => ({
      id: entry.id,
      role: entry.role,
      content: entry.role === 'assistant'
        ? sanitizeHermesAssistantText(entry.content)
        : sanitizeHermesUserText(entry.content),
      reasoning: entry.reasoning,
      tools: Array.isArray(entry.tools) ? entry.tools : undefined,
      usage: entry.usage,
      finishReason: entry.finishReason,
      error: entry.error,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    }))
}

function mergeHermesToolCalls(
  currentTools: HermesToolCall[],
  hydratedTools: HermesToolCall[],
): HermesToolCall[] {
  if (!currentTools.length) {
    return [...hydratedTools].sort((left, right) => left.index - right.index)
  }
  if (!hydratedTools.length) return currentTools

  const usedHydratedIndexes = new Set<number>()
  const merged = currentTools.map((tool, index) => {
    const normalizedCurrentName = normalizeHermesToolName(tool.name)
    const hydratedIndex = hydratedTools.findIndex((candidate, candidateIndex) => {
      if (usedHydratedIndexes.has(candidateIndex)) return false
      if (tool.id && candidate.id && tool.id === candidate.id) return true
      const normalizedCandidateName = normalizeHermesToolName(candidate.name)
      if (candidate.index === tool.index && normalizedCandidateName === normalizedCurrentName) return true
      if (candidate.index === index && normalizedCandidateName === normalizedCurrentName) return true
      return normalizedCandidateName === normalizedCurrentName
    })

    if (hydratedIndex < 0) return tool
    usedHydratedIndexes.add(hydratedIndex)
    const hydrated = hydratedTools[hydratedIndex]
    return {
      index: hydrated.index ?? tool.index,
      id: tool.id || hydrated.id,
      name: hydrated.name || tool.name,
      arguments: tool.arguments.trim() ? tool.arguments : hydrated.arguments || '',
      resultOk: tool.resultOk ?? hydrated.resultOk,
      resultMessage: tool.resultMessage || hydrated.resultMessage,
      resultDetail: tool.resultDetail || hydrated.resultDetail,
      mediaPaths: tool.mediaPaths?.length ? tool.mediaPaths : hydrated.mediaPaths,
    }
  })

  hydratedTools.forEach((tool, index) => {
    if (!usedHydratedIndexes.has(index)) {
      merged.push(tool)
    }
  })

  return merged.sort((left, right) => left.index - right.index)
}

function hasHydratedToolArguments(tools?: HermesToolCall[]): boolean {
  return Array.isArray(tools) && tools.some(tool => tool.arguments.trim().length > 0)
}

function hermesToolSignature(tools?: HermesToolCall[]): string {
  return Array.isArray(tools)
    ? tools
        .map(tool => `${tool.index}:${tool.id || ''}:${tool.name}:${tool.arguments}`)
        .join('\u0001')
    : ''
}

function findHydratedAssistantToolSource(
  hydratedMessages: ChatMessage[],
  assistantMessage: ChatMessage,
): ChatMessage | null {
  const assistantCandidates = hydratedMessages.filter(message => message.role === 'assistant')
  if (assistantCandidates.length === 0) return null

  const localText = normalizeHermesAssistantComparisonText(assistantMessage.content)
  const localPrefix = localText.slice(0, 120)

  for (let index = assistantCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = assistantCandidates[index]
    const candidateText = normalizeHermesAssistantComparisonText(candidate.content)
    const closeInTime = Math.abs((candidate.timestamp || 0) - (assistantMessage.timestamp || 0)) <= 5 * 60 * 1000
    const textMatches =
      !localPrefix
      || !candidateText
      || candidateText.includes(localPrefix)
      || localText.includes(candidateText.slice(0, 120))
    if (closeInTime && textMatches) return candidate
  }

  return assistantCandidates[assistantCandidates.length - 1] || null
}

function findLatestHydratedAssistantTurnSource(hydratedMessages: ChatMessage[]): ChatMessage | null {
  if (!hydratedMessages.length) return null

  let startIndex = 0
  for (let index = hydratedMessages.length - 1; index >= 0; index -= 1) {
    if (hydratedMessages[index]?.role === 'user') {
      startIndex = index + 1
      break
    }
  }

  const turnMessages = collapseConsecutiveHermesAssistantTurns(hydratedMessages.slice(startIndex))
  return [...turnMessages]
    .reverse()
    .find(message => message.role === 'assistant' && (message.tools?.length || 0) > 0) || null
}

async function fetchHydratedHermesMessages(sessionId: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/hermes/sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.available === false) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
  }
  return parseHydratedHermesMessages(data?.messages)
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function sanitizeHermesUserText(content: string): string {
  const trimmed = typeof content === 'string' ? content.trim() : ''
  if (!trimmed) return ''
  if (!trimmed.startsWith('Oasis runtime context:')) return trimmed

  const marker = HERMES_USER_REQUEST_MARKER.exec(trimmed)
  if (!marker) return trimmed

  return trimmed.slice(marker.index + marker[0].length).trim() || trimmed
}

function appendHermesMediaLine(content: string, mediaUrl: string): string {
  const sanitizedContent = sanitizeHermesAssistantText(content)
  const nextMediaUrl = mediaUrl.trim()
  if (!nextMediaUrl) return sanitizedContent

  const mediaLine = `MEDIA:${nextMediaUrl}`
  if (sanitizedContent.split(/\r?\n/).some(line => line.trim() === mediaLine)) {
    return sanitizedContent
  }

  return sanitizeHermesAssistantText(
    sanitizedContent
      ? `${sanitizedContent}\n${mediaLine}`
      : mediaLine,
  )
}

function appendHermesMediaLines(content: string, mediaUrls: string[]): string {
  return mediaUrls.reduce((nextContent, mediaUrl) => appendHermesMediaLine(nextContent, mediaUrl), content)
}

function unwrapHermesPathLikeValue(path: string): string {
  let next = path.trim()
  const wrappedMatch = next.match(/^(?:Path|PosixPath)\((['"])(.+)\1\)$/)
  if (wrappedMatch?.[2]) {
    next = wrappedMatch[2].trim()
  }
  next = next.replace(/^['"`]+|['"`]+$/g, '').trim()
  if (/^file:\/\//i.test(next)) {
    try {
      const url = new URL(next)
      next = decodeURIComponent(url.pathname)
    } catch {
      next = next.replace(/^file:\/\//i, '')
    }
  }
  const explicitPathMatch = next.match(/((?:https?:\/\/|file:\/\/|~\/|\/(?:home|tmp)\/)[^\s"'`]+?\.(?:mp3|wav|ogg|oga|opus|m4a|png|jpg|jpeg|gif|webp|mp4|webm|m4v)(?:\?[^\s"'`]+)?)/i)
  if (explicitPathMatch?.[1]) {
    return explicitPathMatch[1].trim()
  }
  return next.replace(/[)\],.;:!?]+$/g, '').trim()
}

function normalizeHermesMediaPath(path: string): string {
  const next = unwrapHermesPathLikeValue(path)
  if (!next) return ''
  if (isDirectHermesMediaUrl(next)) return next
  return next
}

interface HermesMediaReference {
  path: string
  mediaType: MediaType
}

function hermesMediaReferenceKey(path: string, mediaType: MediaType): string {
  return `${mediaType}:${normalizeHermesMediaPath(path)}`
}

function detectHermesMediaType(path: string): MediaType | null {
  const normalized = normalizeHermesMediaPath(path)
  if (/^data:image\//i.test(normalized)) return 'image'
  if (/^data:audio\//i.test(normalized)) return 'audio'
  if (/^data:video\//i.test(normalized)) return 'video'
  if (/\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
  if (/\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
  if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
  // Trusted media services — infer type when extension is missing
  if (/(?:fal\.media|fal-cdn\.|oaidalleapiprodscus\.|replicate\.delivery)/i.test(normalized)) {
    if (/video|mp4|webm/i.test(normalized)) return 'video'
    return 'image'
  }
  if (/(?:api\.elevenlabs\.io|elevenlabs\.io\/)/i.test(normalized)) return 'audio'
  return null
}

function isDirectHermesMediaUrl(path: string): boolean {
  return /^(?:https?:\/\/|blob:|data:)/i.test(path)
}

function buildHermesMediaUrl(path: string): string {
  const normalized = normalizeHermesMediaPath(path)
  if (isDirectHermesMediaUrl(normalized)) return normalized
  return `/api/hermes/media?path=${encodeURIComponent(normalized)}`
}

function joinPrompt(base: string, addition: string): string {
  if (!addition) return base
  if (!base) return addition
  return `${base} ${addition}`.trim()
}

function buildSyntheticHermesSessionSummary(sessionId: string, messages: ChatMessage[]): HermesNativeSessionSummary | null {
  const sanitizedMessages = sanitizeCachedMessages(messages)
  if (sanitizedMessages.length === 0) return null

  const first = sanitizedMessages[0]
  const last = sanitizedMessages[sanitizedMessages.length - 1]
  const preview = [...sanitizedMessages]
    .reverse()
    .map(message => message.content
      .split(/\r?\n/)
      .filter(line => !line.trim().startsWith('MEDIA:'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .find(Boolean) || `Session ${sessionId.slice(-8)}`

  return {
    id: sessionId,
    title: null,
    preview: preview.slice(0, 160),
    source: 'native',
    model: null,
    startedAt: first?.timestamp || Date.now(),
    lastActiveAt: last?.timestamp || first?.timestamp || Date.now(),
    messageCount: sanitizedMessages.length,
  }
}

function compareHermesSessionSummaries(left: HermesNativeSessionSummary, right: HermesNativeSessionSummary): number {
  const leftTime = left.lastActiveAt || left.startedAt || 0
  const rightTime = right.lastActiveAt || right.startedAt || 0
  return rightTime - leftTime
}

function upsertHermesSessionSummary(
  sessions: HermesNativeSessionSummary[],
  summary: HermesNativeSessionSummary | null,
): HermesNativeSessionSummary[] {
  if (!summary) return sessions

  const existingIndex = sessions.findIndex(session => session.id === summary.id)
  if (existingIndex === -1) {
    return [summary, ...sessions].sort(compareHermesSessionSummaries)
  }

  const next = sessions.slice()
  next[existingIndex] = {
    ...next[existingIndex],
    ...summary,
  }
  return next.sort(compareHermesSessionSummaries)
}

function mergeHermesSessionSummaries(
  primary: HermesNativeSessionSummary[],
  secondary: HermesNativeSessionSummary[],
): HermesNativeSessionSummary[] {
  let merged = primary.slice()
  for (const summary of secondary) {
    merged = upsertHermesSessionSummary(merged, summary)
  }
  return merged.sort(compareHermesSessionSummaries)
}

function extractHermesMediaReferences(content: string): HermesMediaReference[] {
  const refs: HermesMediaReference[] = []
  const seen = new Set<string>()

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('MEDIA:')) continue

    const path = normalizeHermesMediaPath(trimmed.slice('MEDIA:'.length))
    const mediaType = detectHermesMediaType(path)
    if (!path || !mediaType) continue

    const key = hermesMediaReferenceKey(path, mediaType)
    if (seen.has(key)) continue
    seen.add(key)

    refs.push({
      path,
      mediaType,
    })
  }

  return refs
}

function HermesProxiedMediaBubble({
  mediaUrl,
  mediaType,
  prompt,
  needsProxy,
}: {
  mediaUrl: string
  mediaType: MediaType
  prompt: string
  needsProxy: boolean
}) {
  const [resolvedUrl, setResolvedUrl] = useState(() => (needsProxy ? '' : mediaUrl))
  const [loading, setLoading] = useState(needsProxy)
  const [error, setError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!needsProxy) {
      setResolvedUrl(mediaUrl)
      setLoading(false)
      setError('')
      return
    }

    const controller = new AbortController()
    let objectUrl = ''

    async function load() {
      setLoading(true)
      setError('')

      try {
        const response = await fetch(mediaUrl, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          let message = detail || `HTTP ${response.status}`
          try {
            const parsed = JSON.parse(detail) as { error?: unknown }
            if (typeof parsed?.error === 'string' && parsed.error.trim()) {
              message = parsed.error
            }
          } catch {
            // Response is plain text already.
          }
          throw new Error(message)
        }

        const blob = await response.blob()
        objectUrl = URL.createObjectURL(blob)
        setResolvedUrl(objectUrl)
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : `Unable to load Hermes ${mediaType}.`)
      } finally {
        setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaUrl, mediaType, needsProxy, retryNonce])

  if (loading) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-black/35 px-3 py-3">
        <div className="text-[11px] text-amber-100">Loading Hermes {mediaType}...</div>
      </div>
    )
  }

  if (error || !resolvedUrl) {
    return (
      <div className="rounded-lg border border-red-400/30 bg-red-950/20 px-3 py-3 space-y-2">
        <div className="text-[11px] text-red-200">Failed to load {mediaType}</div>
        <div className="text-[10px] text-red-200/80 break-words">{error || `Unknown remote ${mediaType} error.`}</div>
        <button
          onClick={() => setRetryNonce(current => current + 1)}
          className="px-2 py-1 rounded border border-amber-400/35 text-[10px] text-amber-100 hover:border-amber-300/60 cursor-pointer"
        >
          Retry
        </button>
      </div>
    )
  }

  return <MediaBubble url={resolvedUrl} mediaType={mediaType} prompt={prompt} compact galleryScopeId="hermes-thread" />
}

function HermesAudioBubble({
  mediaUrl,
  prompt,
  autoPlay,
  needsProxy,
  avatarAudioTargetId,
}: {
  mediaUrl: string
  prompt: string
  autoPlay: boolean
  needsProxy: boolean
  avatarAudioTargetId?: string | null
}) {
  const [resolvedUrl, setResolvedUrl] = useState(() => (needsProxy ? '' : mediaUrl))
  const [loading, setLoading] = useState(needsProxy)
  const [error, setError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!needsProxy) {
      setResolvedUrl(mediaUrl)
      setLoading(false)
      setError('')
      return
    }

    const controller = new AbortController()
    let objectUrl = ''

    async function load() {
      setLoading(true)
      setError('')

      try {
        const response = await fetch(mediaUrl, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          let message = detail || `HTTP ${response.status}`
          try {
            const parsed = JSON.parse(detail) as { error?: unknown }
            if (typeof parsed?.error === 'string' && parsed.error.trim()) {
              message = parsed.error
            }
          } catch {
            // Response is plain text already.
          }
          throw new Error(message)
        }

        const blob = await response.blob()
        objectUrl = URL.createObjectURL(blob)
        setResolvedUrl(objectUrl)
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load Hermes audio.')
      } finally {
        setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaUrl, needsProxy, retryNonce])

  if (loading) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-black/35 px-3 py-3">
        <div className="text-[11px] text-amber-100">Loading Hermes audio...</div>
      </div>
      )
  }

  if (error || !resolvedUrl) {
    return (
      <div className="rounded-lg border border-red-400/30 bg-red-950/20 px-3 py-3 space-y-2">
        <div className="text-[11px] text-red-200">Failed to load audio</div>
        <div className="text-[11px] text-amber-100/90">{prompt}</div>
        <div className="text-[10px] text-red-200/80 break-words">{error || 'Unknown remote audio error.'}</div>
        <button
          onClick={() => setRetryNonce(current => current + 1)}
          className="px-2 py-1 rounded border border-amber-400/35 text-[10px] text-amber-100 hover:border-amber-300/60 cursor-pointer"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <MediaBubble
      url={resolvedUrl}
      mediaType="audio"
      prompt={prompt}
      compact
      autoPlay={autoPlay}
      avatarLipSyncTargetId={avatarAudioTargetId}
      galleryScopeId="hermes-thread"
    />
  )
}

function renderHermesAssistantContent(
  content: string,
  autoPlayAudio: boolean,
  audioTargetAvatarId?: string | null,
): React.ReactNode {
  const blocks: React.ReactNode[] = []
  const textBuffer: string[] = []
  const seenMediaRefs = new Set<string>()
  let key = 0

  const flushText = () => {
    const text = textBuffer
      .filter(line => !isHermesIgnorableLine(line))
      .join('\n')
      .trim()
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
      const path = normalizeHermesMediaPath(trimmed.slice('MEDIA:'.length))
      const mediaType = detectHermesMediaType(path)
      if (path && mediaType) {
        const mediaKey = hermesMediaReferenceKey(path, mediaType)
        if (seenMediaRefs.has(mediaKey)) {
          continue
        }
        seenMediaRefs.add(mediaKey)

        flushText()
        if (mediaType === 'audio') {
          const mediaUrl = buildHermesMediaUrl(path)
          blocks.push(
            <HermesAudioBubble
              key={`media-${key += 1}`}
              mediaUrl={mediaUrl}
              prompt="Hermes audio"
              autoPlay={autoPlayAudio}
              needsProxy={!isDirectHermesMediaUrl(path)}
              avatarAudioTargetId={audioTargetAvatarId}
            />
          )
        } else {
          const mediaUrl = buildHermesMediaUrl(path)
          blocks.push(
            <HermesProxiedMediaBubble
              key={`media-${key += 1}`}
              mediaUrl={mediaUrl}
              mediaType={mediaType}
              prompt={`Hermes ${mediaType}`}
              needsProxy={!isDirectHermesMediaUrl(path)}
            />
          )
        }
        continue
      }
    }

    textBuffer.push(line)
  }

  flushText()

  if (blocks.length === 0) {
    return renderMarkdown(sanitizeHermesAssistantText(content))
  }
  if (blocks.length === 1) {
    return blocks[0]
  }

  return <div className="space-y-2">{blocks}</div>
}

function getStatusColor(status: HermesStatus): string {
  if (status.connected) return '#34d399'
  if (status.configured) return '#f59e0b'
  return '#ef4444'
}

function StatusBadge({ status, loading }: { status: HermesStatus; loading: boolean }) {
  const color = getStatusColor(status)
  const label = loading
    ? 'checking'
    : status.connected
      ? 'connected'
      : status.configured
        ? 'waiting'
        : 'unconfigured'

  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wide"
      style={{
        color,
        background: `${color}1a`,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  )
}

function SourceBadge({ source }: { source?: HermesStatus['source'] }) {
  if (!source || source === 'none') return null
  const color = source === 'pairing' ? '#f59e0b' : '#60a5fa'
  const label = source === 'pairing' ? 'saved' : 'env'
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}
      title={source === 'pairing' ? 'Using saved local connection data' : 'Using server env config'}
    >
      {label}
    </span>
  )
}

function getTunnelColor(status: HermesTunnelStatus): string {
  if (!status.configured) return '#94a3b8'
  if (status.healthy) return '#34d399'
  if (status.running || status.processAlive) return '#f59e0b'
  return '#ef4444'
}

function getTunnelLabel(status: HermesTunnelStatus): string {
  switch (status.health) {
    case 'healthy':
      return 'oasis-ready'
    case 'partial':
      return 'ssh partial'
    case 'stale':
      return 'ssh stale'
    case 'stopped':
      return 'ssh down'
    case 'saved':
      return status.autoStart ? 'ssh saved' : 'ssh manual'
    default:
      return 'direct'
  }
}

function buildTunnelTitle(status: HermesTunnelStatus): string {
  if (!status.configured) return 'No managed SSH tunnel saved'
  if (status.issues.length > 0) return status.issues[0]
  if (status.healthy) return 'Managed SSH tunnel is carrying both Hermes chat and Oasis MCP traffic.'
  return 'Managed SSH tunnel is saved but not fully verified yet.'
}

function TunnelBadge({ status }: { status: HermesTunnelStatus }) {
  const color = getTunnelColor(status)
  const label = getTunnelLabel(status)

  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}
      title={buildTunnelTitle(status)}
    >
      {label}
    </span>
  )
}

function SettingsDropdown({ settings, onChange, voiceOutput, onVoiceOutputChange }: { settings: PanelSettings; onChange: (next: PanelSettings) => void; voiceOutput?: boolean; onVoiceOutputChange?: (v: boolean) => void }) {
  return (
    <div
      data-ui-panel
      className="absolute right-0 top-full mt-1 z-50 border border-white/10 rounded-lg p-3 shadow-xl w-56"
      style={{ background: 'rgba(10, 8, 5, 0.96)', color: 'rgba(255,245,220,0.96)', fontFamily: 'Consolas, \"Segoe UI\", sans-serif' }}
    >
      <div className="text-[10px] text-amber-200/80 uppercase tracking-widest mb-2">Panel Settings</div>

      <div className="space-y-2 text-[10px]">
        <div>
          <div className="text-amber-200/70 mb-1">Background Color</div>
          <input
            type="color"
            value={settings.bgColor}
            onChange={event => onChange({ ...settings, bgColor: event.target.value })}
            className="w-full h-6 rounded cursor-pointer bg-transparent border border-white/10"
          />
        </div>
        <div>
          <div className="text-amber-200/70 mb-1">Opacity ({(settings.opacity * 100).toFixed(0)}%)</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={event => onChange({ ...settings, opacity: parseFloat(event.target.value) })}
            className="w-full accent-amber-500"
          />
        </div>
        <div>
          <div className="text-amber-200/70 mb-1">Blur ({settings.blur}px)</div>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={settings.blur}
            onChange={event => onChange({ ...settings, blur: parseInt(event.target.value, 10) })}
            className="w-full accent-amber-500"
          />
        </div>
        {onVoiceOutputChange && (
          <div className="pt-1 border-t border-white/10 mt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={voiceOutput ?? false}
                onChange={event => onVoiceOutputChange(event.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-amber-200/70">Auto-play voice notes</span>
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolDetails({
  tool,
  completed,
  failed,
}: {
  tool: HermesToolCall
  completed?: boolean
  failed?: boolean
}) {
  const normalizedName = normalizeHermesToolName(tool.name) || tool.name
  const label = summarizeToolArguments(tool.arguments)
  const toolMedia = (tool.mediaPaths || [])
    .map(path => {
      const mediaType = detectHermesMediaType(path)
      if (!mediaType) return null
      return {
        path: buildHermesMediaUrl(path),
        mediaType,
      }
    })
    .filter((entry): entry is { path: string; mediaType: MediaType } => !!entry)
  return (
    <AgentToolCallCard
      name={normalizedName}
      label={formatToolName(normalizedName)}
      icon="[]"
      summary={label}
      input={prettyToolArguments(tool.arguments)}
      result={completed ? {
        ok: failed ? false : tool.resultOk ?? true,
        ...(tool.resultMessage ? { message: tool.resultMessage } : failed ? { message: 'Tool execution failed.' } : {}),
        ...(tool.resultDetail ? { detail: tool.resultDetail } : {}),
      } : undefined}
      media={toolMedia}
      showResultMessage={Boolean(tool.resultMessage)}
    />
  )
}

async function* parseHermesSSE(response: Response): AsyncGenerator<HermesEvent> {
  if (!response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const normalized = buffer.replace(/\r/g, '')
    const blocks = normalized.split('\n\n')
    buffer = blocks.pop() || ''

    for (const block of blocks) {
      const payload = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim()

      if (!payload) continue

      try {
        yield JSON.parse(payload) as HermesEvent
      } catch {
        // Ignore malformed chunks.
      }
    }
  }

  const trailingPayload = buffer
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim()

  if (trailingPayload) {
    try {
      yield JSON.parse(trailingPayload) as HermesEvent
    } catch {
      // Ignore malformed trailing payloads.
    }
  }
}

export function HermesPanel({
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
  useUILayer('hermes', isOpen && !embedded)

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('hermes', 9998))
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const autoConnectTriedRef = useRef(false)
  const activeNativeSessionIdRef = useRef('')
  const lastHydratedSessionIdRef = useRef('')
  const lastVisionToolSignatureRef = useRef('')

  const [messages, setMessages] = useState<ChatMessage[]>(() => readStoredMessages())
  const messagesRef = useRef<ChatMessage[]>(messages)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [status, setStatus] = useState<HermesStatus>(DEFAULT_STATUS)
  const [tunnelStatus, setTunnelStatus] = useState<HermesTunnelStatus>(DEFAULT_TUNNEL_STATUS)
  const [statusLoading, setStatusLoading] = useState(false)
  const [sessions, setSessions] = useState<HermesNativeSessionSummary[]>([])
  const [nativeSessionsAvailable, setNativeSessionsAvailable] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
  })
  const [sessionHydrating, setSessionHydrating] = useState(false)
  const [showDetails, setShowDetails] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return localStorage.getItem(DETAILS_KEY) !== 'false' } catch { return true }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [connectionInput, setConnectionInput] = useState('')
  const [tunnelInput, setTunnelInput] = useState('')
  const [tunnelAutoStart, setTunnelAutoStart] = useState(true)
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(VOICE_OUTPUT_KEY) === 'true' } catch { return false }
  })
  const [autoPlayMediaMessageId, setAutoPlayMediaMessageId] = useState('')
  const [visionCaptureUrl, setVisionCaptureUrl] = useState('')
  const [visionCaptureError, setVisionCaptureError] = useState('')
  const [visionCapturedAt, setVisionCapturedAt] = useState<number | null>(null)
  const [isCapturingVision, setIsCapturingVision] = useState(false)
  const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_VALUE) return
    activeNativeSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined' || embedded) return DEFAULT_POS
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null') || DEFAULT_POS } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined' || embedded) return DEFAULT_SIZE
    try { return JSON.parse(localStorage.getItem(SIZE_KEY) || 'null') || DEFAULT_SIZE } catch { return DEFAULT_SIZE }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const hermesAvatar = useOasisStore(state => state.placedAgentAvatars.find(entry => entry.agentType === 'hermes') || null)
  const assignHermesAvatar = useOasisStore(state => state.assignHermesAvatar)
  const setAgentAvatarAudio = useOasisStore(state => state.setAgentAvatarAudio)
  const voiceInput = useAgentVoiceInput({
    enabled: isOpen,
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => {
      setInput(current => joinPrompt(current, transcript))
    },
    focusTargetRef: inputRef,
    enablePlayerLipSync: true,
  })

  // Textarea grows with content (oasisspec3)
  useAutoresizeTextarea(inputRef, input, { minPx: 48, maxPx: 200 })

  const focusPanelUI = useCallback(() => {
    useInputManager.getState().enterUIFocus()
  }, [])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const [statusResponse, configResponse, tunnelResponse] = await Promise.all([
        fetch('/api/hermes', { cache: 'no-store' }),
        fetch('/api/hermes/config', { cache: 'no-store' }),
        fetch('/api/hermes/tunnel', { cache: 'no-store' }),
      ])

      const data = await statusResponse.json().catch(() => ({}))
      const cfg = await configResponse.json().catch(() => ({}))
      const tunnel = await tunnelResponse.json().catch(() => ({}))

      if (!statusResponse.ok) {
        setStatus({
          configured: false,
          connected: false,
          base: null,
          apiKey: typeof cfg?.apiKey === 'string' ? cfg.apiKey : null,
          defaultModel: null,
          systemPrompt: typeof cfg?.systemPrompt === 'string' ? cfg.systemPrompt : null,
          models: [],
          source: typeof cfg?.source === 'string' ? cfg.source : undefined,
          canMutateConfig: Boolean(cfg?.canMutateConfig),
          error: typeof data?.error === 'string' ? data.error : `HTTP ${statusResponse.status}`,
        })
      } else {
        const nextStatus: HermesStatus = {
          configured: Boolean(data?.configured),
          connected: Boolean(data?.connected),
          base: typeof data?.base === 'string' ? data.base : null,
          apiKey: typeof cfg?.apiKey === 'string' ? cfg.apiKey : (typeof data?.apiKey === 'string' ? data.apiKey : null),
          defaultModel: typeof data?.defaultModel === 'string' ? data.defaultModel : null,
          systemPrompt: typeof cfg?.systemPrompt === 'string' ? cfg.systemPrompt : (typeof data?.systemPrompt === 'string' ? data.systemPrompt : null),
          models: Array.isArray(data?.models) ? data.models.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
          source: (typeof data?.source === 'string' ? data.source : typeof cfg?.source === 'string' ? cfg.source : undefined) as HermesStatus['source'],
          canMutateConfig: Boolean(cfg?.canMutateConfig),
          error: typeof data?.error === 'string' ? data.error : undefined,
        }

        setStatus(nextStatus)
      }

      setTunnelStatus({
        configured: Boolean(tunnel?.configured),
        running: Boolean(tunnel?.running),
        processAlive: Boolean(tunnel?.processAlive),
        processMatches: Boolean(tunnel?.processMatches),
        healthy: Boolean(tunnel?.healthy),
        health: typeof tunnel?.health === 'string' ? tunnel.health as HermesTunnelStatus['health'] : 'unconfigured',
        apiForwardReachable: Boolean(tunnel?.apiForwardReachable),
        apiForwardConfigured: Boolean(tunnel?.apiForwardConfigured),
        reverseForwardConfigured: Boolean(tunnel?.reverseForwardConfigured),
        issues: Array.isArray(tunnel?.issues) ? tunnel.issues.filter((entry: unknown): entry is string => typeof entry === 'string') : [],
        command: typeof tunnel?.command === 'string' ? tunnel.command : '',
        commandPreview: typeof tunnel?.commandPreview === 'string' ? tunnel.commandPreview : '',
        autoStart: tunnel?.autoStart !== false,
        canMutateConfig: Boolean(tunnel?.canMutateConfig ?? cfg?.canMutateConfig),
        updatedAt: typeof tunnel?.updatedAt === 'string' ? tunnel.updatedAt : null,
        lastStartedAt: typeof tunnel?.lastStartedAt === 'string' ? tunnel.lastStartedAt : null,
        error: typeof tunnel?.error === 'string' ? tunnel.error : undefined,
      })
      setTunnelInput(current => current || (typeof tunnel?.command === 'string' ? tunnel.command : ''))
      setTunnelAutoStart(tunnel?.autoStart !== false)
    } catch (error) {
      setStatus({
        configured: false,
        connected: false,
        base: null,
        apiKey: null,
        defaultModel: null,
        systemPrompt: null,
        models: [],
        error: error instanceof Error ? error.message : 'Unable to check Hermes status.',
      })
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    if (!status.connected || !tunnelStatus.configured) {
      setNativeSessionsAvailable(false)
      setSessions([])
      setSessionsError('')
      return
    }

    setSessionsLoading(true)
    setSessionsError('')

    try {
      const response = await fetch('/api/hermes/sessions?limit=40', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.available === false) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const fetchedSessions: HermesNativeSessionSummary[] = Array.isArray(data?.sessions)
        ? data.sessions.filter((entry: unknown): entry is HermesNativeSessionSummary => {
            if (!entry || typeof entry !== 'object') return false
            const item = entry as Record<string, unknown>
            return typeof item.id === 'string'
          })
        : []

      const fallbackSessionId = preferredSessionId && preferredSessionId !== NEW_SESSION_VALUE
        ? preferredSessionId
        : selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE
          ? selectedSessionId
          : activeNativeSessionIdRef.current
      const cachedSummaries = await readCachedNativeSessionSummaries()
      const fallbackMessages = fallbackSessionId
        ? await readPersistedNativeSessionCache(fallbackSessionId).catch(() => readLegacyNativeSessionCache(fallbackSessionId))
        : []
      const fallbackSummary = fallbackSessionId
        ? buildSyntheticHermesSessionSummary(fallbackSessionId, fallbackMessages)
        : null
      const nextSessions = mergeHermesSessionSummaries(
        fetchedSessions,
        fallbackSummary ? [fallbackSummary, ...cachedSummaries] : cachedSummaries,
      )

      setNativeSessionsAvailable(true)
      setSessions(nextSessions)
      setSelectedSessionId(current => {
        const keepNew = preferredSessionId === NEW_SESSION_VALUE || current === NEW_SESSION_VALUE
        let next = ''

        if (preferredSessionId) {
          next = preferredSessionId === NEW_SESSION_VALUE || nextSessions.some(session => session.id === preferredSessionId)
            ? preferredSessionId
            : ''
        }

        if (!next && current && current !== NEW_SESSION_VALUE && nextSessions.some(session => session.id === current)) {
          next = current
        }

        if (!next && activeNativeSessionIdRef.current && nextSessions.some(session => session.id === activeNativeSessionIdRef.current)) {
          next = activeNativeSessionIdRef.current
        }

        if (!next && keepNew) {
          next = NEW_SESSION_VALUE
        }

        if (!next) {
          next = nextSessions[0]?.id || NEW_SESSION_VALUE
        }

        writeBrowserStorage(SESSION_KEY, next)

        return next
      })
    } catch (error) {
      setNativeSessionsAvailable(false)
      setSessions([])
      setSessionsError(error instanceof Error ? error.message : 'Unable to load Hermes sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }, [selectedSessionId, status.connected, tunnelStatus.configured])

  const hydrateSession = useCallback(async (
    sessionId: string,
    options?: {
      mergeMessages?: ChatMessage[]
    }
  ): Promise<ChatMessage[]> => {
    if (!sessionId || sessionId === NEW_SESSION_VALUE) {
      setSessionHydrating(false)
      setMessages([])
      setAutoScroll(true)
      return []
    }

    setSessionHydrating(true)
    setSessionsError('')
    setAutoPlayMediaMessageId('')

    try {
      const remoteMessages = await fetchHydratedHermesMessages(sessionId)
      const collapsedRemoteMessages = collapseConsecutiveHermesAssistantTurns(remoteMessages)

      const cachedSourceMessages = options?.mergeMessages?.length
        ? options.mergeMessages
        : await readPersistedNativeSessionCache(sessionId)

      const nextMessages = shouldPreferHydratedHermesMessages(collapsedRemoteMessages, cachedSourceMessages)
        ? collapseDuplicateHermesMessages(collapsedRemoteMessages)
        : collapseDuplicateHermesMessages(mergeHydratedHermesMessages(collapsedRemoteMessages, cachedSourceMessages))

      setMessages(nextMessages)
      setAutoScroll(true)
      writeNativeSessionCache(sessionId, nextMessages)
      return nextMessages
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : 'Unable to load the selected Hermes session.')
      const fallbackMessages = options?.mergeMessages || await readPersistedNativeSessionCache(sessionId).catch(() => readLegacyNativeSessionCache(sessionId))
      if (fallbackMessages.length) {
        setMessages(fallbackMessages)
        return fallbackMessages
      }
      return []
    } finally {
      setSessionHydrating(false)
    }
  }, [])

  const enrichAssistantToolsFromSession = useCallback(async (
    sessionId: string,
    assistantMessage: ChatMessage,
  ): Promise<ChatMessage> => {
    if (!sessionId || !assistantMessage.tools?.length || hasHydratedToolArguments(assistantMessage.tools)) {
      return assistantMessage
    }

    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        const hydratedMessages = collapseConsecutiveHermesAssistantTurns(await fetchHydratedHermesMessages(sessionId))
        const hydratedAssistant =
          findLatestHydratedAssistantTurnSource(hydratedMessages)
          || findHydratedAssistantToolSource(hydratedMessages, assistantMessage)
        if (!hydratedAssistant?.tools?.length) {
          if (attempt < 6) await sleep(300 * (attempt + 1))
          continue
        }

        const mergedTools = mergeHermesToolCalls(assistantMessage.tools, hydratedAssistant.tools)
        const hydratedMediaRefs = extractHermesMediaReferences(hydratedAssistant.content).map(ref => ref.path)
        const mergedContent = hydratedMediaRefs.length
          ? appendHermesMediaLines(assistantMessage.content, hydratedMediaRefs)
          : assistantMessage.content
        const toolsChanged = hermesToolSignature(mergedTools) !== hermesToolSignature(assistantMessage.tools)
        const contentChanged = mergedContent !== assistantMessage.content
        if (!toolsChanged && !contentChanged) {
          if (hasHydratedToolArguments(mergedTools)) {
            return { ...assistantMessage, tools: mergedTools, content: mergedContent }
          }
          if (attempt < 6) await sleep(300 * (attempt + 1))
          continue
        }

        const nextAssistantMessage: ChatMessage = {
          ...assistantMessage,
          content: mergedContent,
          tools: mergedTools,
        }

        const nextMessages = collapseDuplicateHermesMessages(messagesRef.current.map(message =>
          message.id === assistantMessage.id
            ? nextAssistantMessage
            : message
        ))
        setMessages(nextMessages)
        writeNativeSessionCache(sessionId, nextMessages)
        setSessions(previous => upsertHermesSessionSummary(
          previous,
          buildSyntheticHermesSessionSummary(sessionId, nextMessages),
        ))
        return nextAssistantMessage
      } catch {
        // Retry a couple times while Hermes flushes the session row.
      }

      if (attempt < 6) {
        await sleep(300 * (attempt + 1))
      }
    }

    return assistantMessage
  }, [])

  const captureHermesVision = useCallback(async (
    tool?: HermesToolCall,
    options?: {
      attachToMessageId?: string
      sessionId?: string
    },
  ): Promise<HermesVisionCapture | null> => {
    if (isCapturingVision) return null

    const worldId = useOasisStore.getState().activeWorldId
    const rawToolArguments = tool?.arguments.trim() || ''
    if (tool && !rawToolArguments) {
      return null
    }

    const parsedArgs = tool ? parseToolArguments(rawToolArguments) : {}
    if (tool && !parsedArgs) {
      setVisionCaptureError('Hermes asked for a screenshot, but the tool arguments were malformed.')
      return null
    }

    const requestedArgs = tool && parsedArgs
      ? {
          ...parsedArgs,
          worldId: typeof parsedArgs.worldId === 'string' && parsedArgs.worldId.trim() ? parsedArgs.worldId : worldId,
          defaultAgentType: 'hermes',
          requesterAgentType: 'hermes',
        }
      : {
          worldId,
          defaultAgentType: 'hermes',
          requesterAgentType: 'hermes',
          format: 'jpeg',
          quality: 0.82,
          width: 960,
          height: 540,
          views: [{
            id: 'hermes-phantom',
            mode: 'agent-avatar-phantom',
            agentType: 'hermes',
            distance: 1,
            heightOffset: 1.55,
            lookAhead: 6,
            fov: 100,
          }],
        }

    if (!tool && !hermesAvatar?.id) {
      setVisionCaptureError('Give Hermes an avatar first so he has a body to see from.')
      return null
    }

    setIsCapturingVision(true)
    setVisionCaptureError('')

    try {
      const response = await fetch('/api/oasis-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: normalizeHermesToolName(tool?.name || 'screenshot_viewport'),
          args: requestedArgs,
        }),
      })

      const data = await response.json().catch(() => null) as {
        ok?: boolean
        error?: string
        message?: string
        data?: {
          primaryCaptureUrl?: string
          primaryCapturePath?: string
          format?: 'jpeg' | 'png' | 'webp'
          base64?: string
          captures?: Array<{
            format?: 'jpeg' | 'png' | 'webp'
            base64?: string
            url?: string
            filePath?: string
          }>
        }
      } | null

      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`)
      }

      const availableCaptures = Array.isArray(data.data?.captures)
        ? data.data.captures.filter(entry =>
            (typeof entry?.url === 'string' && entry.url.length > 0) ||
            (typeof entry?.filePath === 'string' && entry.filePath.length > 0) ||
            (typeof entry?.base64 === 'string' && entry.base64.length > 0)
          )
        : []
      const capture = availableCaptures[0] || (
        typeof data.data?.primaryCaptureUrl === 'string' && data.data.primaryCaptureUrl.length > 0
          ? { url: data.data.primaryCaptureUrl, format: data.data.format }
          : typeof data.data?.primaryCapturePath === 'string' && data.data.primaryCapturePath.length > 0
            ? { filePath: data.data.primaryCapturePath, format: data.data.format }
            : typeof data.data?.base64 === 'string' && data.data.base64.length > 0
              ? { base64: data.data.base64, format: data.data.format }
              : null
      )

      if (!capture?.url && !capture?.filePath && !capture?.base64) {
        throw new Error('Hermes could not see anything yet.')
      }

      const captureMediaRefs = availableCaptures
        .map(entry => {
          if (typeof entry.url === 'string' && entry.url.length > 0) return entry.url
          if (typeof entry.filePath === 'string' && entry.filePath.length > 0) return normalizeHermesMediaPath(entry.filePath)
          return ''
        })
        .filter(Boolean)

      if (capture.url) {
        setVisionCaptureUrl(capture.url)
        setVisionCapturedAt(Date.now())
        if (options?.attachToMessageId) {
          const nextMessages = messagesRef.current.map(message =>
            message.id === options.attachToMessageId
              ? { ...message, content: appendHermesMediaLines(message.content, captureMediaRefs.length ? captureMediaRefs : [capture.url || '']) }
              : message
          )
          setMessages(nextMessages)
          if (options.sessionId) {
            writeNativeSessionCache(options.sessionId, nextMessages)
            setSessions(previous => upsertHermesSessionSummary(
              previous,
              buildSyntheticHermesSessionSummary(options.sessionId || '', nextMessages),
            ))
          }
        }
        return {
          displayUrl: capture.url,
          threadMediaRef: capture.url,
        }
      }

      if (capture.filePath) {
        const threadMediaRef = normalizeHermesMediaPath(capture.filePath)
        const displayUrl = buildHermesMediaUrl(threadMediaRef)
        setVisionCaptureUrl(displayUrl)
        setVisionCapturedAt(Date.now())
        if (options?.attachToMessageId) {
          const nextMessages = messagesRef.current.map(message =>
            message.id === options.attachToMessageId
              ? { ...message, content: appendHermesMediaLines(message.content, captureMediaRefs.length ? captureMediaRefs : [threadMediaRef]) }
              : message
          )
          setMessages(nextMessages)
          if (options.sessionId) {
            writeNativeSessionCache(options.sessionId, nextMessages)
            setSessions(previous => upsertHermesSessionSummary(
              previous,
              buildSyntheticHermesSessionSummary(options.sessionId || '', nextMessages),
            ))
          }
        }
        return {
          displayUrl,
          threadMediaRef,
        }
      }

      const format = capture.format === 'png' || capture.format === 'webp' || capture.format === 'jpeg'
        ? capture.format
        : 'jpeg'

      const displayUrl = `data:image/${format};base64,${capture.base64}`
      setVisionCaptureUrl(displayUrl)
      setVisionCapturedAt(Date.now())
      // Attach the data URL to the chat message too — without this, base64-only
      // captures only show in the side preview and never in chat history (the
      // url/filePath branches above DO attach; this branch was the gap).
      if (options?.attachToMessageId) {
        const nextMessages = messagesRef.current.map(message =>
          message.id === options.attachToMessageId
            ? { ...message, content: appendHermesMediaLines(message.content, [displayUrl]) }
            : message
        )
        setMessages(nextMessages)
        if (options.sessionId) {
          writeNativeSessionCache(options.sessionId, nextMessages)
          setSessions(previous => upsertHermesSessionSummary(
            previous,
            buildSyntheticHermesSessionSummary(options.sessionId || '', nextMessages),
          ))
        }
      }
      return {
        displayUrl,
        threadMediaRef: displayUrl,
      }
    } catch (error) {
      setVisionCaptureError(error instanceof Error ? error.message : 'Hermes vision failed.')
      return null
    } finally {
      setIsCapturingVision(false)
    }
  }, [hermesAvatar?.id, isCapturingVision, messagesRef])

  const connectHermes = useCallback(async (tunnelCommandOverride?: string) => {
    if (isConnecting) return

    setIsConnecting(true)
    setConnectionError('')

    try {
      const tunnelCommand = (tunnelCommandOverride || tunnelInput).trim()
      if (tunnelCommand || tunnelStatus.configured) {
        const tunnelResponse = await fetch('/api/hermes/tunnel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'connect',
            command: tunnelCommand || undefined,
          }),
        })
        const tunnelData = await tunnelResponse.json().catch(() => ({}))
        if (!tunnelResponse.ok) {
          throw new Error(typeof tunnelData?.error === 'string' ? tunnelData.error : `HTTP ${tunnelResponse.status}`)
        }
        if (typeof tunnelData?.error === 'string' && tunnelData.error.trim()) {
          throw new Error(tunnelData.error)
        }
      }

      let connected = false
      let lastError = ''
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch('/api/hermes', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (response.ok && data?.connected) {
          connected = true
          break
        }
        lastError = typeof data?.error === 'string' ? data.error : lastError
        if (attempt < 19) {
          await new Promise(resolve => window.setTimeout(resolve, 600))
        }
      }

      await loadStatus()

      if (!connected && lastError) {
        setConnectionError(lastError)
      } else {
        window.setTimeout(() => inputRef.current?.focus(), 80)
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to connect Hermes.')
      await loadStatus()
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting, loadStatus, tunnelInput, tunnelStatus.configured])

  const openConnectionModal = useCallback(() => {
    setConnectionError('')
    if (!connectionInput.trim()) {
      const lines: string[] = []
      if (status.base) lines.push(`HERMES_API_BASE=${status.base}`)
      if (status.apiKey) lines.push(`HERMES_API_KEY=${status.apiKey}`)
      if (status.defaultModel) lines.push(`HERMES_MODEL=${status.defaultModel}`)
      if (status.systemPrompt) lines.push(`HERMES_SYSTEM_PROMPT=${status.systemPrompt}`)
      if (lines.length > 0) {
        setConnectionInput(lines.join('\n'))
      }
    }
    if (tunnelStatus.configured && tunnelStatus.commandPreview && !tunnelInput.trim()) {
      setTunnelInput(tunnelStatus.commandPreview)
    }
    setShowConnectionModal(true)
  }, [connectionInput, tunnelInput, status, tunnelStatus])

  const saveConnection = useCallback(async (connectAfter: boolean) => {
    if (connectionSaving) return

    const nextConnection = connectionInput.trim()
    const nextTunnel = tunnelInput.trim()
    const hasSavedConnection = status.source === 'pairing' || status.source === 'env'
    const hasSavedTunnel = tunnelStatus.configured

    if (!nextConnection && !nextTunnel && !hasSavedConnection && !hasSavedTunnel) {
      setConnectionError('Paste Hermes connection data or an SSH tunnel command first.')
      return
    }

    setConnectionSaving(true)
    setConnectionError('')

    try {
      // Skip saving if the connection text only contains the placeholder key
      const hasPlaceholderKey = nextConnection && /HERMES_API_KEY=(<paste-real-key-here>|[•]+)/i.test(nextConnection)
      const connectionToSave = hasPlaceholderKey
        ? nextConnection.split('\n').filter(line => !/HERMES_API_KEY=/i.test(line)).join('\n').trim()
        : nextConnection

      if (connectionToSave) {
        const response = await fetch('/api/hermes/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairing: connectionToSave }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
        }
      }

      if (nextTunnel) {
        const response = await fetch('/api/hermes/tunnel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: nextTunnel,
            autoStart: tunnelAutoStart,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
        }
      }

      setConnectionInput('')
      setShowConnectionModal(false)
      autoConnectTriedRef.current = false
      await loadStatus()

      if (connectAfter) {
        await connectHermes(nextTunnel || undefined)
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to save Hermes connection data.')
    } finally {
      setConnectionSaving(false)
    }
  }, [
    connectHermes,
    connectionInput,
    connectionSaving,
    loadStatus,
    status.source,
    tunnelAutoStart,
    tunnelInput,
    tunnelStatus.configured,
  ])

  const forgetSavedConnection = useCallback(async () => {
    if (connectionSaving) return
    setConnectionSaving(true)
    setConnectionError('')

    try {
      const [configResponse, tunnelResponse] = await Promise.all([
        fetch('/api/hermes/config', { method: 'DELETE' }),
        fetch('/api/hermes/tunnel', { method: 'DELETE' }),
      ])

      const configData = await configResponse.json().catch(() => ({}))
      const tunnelData = await tunnelResponse.json().catch(() => ({}))

      if (!configResponse.ok) {
        throw new Error(typeof configData?.error === 'string' ? configData.error : `HTTP ${configResponse.status}`)
      }
      if (!tunnelResponse.ok) {
        throw new Error(typeof tunnelData?.error === 'string' ? tunnelData.error : `HTTP ${tunnelResponse.status}`)
      }

      abortRef.current?.abort()
      abortRef.current = null
      setIsStreaming(false)
      setMessages([])
      setSessions([])
      setNativeSessionsAvailable(false)
      setSelectedSessionId('')
      lastHydratedSessionIdRef.current = ''
      setAutoPlayMediaMessageId('')
      setConnectionInput('')
      setTunnelInput('')
      setShowConnectionModal(false)
      autoConnectTriedRef.current = false
      removeBrowserStorage(CHAT_KEY)
      await loadStatus()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to forget Hermes connection data.')
    } finally {
      setConnectionSaving(false)
    }
  }, [connectionSaving, loadStatus])

  const stopManagedTunnel = useCallback(async () => {
    if (isConnecting) return
    setIsConnecting(true)
    setConnectionError('')

    try {
      const response = await fetch('/api/hermes/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }
      await loadStatus()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Unable to stop the Hermes tunnel.')
    } finally {
      setIsConnecting(false)
    }
  }, [isConnecting, loadStatus])

  useEffect(() => {
    if (!isOpen) return
    void loadStatus()
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [isOpen, loadStatus])

  useEffect(() => {
    if (!isOpen) {
      autoConnectTriedRef.current = false
      setShowConnectionModal(false)
      setShowSettings(false)
      setShowAvatarGallery(false)
      return
    }
  }, [isOpen])

  useEffect(() => {
    void migrateLegacyHermesNativeSessionCache()
  }, [])

  useEffect(() => {
    // ░▒▓ VANISH-ON-SCROLL ROOT CAUSE (oasisspec3): scrollIntoView() walks the
    // ancestor chain and scrolls every scrollable parent, which inside drei's
    // <Html transform> includes the CSS3DObject's internal wrapper → matrix3d
    // gets clobbered → panel appears to vanish until the next three.js frame
    // re-applies the matrix (camera wiggle / Esc). Imperative scrollTop on the
    // known scroll container touches ONLY that container — same pattern as
    // AnorakProPanel which has never had this bug. ▓▒░
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [messages, isStreaming, autoScroll])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (nativeSessionsAvailable) return
    writeBrowserStorage(CHAT_KEY, JSON.stringify(messages.slice(-60)))
  }, [messages, nativeSessionsAvailable])

  useEffect(() => {
    if (!nativeSessionsAvailable) return
    const cacheSessionId = selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE
      ? selectedSessionId
      : activeNativeSessionIdRef.current
    if (!cacheSessionId) return
    if (sessionHydrating) return
    if (!isStreaming && lastHydratedSessionIdRef.current !== cacheSessionId) return
    writeNativeSessionCache(cacheSessionId, messages)
  }, [isStreaming, messages, nativeSessionsAvailable, selectedSessionId, sessionHydrating])

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeBrowserStorage(VOICE_OUTPUT_KEY, String(voiceOutputEnabled))
  }, [voiceOutputEnabled])

  useEffect(() => {
    if (!hermesAvatar?.id) return
    if (isOpen && voiceOutputEnabled) return
    setAgentAvatarAudio(hermesAvatar.id, null)
  }, [hermesAvatar?.id, isOpen, setAgentAvatarAudio, voiceOutputEnabled])

  useEffect(() => {
    if (!hermesAvatar?.id || autoPlayMediaMessageId) return
    setAgentAvatarAudio(hermesAvatar.id, null)
  }, [autoPlayMediaMessageId, hermesAvatar?.id, setAgentAvatarAudio])

  useEffect(() => {
    if (!hermesAvatar?.id) return
    setAgentAvatarAudio(hermesAvatar.id, null)
  }, [hermesAvatar?.id, selectedSessionId, setAgentAvatarAudio])

  useEffect(() => {
    if (!isOpen || !status.connected || !tunnelStatus.configured) return
    void loadSessions()
  }, [isOpen, loadSessions, status.connected, tunnelStatus.configured])

  useEffect(() => {
    if (status.connected && tunnelStatus.configured) return
    setNativeSessionsAvailable(false)
    setSessions([])
    setSessionHydrating(false)
    activeNativeSessionIdRef.current = ''
    lastHydratedSessionIdRef.current = ''
  }, [status.connected, tunnelStatus.configured])

  useEffect(() => {
    if (!nativeSessionsAvailable) return
    if (isStreaming) return
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_VALUE) {
      lastHydratedSessionIdRef.current = selectedSessionId || NEW_SESSION_VALUE
      // Only clear if we're not actively sending (messages were just added by sendMessage)
      if (messages.length === 0) {
        setAutoPlayMediaMessageId('')
        setAutoScroll(true)
      }
      return
    }

    if (lastHydratedSessionIdRef.current === selectedSessionId && messages.length > 0) return

    lastHydratedSessionIdRef.current = selectedSessionId
    void hydrateSession(selectedSessionId)
  }, [hydrateSession, isStreaming, messages.length, nativeSessionsAvailable, selectedSessionId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!selectedSessionId) return
    writeBrowserStorage(SESSION_KEY, selectedSessionId)
  }, [selectedSessionId])

  useEffect(() => {
    if (voiceOutputEnabled) return
    setAutoPlayMediaMessageId('')
  }, [voiceOutputEnabled])

  useEffect(() => {
    if (!isOpen || statusLoading || isConnecting) return
    if (status.connected) return
    if (autoConnectTriedRef.current) return
    if (!status.configured && !tunnelStatus.configured) return
    if (tunnelStatus.configured && !tunnelStatus.autoStart) return

    autoConnectTriedRef.current = true
    void connectHermes()
  }, [
    connectHermes,
    isConnecting,
    isOpen,
    status.configured,
    status.connected,
    statusLoading,
    tunnelStatus.autoStart,
    tunnelStatus.configured,
  ])

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    if (embedded) return
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, option, a, [data-no-drag]')) return

    event.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: event.clientX - position.x, y: event.clientY - position.y }
  }, [embedded, position])

  const handleDrag = useCallback((event: MouseEvent) => {
    if (embedded || !isDragging) return
    const nextPos = {
      x: event.clientX - dragStart.current.x,
      y: Math.max(-8, event.clientY - dragStart.current.y),
    }
    setPosition(nextPos)
    writeBrowserStorage(POS_KEY, JSON.stringify(nextPos))
  }, [embedded, isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    if (embedded) return
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: event.clientX, y: event.clientY, w: size.w, h: size.h }
  }, [embedded, size])

  const handleResize = useCallback((event: MouseEvent) => {
    if (embedded || !isResizing) return
    const nextSize = {
      w: Math.max(MIN_WIDTH, resizeStart.current.w + (event.clientX - resizeStart.current.x)),
      h: Math.max(MIN_HEIGHT, resizeStart.current.h + (event.clientY - resizeStart.current.y)),
    }
    setSize(nextSize)
    writeBrowserStorage(SIZE_KEY, JSON.stringify(nextSize))
  }, [embedded, isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (embedded) return
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
  }, [embedded, handleDrag, handleDragEnd, handleResize, handleResizeEnd, isDragging, isResizing])

  const updatePanelSettings = useCallback((next: PanelSettings) => {
    setPanelSettings(next)
    writeBrowserStorage(SETTINGS_KEY, JSON.stringify(next))
  }, [])

  const _toggleDetails = useCallback(() => {
    setShowDetails(current => {
      const next = !current
      writeBrowserStorage(DETAILS_KEY, String(next))
      return next
    })
  }, [])

  const _clearChat = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    setAutoPlayMediaMessageId('')

    if (nativeSessionsAvailable) {
      activeNativeSessionIdRef.current = ''
      lastHydratedSessionIdRef.current = NEW_SESSION_VALUE
      setSelectedSessionId(NEW_SESSION_VALUE)
      setMessages([])
      setAutoScroll(true)
      return
    }

    setMessages([])
    removeBrowserStorage(CHAT_KEY)
  }, [nativeSessionsAvailable])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    const sessionId = selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE
      ? selectedSessionId
      : activeNativeSessionIdRef.current
    if (nativeSessionsAvailable && sessionId) {
      void hydrateSession(sessionId)
    }
  }, [hydrateSession, nativeSessionsAvailable, selectedSessionId])

  const sendMessage = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming || !status.connected) return

    const worldId = useOasisStore.getState().activeWorldId
    const useNativeSessions = nativeSessionsAvailable
    const sessionIdForRequest = useNativeSessions
      ? (
          selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE
            ? selectedSessionId
            : activeNativeSessionIdRef.current
        )
      : ''
    const history = messages.slice(-24).map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }))

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }

    const assistantId = `assistant-${Date.now()}`
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    setAutoScroll(true)
    setAutoPlayMediaMessageId('')
    setMessages(previous => [...previous, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)

    // Yield to the event loop so React paints the user message before the fetch blocks
    await new Promise(resolve => setTimeout(resolve, 0))

    const controller = new AbortController()
    abortRef.current = controller
    let resolvedSessionId = sessionIdForRequest

    try {
      const response = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          history,
          worldId,
          playerContext: {
            avatar: getPlayerAvatarPose(),
            camera: getCameraSnapshot(),
          },
          sessionMode: useNativeSessions ? 'native' : 'compat',
          sessionId: sessionIdForRequest || undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '')
        setMessages(previous => previous.map(message =>
          message.id === assistantId
            ? { ...message, error: detail || `HTTP ${response.status}`, content: detail || message.content }
            : message
        ))
        return
      }

      let assistantText = ''
      let assistantReasoning = ''
      let assistantUsage: HermesUsage | undefined
      let finishReason: string | undefined
      let assistantError: string | undefined
      const toolMap = new Map<number, HermesToolCall>()
      let dedupSnapshot = ''  // full text before tool_calls — used to skip re-sent chunks
      let dedupPos = 0        // how far into the snapshot we've matched
      let lastRenderTime = 0

      for await (const event of parseHermesSSE(response)) {
        if (controller.signal.aborted) break

        switch (event.type) {
          case 'text': {
            const chunk = event.content
            // After tool_calls, the API re-sends previous text. Skip chunks that match the snapshot.
            if (dedupSnapshot && dedupPos < dedupSnapshot.length) {
              const remaining = dedupSnapshot.length - dedupPos
              if (chunk.length <= remaining) {
                // Chunk fits within snapshot — check exact match
                const expected = dedupSnapshot.slice(dedupPos, dedupPos + chunk.length)
                if (chunk === expected) {
                  dedupPos += chunk.length
                  if (dedupPos >= dedupSnapshot.length) dedupSnapshot = ''
                  break // skip — this is a re-send
                }
                // Chunk doesn't match — check if it's a trimmed/whitespace variant
                if (chunk.trim() === expected.trim() && chunk.trim().length > 0) {
                  dedupPos += chunk.length
                  if (dedupPos >= dedupSnapshot.length) dedupSnapshot = ''
                  break // skip — whitespace-variant re-send
                }
              } else {
                // Chunk straddles the snapshot boundary — split it
                const overlapPart = dedupSnapshot.slice(dedupPos)
                if (chunk.startsWith(overlapPart)) {
                  // Overlap matches, accept only the new portion past the snapshot
                  dedupSnapshot = ''
                  assistantText += chunk.slice(overlapPart.length)
                  break
                }
                if (chunk.trimStart().startsWith(overlapPart.trimEnd()) && overlapPart.trim().length > 0) {
                  dedupSnapshot = ''
                  break // close enough — skip the whole chunk to avoid duplication
                }
              }
              // True divergence — stop deduping, accept from here
              dedupSnapshot = ''
            }
            assistantText += chunk
            break
          }
          case 'reasoning':
            assistantReasoning += event.content
            break
          case 'tool': {
            if (!toolMap.has(event.index) && assistantText.trim()) {
              dedupSnapshot = assistantText
              dedupPos = 0
            }
            const current = toolMap.get(event.index) || {
              index: event.index,
              id: event.id,
              name: event.name || `tool_${event.index + 1}`,
              arguments: '',
            }
            current.id = event.id || current.id
            current.name = event.name || current.name
            current.arguments += event.argumentsChunk || ''
            toolMap.set(event.index, current)
            break
          }
          case 'usage':
            assistantUsage = {
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              totalTokens: event.totalTokens,
            }
            break
          case 'done':
            finishReason = event.finishReason || finishReason
            // Snapshot text at tool_calls boundary — next turn will re-send it
            if (event.finishReason === 'tool_calls' || event.finishReason === 'tool_use') {
              dedupSnapshot = assistantText
              dedupPos = 0
            }
            break
          case 'error':
            assistantError = event.message
            break
          case 'meta':
            if (event.sessionId) {
              const nextSessionId = event.sessionId
              resolvedSessionId = nextSessionId
              activeNativeSessionIdRef.current = nextSessionId
              setSelectedSessionId(nextSessionId)
              setSessions(previous => upsertHermesSessionSummary(
                previous,
                buildSyntheticHermesSessionSummary(nextSessionId, [...messages, userMessage, assistantMessage]),
              ))
            }
            break
        }

        // Throttle re-renders for smooth streaming feel (~33ms)
        const now = Date.now()
        if (now - lastRenderTime >= STREAM_RENDER_INTERVAL_MS || event.type === 'done' || event.type === 'error') {
          lastRenderTime = now
          const orderedTools = Array.from(toolMap.values()).sort((left, right) => left.index - right.index)
          const liveTools = orderedTools.length ? orderedTools : extractHermesProgressToolCalls(assistantText)
          setMessages(previous => previous.map(message =>
            message.id === assistantId
              ? {
                  ...message,
                  content: sanitizeHermesAssistantText(assistantText),
                  reasoning: assistantReasoning || undefined,
                  tools: liveTools.length ? liveTools : undefined,
                  usage: assistantUsage,
                  finishReason,
                  error: assistantError,
                }
              : message
          ))
        }
      }

      const orderedTools = Array.from(toolMap.values()).sort((left, right) => left.index - right.index)
      const finalTools = orderedTools.length ? orderedTools : extractHermesProgressToolCalls(assistantText)
      const finalAssistantText = sanitizeHermesAssistantText(assistantText)
      if (!finishReason && (assistantError || finalAssistantText.trim() || assistantReasoning.trim() || finalTools.length > 0)) {
        finishReason = assistantError ? 'error' : 'stop'
      }

      const finalAssistantMessage: ChatMessage = {
        ...assistantMessage,
        content: finalAssistantText,
        reasoning: assistantReasoning || undefined,
        tools: finalTools,
        usage: assistantUsage,
        finishReason,
        error: assistantError,
      }

      setMessages(previous => {
        let replaced = false
        const next = previous.map(message => {
          if (message.id !== assistantId) return message
          replaced = true
          return finalAssistantMessage
        })
        return collapseDuplicateHermesMessages(replaced ? next : [...next, finalAssistantMessage])
      })

      let settledAssistantMessage = finalAssistantMessage
      if (useNativeSessions && resolvedSessionId) {
        activeNativeSessionIdRef.current = resolvedSessionId
        lastHydratedSessionIdRef.current = resolvedSessionId
        void loadSessions(resolvedSessionId)
        settledAssistantMessage = await enrichAssistantToolsFromSession(resolvedSessionId, finalAssistantMessage)
        if (hermesToolSignature(settledAssistantMessage.tools) !== hermesToolSignature(finalAssistantMessage.tools)) {
          setMessages(previous => collapseDuplicateHermesMessages(previous.map(message =>
            message.id === assistantId
              ? settledAssistantMessage
              : message
          )))
        }
        const mergedMessages = collapseDuplicateHermesMessages([
          ...messages,
          userMessage,
          settledAssistantMessage,
        ])
        writeNativeSessionCache(resolvedSessionId, mergedMessages)
        setSessions(previous => upsertHermesSessionSummary(
          previous,
          buildSyntheticHermesSessionSummary(resolvedSessionId, mergedMessages),
        ))
      }
      let voiceTargetMessage = settledAssistantMessage

      const latestImageMediaRef = extractHermesMediaReferences(settledAssistantMessage.content)
        .reverse()
        .find(ref => ref.mediaType === 'image')
      if (latestImageMediaRef?.path) {
        setVisionCaptureError('')
        setVisionCaptureUrl(buildHermesMediaUrl(latestImageMediaRef.path))
        setVisionCapturedAt(Date.now())
      }

      if (!assistantError && settledAssistantMessage.tools?.length && hasHydratedToolArguments(settledAssistantMessage.tools)) {
        const latestVisionTool = [...settledAssistantMessage.tools]
          .reverse()
          .find(tool => isHermesVisionTool(tool.name))
        if (latestVisionTool) {
          const signature = `${settledAssistantMessage.id}:${latestVisionTool.name}:${latestVisionTool.arguments}`
          if (lastVisionToolSignatureRef.current !== signature) {
            lastVisionToolSignatureRef.current = signature
            void captureHermesVision(latestVisionTool, {
              attachToMessageId: settledAssistantMessage.id,
              ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
            })
          }
        }
      }

      if (!assistantError && voiceOutputEnabled) {
        const voiceContent = voiceTargetMessage.content.trim()
        if (voiceContent) {
          const mediaRefs = extractHermesMediaReferences(voiceTargetMessage.content)
          const firstAudioRef = mediaRefs.find(ref => ref.mediaType === 'audio')

          if (firstAudioRef) {
            setAutoPlayMediaMessageId(voiceTargetMessage.id)
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        if (useNativeSessions && resolvedSessionId) {
          void hydrateSession(resolvedSessionId)
        }
        return
      }
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? {
              ...message,
              error: error instanceof Error ? error.message : 'Hermes request failed.',
            }
          : message
      ))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsStreaming(false)
    }
  }, [
    hydrateSession,
    input,
    isStreaming,
    loadSessions,
    messages,
    nativeSessionsAvailable,
    captureHermesVision,
    enrichAssistantToolsFromSession,
    selectedSessionId,
    status.connected,
    voiceOutputEnabled,
  ])

  const isVisible = embedded || isOpen
  if (!isVisible || typeof document === 'undefined') return null

  const rgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(part => parseInt(part, 16)) || [18, 12, 4]
  const backgroundStyle = panelSettings.blur > 0 && panelSettings.opacity < 1
    ? {
        backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})`,
        backdropFilter: `blur(${panelSettings.blur}px)`,
      }
    : { backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})` }

  const canSend = status.connected && Boolean(input.trim()) && !isStreaming
  const canMutateAnyConfig = Boolean(status.canMutateConfig || tunnelStatus.canMutateConfig)
  const tunnelLabel = getTunnelLabel(tunnelStatus)
  const tunnelTitle = buildTunnelTitle(tunnelStatus)
  const sessionValue = nativeSessionsAvailable
    ? (selectedSessionId || activeNativeSessionIdRef.current || sessions[0]?.id || NEW_SESSION_VALUE)
    : NEW_SESSION_VALUE
  const activeSession = sessions.find(session => session.id === sessionValue) || null

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'hermes-panel'}
      data-ui-panel
      className={`${embedded ? 'relative w-full h-full' : 'fixed'} rounded-xl flex flex-col overflow-hidden`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        userSelect: isDragging || isResizing ? 'none' : 'auto',
        ...(embedded ? EMBEDDED_SCROLL_SURFACE_STYLE : {}),
        ...backgroundStyle,
        color: 'rgba(255, 245, 220, 0.96)',
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        border: `1px solid ${isStreaming ? 'rgba(245,158,11,0.58)' : 'rgba(245,158,11,0.24)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(245,158,11,0.16), inset 0 0 60px rgba(245,158,11,0.04)'
          : '0 8px 40px rgba(0,0,0,0.78)',
        transition: 'box-shadow 0.35s ease, border-color 0.35s ease',
      }}
      onMouseDown={event => {
        event.stopPropagation()
        focusPanelUI()
        if (!embedded) useOasisStore.getState().bringPanelToFront('hermes')
      }}
      onPointerDown={event => event.stopPropagation()}
      onClick={embedded ? event => event.stopPropagation() : undefined}
    >
      <div
        data-drag-handle
        onMouseDown={embedded ? undefined : handleDragStart}
        className={`flex items-center justify-between px-3 py-2 border-b border-white/10 select-none ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(245,158,11,0.16) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(24,18,10,0.72)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>?</span>
          <span className="text-amber-300 font-bold text-sm tracking-wide">Hermes</span>
          <StatusBadge status={status} loading={statusLoading || isConnecting} />
          <SourceBadge source={status.source} />
          <TunnelBadge status={tunnelStatus} />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void connectHermes()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-emerald-200/80 hover:text-emerald-100 border border-emerald-500/25 hover:border-emerald-400/50 transition-all cursor-pointer disabled:opacity-50"
            title={tunnelStatus.configured ? 'Start the saved SSH tunnel if needed, then connect to Hermes' : 'Refresh Hermes and connect'}
            disabled={isConnecting || statusLoading || (!status.configured && !tunnelStatus.configured)}
          >
            {isConnecting ? 'connecting' : 'connect'}
          </button>
          <button
            onClick={openConnectionModal}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer disabled:opacity-50"
            title="Edit saved connection data and SSH tunnel"
            disabled={!canMutateAnyConfig || connectionSaving}
          >
            config
          </button>
          <button
            onClick={() => void stopManagedTunnel()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-red-300/80 hover:text-red-200 border border-red-500/25 hover:border-red-500/40 transition-all cursor-pointer disabled:opacity-50"
            title="Stop the managed SSH tunnel without forgetting it"
            disabled={isConnecting || !tunnelStatus.running}
          >
            stop
          </button>
          <button
            onClick={() => setShowAvatarGallery(true)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer"
            style={{
              color: hermesAvatar ? '#c084fc' : '#d1d5db',
              borderColor: hermesAvatar ? 'rgba(192,132,252,0.28)' : 'rgba(255,255,255,0.08)',
              background: hermesAvatar ? 'rgba(168,85,247,0.12)' : 'transparent',
            }}
            title={hermesAvatar ? 'Change Hermes avatar' : 'Assign Hermes an avatar in the world'}
          >
            avatar
          </button>
          <button
            onClick={() => void captureHermesVision()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer disabled:opacity-50"
            style={{
              color: visionCaptureUrl ? '#7dd3fc' : '#d1d5db',
              borderColor: visionCaptureUrl ? 'rgba(125,211,252,0.28)' : 'rgba(255,255,255,0.08)',
              background: visionCaptureUrl ? 'rgba(14,116,144,0.14)' : 'transparent',
            }}
            title="Capture Hermes' current phantom-camera view"
            disabled={isCapturingVision}
          >
            {isCapturingVision ? 'view...' : 'view'}
          </button>
          <div className="relative flex items-center">
            <button
              onClick={() => setShowSettings(current => !current)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer"
              title="Panel settings"
            >
              {'\u2699'}
            </button>
            {showSettings && <SettingsDropdown settings={panelSettings} onChange={updatePanelSettings} voiceOutput={voiceOutputEnabled} onVoiceOutputChange={(v) => { setVoiceOutputEnabled(v); if (!v) setAutoPlayMediaMessageId('') }} />}
          </div>
          {!hideCloseButton && (
            <button onClick={onClose} className="text-amber-100/80 hover:text-white transition-colors text-lg leading-none cursor-pointer" title="Close">
              x
            </button>
          )}
        </div>
      </div>

      <div
        data-drag-handle
        onMouseDown={embedded ? undefined : handleDragStart}
        className="px-3 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono"
        style={{ background: 'rgba(0,0,0,0.22)' }}
      >
        <span className="text-amber-100/70 uppercase">session</span>
        <select
          data-no-drag
          value={sessionValue}
          onChange={event => {
            const nextSessionId = event.target.value
            activeNativeSessionIdRef.current = nextSessionId === NEW_SESSION_VALUE ? '' : nextSessionId
            setSelectedSessionId(nextSessionId)
            if (nextSessionId === NEW_SESSION_VALUE) {
              setMessages([])
              setAutoPlayMediaMessageId('')
              setAutoScroll(true)
            }
          }}
          disabled={!nativeSessionsAvailable || sessionsLoading || isStreaming}
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-amber-100 outline-none disabled:opacity-50"
        >
          <option value={NEW_SESSION_VALUE}>+ new chat</option>
          {sessions.map(session => (
            <option key={session.id} value={session.id}>
              {formatSessionLabel(session)}
            </option>
          ))}
        </select>
        <button
          data-no-drag
          onClick={() => {
            activeNativeSessionIdRef.current = ''
            setSelectedSessionId(NEW_SESSION_VALUE)
            setMessages([])
            setAutoScroll(true)
          }}
          disabled={isStreaming}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/80 hover:text-amber-100 border border-amber-500/25 hover:border-amber-400/50 transition-all cursor-pointer disabled:opacity-50"
          title="Start a new Hermes session in Oasis"
        >
          + new
        </button>
        <span
          className="hidden md:block text-amber-100/65 truncate max-w-[120px]"
          title={tunnelStatus.commandPreview ? `${tunnelTitle}\n${tunnelStatus.commandPreview}` : tunnelTitle}
        >
          {nativeSessionsAvailable ? (activeSession ? activeSession.source : 'native') : tunnelLabel}
        </span>
        {activeSession && showDetails ? (
          <span className="hidden lg:block text-amber-100/65 truncate max-w-[220px]" title={activeSession.preview || activeSession.id}>
            {activeSession.preview || activeSession.id}
          </span>
        ) : (
          status.base && (
            <span className="hidden lg:block text-amber-100/65 truncate max-w-[180px]" title={status.base}>
              {status.base}
            </span>
          )
        )}
      </div>

      {connectionError && (
        <div className="px-3 py-1.5 text-[10px] text-red-200 border-b border-red-500/20 bg-red-500/10 font-mono">
          {connectionError}
        </div>
      )}

      {!connectionError && status.connected && tunnelStatus.configured && !tunnelStatus.healthy && tunnelStatus.issues[0] && (
        <div className="px-3 py-1.5 text-[10px] text-amber-100 border-b border-amber-500/20 bg-amber-500/10 font-mono">
          {tunnelStatus.issues[0]}
        </div>
      )}

      {sessionsError && !connectionError && (
        <div className="px-3 py-1.5 text-[10px] text-amber-100 border-b border-amber-500/20 bg-amber-500/10 font-mono">
          {sessionsError}
        </div>
      )}

      {!voiceInput.error && voiceInput.backendState === 'loading' && voiceInput.backendMessage && !connectionError && !sessionsError && (
        <div className="px-3 py-1.5 text-[10px] text-sky-100 border-b border-sky-500/20 bg-sky-500/10 font-mono">
          {voiceInput.backendMessage}
        </div>
      )}

      {voiceInput.error && !connectionError && !sessionsError && (
        <div className="px-3 py-1.5 text-[10px] text-amber-100 border-b border-amber-500/20 bg-amber-500/10 font-mono">
          {voiceInput.error}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          data-agent-window-scroll-root=""
          className="h-full overflow-y-auto px-3 py-3 space-y-3 min-h-0"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent', ...EMBEDDED_SCROLL_SURFACE_STYLE }}
        >
          {(visionCaptureUrl || visionCaptureError || hermesAvatar) && (
            <div
              className="rounded-xl border px-3 py-2 space-y-2"
              style={{
                borderColor: visionCaptureError ? 'rgba(239,68,68,0.35)' : 'rgba(56,189,248,0.25)',
                background: 'rgba(7,12,20,0.75)',
              }}
            >
              <div className="flex items-center justify-between gap-3 text-[10px] font-mono">
                <span className="text-sky-200">Hermes vision</span>
                <span className="text-gray-500">
                  {hermesAvatar ? 'avatar online' : 'no avatar'}
                  {visionCapturedAt ? ` - ${new Date(visionCapturedAt).toLocaleTimeString()}` : ''}
                </span>
              </div>
              {visionCaptureUrl && (
                <MediaBubble
                  url={visionCaptureUrl}
                  mediaType="image"
                  prompt="Hermes vision"
                  compact
                  galleryScopeId="hermes-thread"
                />
              )}
              {!visionCaptureUrl && hermesAvatar && !visionCaptureError && (
                <div className="text-[11px] text-gray-400">Tap `view` and Hermes will show you what his phantom camera sees.</div>
              )}
              {visionCaptureError && (
                <div className="text-[11px] text-red-300">{visionCaptureError}</div>
              )}
            </div>
          )}

          {sessionHydrating && (
            <div className="px-3 py-2 rounded-lg text-[11px] font-mono text-amber-100 border border-amber-500/20 bg-black/30">
              loading session...
            </div>
          )}

          {messages.length === 0 && (
            <div className="h-full flex flex-col justify-center text-center px-4">
              <div className="text-4xl mb-3 text-amber-300">☤</div>
              <div className="text-sm text-amber-100 mb-1">Hermes is in the Oasis.</div>
              {status.connected ? (
                <>
                  <div className="text-xs text-amber-100/80 mb-4">
                    Try one of these to see your agent interact with the 3D world:
                  </div>
                  <div className="space-y-2 text-[11px] font-mono text-amber-100/80">
                    <button className="block w-full text-left hover:text-amber-300 transition-colors cursor-pointer px-2 py-1 rounded border border-amber-500/15 hover:border-amber-500/30" onClick={() => setInput('What world am I in? Call get_world_info.')}>
                      <span className="text-emerald-400/80">easy</span> — What world am I in? Call get_world_info.
                    </button>
                    <button className="block w-full text-left hover:text-amber-300 transition-colors cursor-pointer px-2 py-1 rounded border border-amber-500/15 hover:border-amber-500/30" onClick={() => setInput('Place a tree, a bench, and a lamp post in a small park arrangement.')}>
                      <span className="text-amber-400/80">build</span> — Place a tree, a bench, and a lamp post in a park.
                    </button>
                    <button className="block w-full text-left hover:text-amber-300 transition-colors cursor-pointer px-2 py-1 rounded border border-amber-500/15 hover:border-amber-500/30" onClick={() => setInput('Craft a medieval watchtower with flame torches, then set the sky to night and paint a stone path around it.')}>
                      <span className="text-red-400/80">epic</span> — Craft a watchtower with torches, night sky, stone path.
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-amber-100/80 mb-4">
                    Connect your Hermes agent to co-build in this 3D world.
                  </div>
                  <div className="text-[11px] text-left font-mono rounded-lg border border-amber-500/20 bg-black/30 px-3 py-3 space-y-1 text-amber-100/85">
                    <div>1. {canMutateAnyConfig ? 'Click `config` above.' : 'Open this panel on localhost to edit saved connection data.'}</div>
                    <div>2. Paste your Hermes API base URL and key.</div>
                    <div>3. If remote, paste the SSH tunnel command too.</div>
                    <div>4. Hit `connect` and start building.</div>
                  </div>
                  {status.error && (
                    <div className="mt-3 text-xs text-red-300">{status.error}</div>
                  )}
                </>
              )}
            </div>
          )}

          {messages.map((message, messageIndex) => (
            <div key={`${message.id}-${message.role}-${messageIndex}`} className="space-y-2">
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <div
                    className="max-w-[88%] px-3 py-2 rounded-lg text-xs text-gray-100"
                    style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.22)' }}
                  >
                    {message.content}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {(message.content || isStreaming) && (
                    <div
                      className="px-3 py-2 rounded-lg text-xs text-gray-100 whitespace-pre-wrap leading-relaxed"
                      style={{ background: 'rgba(0,0,0,0.48)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      {message.content
                        ? renderHermesAssistantContent(
                            message.content,
                            autoPlayMediaMessageId === message.id && voiceOutputEnabled,
                            hermesAvatar?.id,
                          )
                        : <span className="text-amber-100/75">Streaming...</span>}
                    </div>
                  )}

                  {message.error && (
                    <div className="px-3 py-2 rounded-lg text-xs text-red-200 border border-red-500/25 bg-red-500/10">
                      {message.error}
                    </div>
                  )}

                  {message.reasoning && (
                    <CollapsibleBlock
                      label={`reasoning (${message.reasoning.length} chars)`}
                      icon="::"
                      content={message.reasoning}
                      accentColor="rgba(148,163,184,0.35)"
                      compact
                    />
                  )}

                  {message.tools && message.tools.length > 0 && (
                    <div className="space-y-1.5">
                      {message.tools.map(tool => (
                        <ToolDetails
                          key={`${message.id}-${tool.index}-${tool.id || tool.name}`}
                          tool={tool}
                          completed={!isStreaming || message !== messages[messages.length - 1]}
                          failed={Boolean(message.error) || message.finishReason === 'error'}
                        />
                      ))}
                    </div>
                  )}

                  {message.usage && (
                    <CollapsibleBlock
                      label={`usage (${message.usage.totalTokens || 0} total tokens)`}
                      icon="##"
                      content={JSON.stringify(message.usage, null, 2)}
                      accentColor="rgba(52,211,153,0.35)"
                      compact
                    />
                  )}

                  {isStreaming && message === messages[messages.length - 1] && (
                    <div className="flex items-center gap-2 text-[10px] font-mono text-amber-200/50 px-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      streaming...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {!autoScroll && messages.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 right-3">
            <button
              data-no-drag
              className="pointer-events-auto px-2 py-1 rounded-full text-[10px] font-mono border border-amber-500/25 bg-black/70 text-amber-100 hover:border-amber-400/50"
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
      </div>

      <div className="px-3 py-2 border-t border-white/10" style={{ background: 'rgba(8,6,3,0.8)' }}>
        {!status.connected && status.error && (
          <div className="text-[10px] text-red-300 mb-2">{status.error}</div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-2">
            <AgentVoiceInputButton
              data-no-drag
              controller={voiceInput}
              disabled={!status.connected}
              className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-amber-100 disabled:opacity-30 disabled:cursor-not-allowed"
              titleReady="Record from your device mic and drop the local Whisper transcript into Hermes."
            />
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            rows={3}
            maxLength={6000}
            placeholder={
              !status.connected
                ? 'Connect Hermes first...'
                : isStreaming
                  ? 'Hermes is responding...'
                  : nativeSessionsAvailable
                    ? 'Talk to Hermes in this session...'
                    : 'Talk to Hermes...'
            }
            disabled={!status.connected || isStreaming}
            className="flex-1 resize-none rounded-lg px-3 py-2 text-xs text-white outline-none placeholder:text-amber-100/45 disabled:opacity-60"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${isStreaming ? 'rgba(245,158,11,0.32)' : 'rgba(245,158,11,0.18)'}`,
            }}
          />
          <button
            onClick={isStreaming ? cancel : () => void sendMessage()}
            disabled={!isStreaming && !canSend}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              minWidth: 70,
              background: isStreaming
                ? 'rgba(239,68,68,0.36)'
                : 'linear-gradient(135deg, rgba(245,158,11,0.56) 0%, rgba(217,119,6,0.56) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.48)' : 'rgba(245,158,11,0.32)'}`,
            }}
          >
            {isStreaming ? 'stop' : 'send'}
          </button>
        </div>
      </div>

      {showConnectionModal && (
        <div
          data-ui-panel
          className="absolute inset-0 z-40 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-3"
          onMouseDownCapture={event => {
            focusPanelUI()
            event.stopPropagation()
          }}
          onPointerDownCapture={event => event.stopPropagation()}
        >
          <div
            data-ui-panel
            className="w-full max-w-[560px] rounded-lg border border-amber-500/30 bg-[#120f08] shadow-2xl"
          >
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-mono text-amber-200">Hermes Connection</div>
              <button
                data-no-drag
                className="text-amber-100/80 hover:text-white text-sm"
                onClick={() => setShowConnectionModal(false)}
              >
                x
              </button>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="text-[11px] text-amber-100/85 font-mono">
                Save your Hermes connection block and optional SSH tunnel here. Oasis keeps the secret server-side and can re-launch the tunnel for you on future opens.
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-amber-200/80">Connection Data</div>
                  {status.source === 'pairing' && !connectionInput.trim() && (
                    <div className="text-[10px] font-mono text-amber-100/60">saved locally already</div>
                  )}
                </div>
                <textarea
                  data-no-drag
                  value={connectionInput}
                  onChange={event => setConnectionInput(event.target.value)}
                  placeholder={CONNECTION_HINT}
                  className="w-full h-40 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-amber-100 font-mono outline-none"
                  spellCheck={false}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-amber-200/80">SSH Tunnel</div>
                  {tunnelStatus.configured && !tunnelInput.trim() && (
                    <div className="text-[10px] font-mono text-amber-100/60">saved locally already</div>
                  )}
                </div>
                <textarea
                  data-no-drag
                  value={tunnelInput}
                  onChange={event => setTunnelInput(event.target.value)}
                  placeholder={TUNNEL_HINT}
                  className="w-full h-24 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-amber-100 font-mono outline-none"
                  spellCheck={false}
                />
                <label className="flex items-center gap-2 text-[11px] font-mono text-amber-100/85 select-none">
                  <input
                    data-no-drag
                    type="checkbox"
                    checked={tunnelAutoStart}
                    onChange={event => setTunnelAutoStart(event.target.checked)}
                    className="accent-amber-500"
                  />
                  auto-start SSH when the Hermes panel opens
                </label>
              </div>

              {connectionError && (
                <div className="text-[10px] text-red-200 border border-red-500/20 bg-red-500/10 rounded px-2 py-1.5 font-mono">
                  {connectionError}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-amber-100/85 hover:text-white"
                    onClick={() => setConnectionInput(CONNECTION_HINT)}
                  >
                    secrets template
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-amber-100/85 hover:text-white"
                    onClick={() => setTunnelInput(TUNNEL_HINT)}
                  >
                    ssh template
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-red-500/25 text-[10px] font-mono text-red-200 hover:text-white disabled:opacity-50"
                    onClick={() => void forgetSavedConnection()}
                    disabled={connectionSaving || (!status.configured && !tunnelStatus.configured)}
                  >
                    forget saved
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-amber-100/85 hover:text-white"
                    onClick={() => setShowConnectionModal(false)}
                  >
                    cancel
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-100 hover:text-white disabled:opacity-50"
                    onClick={() => void saveConnection(false)}
                    disabled={connectionSaving}
                  >
                    {connectionSaving ? 'saving...' : 'save'}
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 text-[10px] font-mono text-emerald-100 disabled:opacity-50"
                    onClick={() => void saveConnection(true)}
                    disabled={connectionSaving}
                  >
                    {connectionSaving ? 'saving...' : 'save & connect'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={hermesAvatar?.avatar3dUrl || null}
          onSelect={(avatarUrl) => {
            assignHermesAvatar(avatarUrl)
            setShowAvatarGallery(false)
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}

      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(245,158,11,0.42) 50%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody

  return createPortal(
    panelBody,
    document.body
  )
}
