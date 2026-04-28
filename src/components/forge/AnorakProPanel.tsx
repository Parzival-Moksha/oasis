'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO PANEL — 2D overlay for the autonomous dev pipeline
// ─═̷─═̷─ॐ─═̷─═̷─ Curator, Coder, Reviewer, Tester in one view ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '../../store/oasisStore'
import { useUILayer } from '@/lib/input-manager'
import { TOOL_ICONS_MAP } from '@/lib/anorak-engine'
import {
  type AnorakLobe,
  type CustomContextModule as SharedCustomContextModule,
  type LegacyContextModules,
  type LobeModuleMap,
  getContextModuleCatalog,
  getDefaultConfigFields,
  mergeContextConfig,
  normalizeContextConfig,
} from '@/lib/anorak-context-config'
import { CollapsibleBlock, ToolCallCard, TokenCounter, renderMarkdown } from '@/lib/anorak-renderers'
import { MediaBubble } from './MediaBubble'
import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { AgentVoiceInputButton } from './AgentVoiceInputButton'
import { AvatarGallery } from './AvatarGallery'
import { readTokenUsagePayload } from '@/lib/token-usage'
import {
  listClientAgentSessionCaches,
  saveClientAgentSessionCaches,
  type ClientAgentSessionCacheRecord,
} from '@/lib/agent-session-cache-client'
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '@/lib/browser-storage'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 80, y: 80 }
const MIN_WIDTH = 480
const MIN_HEIGHT = 450
const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 700

const POS_KEY = 'oasis-anorak-pro-pos'
const SIZE_KEY = 'oasis-anorak-pro-size'
const TAB_KEY = 'oasis-anorak-pro-tab'
const SETTINGS_KEY = 'oasis-anorak-pro-settings'
const CONFIG_KEY = 'oasis-anorak-pro-config'
const LOBE_FILTER_KEY = 'oasis-anorak-pro-lobe-filters'
const PRO_SESSION_KEY = 'oasis-anorak-pro-session-v2'

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PRO CONFIG — persisted to localStorage, flows to API calls
// ═══════════════════════════════════════════════════════════════════════════

export type CustomContextModule = SharedCustomContextModule

export interface AnorakProConfig {
  models: { curator: string; coder: string; reviewer: string; tester: string; gamer: string; 'anorak-pro': string }
  reviewerThreshold: number
  batchSize: number
  recapLength: number
  testerHeaded: boolean
  gamerHeaded: boolean
  autoCurate: boolean
  autoCode: boolean
  heartbeat: boolean
  heartbeatFirstPingDelayMin: number
  heartbeatFrequencyMin: number
  heartbeatWorkStart: number
  heartbeatWorkEnd: number
  contextModules: LegacyContextModules
  customModules: CustomContextModule[]
  lobeModules: LobeModuleMap
  topMissionCount: number
  moduleValues: Record<string, number>
}

const DEFAULT_CONFIG: AnorakProConfig = {
  models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet', gamer: 'sonnet', 'anorak-pro': 'sonnet' },
  reviewerThreshold: 90,
  batchSize: 1,
  recapLength: 100,
  testerHeaded: true,
  gamerHeaded: true,
  autoCurate: false,
  autoCode: false,
  heartbeat: false,
  heartbeatFirstPingDelayMin: 60,
  heartbeatFrequencyMin: 120,
  heartbeatWorkStart: 9,
  heartbeatWorkEnd: 18,
  ...getDefaultConfigFields(),
}

function loadConfig(): AnorakProConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
    if (!saved) return DEFAULT_CONFIG
    return normalizeContextConfig(saved, DEFAULT_CONFIG) as AnorakProConfig
  } catch { return DEFAULT_CONFIG }
}

function saveConfig(c: AnorakProConfig) {
  writeBrowserStorage(CONFIG_KEY, JSON.stringify(c))
}

type Tab = 'stream' | 'mindcraft' | 'curator-log' | 'cehq' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'stream', label: 'Stream', icon: '⚡' },
  { id: 'mindcraft', label: 'Mindcraft', icon: '📋' },
  { id: 'curator-log', label: 'Curator Log', icon: '📜' },
  { id: 'cehq', label: 'CEHQ', icon: '🧠' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const LOBE_COLORS: Record<string, string> = {
  'anorak-pro': '#14b8a6',
  curator: '#f59e0b',
  coder: '#ef4444',
  reviewer: '#3b82f6',
  tester: '#22c55e',
  gamer: '#eab308',
  carbondev: '#60a5fa',
}

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
}

const DEFAULT_SETTINGS: PanelSettings = { bgColor: '#080a0f', opacity: 0.92, blur: 0 }

interface TelegramPanelConfig {
  enabled: boolean
  configured: boolean
  hasBotToken: boolean
  botToken: string
  botTokenHint: string
  chatId: string
  messageThreadId: string
  webhookSecret: string
  webhookSecretSet: boolean
  webhookUrl: string
  pollingEnabled: boolean
  pollingIntervalSec: number
  voiceNotesEnabled: boolean
  voiceRepliesEnabled: boolean
  polling: TelegramPollingPanelStatus
  source: string
  canMutateConfig: boolean
  updatedAt: string | null
}

interface TelegramPollingPanelStatus {
  running: boolean
  busy: boolean
  enabled: boolean
  configured: boolean
  intervalSec: number
  offset: number | null
  origin: string
  lastPollAt: string
  lastSuccessfulPollAt: string
  lastInboundAt: string
  lastStartedAt: string
  lastStoppedAt: string
  lastError: string
  processedUpdateCount: number
  conversationCount: number
  missionCount: number
  lastUpdateId: number | null
  lastTranscript: string
  lastIgnoredAt: string
  lastIgnoredReason: string
  lastIgnoredChatId: string
  lastIgnoredThreadId: string
  lastIgnoredUsername: string
  lastIgnoredTextPreview: string
  bootstrappedAt: string
}

const DEFAULT_TELEGRAM_POLLING_STATUS: TelegramPollingPanelStatus = {
  running: false,
  busy: false,
  enabled: false,
  configured: false,
  intervalSec: 8,
  offset: null,
  origin: '',
  lastPollAt: '',
  lastSuccessfulPollAt: '',
  lastInboundAt: '',
  lastStartedAt: '',
  lastStoppedAt: '',
  lastError: '',
  processedUpdateCount: 0,
  conversationCount: 0,
  missionCount: 0,
  lastUpdateId: null,
  lastTranscript: '',
  lastIgnoredAt: '',
  lastIgnoredReason: '',
  lastIgnoredChatId: '',
  lastIgnoredThreadId: '',
  lastIgnoredUsername: '',
  lastIgnoredTextPreview: '',
  bootstrappedAt: '',
}

function parseTelegramPollingStatus(value: unknown): TelegramPollingPanelStatus {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const numberOrNull = (field: string) => {
    const candidate = raw[field]
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
  }
  const numberOr = (field: string, fallback: number) => {
    const candidate = raw[field]
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
  }
  const stringOr = (field: string) => typeof raw[field] === 'string' ? raw[field] as string : ''

  return {
    running: Boolean(raw.running),
    busy: Boolean(raw.busy),
    enabled: Boolean(raw.enabled),
    configured: Boolean(raw.configured),
    intervalSec: numberOr('intervalSec', DEFAULT_TELEGRAM_POLLING_STATUS.intervalSec),
    offset: numberOrNull('offset'),
    origin: stringOr('origin'),
    lastPollAt: stringOr('lastPollAt'),
    lastSuccessfulPollAt: stringOr('lastSuccessfulPollAt'),
    lastInboundAt: stringOr('lastInboundAt'),
    lastStartedAt: stringOr('lastStartedAt'),
    lastStoppedAt: stringOr('lastStoppedAt'),
    lastError: stringOr('lastError'),
    processedUpdateCount: numberOr('processedUpdateCount', 0),
    conversationCount: numberOr('conversationCount', 0),
    missionCount: numberOr('missionCount', 0),
    lastUpdateId: numberOrNull('lastUpdateId'),
    lastTranscript: stringOr('lastTranscript'),
    lastIgnoredAt: stringOr('lastIgnoredAt'),
    lastIgnoredReason: stringOr('lastIgnoredReason'),
    lastIgnoredChatId: stringOr('lastIgnoredChatId'),
    lastIgnoredThreadId: stringOr('lastIgnoredThreadId'),
    lastIgnoredUsername: stringOr('lastIgnoredUsername'),
    lastIgnoredTextPreview: stringOr('lastIgnoredTextPreview'),
    bootstrappedAt: stringOr('bootstrappedAt'),
  }
}

const DEFAULT_TELEGRAM_CONFIG: TelegramPanelConfig = {
  enabled: true,
  configured: false,
  hasBotToken: false,
  botToken: '',
  botTokenHint: '',
  chatId: '',
  messageThreadId: '',
  webhookSecret: '',
  webhookSecretSet: false,
  webhookUrl: '',
  pollingEnabled: true,
  pollingIntervalSec: 8,
  voiceNotesEnabled: true,
  voiceRepliesEnabled: true,
  polling: DEFAULT_TELEGRAM_POLLING_STATUS,
  source: 'none',
  canMutateConfig: true,
  updatedAt: null,
}

// See HermesPanel.tsx — translateZ/backfaceVisibility nuke inner content when
// stacked inside drei's CSS3D <Html transform>. Removed for the embedded case.
const EMBEDDED_SCROLL_SURFACE_STYLE = {
  overscrollBehavior: 'contain' as const,
  WebkitOverflowScrolling: 'touch' as const,
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAM TAB — unified chat/stream view with all lobe colors
// ═══════════════════════════════════════════════════════════════════════════

interface StreamEntry {
  id: number
  type: 'text' | 'status' | 'tool' | 'tool_start' | 'tool_result' | 'error' | 'stderr' | 'thinking' | 'result' | 'media'
  content: string
  lobe: string
  timestamp: number
  toolName?: string
  toolIcon?: string
  toolInput?: Record<string, unknown>
  toolDisplay?: string
  toolUseId?: string  // links tool calls to their results
  isError?: boolean
  resultLength?: number
  fullResult?: string  // complete tool result payload for parsers (e.g. screenshot URL extraction). Capped upstream at 32KB.
  mediaType?: string
  mediaUrl?: string
  mediaPrompt?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

const SESSIONS_KEY = 'oasis-anorak-pro-sessions'
const ACTIVE_SESSION_KEY = 'oasis-anorak-pro-active-session'
const ANORAK_PRO_AGENT_CACHE_TYPE = 'anorak-pro'

interface TokenStats {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const ZERO_TOKENS: TokenStats = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

function summarizeUsageTokens(event: unknown, defaults: { sessionId?: string; model: string }) {
  const usage = readTokenUsagePayload(event, {
    sessionId: defaults.sessionId,
    provider: 'anthropic',
    model: defaults.model,
  })
  const inputTokens = usage?.inputTokens || 0
  const outputTokens = usage?.outputTokens || 0
  const costUsd = typeof usage?.costUsd === 'number' ? usage.costUsd : 0
  const cost = costUsd > 0 ? `$${costUsd.toFixed(4)}` : ''
  const tokens = inputTokens > 0 ? `â†“${inputTokens} â†‘${outputTokens}` : ''

  return {
    inputTokens,
    outputTokens,
    costUsd,
    content: [tokens, cost].filter(Boolean).join(' | ') || 'done',
  }
}

interface AnorakProSession {
  id: string
  name: string
  createdAt: string
  entries: StreamEntry[]
  tokens?: TokenStats
}

function sanitizeTokenStats(value: unknown): TokenStats | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<TokenStats>
  return {
    inputTokens: typeof record.inputTokens === 'number' && Number.isFinite(record.inputTokens) ? record.inputTokens : 0,
    outputTokens: typeof record.outputTokens === 'number' && Number.isFinite(record.outputTokens) ? record.outputTokens : 0,
    costUsd: typeof record.costUsd === 'number' && Number.isFinite(record.costUsd) ? record.costUsd : 0,
  }
}

function formatSessionName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function sanitizeAnorakProSession(value: unknown): AnorakProSession | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<AnorakProSession>
  if (typeof record.id !== 'string' || !record.id) return null
  return {
    id: record.id,
    name: typeof record.name === 'string' && record.name ? record.name : formatSessionName(new Date()),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    entries: Array.isArray(record.entries) ? record.entries.filter(entry => entry && typeof entry === 'object') as StreamEntry[] : [],
    tokens: sanitizeTokenStats(record.tokens),
  }
}

function getAnorakProSessionLastActiveAt(session: AnorakProSession): number {
  const entryTime = session.entries.reduce((latest, entry) => Math.max(latest, entry.timestamp || 0), 0)
  const createdAt = Date.parse(session.createdAt)
  return entryTime || (Number.isFinite(createdAt) ? createdAt : Date.now())
}

function sanitizeAnorakProSessions(value: unknown): AnorakProSession[] {
  if (!Array.isArray(value)) return []
  return value
    .map(sanitizeAnorakProSession)
    .filter((session): session is AnorakProSession => Boolean(session))
    .sort((a, b) => getAnorakProSessionLastActiveAt(b) - getAnorakProSessionLastActiveAt(a))
}

function loadSessions(): AnorakProSession[] {
  if (typeof window === 'undefined') return []
  try { return sanitizeAnorakProSessions(JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')) } catch { return [] }
}

function toAnorakProCacheInput(session: AnorakProSession) {
  return {
    sessionId: session.id,
    title: session.name,
    payload: session,
    messageCount: session.entries.length,
    source: 'oasis-panel',
    createdAt: session.createdAt,
    lastActiveAt: getAnorakProSessionLastActiveAt(session),
  }
}

function fromAnorakProCacheRecord(record: ClientAgentSessionCacheRecord<AnorakProSession>): AnorakProSession | null {
  const session = sanitizeAnorakProSession(record.payload)
  if (!session) return null
  return {
    ...session,
    id: record.sessionId || session.id,
    name: record.title || session.name,
  }
}

function mergeAnorakProSessions(primary: AnorakProSession[], secondary: AnorakProSession[]): AnorakProSession[] {
  const byId = new Map<string, AnorakProSession>()
  for (const session of secondary) byId.set(session.id, session)
  for (const session of primary) byId.set(session.id, session)
  return sanitizeAnorakProSessions([...byId.values()])
}

let anorakProLegacyMigrationPromise: Promise<void> | null = null

async function migrateLegacyAnorakProSessions(): Promise<AnorakProSession[]> {
  if (typeof window === 'undefined') return []
  if (anorakProLegacyMigrationPromise) {
    await anorakProLegacyMigrationPromise
    return []
  }

  const legacy = loadSessions()
  if (legacy.length === 0) return []

  anorakProLegacyMigrationPromise = (async () => {
    const ok = await saveClientAgentSessionCaches(
      ANORAK_PRO_AGENT_CACHE_TYPE,
      legacy.map(session => ({ ...toAnorakProCacheInput(session), source: 'legacy-localStorage' })),
    )
    if (ok) removeBrowserStorage(SESSIONS_KEY)
  })()

  try {
    await anorakProLegacyMigrationPromise
  } finally {
    anorakProLegacyMigrationPromise = null
  }

  return legacy
}

async function loadPersistedAnorakProSessions(): Promise<AnorakProSession[]> {
  const records = await listClientAgentSessionCaches<AnorakProSession>(ANORAK_PRO_AGENT_CACHE_TYPE, 100)
  return sanitizeAnorakProSessions(records.map(fromAnorakProCacheRecord))
}

function saveSessions(sessions: AnorakProSession[]) {
  const sanitized = sanitizeAnorakProSessions(sessions)
  if (sanitized.length === 0) return
  void saveClientAgentSessionCaches(
    ANORAK_PRO_AGENT_CACHE_TYPE,
    sanitized.map(toAnorakProCacheInput),
  ).then(ok => {
    if (ok) removeBrowserStorage(SESSIONS_KEY)
  }).catch(() => {
    // Ignore persistence errors; live React state remains authoritative.
  })
}

function createSession(): AnorakProSession {
  return { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: formatSessionName(new Date()), createdAt: new Date().toISOString(), entries: [] }
}

const StreamTab = React.memo(function StreamTab({ entries, onSend, isChatting, isStreaming, sessionTokens, sessions, activeSessionId, onNewSession, onSwitchSession, audioTargetAvatarId }: {
  entries: StreamEntry[]
  onSend: (msg: string) => void
  isChatting: boolean
  isStreaming: boolean
  sessionTokens: TokenStats
  sessions: AnorakProSession[]
  activeSessionId: string
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  audioTargetAvatarId?: string | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mountedAtRef = useRef(Date.now())
  const visible = entries.slice(-200)
  const [chatInput, setChatInput] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  // Voice input — reuses same hook as Merlin
  const voiceInput = useAgentVoiceInput({
    enabled: true,
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => {
      setChatInput(current => (current ? `${current} ${transcript}`.trim() : transcript))
    },
    focusTargetRef: inputRef as React.RefObject<HTMLElement>,
    enablePlayerLipSync: true,
  })

  // Textarea grows with content (oasisspec3)
  useAutoresizeTextarea(inputRef, chatInput, { minPx: 30, maxPx: 160 })

  // Lobe filter state — persisted to localStorage
  const [visibleLobes, setVisibleLobes] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {}
    try { const s = localStorage.getItem(LOBE_FILTER_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
  })
  const toggleLobe = useCallback((lobe: string) => {
    setVisibleLobes(prev => {
      const next = { ...prev, [lobe]: prev[lobe] === false ? true : false }
      writeBrowserStorage(LOBE_FILTER_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const filtered = visible.filter(e => visibleLobes[e.lobe] !== false)

  // Auto-scroll on new content (only when enabled)
  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries.length, autoScroll])

  // Detect manual scroll-up via passive listener
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const handleSend = useCallback(() => {
    const msg = chatInput.trim()
    if (!msg || isChatting) return
    setChatInput('')
    onSend(msg)
  }, [chatInput, isChatting, onSend])

  const sessionBar = (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5 shrink-0">
      <select value={activeSessionId} onChange={e => onSwitchSession(e.target.value)}
        className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-mono text-white/90 outline-none focus:border-teal-500/50 truncate">
        {sessions.map(s => (
          <option key={s.id} value={s.id}>{s.name} ({s.entries.length})</option>
        ))}
      </select>
      <button onClick={onNewSession}
        className="shrink-0 px-2 py-0.5 rounded text-[9px] font-mono font-bold text-teal-300 bg-teal-500/20 border border-teal-500/30 hover:bg-teal-500/30 transition-colors">
        +NEW
      </button>
    </div>
  )

  if (visible.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        {sessionBar}
        <div className="flex-1 flex items-center justify-center text-[#c0ffee]/60 text-sm font-mono">
          Chat with Anorak Pro or curate a mission to see the stream.
        </div>
        <div className="p-2 border-t border-white/5">
          <div className="flex gap-1.5 items-end">
            <AgentVoiceInputButton
              controller={voiceInput}
              disabled={isChatting}
              className="px-2 py-1.5 rounded-lg text-[10px] font-mono border border-white/10 text-teal-100 disabled:opacity-30 disabled:cursor-not-allowed"
              titleReady="Record from mic → Whisper transcription → drops into prompt"
            />
            <textarea
              ref={inputRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Talk to Anorak Pro..."
              rows={1}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-teal-500/50 resize-none font-mono placeholder:text-[#c0ffee]/60"
            />
            <button
              onClick={handleSend}
              disabled={isChatting || !chatInput.trim()}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'rgba(20,184,166,0.2)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}
            >
              {isChatting ? '...' : '⚡'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const lobeKeys = Object.keys(LOBE_COLORS)

  return (
    <>
      {sessionBar}
      {/* Lobe filter bar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5 shrink-0 flex-wrap">
        {lobeKeys.map(lobe => (
          <label key={lobe} className="inline-flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={visibleLobes[lobe] !== false} onChange={() => toggleLobe(lobe)}
              className="w-2.5 h-2.5 accent-teal-500 cursor-pointer" />
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: LOBE_COLORS[lobe] }} />
            <span className="text-[9px] font-mono text-[#c0ffee]/80">{lobe}</span>
          </label>
        ))}
        <span className="text-[9px] font-mono text-[#c0ffee]/60 ml-auto">{filtered.length}/{visible.length}</span>
      </div>
      {/* Token counter bar — always visible during streaming or when tokens exist */}
      {(isStreaming || sessionTokens.inputTokens > 0 || sessionTokens.outputTokens > 0) && (
        <div className="px-2 py-0.5 border-b border-white/5 shrink-0">
          <TokenCounter
            inputTokens={sessionTokens.inputTokens}
            outputTokens={sessionTokens.outputTokens}
            costUsd={sessionTokens.costUsd}
            isStreaming={isStreaming}
            alwaysShow
          />
        </div>
      )}
      <div
        ref={scrollRef}
        data-agent-window-scroll-root=""
        className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs"
        style={EMBEDDED_SCROLL_SURFACE_STYLE}
      >
        {filtered.map((e, idx) => {
          // Skip tool_result entries — they're rendered inline with the preceding tool card
          if (e.type === 'tool_result') return null
          // Skip tool_start when a matching tool entry follows (avoids duplicate cards)
          if (e.type === 'tool_start') {
            const next = filtered[idx + 1]
            if (next && next.type === 'tool' && next.toolName === e.toolName) return null
          }

          const lobeColor = LOBE_COLORS[e.lobe] || '#888'
          const prevEntry = idx > 0 ? filtered[idx - 1] : null
          const showLobe = !prevEntry || prevEntry.lobe !== e.lobe
          const shouldAutoPlayFreshAudio = e.mediaType === 'audio'
            && e.timestamp >= mountedAtRef.current
            && (Date.now() - e.timestamp) < 15000

          // For tool/tool_start entries, find the matching tool_result to show completion state
          let toolResult: { preview: string; isError: boolean; length: number; fullResult?: string } | undefined
          if (e.type === 'tool' || e.type === 'tool_start') {
            // Match by toolUseId first (precise), fall back to sequential proximity
            // Mirrors AnorakContent.tsx logic: if both IDs exist → match by ID,
            // otherwise match the next tool_result with no intervening tool entries
            for (let j = idx + 1; j < filtered.length && j < idx + 50; j++) {
              const candidate = filtered[j]
              if (candidate.type === 'tool_result') {
                if (e.toolUseId && candidate.toolUseId) {
                  // Both have IDs — only match if they agree
                  if (candidate.toolUseId === e.toolUseId) {
                    toolResult = {
                      preview: candidate.content.substring(0, 500),
                      isError: !!candidate.isError,
                      length: candidate.resultLength || candidate.content.length,
                      fullResult: candidate.fullResult ?? (candidate.content.length <= 16000 ? candidate.content : undefined),
                    }
                    break
                  }
                } else {
                  // At least one ID missing — sequential fallback: accept if no
                  // intervening tool/tool_start sits between this tool and the result
                  const hasInterveningTool = filtered.slice(idx + 1, j).some(
                    x => x.type === 'tool' || x.type === 'tool_start'
                  )
                  if (!hasInterveningTool) {
                    toolResult = {
                      preview: candidate.content.substring(0, 500),
                      isError: !!candidate.isError,
                      length: candidate.resultLength || candidate.content.length,
                      fullResult: candidate.fullResult ?? (candidate.content.length <= 16000 ? candidate.content : undefined),
                    }
                    break
                  }
                }
              }
              // If both IDs exist but didn't match this candidate, keep scanning
              // If sequential mode and we hit another tool, stop (result belongs to that tool)
              if (!(e.toolUseId && candidate.toolUseId) && (candidate.type === 'tool' || candidate.type === 'tool_start')) break
            }
          }

          return (
            <div key={`${e.id}-${e.type}-${e.timestamp}`} style={{
              borderLeft: `3px solid ${lobeColor}`,
              paddingLeft: 8,
              background: `${lobeColor}08`,
              borderRadius: 4,
              marginBottom: 2,
            }}>
              {showLobe && <div className="text-[9px] mb-0.5" style={{ opacity: 0.4 }}>{e.lobe}</div>}
              {(e.type === 'tool_start' || e.type === 'tool') && (
                <ToolCallCard
                  name={e.toolName || e.content}
                  icon={e.toolIcon || TOOL_ICONS_MAP[e.toolName || ''] || '🔧'}
                  display={e.toolDisplay || e.content}
                  input={e.toolInput}
                  result={toolResult}
                  compact
                />
              )}
              {e.type === 'status' && <span style={{ fontStyle: 'italic', color: lobeColor }}>{e.content}</span>}
              {e.type === 'text' && (
                <div className="text-[11px] text-white/90 leading-relaxed" style={{ color: '#cbd5e1' }}>
                  {renderMarkdown(e.content)}
                </div>
              )}
              {e.type === 'error' && (
                <div className="text-[10px] text-red-400 px-2 py-1 rounded"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  {e.content}
                </div>
              )}
              {e.type === 'stderr' && <span style={{ opacity: 0.6, color: '#555' }}>{e.content}</span>}
              {e.type === 'thinking' && (
                <CollapsibleBlock
                  label={`thinking (${e.content.length} chars)`}
                  icon="🧠"
                  content={e.content}
                  accentColor="rgba(168,85,247,0.4)"
                  compact
                />
              )}
              {e.type === 'result' && <span style={{ color: '#22c55e', fontStyle: 'italic' }}>✓ {e.content}</span>}
              {e.type === 'media' && e.mediaUrl && (
                <MediaBubble
                  url={e.mediaUrl}
                  mediaType={(e.mediaType as 'image' | 'audio' | 'video') || 'image'}
                  prompt={e.mediaPrompt}
                  compact
                  autoPlay={shouldAutoPlayFreshAudio}
                  avatarLipSyncTargetId={e.mediaType === 'audio' ? audioTargetAvatarId : undefined}
                />
              )}
            </div>
          )
        })}

        {/* Auto-scroll pill — appears when user scrolls up */}
        {!autoScroll && filtered.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }}
            className="sticky bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[9px] font-mono font-bold cursor-pointer z-10 transition-all hover:scale-105"
            style={{
              background: 'rgba(8,10,15,0.9)',
              border: '1px solid rgba(20,184,166,0.4)',
              color: '#14b8a6',
              boxShadow: '0 2px 12px rgba(20,184,166,0.2)',
              backdropFilter: 'blur(8px)',
            }}
          >
            ↓ New messages
          </button>
        )}
      </div>

      {/* Chat input */}
      <div className="p-2 border-t border-white/5">
        {!voiceInput.error && voiceInput.backendState === 'loading' && voiceInput.backendMessage && (
          <div className="mb-1.5 rounded-lg border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-[10px] font-mono text-teal-100">
            {voiceInput.backendMessage}
          </div>
        )}
        {voiceInput.error && (
          <div className="mb-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-mono text-amber-100">
            {voiceInput.error}
          </div>
        )}
        <div className="flex gap-1.5">
          <AgentVoiceInputButton
            controller={voiceInput}
            disabled={isChatting}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono border border-white/10 text-teal-100 disabled:opacity-30 disabled:cursor-not-allowed"
            titleReady="Record from mic → Whisper transcription → drops into prompt"
          />
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={voiceInput.listening ? 'Listening...' : voiceInput.transcribing ? 'Transcribing...' : 'Talk to Anorak Pro...'}
            rows={1}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-teal-500/50 resize-none font-mono placeholder:text-[#c0ffee]/60"
          />
          <button
            onClick={handleSend}
            disabled={isChatting || !chatInput.trim()}
            className="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: 'rgba(20,184,166,0.2)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}
          >
            {isChatting ? '...' : '⚡'}
          </button>
        </div>
      </div>

    </>
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT TAB — mission list with 4 segments
// ═══════════════════════════════════════════════════════════════════════════

const MATURITY_COLORS = ['#c0ffee', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7']
const MATURITY_LABELS = ['🌑 para', '🌒 pashyanti', '🌓 madhyama', '🌕 vaikhari', '⚡ built', '🔍 reviewed', '🧪 tested', '🎮 gamertested', '💎 carbontested']
const MATURITY_EMOJIS = ['🌑', '🌒', '🌓', '🌕', '⚡', '🔍', '🧪', '🎮', '💎']

const DHARMA_ABBR: Record<string, { label: string; color: string }> = {
  view: { label: 'VW', color: '#60a5fa' },
  intention: { label: 'IN', color: '#f59e0b' },
  speech: { label: 'SP', color: '#a78bfa' },
  action: { label: 'AC', color: '#ef4444' },
  livelihood: { label: 'LH', color: '#22c55e' },
  effort: { label: 'EF', color: '#f97316' },
  mindfulness: { label: 'MF', color: '#14b8a6' },
  concentration: { label: 'CN', color: '#ec4899' },
}

interface MindcraftMission {
  id: number; name: string; maturityLevel: number; status: string
  priority: number | null; flawlessPercent: number | null
  reviewerScore: number | null; testerScore: number | null
  gamerScore: number | null; gamerVerdict: string | null
  valor: number | null; score: number | null
  assignedTo: string | null; dharmaPath: string | null
  executionPhase: string | null; executionRound: number
  executionMode: string | null
  carbonDescription: string | null; siliconDescription: string | null
  description: string | null; history: string | null
  urgency: number; easiness: number; impact: number
  createdAt: string; imageUrl?: string | null
  curatorQueuePosition: number | null
}

// ── Mission Popup — full tabbed modal ──────────────────────────────────────────
type MissionPopupTab = 'overview' | 'specs' | 'thread'

function MissionPopup({ mission, onClose, onSubmit, onCurate, onExecute, isAgentRunning }: {
  mission: MindcraftMission
  onClose: () => void
  onSubmit: () => void
  onCurate: (id: number) => void
  onExecute: (id: number) => void
  isAgentRunning: boolean
}) {
  const [tab, setTab] = useState<MissionPopupTab>('overview')
  const [editName, setEditName] = useState(mission.name)
  const [editU, setEditU] = useState(mission.urgency)
  const [editE, setEditE] = useState(mission.easiness)
  const [editI, setEditI] = useState(mission.impact)
  const [editCarbon, setEditCarbon] = useState(mission.carbonDescription || '')
  const [editSilicon, setEditSilicon] = useState(mission.siliconDescription || '')
  const [saving, setSaving] = useState(false)
  const [verdict, setVerdict] = useState<'accept' | 'modify' | 'rewrite'>('accept')
  const [rating, setRating] = useState(7)
  const [msg, setMsg] = useState('')
  const [startTime] = useState(Date.now())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [imageFullscreen, setImageFullscreen] = useState(false)

  const history: Array<Record<string, unknown>> = (() => { try { return JSON.parse(mission.history || '[]') } catch { return [] } })()
  const age = Math.floor((Date.now() - new Date(mission.createdAt).getTime()) / 86400000)
  const calcPri = (editU * editE * editI / 125).toFixed(2)

  const saveMission = async (fields: Record<string, unknown>) => {
    setSaving(true)
    try {
      await fetch(`/api/missions/${mission.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
    } catch { /* offline */ }
    setSaving(false)
  }

  const deleteMission = async () => {
    await fetch(`/api/missions/${mission.id}`, { method: 'DELETE' }).catch(() => {})
    onSubmit()
  }

  const sendFeedback = async (mature: boolean) => {
    const carbonSeconds = Math.round((Date.now() - startTime) / 1000)
    await fetch('/api/anorak/pro/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId: mission.id, mature, verdict, rating, carbondevMsg: msg || undefined, carbonSeconds }),
    }).catch(() => {})
    onSubmit()
  }

  const POPUP_TABS: { id: MissionPopupTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'specs', label: 'Specs' },
    { id: 'thread', label: `Thread (${history.length})` },
  ]

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[99999]" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-[#0a0e1a] border border-[#14b8a6]/30 rounded-xl w-[95%] max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ color: MATURITY_COLORS[mission.maturityLevel] }} className="text-xs shrink-0">{MATURITY_LABELS[mission.maturityLevel]}</span>
            <span className="text-[#c0ffee]/70 text-xs shrink-0">#{mission.id}</span>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => { if (editName !== mission.name) saveMission({ name: editName }) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="flex-1 min-w-0 bg-transparent text-white font-bold text-sm outline-none border-b border-transparent hover:border-[#14b8a6]/30 focus:border-[#14b8a6]"
            />
          </div>
          <button onClick={onClose} className="text-[#c0ffee]/70 hover:text-white text-xl leading-none cursor-pointer shrink-0 ml-2">×</button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-white/5 shrink-0">
          {POPUP_TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-1.5 text-[10px] font-mono tracking-wide cursor-pointer transition-all"
              style={{ color: tab === t.id ? '#14b8a6' : '#c0ffee80', borderBottom: tab === t.id ? '2px solid #14b8a6' : '2px solid transparent' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="flex-1 overflow-y-auto p-4 text-xs font-mono">

          {/* ═══ OVERVIEW TAB ═══ */}
          {tab === 'overview' && (
            <div className="space-y-3">
              {/* Status bar */}
              <div className="flex items-center gap-3 text-[10px] flex-wrap">
                <span className="text-[#c0ffee]/70">pri {calcPri}</span>
                <span className="text-[#c0ffee]/70">{age}d old</span>
                {mission.flawlessPercent != null && <span className="text-teal-400">{mission.flawlessPercent}% flawless</span>}
                {mission.assignedTo && <span className="text-blue-400">→ {mission.assignedTo}</span>}
                {saving && <span className="text-amber-400 animate-pulse">saving...</span>}
              </div>

              {/* Mission image */}
              {mission.imageUrl && (
                <div className="cursor-pointer" onClick={() => setImageFullscreen(true)}>
                  <img src={mission.imageUrl} alt={`Mission #${mission.id}`}
                    className="w-full max-h-40 object-cover rounded border border-white/10 hover:border-[#14b8a6]/50 transition-all" />
                </div>
              )}

              {/* UEI sliders */}
              <div className="grid grid-cols-3 gap-3">
                {([['U', editU, setEditU], ['E', editE, setEditE], ['I', editI, setEditI]] as const).map(([label, val, setVal]) => (
                  <div key={label}>
                    <div className="text-[10px] text-[#c0ffee]/70 mb-0.5">{label === 'U' ? 'Urgency' : label === 'E' ? 'Easiness' : 'Impact'}: {val}</div>
                    <input type="range" min={1} max={10} step={0.5} value={val}
                      onChange={e => (setVal as (v: number) => void)(parseFloat(e.target.value))}
                      onMouseUp={() => saveMission({ urgency: editU, easiness: editE, impact: editI })}
                      className="w-full accent-teal-500" />
                  </div>
                ))}
              </div>

              {/* Carbon description (read-only preview) */}
              {(mission.carbonDescription || mission.description) && (
                <div className="p-2 rounded bg-black/40 border border-white/5 text-xs text-white/90 italic">
                  {mission.carbonDescription || mission.description}
                </div>
              )}

              {/* Dharma tags */}
              <div className="flex gap-1 flex-wrap">
                {Object.entries(DHARMA_ABBR).map(([path, d]) => {
                  const active = (mission.dharmaPath || '').split(',').map(s => s.trim()).includes(path)
                  return (
                    <button key={path} onClick={() => {
                      const current = (mission.dharmaPath || '').split(',').map(s => s.trim()).filter(Boolean)
                      const next = active ? current.filter(p => p !== path) : [...current, path]
                      saveMission({ dharmaPath: next.join(',') || null })
                    }}
                      className="text-[9px] px-2 py-0.5 rounded border cursor-pointer transition-all"
                      style={{
                        color: active ? d.color : `${d.color}50`,
                        borderColor: active ? `${d.color}60` : `${d.color}20`,
                        background: active ? `${d.color}15` : 'transparent',
                      }}>
                      {d.label}
                    </button>
                  )
                })}
              </div>

              {/* Quick actions */}
              <div className="flex gap-2 pt-2 border-t border-white/5">
                <button onClick={() => { onCurate(mission.id); onClose() }} disabled={isAgentRunning}
                  className="flex-1 text-[10px] py-1.5 rounded cursor-pointer bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-30 transition-all">
                  📋 CURATE
                </button>
                <button onClick={() => { onExecute(mission.id); onClose() }} disabled={isAgentRunning || mission.maturityLevel < 2}
                  className="flex-1 text-[10px] py-1.5 rounded cursor-pointer bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-30 transition-all">
                  🔥 CODE
                </button>
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="text-[10px] py-1.5 px-3 rounded cursor-pointer bg-red-900/30 text-red-400 border border-red-500/20 hover:bg-red-900/50 transition-all">
                  🗑
                </button>
              </div>

              {/* Delete confirmation */}
              {showDeleteConfirm && (
                <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-center">
                  <div className="text-white mb-2">Delete mission #{mission.id}? This cannot be undone.</div>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => setShowDeleteConfirm(false)} className="text-[10px] px-4 py-1 rounded bg-white/5 text-[#c0ffee] cursor-pointer">Cancel</button>
                    <button onClick={deleteMission} className="text-[10px] px-4 py-1 rounded bg-red-500/30 text-red-400 cursor-pointer">DELETE</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ SPECS TAB ═══ */}
          {tab === 'specs' && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-amber-400 uppercase tracking-widest mb-1">Carbon Description (mammalianspeak)</div>
                <textarea value={editCarbon} onChange={e => setEditCarbon(e.target.value)}
                  onBlur={() => { if (editCarbon !== (mission.carbonDescription || '')) saveMission({ carbonDescription: editCarbon || null }) }}
                  rows={5} placeholder="The war cry — emotional, dramatic, zero jargon..."
                  className="w-full bg-black/40 border border-amber-500/20 rounded p-2 text-white/90 text-xs outline-none resize-y focus:border-amber-500/50" />
              </div>
              <div>
                <div className="text-[10px] text-red-400 uppercase tracking-widest mb-1">Silicon Description (coder&apos;s bible)</div>
                <textarea value={editSilicon} onChange={e => setEditSilicon(e.target.value)}
                  onBlur={() => { if (editSilicon !== (mission.siliconDescription || '')) saveMission({ siliconDescription: editSilicon || null }) }}
                  rows={10} placeholder="Technical spec — exact files, line ranges, functions, edge cases..."
                  className="w-full bg-black/40 border border-red-500/20 rounded p-2 text-white/90 text-xs outline-none resize-y focus:border-red-500/50 font-mono" />
              </div>
            </div>
          )}

          {/* ═══ THREAD TAB ═══ */}
          {tab === 'thread' && (
            <div className="space-y-3">
              {/* Full history */}
              {history.length === 0 ? (
                <div className="text-[#c0ffee]/60 text-center py-4">No history yet. Curate this mission to start the thread.</div>
              ) : (
                <div className="space-y-2">
                  {history.map((entry, i) => {
                    // Handle both old format (agent/msg) and new format (actor/curatorMsg)
                    const actor = (entry.actor || entry.agent || 'unknown') as string
                    const mainMsg = entry.curatorMsg || entry.msg || entry.message || null
                    const isCurator = actor === 'curator'
                    const accentColor = isCurator ? '#f59e0b' : actor === 'carbondev' ? '#60a5fa' : '#14b8a6'
                    return (
                      <div key={i} className="rounded border p-2" style={{ borderColor: `${accentColor}30`, background: `${accentColor}08` }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-bold uppercase" style={{ color: accentColor }}>{actor}</span>
                          <span className="text-[9px] text-[#c0ffee]/60">{entry.action as string}</span>
                          {entry.timestamp ? <span className="text-[9px] text-[#c0ffee]/60 ml-auto">{new Date(entry.timestamp as string).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> : null}
                        </div>
                        {mainMsg ? <div className="text-xs text-white/90 mb-1">{String(mainMsg)}</div> : null}
                        {entry.silicondevMsg ? (
                          <div className="mt-1 p-1.5 rounded bg-teal-500/10 border border-teal-500/20">
                            <div className="text-[9px] text-teal-400 uppercase mb-0.5">SiliconDev predicts{entry.silicondevConfidence ? ` (${Number(entry.silicondevConfidence).toFixed(1)})` : ''}</div>
                            <div className="text-xs text-[#c0ffee]">{String(entry.silicondevMsg)}</div>
                          </div>
                        ) : null}
                        {entry.carbondevMsg ? <div className="text-xs text-blue-300 mt-1">{String(entry.carbondevMsg)}</div> : null}
                        {entry.verdict ? <span className="text-[9px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: `${accentColor}20`, color: accentColor }}>{String(entry.verdict).toUpperCase()}{entry.rating != null ? ` ${entry.rating}/10` : ''}</span> : null}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Feedback form — always available */}
              <div className="border-t border-white/10 pt-3 space-y-2">
                <div className="text-[10px] text-[#c0ffee] uppercase tracking-widest">Your Response</div>

                {/* Verdict */}
                <div className="flex gap-2">
                  {(['accept', 'modify', 'rewrite'] as const).map(v => (
                    <button key={v} onClick={() => setVerdict(v)}
                      className="text-[10px] px-3 py-1 rounded cursor-pointer transition-all"
                      style={{
                        background: verdict === v ? (v === 'accept' ? 'rgba(34,197,94,0.2)' : v === 'modify' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${verdict === v ? (v === 'accept' ? 'rgba(34,197,94,0.5)' : v === 'modify' ? 'rgba(245,158,11,0.5)' : 'rgba(239,68,68,0.5)') : 'rgba(255,255,255,0.1)'}`,
                        color: verdict === v ? '#fff' : '#c0ffee80',
                      }}>
                      {v.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Rating */}
                <div>
                  <div className="text-[10px] text-[#c0ffee]/70 mb-0.5">SiliconDev rating: {rating}/10</div>
                  <input type="range" min={0} max={10} value={rating} onChange={e => setRating(parseInt(e.target.value))} className="w-full accent-teal-500" />
                </div>

                {/* Message — always visible */}
                <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2}
                  className="w-full bg-black/60 border border-white/10 rounded p-2 text-xs text-white/90 outline-none resize-y"
                  placeholder="Your message to curator (optional for bump, required for refine)..." />

                {/* Actions */}
                <div className="flex gap-2">
                  <button onClick={() => sendFeedback(true)}
                    className="flex-1 text-[10px] py-1.5 rounded cursor-pointer bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all">
                    ⬆ BUMP
                  </button>
                  <button onClick={() => sendFeedback(false)}
                    className="flex-1 text-[10px] py-1.5 rounded cursor-pointer bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all">
                    ↻ REFINE
                  </button>
                  <button onClick={async () => {
                    await fetch(`/api/missions/${mission.id}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ maturityLevel: 3 }),
                    }).catch(() => {})
                    onSubmit()
                  }}
                    className="text-[10px] py-1.5 px-3 rounded cursor-pointer bg-[#e879f9]/20 text-[#e879f9] border border-[#e879f9]/30 hover:bg-[#e879f9]/30 transition-all"
                    title="Skip to vaikhari (maturity 3) — ready for execution">
                    ⚡ READY
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Image fullscreen overlay */}
        {imageFullscreen && mission.imageUrl && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[999999] cursor-pointer" onClick={() => setImageFullscreen(false)}>
            <img src={mission.imageUrl} alt={`Mission #${mission.id}`} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Column definitions for Mindcraft table ──
const MC_COLS = [
  { key: 'id', label: '#', w: 32, sortable: true },
  { key: 'queue', label: 'Q', w: 24, sortable: true },
  { key: 'maturity', label: '🌑', w: 28, sortable: true },
  { key: 'name', label: 'Name', w: 0, sortable: true }, // flex
  { key: 'pri', label: 'Pri', w: 36, sortable: true },
  { key: 'flawless', label: 'F%', w: 32, sortable: true },
  { key: 'rev', label: 'Rev', w: 32, sortable: true },
  { key: 'score', label: 'Sc', w: 32, sortable: true },
  { key: 'age', label: 'Age', w: 32, sortable: true },
  { key: 'actions', label: '', w: 72, sortable: false },
] as const

type McSortKey = typeof MC_COLS[number]['key']
const MC_WIDTHS_KEY = 'oasis-mindcraft-col-widths'

function getMcSortValue(m: MindcraftMission, key: McSortKey): number {
  switch (key) {
    case 'id': return m.id
    case 'queue': return m.curatorQueuePosition ?? 9999
    case 'maturity': return m.maturityLevel
    case 'name': return 0 // alpha sort handled separately
    case 'pri': return m.priority ?? 0
    case 'flawless': return m.flawlessPercent ?? -1
    case 'rev': return m.reviewerScore ?? -1
    case 'score': return m.score ?? -1
    case 'age': return new Date(m.createdAt).getTime()
    case 'actions': return 0
  }
}

function MindcraftTab({
  onCurate,
  onExecute,
  isAgentRunning,
}: {
  onCurate: (id: number) => void
  onExecute: (id: number) => void
  isAgentRunning: boolean
}) {
  const [missions, setMissions] = useState<MindcraftMission[]>([])
  const [loading, setLoading] = useState(true)
  const [popupMission, setPopupMission] = useState<MindcraftMission | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newDharma, setNewDharma] = useState('')
  const [creating, setCreating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Column sort state per section
  const [sortKey, setSortKey] = useState<McSortKey>('pri')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Column widths (persisted)
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem(MC_WIDTHS_KEY) || '{}') } catch { return {} }
  })
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const col = MC_COLS.find(c => c.key === key)
    const startW = colWidths[key] ?? col?.w ?? 40
    resizeRef.current = { key, startX: e.clientX, startW }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = ev.clientX - resizeRef.current.startX
      const next = Math.max(20, resizeRef.current.startW + delta)
      setColWidths(prev => {
        const updated = { ...prev, [resizeRef.current!.key]: next }
        writeBrowserStorage(MC_WIDTHS_KEY, JSON.stringify(updated))
        return updated
      })
    }
    const onUp = () => { resizeRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [colWidths])

  const toggleSort = useCallback((key: McSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'pri' || key === 'flawless' || key === 'rev' || key === 'score' ? 'desc' : 'asc') }
  }, [sortKey])

  const sortMissions = useCallback((list: MindcraftMission[]) => {
    return [...list].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name)
        return sortDir === 'asc' ? cmp : -cmp
      }
      const va = getMcSortValue(a, sortKey)
      const vb = getMcSortValue(b, sortKey)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [sortKey, sortDir])

  const fetchMissions = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetch('/api/missions', { signal: abortRef.current.signal })
      if (!res.ok) return
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.data ?? [])
      setMissions(list.filter((m: MindcraftMission) =>
        m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro' ||
        m.assignedTo === 'carbondev' || m.assignedTo === null
      ))
    } catch (err) { if ((err as Error).name !== 'AbortError') { /* offline */ } }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMissions() }, [fetchMissions])
  useEffect(() => {
    const interval = setInterval(fetchMissions, 10000)
    return () => { abortRef.current?.abort(); clearInterval(interval) }
  }, [fetchMissions])

  const handleCreateMission = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || null,
          assignedTo: 'anorak',
          dharmaPath: newDharma || null,
        }),
      })
      if (res.ok) {
        setNewName('')
        setNewDesc('')
        setNewDharma('')
        setShowNewForm(false)
        fetchMissions()
      }
    } catch { /* offline */ }
    setCreating(false)
  }, [newName, newDesc, newDharma, fetchMissions])

  if (loading) return <div className="flex-1 flex items-center justify-center text-[#c0ffee]/60 text-sm">Loading...</div>

  const wip = missions.filter(m => m.executionPhase != null || m.status === 'wip')
  const feedback = missions.filter(m => m.assignedTo === 'carbondev' && m.maturityLevel < 3 && m.status === 'todo')
  const southLoop = sortMissions(missions.filter(m =>
    m.status === 'todo' && m.maturityLevel >= 3 && !m.executionPhase
  ))
  const curatorPipeline = sortMissions(missions.filter(m =>
    m.status === 'todo' && m.maturityLevel < 3 && m.assignedTo !== 'carbondev' && !m.executionPhase
  ))
  const done = [...missions.filter(m => m.status === 'done')].sort((a, b) => b.id - a.id)

  const age = (m: MindcraftMission) => Math.floor((Date.now() - new Date(m.createdAt).getTime()) / 86400000)

  // Shared column header renderer
  const renderHeader = (showSort: boolean) => (
    <div className="flex items-center text-[8px] uppercase tracking-wider text-[#c0ffee]/50 border-b border-white/5 pb-1 mb-1 select-none">
      {MC_COLS.map(col => {
        const w = colWidths[col.key] ?? col.w
        const isSorted = showSort && sortKey === col.key
        return (
          <div key={col.key} className="relative flex items-center"
            style={col.key === 'name' ? { flex: 1, minWidth: 80 } : { width: w, flexShrink: 0 }}>
            {col.sortable && showSort ? (
              <button onClick={() => toggleSort(col.key)} className="cursor-pointer hover:text-[#14b8a6] transition-colors"
                style={isSorted ? { color: '#14b8a6' } : {}}>
                {col.label}{isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </button>
            ) : (
              <span>{col.label}</span>
            )}
            {col.key !== 'actions' && col.key !== 'name' && (
              <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#14b8a6]/30"
                onMouseDown={e => handleResizeStart(col.key, e)} />
            )}
          </div>
        )
      })}
    </div>
  )

  // Shared row renderer
  const renderRow = (m: MindcraftMission, accentColor: string, showActions: 'curate' | 'code' | 'feedback' | 'wip' | 'done') => (
    <div key={m.id}
      className="flex items-center py-1 px-0.5 rounded cursor-pointer hover:bg-white/5 transition-all group"
      style={{ borderLeft: `3px solid ${accentColor}40` }}
      onClick={() => setPopupMission(m)}>
      {/* ID + image indicator */}
      <div style={{ width: colWidths.id ?? 32, flexShrink: 0 }} className="text-[10px] text-[#c0ffee]/60 flex items-center gap-0.5">
        {m.imageUrl && <span className="text-[8px]">🖼</span>}
        <span>#{m.id}</span>
      </div>
      {/* Queue */}
      <div style={{ width: colWidths.queue ?? 24, flexShrink: 0 }} className="text-[10px] text-[#c0ffee]/40">{m.curatorQueuePosition ?? '·'}</div>
      {/* Maturity */}
      <div style={{ width: colWidths.maturity ?? 28, flexShrink: 0 }} className="text-[10px]">
        <span style={{ color: MATURITY_COLORS[m.maturityLevel] }}>{MATURITY_EMOJIS[m.maturityLevel] || '?'}</span>
      </div>
      {/* Name */}
      <div style={{ flex: 1, minWidth: 80 }} className="text-[11px] text-white truncate pr-1">{m.name}</div>
      {/* Priority */}
      <div style={{ width: colWidths.pri ?? 36, flexShrink: 0 }} className="text-[10px] text-[#c0ffee]/60">{m.priority?.toFixed(1) ?? '·'}</div>
      {/* Flawless% */}
      <div className="text-[10px]"
        style={{ width: colWidths.flawless ?? 32, flexShrink: 0, color: m.flawlessPercent != null ? (m.flawlessPercent >= 80 ? '#22c55e' : m.flawlessPercent >= 50 ? '#f59e0b' : '#ef4444') : '#c0ffee40' }}>
        {m.flawlessPercent != null ? `${m.flawlessPercent}` : '·'}
      </div>
      {/* Reviewer Score */}
      <div className="text-[10px]"
        style={{ width: colWidths.rev ?? 32, flexShrink: 0, color: m.reviewerScore != null ? (m.reviewerScore >= 90 ? '#22c55e' : m.reviewerScore >= 70 ? '#f59e0b' : '#ef4444') : '#c0ffee40' }}>
        {m.reviewerScore != null ? `${m.reviewerScore}` : '·'}
      </div>
      {/* Score (priority × valor) */}
      <div className="text-[10px]"
        style={{ width: colWidths.score ?? 32, flexShrink: 0, color: m.score != null ? '#14b8a6' : '#c0ffee40' }}>
        {m.score != null ? m.score.toFixed(1) : '·'}
      </div>
      {/* Age */}
      <div style={{ width: colWidths.age ?? 32, flexShrink: 0 }} className="text-[10px] text-[#c0ffee]/50">{age(m)}d</div>
      {/* Actions */}
      <div style={{ width: colWidths.actions ?? 72, flexShrink: 0 }} className="flex items-center gap-1">
        {showActions === 'curate' && (
          <button onClick={e => { e.stopPropagation(); onCurate(m.id) }} disabled={isAgentRunning}
            className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 cursor-pointer">CUR</button>
        )}
        {showActions === 'code' && (
          <button onClick={e => { e.stopPropagation(); onExecute(m.id) }} disabled={isAgentRunning}
            className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 cursor-pointer">CODE</button>
        )}
        {showActions === 'feedback' && (
          <span className="text-[8px] text-blue-400 animate-pulse" style={{ animationDuration: '3s' }}>REVIEW →</span>
        )}
        {showActions === 'wip' && !isAgentRunning && (
          <button onClick={e => { e.stopPropagation(); onExecute(m.id) }}
            className="text-[8px] px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-400 cursor-pointer">RES</button>
        )}
        <button
          onClick={async e => { e.stopPropagation(); if (confirm(`Delete #${m.id}?`)) { await fetch(`/api/missions/${m.id}`, { method: 'DELETE' }); fetchMissions() } }}
          className="text-[8px] text-red-400/30 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">🗑</button>
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto p-2 text-xs font-mono">
      {/* + New Mission */}
      {!showNewForm ? (
        <button onClick={() => setShowNewForm(true)}
          className="w-full text-[10px] py-1 mb-2 rounded border border-dashed border-teal-500/30 text-teal-400/70 hover:border-teal-500/60 hover:text-teal-400 hover:bg-teal-500/5 cursor-pointer">
          + NEW MISSION
        </button>
      ) : (
        <div className="rounded border border-teal-500/30 bg-teal-500/5 p-2 mb-2 space-y-1">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateMission()}
            placeholder="Mission name..." className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-white text-[11px] outline-none" />
          <div className="flex gap-2">
            <button onClick={() => { setShowNewForm(false); setNewName(''); setNewDesc(''); setNewDharma('') }}
              className="text-[9px] px-2 py-0.5 text-[#c0ffee]/70 cursor-pointer">CANCEL</button>
            <button onClick={handleCreateMission} disabled={!newName.trim() || creating}
              className="text-[9px] px-3 py-0.5 rounded bg-teal-500/20 text-teal-400 disabled:opacity-30 cursor-pointer">{creating ? '...' : 'CREATE'}</button>
          </div>
        </div>
      )}

      {/* ═══ WIP Section ═══ */}
      {wip.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] text-teal-400 uppercase tracking-widest mb-1">🔥 Work In Progress ({wip.length})</div>
          {wip.map(m => (
            <div key={m.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md mb-1 animate-pulse"
              style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.3)', animationDuration: '3s' }}>
              <span className="text-teal-400">●</span>
              <span className="text-white text-[11px]">#{m.id}</span>
              <span className="text-white truncate flex-1 text-[11px]">{m.name}</span>
              <span className="text-teal-400/70 text-[10px]">{m.executionPhase} r{m.executionRound}</span>
              {!isAgentRunning && <>
                <button onClick={() => onExecute(m.id)} className="text-[8px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 cursor-pointer">RESUME</button>
                <button onClick={async () => { await fetch(`/api/missions/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executionPhase: null, status: 'todo' }) }); fetchMissions() }}
                  className="text-[8px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 cursor-pointer">ABORT</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {/* ═══ South Loop — vaikhari missions ready for execution ═══ */}
      {southLoop.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] text-red-400 uppercase tracking-widest mb-1">🔥 South Loop ({southLoop.length})</div>
          {renderHeader(true)}
          {southLoop.map(m => renderRow(m, '#ef4444', 'code'))}
        </div>
      )}

      {/* ═══ Awaiting Feedback ═══ */}
      {feedback.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] text-blue-400 uppercase tracking-widest mb-1">💬 Awaiting Feedback ({feedback.length})</div>
          {renderHeader(false)}
          {feedback.map(m => renderRow(m, '#60a5fa', 'feedback'))}
        </div>
      )}

      {/* ═══ Curator Pipeline (sortable) ═══ */}
      <div className="mb-2">
        <div className="text-[9px] text-amber-400 uppercase tracking-widest mb-1">📋 Curator Pipeline ({curatorPipeline.length})</div>
        {renderHeader(true)}
        {curatorPipeline.length === 0
          ? <div className="text-[#c0ffee]/40 text-[10px] py-2 text-center">Pipeline empty</div>
          : curatorPipeline.map(m => renderRow(m, MATURITY_COLORS[m.maturityLevel], m.maturityLevel >= 3 ? 'code' : 'curate'))}
      </div>

      {/* ═══ Done ═══ */}
      <div className="mb-2">
        <div className="text-[9px] text-[#c0ffee]/50 uppercase tracking-widest mb-1">✅ Done ({done.length})</div>
        {renderHeader(false)}
        {done.map(m => renderRow(m, '#c0ffee', 'done'))}
      </div>

      {/* Mission popup */}
      {popupMission && (
        <MissionPopup
          mission={popupMission}
          onClose={() => { setPopupMission(null); fetchMissions() }}
          onSubmit={() => { setPopupMission(null); fetchMissions() }}
          onCurate={onCurate}
          onExecute={onExecute}
          isAgentRunning={isAgentRunning}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR LOG TAB
// ═══════════════════════════════════════════════════════════════════════════

function CuratorLogTab() {
  const [logs, setLogs] = useState<Array<{
    id: number
    status: string
    startedAt: string
    durationMs: number | null
    missionsProcessed: number
    missionsEnriched: number
    tokensIn: number
    tokensOut: number
    error: string | null
    missionResults: string | null
  }>>([])
  const abortRef = useRef<AbortController | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    const fetchLogs = async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      try {
        const res = await fetch('/api/anorak/pro/curator-logs', { signal: abortRef.current.signal })
        if (res.ok) setLogs(await res.json())
      } catch (err) { if ((err as Error).name !== 'AbortError') { /* offline */ } }
    }
    fetchLogs()
    const interval = setInterval(fetchLogs, 15000)
    return () => { abortRef.current?.abort(); clearInterval(interval) }
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
      {logs.length === 0 ? (
        <div className="text-[#c0ffee] text-center py-8">
          No curator invocations yet.<br />
          Curate a mission to see logs here.
        </div>
      ) : logs.map(log => (
        <div key={log.id} className="border-b border-[#14b8a6]/10 py-2">
          <button
            onClick={() => setExpandedId(prev => prev === log.id ? null : log.id)}
            className="flex w-full items-center gap-2 text-left cursor-pointer"
          >
            <span className={log.status === 'completed' ? 'text-[#22c55e]' : log.status === 'failed' ? 'text-[#fb7185]' : 'text-[#fbbf24]'}>
              {log.status === 'completed' ? '✓' : log.status === 'failed' ? '✗' : '●'}
            </span>
            <span className="text-[#7dd3fc]">{new Date(log.startedAt).toLocaleTimeString()}</span>
            <span className="text-[#c0ffee]">{log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '...'}</span>
            <span className="text-white">{log.missionsProcessed} processed, {log.missionsEnriched} enriched</span>
            <span className="ml-auto text-[#14b8a6] text-[10px]">{expandedId === log.id ? 'Hide' : 'Details'}</span>
          </button>
          {expandedId === log.id && (
            <div className="mt-2 rounded border border-[#14b8a6]/15 bg-black/40 p-2 text-[10px]">
              <div className="flex flex-wrap gap-3 text-[#c0ffee]">
                <span>tokens in {log.tokensIn}</span>
                <span>tokens out {log.tokensOut}</span>
                <span>status {log.status}</span>
              </div>
              {log.error && <div className="mt-2 text-[#fb7185]">{log.error}</div>}
              {(() => {
                let results: Array<{ id: number; name: string; enriched: boolean; fromLevel: number | null; toLevel: number; historyDelta: number; wroteCarbon: boolean; wroteSilicon: boolean; wroteAcceptance: boolean }> = []
                try {
                  results = log.missionResults ? JSON.parse(log.missionResults) : []
                } catch {
                  results = []
                }
                if (results.length === 0) return <div className="mt-2 text-[#c0ffee]">No per-mission result data recorded.</div>
                return (
                  <div className="mt-2 space-y-2">
                    {results.map(result => (
                      <div key={result.id} className="rounded border border-[#14b8a6]/10 bg-black/50 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-white">#{result.id} {result.name}</span>
                          <span className={result.enriched ? 'text-[#22c55e]' : 'text-[#c0ffee]'}>{result.enriched ? 'enriched' : 'unchanged'}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[#c0ffee]">
                          <span>level {result.fromLevel ?? '?'} → {result.toLevel}</span>
                          <span>history +{result.historyDelta}</span>
                          {result.wroteCarbon && <span className="text-[#22c55e]">carbon</span>}
                          {result.wroteSilicon && <span className="text-[#0ea5e9]">silicon</span>}
                          {result.wroteAcceptance && <span className="text-[#f59e0b]">acceptance</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CEHQ TAB — Context Engineering HQ
// ═══════════════════════════════════════════════════════════════════════════

function LobeEditor({ lobe }: { lobe: string }) {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const ac = new AbortController()
    setLoading(true)
    setLoadError(null)
    fetch(`/api/anorak/pro/lobeprompt?lobe=${lobe}`, { signal: ac.signal })
      .then(async r => {
        if (r.ok) return r.json()
        let message = `Load failed (${r.status})`
        try {
          const data = await r.json() as { error?: string }
          if (typeof data?.error === 'string' && data.error.trim()) message = data.error
        } catch { /* keep generic error */ }
        throw new Error(message)
      })
      .then(data => { if (data?.content) { setContent(data.content); setDirty(false) } })
      .catch(e => {
        if (e.name !== 'AbortError') {
          setLoadError(typeof e?.message === 'string' && e.message ? e.message : 'Load failed while offline')
        }
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [expanded, lobe])

  const handleSave = async () => {
    setSaved(false)
    setSaveError(null)
    try {
      const res = await fetch('/api/anorak/pro/lobeprompt', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobe, content }),
      })
      if (!res.ok) {
        let message = 'Save failed'
        try {
          const data = await res.json() as { error?: string }
          if (typeof data?.error === 'string' && data.error.trim()) message = data.error
        } catch { /* keep generic error */ }
        setSaveError(message)
        return
      }
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setSaveError('Save failed while offline')
    }
  }

  return (
    <>
      <button
        onClick={() => setExpanded(!expanded)}
        className="rounded border border-[#14b8a6]/35 bg-[#0f172a] px-2 py-1 text-left text-[10px] text-[#c0ffee] hover:border-[#14b8a6] hover:text-white cursor-pointer"
      >
        <div className="font-bold">Sysprompt</div>
        <div className="text-[9px] text-[#7dd3fc]">.claude/agents/{lobe}.md {dirty && <span className="text-[#f59e0b] ml-1">●</span>}</div>
      </button>
      {expanded && (
        <div className="col-span-3 mt-2 rounded border border-[#14b8a6]/25 bg-black/50 p-2">
          {loading ? (
            <div className="text-[#c0ffee] text-[10px] py-2">Loading...</div>
          ) : loadError ? (
            <div className="text-[#fb7185] text-[10px] py-2">{loadError}</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setDirty(true) }}
                className="w-full h-40 bg-black/70 border border-[#14b8a6]/30 rounded p-2 text-white text-[10px] leading-relaxed resize-y outline-none focus:border-[#14b8a6]"
                spellCheck={false}
              />
              <div className="flex items-center gap-2 mt-1">
                <button onClick={handleSave} disabled={!dirty}
                  className="text-[9px] px-2 py-0.5 rounded bg-[#14b8a6]/20 text-[#14b8a6] hover:bg-[#14b8a6]/30 disabled:opacity-30 cursor-pointer">
                  Save
                </button>
                <span className="text-[9px] text-[#c0ffee]">{content.length} chars</span>
                {saved && <span className="text-[9px] text-[#22c55e]">Saved ✓</span>}
                {saveError && <span className="text-[9px] text-[#fb7185]">{saveError}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}

function CustomModuleEditor({ module, onSave, onDelete }: {
  module: CustomContextModule
  onSave: (next: CustomContextModule) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(module)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(module)
  }, [module])

  const dirty = JSON.stringify(draft) !== JSON.stringify(module)

  const handleSave = () => {
    onSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="rounded border border-[#14b8a6]/20 bg-black/40 p-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="text"
          value={draft.name}
          onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
          className="flex-1 bg-transparent border-b border-[#14b8a6]/30 text-white text-[10px] outline-none focus:border-[#14b8a6]"
          placeholder="Module name"
        />
        <label className="flex items-center gap-1 text-[9px] text-[#c0ffee] whitespace-nowrap">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => setDraft(prev => ({ ...prev, enabled: e.target.checked }))}
            className="accent-[#14b8a6]"
          />
          available
        </label>
        <button onClick={onDelete} className="text-[#fb7185] hover:text-white text-[10px] cursor-pointer">✕</button>
      </div>

      <div className="mb-2 flex items-center gap-2 text-[9px]">
        <button
          onClick={() => setDraft(prev => ({ ...prev, type: 'text' }))}
          className={`rounded px-2 py-0.5 border cursor-pointer ${draft.type === 'text' ? 'border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10' : 'border-[#14b8a6]/25 text-[#c0ffee]'}`}
        >
          Text
        </button>
        <button
          onClick={() => setDraft(prev => ({ ...prev, type: 'file' }))}
          className={`rounded px-2 py-0.5 border cursor-pointer ${draft.type === 'file' ? 'border-[#f59e0b] text-[#f59e0b] bg-[#f59e0b]/10' : 'border-[#14b8a6]/25 text-[#c0ffee]'}`}
        >
          Link File
        </button>
        {saved && <span className="text-[#22c55e]">Saved ✓</span>}
      </div>

      {draft.type === 'file' ? (
        <div className="mb-2 flex items-center gap-1">
          <input
            type="text"
            value={draft.filePath}
            onChange={e => setDraft(prev => ({ ...prev, filePath: e.target.value }))}
            placeholder="File path (type or browse)"
            className="flex-1 bg-black/70 border border-[#f59e0b]/30 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-[#f59e0b]"
          />
          <label className="shrink-0 rounded bg-[#f59e0b]/20 px-2 py-1 text-[9px] text-[#f59e0b] hover:bg-[#f59e0b]/30 cursor-pointer">
            Browse
            <input
              type="file"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) {
                  const selectedPath = (file as unknown as { path?: string }).path || file.webkitRelativePath || file.name
                  setDraft(prev => ({ ...prev, filePath: selectedPath }))
                }
                e.target.value = '' // reset to allow re-selecting same file
              }}
            />
          </label>
        </div>
      ) : (
        <textarea
          value={draft.content}
          onChange={e => setDraft(prev => ({ ...prev, content: e.target.value }))}
          placeholder="Free-text context injected into agent prompts..."
          maxLength={400000}
          className="mb-2 w-full h-20 bg-black/70 border border-[#14b8a6]/20 rounded p-2 text-white text-[10px] resize-y outline-none focus:border-[#14b8a6]"
          spellCheck={false}
        />
      )}

      <div className="flex items-center justify-between text-[9px] text-[#c0ffee]">
        <span>{draft.type === 'file' ? (draft.filePath || 'No file linked yet') : `${draft.content.length} chars`}</span>
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="rounded bg-[#14b8a6]/20 px-2 py-0.5 text-[#14b8a6] hover:bg-[#14b8a6]/30 disabled:opacity-30 cursor-pointer"
        >
          Save Module
        </button>
      </div>
    </div>
  )
}

// ── Type colors for module badges ──
const MODULE_TYPE_COLORS: Record<string, string> = {
  builtin: '#14b8a6',  // teal
  custom: '#22c55e',   // green (text modules)
  file: '#f59e0b',     // amber (file modules)
  system: '#7dd3fc',   // sky blue (no grey allowed)
}

function moduleTypeColor(entry: { kind: string; type?: string }): string {
  if (entry.kind === 'custom' && entry.type === 'file') return MODULE_TYPE_COLORS.file
  return MODULE_TYPE_COLORS[entry.kind] || MODULE_TYPE_COLORS.builtin
}

function moduleTypeLabel(entry: { kind: string; parameterized?: boolean; type?: string }): string {
  if (entry.kind === 'custom' && entry.type === 'file') return 'file'
  if (entry.parameterized) return 'param'
  return entry.kind
}

// ── Fullscreen Preview Modal ──
function PreviewOverlay({ target, content, loading, onClose }: {
  target: { lobe: AnorakLobe; moduleId: string; title: string }
  content: string
  loading: boolean
  onClose: () => void
}) {
  const tokens = Math.ceil((content?.length || 0) / 4)
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-[#0a0e1a] border border-[#14b8a6]/30 rounded-lg w-[90%] max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#14b8a6]/20">
          <div>
            <h3 className="font-bold text-[#14b8a6] text-sm">{target.title}</h3>
            <p className="text-[10px] text-[#c0ffee]">
              {target.lobe} module{!loading && content ? ` · ~${tokens} tokens` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-[#c0ffee] hover:text-white text-2xl leading-none cursor-pointer">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-[#c0ffee] py-8">
              <div className="animate-spin text-2xl mb-2">⚙️</div>
              Loading preview...
            </div>
          ) : (
            <pre className="text-[10px] text-white whitespace-pre-wrap font-mono bg-black/50 p-4 rounded leading-relaxed">{content}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Fullscreen Add Module Modal ──
function AddModuleOverlay({ lobe, options, onAdd, onClose }: {
  lobe: AnorakLobe
  options: ReturnType<typeof getContextModuleCatalog>
  onAdd: (moduleId: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-[#0a0e1a] border border-[#14b8a6]/30 rounded-lg w-[90%] max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#14b8a6]/20">
          <h3 className="font-bold text-[#14b8a6] text-sm">Add Module to {lobe}</h3>
          <button onClick={onClose} className="text-[#c0ffee] hover:text-white text-2xl leading-none cursor-pointer">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {options.length === 0 ? (
            <p className="text-center text-[#c0ffee] py-4">All modules already added</p>
          ) : (
            options.map(entry => (
              <button
                key={entry.id}
                onClick={() => { onAdd(entry.id); onClose() }}
                className="w-full p-3 text-left rounded border border-[#14b8a6]/20 hover:border-[#14b8a6]/50 hover:bg-[#14b8a6]/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px]" style={{ color: moduleTypeColor(entry) }}>{entry.name}</span>
                  <span className="text-[8px] uppercase tracking-wide" style={{ color: moduleTypeColor(entry) }}>{moduleTypeLabel(entry)}</span>
                </div>
                <div className="text-[10px] text-[#c0ffee] mt-0.5">{entry.description}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function CEHQTab({ config, onUpdate }: { config: AnorakProConfig; onUpdate: (p: Partial<AnorakProConfig>) => void }) {
  const selectCls = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 border border-[#14b8a6]/25 text-white outline-none'
  const catalog = getContextModuleCatalog(config.customModules)
  const catalogById = new Map(catalog.map(entry => [entry.id, entry]))
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const [expandedLobes, setExpandedLobes] = useState<Record<string, boolean>>({ curator: true })
  const [addModalLobe, setAddModalLobe] = useState<AnorakLobe | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ lobe: AnorakLobe; moduleId: string; title: string } | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const merlinRuntimeModules = [
    {
      id: 'runtime:claude-md',
      name: 'CLAUDE.md',
      description: 'Auto-loaded by Claude Code CLI. Project architecture, gotchas, commands, standards.',
    },
    {
      id: 'runtime:merlin-root',
      name: 'Oasis root',
      description: 'Server-side workspace path (`OASIS_ROOT` / `process.cwd()`) injected at bootstrap.',
    },
    {
      id: 'runtime:merlin-world',
      name: 'Active world',
      description: activeWorldId ? `Pinned world for new sessions: ${activeWorldId}` : 'Pinned to the active Oasis world at session start.',
    },
    {
      id: 'runtime:merlin-steer',
      name: 'Runtime steer',
      description: 'Keep Merlin in character, but route real work through MCP tools.',
    },
    {
      id: 'runtime:merlin-oasis-mcp',
      name: 'Oasis MCP',
      description: 'World-aware tool bundle: build, place, move avatars, inspect world, screenshot.',
    },
    {
      id: 'runtime:merlin-mission-mcp',
      name: 'Mission MCP',
      description: 'Media tool bundle: image, voice, and video generation.',
    },
  ] as const

  const toggleExpand = useCallback((lobe: string) => {
    setExpandedLobes(prev => ({ ...prev, [lobe]: !prev[lobe] }))
  }, [])

  const updateLobeModules = useCallback((lobe: AnorakLobe, nextIds: string[]) => {
    onUpdate({
      lobeModules: {
        ...config.lobeModules,
        [lobe]: nextIds,
      },
    })
  }, [config.lobeModules, onUpdate])

  const attachModule = useCallback((lobe: AnorakLobe, moduleId: string) => {
    if (!moduleId || config.lobeModules[lobe].includes(moduleId)) return
    updateLobeModules(lobe, [...config.lobeModules[lobe], moduleId])
  }, [config.lobeModules, updateLobeModules])

  const removeModule = useCallback((lobe: AnorakLobe, moduleId: string) => {
    updateLobeModules(lobe, config.lobeModules[lobe].filter(id => id !== moduleId))
    if (previewTarget?.lobe === lobe && previewTarget.moduleId === moduleId) {
      setPreviewTarget(null)
      setPreviewContent('')
    }
  }, [config.lobeModules, previewTarget, updateLobeModules])

  const openPreview = useCallback(async (lobe: AnorakLobe, moduleId: string, title: string) => {
    setPreviewTarget({ lobe, moduleId, title })
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/anorak/pro/context-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lobe,
          contextModules: config.contextModules,
          customModules: config.customModules,
          lobeModules: config.lobeModules,
          topMissionCount: config.topMissionCount,
          moduleValues: config.moduleValues,
        }),
      })
      if (!res.ok) {
        setPreviewContent(`Failed to preview module (${res.status})`)
        return
      }
      const data = await res.json()
      const match = Array.isArray(data.modules)
        ? data.modules.find((mod: { id: string; content: string }) => mod.id === moduleId)
        : null
      setPreviewContent(match?.content || 'This module currently resolves to no prompt content.')
    } catch (error) {
      setPreviewContent(`Preview failed: ${(error as Error).message}`)
    } finally {
      setPreviewLoading(false)
    }
  }, [config.contextModules, config.customModules, config.lobeModules, config.moduleValues, config.topMissionCount])

  const saveCustomModule = useCallback((index: number, nextModule: CustomContextModule) => {
    const next = [...config.customModules]
    next[index] = nextModule
    onUpdate({ customModules: next })
  }, [config.customModules, onUpdate])

  const addCustomModule = useCallback((type: 'text' | 'file') => {
    if ((config.customModules?.length ?? 0) >= 20) return
    const nextIndex = (config.customModules?.length ?? 0) + 1
    onUpdate({
      customModules: [
        ...(config.customModules || []),
        {
          id: `custom:module-${Date.now()}-${nextIndex}`,
          name: type === 'file' ? `Linked File ${nextIndex}` : `Module ${nextIndex}`,
          content: '',
          enabled: true,
          type,
          filePath: '',
        },
      ],
    })
  }, [config.customModules, onUpdate])

  const availableModulesFor = useCallback((lobe: AnorakLobe) => {
    return catalog.filter(entry => {
      if (config.lobeModules[lobe].includes(entry.id)) return false
      if (entry.kind === 'custom') {
        const custom = config.customModules.find(mod => mod.id === entry.id)
        return custom?.enabled !== false
      }
      return true
    })
  }, [catalog, config.customModules, config.lobeModules])

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
      <div className="text-[#14b8a6] text-[10px] uppercase tracking-widest mb-2">Context Engineering HQ</div>

      {/* ── Type Legend ── */}
      <div className="mb-3 flex gap-4 text-[9px]">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODULE_TYPE_COLORS.builtin }} />
          <span className="text-[#c0ffee]">built-in</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODULE_TYPE_COLORS.custom }} />
          <span className="text-[#c0ffee]">custom text</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MODULE_TYPE_COLORS.file }} />
          <span className="text-[#c0ffee]">linked file</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#e879f9' }} />
          <span className="text-[#c0ffee]">runtime 🔒</span>
        </span>
      </div>

      <div className="space-y-2">
        {/* ── Per-lobe expandable cards ── */}
        {(['curator', 'coder', 'reviewer', 'tester'] as const).map(lobe => {
          const attached = config.lobeModules[lobe] || []
          const moduleCount = attached.length + 1 + (lobe === 'curator' ? 1 : 0) // +1 sysprompt, +1 runtime mission for curator
          const isExpanded = !!expandedLobes[lobe]
          return (
            <div key={lobe} className="border rounded bg-black/30" style={{ borderColor: `${LOBE_COLORS[lobe]}30` }}>
              {/* ── Collapsed header ── */}
              <div
                className="flex items-center justify-between px-2 py-1.5 cursor-pointer select-none"
                onClick={() => toggleExpand(lobe)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-white">{isExpanded ? '▼' : '▶'}</span>
                  <span style={{ color: LOBE_COLORS[lobe] }} className="font-bold capitalize text-[11px]">{lobe}</span>
                  <span className="text-[9px] text-[#c0ffee]">{config.models[lobe]}</span>
                </div>
                <span className="text-[9px] text-[#c0ffee]">{moduleCount} module{moduleCount !== 1 ? 's' : ''}</span>
              </div>

              {/* ── Expanded content ── */}
              {isExpanded && (
                <div className="px-2 pb-2 pt-1 border-t" style={{ borderColor: `${LOBE_COLORS[lobe]}20` }}>
                  {/* Model selector + Add button */}
                  <div className="flex items-center justify-between mb-2">
                    <select
                      value={config.models[lobe]}
                      onChange={e => onUpdate({ models: { ...config.models, [lobe]: e.target.value } })}
                      className={selectCls}
                    >
                      <option value="opus">Opus</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="haiku">Haiku</option>
                    </select>
                    <button
                      onClick={() => setAddModalLobe(lobe)}
                      className="text-[9px] px-2 py-0.5 rounded border border-dashed border-[#14b8a6]/40 text-[#14b8a6] hover:bg-[#14b8a6]/10 cursor-pointer"
                    >
                      + Add Module
                    </button>
                  </div>

                  {/* Module pill grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {/* Runtime mission pill — locked, curator only */}
                    {/* CLAUDE.md — auto-loaded by Claude Code CLI for all agents */}
                    <div className="relative rounded border border-[#e879f9]/30 bg-[#020617] p-2 opacity-80">
                      <div className="absolute top-0.5 right-1 flex items-center gap-1">
                        <span className="text-[7px] uppercase tracking-wide text-[#e879f9]">runtime</span>
                        <span className="text-[#e879f9] text-[10px]">🔒</span>
                      </div>
                      <div className="pr-10 text-[10px] font-bold text-[#e879f9]">CLAUDE.md</div>
                      <div className="text-[9px] text-[#c0ffee] mt-0.5">Auto-loaded by CLI. Architecture, gotchas, commands, standards.</div>
                    </div>

                    {lobe === 'curator' && (
                      <div className="relative rounded border border-[#e879f9]/30 bg-[#020617] p-2 opacity-80">
                        <div className="absolute top-0.5 right-1 flex items-center gap-1">
                          <span className="text-[7px] uppercase tracking-wide text-[#e879f9]">runtime</span>
                          <span className="text-[#e879f9] text-[10px]">🔒</span>
                        </div>
                        <div className="pr-10 text-[10px] font-bold text-[#e879f9]">Target Mission</div>
                        <div className="text-[9px] text-[#c0ffee] mt-0.5">Auto-injected: full mission data for the mission being curated</div>
                      </div>
                    )}

                    <LobeEditor lobe={lobe} />

                    {attached.map(moduleId => {
                      const moduleMeta = catalogById.get(moduleId)
                      if (!moduleMeta) return null
                      const typeColor = moduleTypeColor(moduleMeta)
                      return (
                        <div
                          key={moduleId}
                          className="relative rounded border bg-[#020617] p-2 cursor-pointer transition-transform hover:scale-[1.02]"
                          style={{ borderColor: `${typeColor}40` }}
                          onClick={() => openPreview(lobe, moduleId, moduleMeta.name)}
                        >
                          {/* Type badge + remove */}
                          <div className="absolute top-0.5 right-1 flex items-center gap-1">
                            <span className="text-[7px] uppercase tracking-wide" style={{ color: typeColor }}>{moduleTypeLabel(moduleMeta)}</span>
                            <button
                              className="text-[#c0ffee] hover:text-[#fb7185] text-[10px] leading-none cursor-pointer"
                              onClick={e => { e.stopPropagation(); removeModule(lobe, moduleId) }}
                            >×</button>
                          </div>
                          <div className="pr-10 text-[10px] font-bold" style={{ color: typeColor }}>{moduleMeta.name}</div>
                          <div className="text-[9px] text-[#c0ffee] mt-0.5 truncate">{moduleMeta.description}</div>
                          {moduleMeta.parameterized && (
                            <div className="mt-1.5 flex items-center gap-1 text-[9px]" onClick={e => e.stopPropagation()}>
                              <button onClick={() => {
                                const cur = config.moduleValues[moduleId] ?? 3
                                onUpdate({ moduleValues: { ...config.moduleValues, [moduleId]: Math.max(1, cur - 1) } })
                              }} className="rounded border px-1 cursor-pointer" style={{ borderColor: `${typeColor}50`, color: typeColor }}>◀</button>
                              <span className="text-white w-3 text-center">{config.moduleValues[moduleId] ?? 3}</span>
                              <button onClick={() => {
                                const cur = config.moduleValues[moduleId] ?? 3
                                onUpdate({ moduleValues: { ...config.moduleValues, [moduleId]: Math.min(50, cur + 1) } })
                              }} className="rounded border px-1 cursor-pointer" style={{ borderColor: `${typeColor}50`, color: typeColor }}>▶</button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {attached.length === 0 && (
                      <div className="rounded border border-dashed border-[#14b8a6]/20 p-2 text-[10px] text-[#c0ffee]">
                        No modules attached.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* ── Anorak Pro lobe (orchestrator) ── */}
        {(() => {
          const lobe = 'anorak-pro' as AnorakLobe
          const attached = config.lobeModules[lobe] || []
          const isExpanded = !!expandedLobes[lobe]
          const anorakProRuntimeModules = [
            { id: 'runtime:claude-md', name: 'CLAUDE.md', description: 'Auto-loaded by Claude Code CLI. Project architecture, gotchas, commands, standards.' },
            { id: 'runtime:ap-mission-mcp', name: 'Mission MCP', description: 'Tools: create_para_mission, create_pashyanti_mission, get_mission, get_missions_queue, mature_mission, generate_image/voice/video.' },
          ]
          return (
            <div className="border border-[#14b8a6]/30 rounded bg-black/30">
              <div className="flex items-center justify-between px-2 py-1.5 cursor-pointer select-none" onClick={() => toggleExpand(lobe)}>
                <div className="flex items-center gap-2">
                  <span className="text-white">{isExpanded ? '▼' : '▶'}</span>
                  <span style={{ color: '#14b8a6' }} className="font-bold text-[11px]">anorak-pro</span>
                  <span className="text-[9px] text-[#5eead4]">orchestrator + heartbeat</span>
                </div>
                <span className="text-[9px] text-[#c0ffee]">{attached.length + anorakProRuntimeModules.length + 1} modules</span>
              </div>
              {isExpanded && (
                <div className="px-2 pb-2 pt-1 border-t border-[#14b8a6]/20">
                  <div className="mb-2 text-[10px] text-[#ccfbf1]">Prefrontal cortex: connects north loop (curator) and south loop (coder → reviewer → tester → gamer). Heartbeat wakes it periodically to assess pipeline and create missions.</div>

                  {/* Model selector + Add button */}
                  <div className="flex items-center justify-between mb-2">
                    <select
                      value={(config.models as Record<string, string>)[lobe] || 'sonnet'}
                      onChange={e => onUpdate({ models: { ...config.models, [lobe]: e.target.value } })}
                      className={selectCls}
                    >
                      <option value="opus">Opus</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="haiku">Haiku</option>
                    </select>
                    <button
                      onClick={() => setAddModalLobe(lobe)}
                      className="text-[9px] px-2 py-0.5 rounded border border-dashed border-[#14b8a6]/40 text-[#14b8a6] hover:bg-[#14b8a6]/10 cursor-pointer"
                    >
                      + Add Module
                    </button>
                  </div>

                  {/* Runtime pills (locked) */}
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    {anorakProRuntimeModules.map(module => (
                      <div key={module.id} className="rounded border border-[#14b8a6]/20 bg-[#042f2e]/40 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] font-bold text-[#5eead4]">{module.name}</div>
                          <span className="text-[7px] uppercase tracking-wide text-[#14b8a6]">runtime 🔒</span>
                        </div>
                        <div className="mt-1 text-[9px] text-[#99f6e4]/70">{module.description}</div>
                      </div>
                    ))}
                  </div>

                  {/* Configurable module pills */}
                  <div className="grid grid-cols-3 gap-2">
                    <LobeEditor lobe={lobe} />

                    {attached.map(moduleId => {
                      const moduleMeta = catalogById.get(moduleId)
                      if (!moduleMeta) return null
                      const typeColor = moduleTypeColor(moduleMeta)
                      return (
                        <div
                          key={moduleId}
                          className="relative rounded border bg-[#020617] p-2 cursor-pointer transition-transform hover:scale-[1.02]"
                          style={{ borderColor: `${typeColor}40` }}
                          onClick={() => openPreview(lobe, moduleId, moduleMeta.name)}
                        >
                          <div className="absolute top-0.5 right-1 flex items-center gap-1">
                            <span className="text-[7px] uppercase tracking-wide" style={{ color: typeColor }}>{moduleTypeLabel(moduleMeta)}</span>
                            <button
                              className="text-[#c0ffee] hover:text-[#fb7185] text-[10px] leading-none cursor-pointer"
                              onClick={e => { e.stopPropagation(); removeModule(lobe, moduleId) }}
                            >×</button>
                          </div>
                          <div className="pr-10 text-[10px] font-bold" style={{ color: typeColor }}>{moduleMeta.name}</div>
                          <div className="text-[9px] text-[#c0ffee] mt-0.5 truncate">{moduleMeta.description}</div>
                          {moduleMeta.parameterized && (
                            <div className="mt-1.5 flex items-center gap-1 text-[9px]" onClick={e => e.stopPropagation()}>
                              <button onClick={() => {
                                const cur = config.moduleValues[moduleId] ?? 3
                                onUpdate({ moduleValues: { ...config.moduleValues, [moduleId]: Math.max(1, cur - 1) } })
                              }} className="rounded border px-1 cursor-pointer" style={{ borderColor: `${typeColor}50`, color: typeColor }}>◀</button>
                              <span className="text-white w-3 text-center">{config.moduleValues[moduleId] ?? 3}</span>
                              <button onClick={() => {
                                const cur = config.moduleValues[moduleId] ?? 3
                                onUpdate({ moduleValues: { ...config.moduleValues, [moduleId]: Math.min(50, cur + 1) } })
                              }} className="rounded border px-1 cursor-pointer" style={{ borderColor: `${typeColor}50`, color: typeColor }}>▶</button>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {attached.length === 0 && (
                      <div className="rounded border border-dashed border-[#14b8a6]/20 p-2 text-[10px] text-[#c0ffee]">
                        No configurable modules attached.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Gamer lobe (prompt-only) ── */}
        <div className="border border-[#eab308]/20 rounded bg-black/30">
          <div className="flex items-center justify-between px-2 py-1.5 cursor-pointer select-none" onClick={() => toggleExpand('gamer')}>
            <div className="flex items-center gap-2">
              <span className="text-white">{expandedLobes.gamer ? '▼' : '▶'}</span>
              <span style={{ color: LOBE_COLORS.gamer }} className="font-bold capitalize text-[11px]">gamer</span>
              <span className="text-[9px] text-[#fbbf24]">prompt-only</span>
            </div>
          </div>
          {expandedLobes.gamer && (
            <div className="px-2 pb-2 pt-1 border-t border-[#eab308]/20">
              <div className="mb-2 text-[10px] text-[#fef3c7]">Embodied gameplay agent. Does not participate in module orchestration yet.</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="relative rounded border border-[#e879f9]/30 bg-[#020617] p-2 opacity-80">
                  <div className="absolute top-0.5 right-1 flex items-center gap-1">
                    <span className="text-[7px] uppercase tracking-wide text-[#e879f9]">runtime</span>
                    <span className="text-[#e879f9] text-[10px]">🔒</span>
                  </div>
                  <div className="pr-10 text-[10px] font-bold text-[#e879f9]">CLAUDE.md</div>
                  <div className="text-[9px] text-[#c0ffee] mt-0.5">Auto-loaded by CLI. Architecture, gotchas, commands, standards.</div>
                </div>
                <LobeEditor lobe="gamer" />
              </div>
            </div>
          )}
        </div>

        {/* ── Merlin lobe (prompt-only) ── */}
        <div className="border border-[#a78bfa]/20 rounded bg-black/30">
          <div className="flex items-center justify-between px-2 py-1.5 cursor-pointer select-none" onClick={() => toggleExpand('merlin')}>
            <div className="flex items-center gap-2">
              <span className="text-white">{expandedLobes.merlin ? '▼' : '▶'}</span>
              <span style={{ color: '#a78bfa' }} className="font-bold capitalize text-[11px]">merlin</span>
              <span className="text-[9px] text-[#c4b5fd]">prompt + bootstrap</span>
            </div>
          </div>
          {expandedLobes.merlin && (
            <div className="px-2 pb-2 pt-1 border-t border-[#a78bfa]/20">
              <div className="mb-2 text-[10px] text-[#ede9fe]">World-builder agent. CEHQ can edit `merlin.md`, and the locked runtime pills below mirror the extra bootstrap context Merlin receives at new-session start.</div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                {merlinRuntimeModules.map(module => (
                  <div
                    key={module.id}
                    className="rounded border border-[#a78bfa]/20 bg-[#1e1b4b]/20 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-bold text-[#ddd6fe]">{module.name}</div>
                      <span className="text-[7px] uppercase tracking-wide text-[#c4b5fd]">locked</span>
                    </div>
                    <div className="mt-1 text-[9px] text-[#c4b5fd]/85">{module.description}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <LobeEditor lobe="merlin" />
              </div>
            </div>
          )}
        </div>

        {/* ── Custom Module Library ── */}
        <div className="border border-[#14b8a6]/15 rounded p-2 bg-black/30">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-white font-bold text-[11px]">Custom Module Library</div>
              <div className="text-[#c0ffee] text-[9px]">Saved modules become attachable to any lobe. File modules resolve live from disk.</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => addCustomModule('text')} disabled={(config.customModules?.length ?? 0) >= 20} className="text-[9px] px-2 py-0.5 rounded bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30 disabled:opacity-30 cursor-pointer">+ Text</button>
              <button onClick={() => addCustomModule('file')} disabled={(config.customModules?.length ?? 0) >= 20} className="text-[9px] px-2 py-0.5 rounded bg-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/30 disabled:opacity-30 cursor-pointer">+ Link File</button>
            </div>
          </div>

          <div className="space-y-2">
            {(config.customModules || []).map((mod, i) => (
              <CustomModuleEditor
                key={mod.id || i}
                module={mod}
                onSave={nextModule => saveCustomModule(i, nextModule)}
                onDelete={() => {
                  const filtered = config.customModules.filter((_, j) => j !== i)
                  onUpdate({ customModules: filtered })
                }}
              />
            ))}
            {(config.customModules || []).length === 0 && (
              <div className="text-[#c0ffee] text-[10px] py-1">No custom modules yet. Add text or file-backed context.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Fullscreen Preview Modal ── */}
      {previewTarget && (
        <PreviewOverlay
          target={previewTarget}
          content={previewContent}
          loading={previewLoading}
          onClose={() => { setPreviewTarget(null); setPreviewContent('') }}
        />
      )}

      {/* ── Fullscreen Add Module Modal ── */}
      {addModalLobe && (
        <AddModuleOverlay
          lobe={addModalLobe}
          options={availableModulesFor(addModalLobe)}
          onAdd={moduleId => attachModule(addModalLobe, moduleId)}
          onClose={() => setAddModalLobe(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════

function SettingsDropdown({ settings, onChange }: { settings: PanelSettings; onChange: (s: PanelSettings) => void }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg p-3 shadow-xl w-56">
      <div className="text-[10px] text-[#c0ffee]/80 uppercase tracking-widest mb-2">Panel Settings</div>

      <div className="space-y-2 text-[10px]">
        <div>
          <div className="text-[#c0ffee]/70 mb-1">Background Color</div>
          <input
            type="color"
            value={settings.bgColor}
            onChange={e => onChange({ ...settings, bgColor: e.target.value })}
            className="w-full h-6 rounded cursor-pointer bg-transparent border border-white/10"
          />
        </div>
        <div>
          <div className="text-[#c0ffee]/70 mb-1">Opacity ({(settings.opacity * 100).toFixed(0)}%)</div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={settings.opacity}
            onChange={e => onChange({ ...settings, opacity: parseFloat(e.target.value) })}
            className="w-full accent-teal-500"
          />
        </div>
        <div>
          <div className="text-[#c0ffee]/70 mb-1">Blur ({settings.blur}px)</div>
          <input
            type="range" min={0} max={20} step={1}
            value={settings.blur}
            onChange={e => onChange({ ...settings, blur: parseInt(e.target.value) })}
            className="w-full accent-teal-500"
          />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PRO PANEL — main component
// ═══════════════════════════════════════════════════════════════════════════

export function AnorakProPanel({
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
  useUILayer('anorak-pro', isOpen && !embedded)
  const { settings: _sceneSettings } = useContext(SettingsContext)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('anorak-pro', 9998))

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'stream'
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'stream' } catch { return 'stream' }
  })

  const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })
  const [showSettings, setShowSettings] = useState(false)

  // Avatar gallery
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const anorakProAvatar = useOasisStore(s => s.placedAgentAvatars.find(a => a.agentType === 'anorak-pro'))
  const assignSharedAgentAvatar = useOasisStore(s => s.assignSharedAgentAvatar)
  const switchWorld = useOasisStore(s => s.switchWorld)

  // Anorak Pro config (flows to API calls)
  const [config, setConfig] = useState<AnorakProConfig>(loadConfig)
  const updateConfig = useCallback((partial: Partial<AnorakProConfig>) => {
    setConfig(prev => {
      const next = mergeContextConfig(prev, partial) as AnorakProConfig
      saveConfig(next)
      return next
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/anorak/pro/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customModules: config.customModules,
        lobeModules: config.lobeModules,
        topMissionCount: config.topMissionCount,
        moduleValues: config.moduleValues,
      }),
      signal: controller.signal,
    }).catch(() => {})

    return () => controller.abort()
  }, [config.customModules, config.lobeModules, config.topMissionCount, config.moduleValues])

  const [telegramConfig, setTelegramConfig] = useState<TelegramPanelConfig>(DEFAULT_TELEGRAM_CONFIG)
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [telegramSaving, setTelegramSaving] = useState(false)
  const [telegramTesting, setTelegramTesting] = useState(false)
  const [telegramPollingNow, setTelegramPollingNow] = useState(false)
  const [telegramStatus, setTelegramStatus] = useState('')
  const [roadmapWorldBusy, setRoadmapWorldBusy] = useState(false)
  const [roadmapWorldStatus, setRoadmapWorldStatus] = useState('')

  const loadTelegramConfig = useCallback(async () => {
    setTelegramLoading(true)
    try {
      const res = await fetch('/api/anorak/pro/telegram', { cache: 'no-store' })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)

      setTelegramConfig({
        enabled: Boolean(data.enabled),
        configured: Boolean(data.configured),
        hasBotToken: Boolean(data.hasBotToken),
        botToken: '',
        botTokenHint: typeof data.botTokenHint === 'string' ? data.botTokenHint : '',
        chatId: typeof data.chatId === 'string' ? data.chatId : '',
        messageThreadId: typeof data.messageThreadId === 'string' ? data.messageThreadId : '',
        webhookSecret: '',
        webhookSecretSet: Boolean(data.webhookSecretSet),
        webhookUrl: typeof data.webhookUrl === 'string' ? data.webhookUrl : '',
        pollingEnabled: Boolean(data.pollingEnabled),
        pollingIntervalSec: typeof data.pollingIntervalSec === 'number' ? data.pollingIntervalSec : 8,
        voiceNotesEnabled: data.voiceNotesEnabled !== false,
        voiceRepliesEnabled: data.voiceRepliesEnabled !== false,
        polling: parseTelegramPollingStatus(data.polling),
        source: typeof data.source === 'string' ? data.source : 'none',
        canMutateConfig: data.canMutateConfig !== false,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      })
      setTelegramStatus('')
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTelegramLoading(false)
    }
  }, [])

  const saveTelegramConfig = useCallback(async () => {
    setTelegramSaving(true)
    setTelegramStatus('')
    try {
      const res = await fetch('/api/anorak/pro/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: telegramConfig.enabled,
          botToken: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
          messageThreadId: telegramConfig.messageThreadId,
          webhookSecret: telegramConfig.webhookSecret,
          pollingEnabled: telegramConfig.pollingEnabled,
          pollingIntervalSec: telegramConfig.pollingIntervalSec,
          voiceNotesEnabled: telegramConfig.voiceNotesEnabled,
          voiceRepliesEnabled: telegramConfig.voiceRepliesEnabled,
        }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)

      setTelegramConfig(prev => ({
        ...prev,
        configured: Boolean(data.configured),
        hasBotToken: Boolean(data.botTokenHint) || prev.hasBotToken || Boolean(prev.botToken),
        botToken: '',
        botTokenHint: typeof data.botTokenHint === 'string' ? data.botTokenHint : prev.botTokenHint,
        chatId: typeof data.chatId === 'string' ? data.chatId : prev.chatId,
        messageThreadId: typeof data.messageThreadId === 'string' ? data.messageThreadId : prev.messageThreadId,
        webhookSecret: '',
        webhookSecretSet: Boolean(data.webhookSecretSet),
        pollingEnabled: data.pollingEnabled !== undefined ? Boolean(data.pollingEnabled) : prev.pollingEnabled,
        pollingIntervalSec: typeof data.pollingIntervalSec === 'number' ? data.pollingIntervalSec : prev.pollingIntervalSec,
        voiceNotesEnabled: data.voiceNotesEnabled !== undefined ? data.voiceNotesEnabled !== false : prev.voiceNotesEnabled,
        voiceRepliesEnabled: data.voiceRepliesEnabled !== undefined ? data.voiceRepliesEnabled !== false : prev.voiceRepliesEnabled,
        polling: parseTelegramPollingStatus(data.polling),
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : prev.updatedAt,
      }))
      setTelegramStatus('Telegram settings saved. Polling is now synced with the local bridge.')
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTelegramSaving(false)
    }
  }, [telegramConfig])

  const sendTelegramTest = useCallback(async () => {
    setTelegramTesting(true)
    setTelegramStatus('')
    try {
      const res = await fetch('/api/anorak/pro/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)
      setTelegramStatus('Telegram test ping sent.')
      await loadTelegramConfig()
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTelegramTesting(false)
    }
  }, [loadTelegramConfig])

  const pollTelegramNow = useCallback(async () => {
    setTelegramPollingNow(true)
    setTelegramStatus('')
    try {
      const res = await fetch('/api/anorak/pro/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll-now' }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)
      await loadTelegramConfig()
      const processedCount = typeof data.processedCount === 'number' ? data.processedCount : 0
      const bootstrapped = Boolean(data.bootstrapped)
      const bridgeDisabled = Boolean(data.bridgeDisabled)
      const hint = typeof data.hint === 'string' ? data.hint : ''
      setTelegramStatus(
        bridgeDisabled
          ? (hint || 'Telegram bridge is saved but disabled.')
          : bootstrapped
          ? 'Telegram polling initialized. Pending messages are being checked now.'
          : (processedCount > 0 ? `Telegram polled ${processedCount} update${processedCount === 1 ? '' : 's'}.` : 'Telegram poll ran. No new messages.'),
      )
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTelegramPollingNow(false)
    }
  }, [loadTelegramConfig])

  const clearTelegramConfig = useCallback(async () => {
    setTelegramSaving(true)
    setTelegramStatus('')
    try {
      const res = await fetch('/api/anorak/pro/telegram', { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)
      await loadTelegramConfig()
      setTelegramStatus('Telegram settings cleared.')
    } catch (error) {
      setTelegramStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setTelegramSaving(false)
    }
  }, [loadTelegramConfig])

  const buildRoadmapWorld = useCallback(async () => {
    setRoadmapWorldBusy(true)
    setRoadmapWorldStatus('')
    try {
      const res = await fetch('/api/anorak/pro/roadmap-world', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: anorakProAvatar?.avatar3dUrl || null }),
      })
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok) throw new Error((typeof data.error === 'string' && data.error) || `HTTP ${res.status}`)

      if (typeof data.worldId === 'string' && data.worldId) {
        switchWorld(data.worldId)
      }
      setRoadmapWorldStatus(Boolean(data.created) ? 'Roadmap World created and opened.' : 'Roadmap World refreshed and opened.')
    } catch (error) {
      setRoadmapWorldStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setRoadmapWorldBusy(false)
    }
  }, [anorakProAvatar, switchWorld])

  // Session management
  const [sessions, setSessions] = useState<AnorakProSession[]>(() => loadSessions())
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    const stored = readBrowserStorage(ACTIVE_SESSION_KEY) || ''
    const allSessions = loadSessions()
    if (stored && allSessions.find(s => s.id === stored)) return stored
    if (allSessions.length > 0) return allSessions[0].id
    return stored
  })
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derive entries from active session
  const activeSession = sessions.find(s => s.id === activeSessionId)
  const streamEntries = activeSession?.entries || []
  const setStreamEntries = useCallback((updater: StreamEntry[] | ((prev: StreamEntry[]) => StreamEntry[])) => {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeSessionId) return s
        const newEntries = typeof updater === 'function' ? updater(s.entries) : updater
        return { ...s, entries: newEntries }
      })
      // Debounced save to SQLite-backed local cache.
      if (saveDebounce.current) clearTimeout(saveDebounce.current)
      saveDebounce.current = setTimeout(() => saveSessions(next), 500)
      return next
    })
  }, [activeSessionId])

  // Ref for stable access from long-lived SSE streams (prevents stale closure on session switch)
  const setStreamEntriesRef = useRef(setStreamEntries)
  setStreamEntriesRef.current = setStreamEntries

  // Token accumulation — adds to active session's token stats
  const sessionTokens = activeSession?.tokens || ZERO_TOKENS
  const addSessionTokens = useCallback((input: number, output: number, cost: number) => {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== activeSessionId) return s
        const t = s.tokens || ZERO_TOKENS
        return { ...s, tokens: { inputTokens: t.inputTokens + input, outputTokens: t.outputTokens + output, costUsd: t.costUsd + cost } }
      })
      if (saveDebounce.current) clearTimeout(saveDebounce.current)
      saveDebounce.current = setTimeout(() => saveSessions(next), 500)
      return next
    })
  }, [activeSessionId])
  const addSessionTokensRef = useRef(addSessionTokens)
  addSessionTokensRef.current = addSessionTokens

  const handleNewSession = useCallback(() => {
    const s = createSession()
    setSessions(prev => {
      const next = [s, ...prev]
      saveSessions(next)
      return next
    })
    setActiveSessionId(s.id)
    writeBrowserStorage(ACTIVE_SESSION_KEY, s.id)
  }, [])

  const handleSwitchSession = useCallback((id: string) => {
    // Flush any pending debounced save before switching — prevents stale overwrite
    if (saveDebounce.current) {
      clearTimeout(saveDebounce.current)
      saveDebounce.current = null
      setSessions(prev => { saveSessions(prev); return prev })
    }
    setActiveSessionId(id)
    writeBrowserStorage(ACTIVE_SESSION_KEY, id)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const legacy = await migrateLegacyAnorakProSessions()
      const persisted = await loadPersistedAnorakProSessions()
      const next = mergeAnorakProSessions(persisted, legacy)
      if (cancelled) return
      if (next.length > 0) {
        setSessions(next)
        setActiveSessionId(current => {
          if (current && next.some(session => session.id === current)) return current
          return next[0].id
        })
      }
      setSessionsHydrated(true)
    })().catch(() => {
      if (!cancelled) setSessionsHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Ensure at least one session exists
  useEffect(() => {
    if (sessionsHydrated && sessions.length === 0) handleNewSession()
  }, [sessions.length, sessionsHydrated, handleNewSession])

  useEffect(() => {
    if (!isOpen) return
    void loadTelegramConfig()
  }, [isOpen, loadTelegramConfig])

  useEffect(() => {
    if (!isOpen || !telegramConfig.pollingEnabled) return
    const id = window.setInterval(() => { void loadTelegramConfig() }, 15000)
    return () => window.clearInterval(id)
  }, [isOpen, telegramConfig.pollingEnabled, loadTelegramConfig])

  // Stream entries
  const entryIdRef = useRef(0)
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [isChatting, setIsChatting] = useState(false)
  const chatAbortRef = useRef<AbortController | null>(null)
  const chatActivityRunIdRef = useRef<string | null>(null)
  const agentActivityRunIdRef = useRef<string | null>(null)
  const [proSessionId, setProSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return readBrowserStorage(PRO_SESSION_KEY) || ''
  })

  useEffect(() => () => {
    const { finishAgentWork } = useOasisStore.getState()
    if (chatActivityRunIdRef.current) {
      finishAgentWork('anorak-pro', chatActivityRunIdRef.current)
      chatActivityRunIdRef.current = null
    }
    if (agentActivityRunIdRef.current) {
      finishAgentWork('anorak-pro', agentActivityRunIdRef.current)
      agentActivityRunIdRef.current = null
    }
  }, [])

  // ─═̷─ Chat with Anorak Pro ─═̷─
  const handleChat = useCallback(async (msg: string) => {
    if (isChatting) return
    setIsChatting(true)
    const activityRunId = `anorak-pro-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    chatActivityRunIdRef.current = activityRunId
    useOasisStore.getState().startAgentWork('anorak-pro', activityRunId, proSessionId || undefined)
    const finishActivity = () => {
      if (chatActivityRunIdRef.current !== activityRunId) return
      chatActivityRunIdRef.current = null
      useOasisStore.getState().finishAgentWork('anorak-pro', activityRunId)
    }
    const failActivity = () => {
      if (chatActivityRunIdRef.current !== activityRunId) return
      chatActivityRunIdRef.current = null
      useOasisStore.getState().failAgentWork('anorak-pro', activityRunId)
    }
    const addEntry = setStreamEntriesRef.current

    // Add user message to stream
    addEntry(prev => [...prev, {
      id: entryIdRef.current++, type: 'text', content: msg,
      lobe: 'carbondev', timestamp: Date.now(),
    }])

    const controller = new AbortController()
    chatAbortRef.current = controller

    try {
      const res = await fetch('/api/claude-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: msg,
          agent: 'anorak-pro',
          sessionId: proSessionId || undefined,
          model: (config.models as Record<string, string>)?.['anorak-pro'] || 'opus',
          customModules: config.customModules,
          lobeModules: config.lobeModules,
          topMissionCount: config.topMissionCount,
          moduleValues: config.moduleValues,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setStreamEntriesRef.current(prev => [...prev, {
          id: entryIdRef.current++, type: 'error',
          content: `HTTP ${res.status}`, lobe: 'anorak-pro', timestamp: Date.now(),
        }])
        failActivity()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue // skip empty + keepalive
          if (trimmed === 'data: [DONE]') continue
          // Strip SSE "data: " prefix
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
          try {
            const event = JSON.parse(jsonStr)
            // Capture session ID
            if (event.type === 'session' && event.sessionId && !proSessionId) {
              setProSessionId(event.sessionId)
              writeBrowserStorage(PRO_SESSION_KEY, event.sessionId)
            }
            // Text from assistant
            if (event.type === 'text') {
              setStreamEntriesRef.current(prev => {
                const last = prev[prev.length - 1]
                if (last && last.lobe === 'anorak-pro' && last.type === 'text') {
                  return [...prev.slice(0, -1), { ...last, content: last.content + (event.content || '') }]
                }
                return [...prev, {
                  id: entryIdRef.current++, type: 'text',
                  content: event.content || '', lobe: 'anorak-pro', timestamp: Date.now(),
                }]
              })
            }
            // Tool use
            if (event.type === 'tool' || event.type === 'tool_start') {
              useOasisStore.getState().setAgentWorkTool('anorak-pro', activityRunId, event.name || 'tool')
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: event.type,
                content: event.display || event.name || 'tool', lobe: 'anorak-pro', timestamp: Date.now(),
                toolName: event.name,
                toolIcon: (event.name && TOOL_ICONS_MAP[event.name]) || undefined,
                toolInput: event.input,
                toolDisplay: event.display,
                toolUseId: event.id,
              }])
            }
            // Tool result
            if (event.type === 'tool_result') {
              useOasisStore.getState().setAgentWorkTool('anorak-pro', activityRunId, null)
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'tool_result',
                content: event.preview || event.name || '', lobe: 'anorak-pro', timestamp: Date.now(),
                toolName: event.name,
                toolIcon: (event.name && TOOL_ICONS_MAP[event.name]) || undefined,
                toolDisplay: event.display,
                toolUseId: event.toolUseId,
                isError: event.isError,
                resultLength: event.length,
                fullResult: event.fullResult,
              }])
            }
            // Result (cost/tokens)
            if (event.type === 'result') {
              const usage = summarizeUsageTokens(event, {
                sessionId: proSessionId || undefined,
                model: (config.models as Record<string, string>)?.['anorak-pro'] || 'opus',
              })
              /*
              const tokens = inTok ? `↓${inTok} ↑${outTok}` : ''
              */
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'result',
                content: usage.content, lobe: 'anorak-pro', timestamp: Date.now(),
              }])
              addSessionTokensRef.current(usage.inputTokens, usage.outputTokens, usage.costUsd)
            }
            // Thinking
            if (event.type === 'thinking') {
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'thinking',
                content: event.content || '', lobe: 'anorak-pro', timestamp: Date.now(),
              }])
            }
            // Errors
            if (event.type === 'error') {
              failActivity()
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'error',
                content: event.content || event.error || '', lobe: 'anorak-pro', timestamp: Date.now(),
              }])
            }
            // Media events
            if (event.type === 'media') {
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'media', content: event.prompt || '',
                lobe: 'anorak-pro', timestamp: Date.now(),
                mediaType: event.mediaType, mediaUrl: event.url, mediaPrompt: event.prompt,
              }])
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        finishActivity()
      } else {
        setStreamEntriesRef.current(prev => [...prev, {
          id: entryIdRef.current++, type: 'error',
          content: `${e}`, lobe: 'system', timestamp: Date.now(),
        }])
        failActivity()
      }
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      finishActivity()
      setIsChatting(false)
    }
  }, [isChatting, proSessionId, config.customModules, config.lobeModules, config.models, config.moduleValues, config.topMissionCount])

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try { const s = localStorage.getItem(POS_KEY); return s ? JSON.parse(s) : DEFAULT_POS } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try { const s = localStorage.getItem(SIZE_KEY); return s ? JSON.parse(s) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Allow drag from background only — skip any element with text or interactive content
    const target = e.target as HTMLElement
    if (target.closest('button, select, input, textarea, a, pre, label, [data-no-drag]')) return
    // Skip if target has text content (user might be trying to select text)
    if (target.closest('.overflow-y-auto, .overflow-auto, .overflow-x-auto')) return
    // Only drag from header bar, tab bar, or panel border areas
    if (!target.closest('[data-drag-handle]')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    // Clamp north: header must stay at least 30px visible
    const newY = Math.max(-10, e.clientY - dragStart.current.y)
    const newPos = { x: e.clientX - dragStart.current.x, y: newY }
    setPosition(newPos)
    writeBrowserStorage(POS_KEY, JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const newW = Math.max(MIN_WIDTH, resizeStart.current.w + (e.clientX - resizeStart.current.x))
    const newH = Math.max(MIN_HEIGHT, resizeStart.current.h + (e.clientY - resizeStart.current.y))
    setSize({ w: newW, h: newH })
    writeBrowserStorage(SIZE_KEY, JSON.stringify({ w: newW, h: newH }))
  }, [isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (isDragging) { document.addEventListener('mousemove', handleDrag); document.addEventListener('mouseup', handleDragEnd) }
    if (isResizing) { document.addEventListener('mousemove', handleResize); document.addEventListener('mouseup', handleResizeEnd) }
    return () => {
      document.removeEventListener('mousemove', handleDrag); document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('mousemove', handleResize); document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd, isResizing, handleResize, handleResizeEnd])

  // Save settings to localStorage
  const updateSettings = useCallback((s: PanelSettings) => {
    setPanelSettings(s)
    writeBrowserStorage(SETTINGS_KEY, JSON.stringify(s))
  }, [])

  // Save active tab
  useEffect(() => { writeBrowserStorage(TAB_KEY, activeTab) }, [activeTab])

  // ─═̷─ SSE consumer for curate/execute streams ─═̷─
  const abortRef = useRef<AbortController | null>(null)

  const consumeSSE = useCallback(async (url: string, body: Record<string, unknown>) => {
    // Abort any in-flight SSE stream before starting a new one
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsAgentRunning(true)
    const activityRunId = `anorak-pro-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    agentActivityRunIdRef.current = activityRunId
    useOasisStore.getState().startAgentWork('anorak-pro', activityRunId, proSessionId || undefined)
    const finishActivity = () => {
      if (agentActivityRunIdRef.current !== activityRunId) return
      agentActivityRunIdRef.current = null
      useOasisStore.getState().finishAgentWork('anorak-pro', activityRunId)
    }
    const failActivity = () => {
      if (agentActivityRunIdRef.current !== activityRunId) return
      agentActivityRunIdRef.current = null
      useOasisStore.getState().failAgentWork('anorak-pro', activityRunId)
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        setStreamEntriesRef.current(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: `HTTP ${res.status}`, lobe: 'system', timestamp: Date.now() }])
        failActivity()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const event = JSON.parse(payload)
            const lobe = event.lobe || 'system'
            const type = event.type || 'text'
            let content = event.content || event.display || event.preview || event.name || ''
            if (type === 'tool' || type === 'tool_start') {
              useOasisStore.getState().setAgentWorkTool('anorak-pro', activityRunId, event.name || 'tool')
            }
            if (type === 'tool_result' || type === 'result' || type === 'text') {
              useOasisStore.getState().setAgentWorkTool('anorak-pro', activityRunId, null)
            }
            if (type === 'error') {
              failActivity()
            }
            if (type === 'done') continue
            // Result events have cost/token data but no content field
            if (type === 'result' && !content) {
              const usage = summarizeUsageTokens(event, {
                sessionId: proSessionId || undefined,
                model: (config.models as Record<string, string>)?.[lobe] || 'sonnet',
              })
              content = usage.content
              /*
              const cost = event.cost_usd ? `$${Number(event.cost_usd).toFixed(4)}` : ''
              const tokens = event.total_input_tokens ? `↓${event.total_input_tokens} ↑${event.total_output_tokens}` : ''
              content = [tokens, cost].filter(Boolean).join(' | ') || 'done'
              */
            }
            // Accumulate session tokens on standardized result events
            if (type === 'result') {
              const usage = summarizeUsageTokens(event, {
                sessionId: proSessionId || undefined,
                model: (config.models as Record<string, string>)?.[lobe] || 'sonnet',
              })
              addSessionTokensRef.current(usage.inputTokens, usage.outputTokens, usage.costUsd)
            }
            // Media events
            if (type === 'media') {
              setStreamEntriesRef.current(prev => [...prev, {
                id: entryIdRef.current++, type: 'media', content: event.prompt || '',
                lobe, timestamp: Date.now(),
                mediaType: event.mediaType, mediaUrl: event.url, mediaPrompt: event.prompt,
              }])
              continue
            }
            if (content || type === 'tool' || type === 'tool_start' || type === 'tool_result') {
              const entry: StreamEntry = {
                id: entryIdRef.current++, type, content, lobe, timestamp: Date.now(),
                // Enriched tool fields from stream parser
                toolName: event.name,
                toolIcon: (event.name && TOOL_ICONS_MAP[event.name]) || undefined,
                toolInput: event.input,
                toolDisplay: event.display,
                toolUseId: event.id || event.toolUseId,
                isError: event.isError,
                resultLength: event.length,
              }
              setStreamEntriesRef.current(prev => [...prev, entry])
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setStreamEntriesRef.current(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: `${e}`, lobe: 'system', timestamp: Date.now() }])
        failActivity()
      } else {
        finishActivity()
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      finishActivity()
      setIsAgentRunning(false)
    }
  }, [])

  const handleCurate = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/curate', {
      missionIds: [missionId],
      model: config.models.curator,
      batchSize: config.batchSize,
      contextModules: config.contextModules,
      customModules: config.customModules,
      lobeModules: config.lobeModules,
      topMissionCount: config.topMissionCount,
      moduleValues: config.moduleValues,
    })
  }, [consumeSSE, config.models.curator, config.batchSize, config.contextModules, config.customModules, config.lobeModules, config.topMissionCount, config.moduleValues])

  const handleExecute = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/execute', {
      missionId,
      coderModel: config.models.coder,
      reviewerModel: config.models.reviewer,
      testerModel: config.models.tester,
      gamerModel: config.models.gamer,
      reviewerThreshold: config.reviewerThreshold,
      recapLength: config.recapLength,
      testerHeaded: config.testerHeaded,
      gamerHeaded: config.gamerHeaded,
      contextModules: config.contextModules,
      customModules: config.customModules,
      lobeModules: config.lobeModules,
      topMissionCount: config.topMissionCount,
    })
  }, [consumeSSE, config])

  // ─═̷─ Auto-curate: poll for immature anorak missions when toggle is ON ─═̷─
  const autoCurateRef = useRef(false)
  autoCurateRef.current = config.autoCurate
  const isRunningRef = useRef(false)
  isRunningRef.current = isAgentRunning

  useEffect(() => {
    if (embedded || !config.autoCurate) return

    const checkAndCurate = async () => {
      if (!autoCurateRef.current || isRunningRef.current) return
      try {
        const res = await fetch('/api/missions')
        if (!res.ok) return
        const missions = await res.json()
        const immature = (Array.isArray(missions) ? missions : missions.data ?? [])
          .filter((m: { assignedTo: string | null; maturityLevel: number; status: string }) =>
            (m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro')
            && m.maturityLevel < 3
            && m.status !== 'done')
          .sort((a: { priority: number | null }, b: { priority: number | null }) => (b.priority ?? 0) - (a.priority ?? 0))
        if (immature.length > 0 && autoCurateRef.current && !isRunningRef.current) {
          handleCurate(immature[0].id)
        }
      } catch { /* offline */ }
    }

    // Check immediately + every 10s
    checkAndCurate()
    const interval = setInterval(checkAndCurate, 10000)
    return () => clearInterval(interval)
  }, [embedded, config.autoCurate, isAgentRunning, handleCurate])

  // ─═̷─ Auto-code: execute highest-priority vaikhari mission when toggle is ON ─═̷─
  const autoCodeRef = useRef(false)
  autoCodeRef.current = config.autoCode

  useEffect(() => {
    if (embedded || !config.autoCode) return

    const checkAndExecute = async () => {
      if (!autoCodeRef.current || isRunningRef.current) return
      try {
        const res = await fetch('/api/missions')
        if (!res.ok) return
        const missions = await res.json()
        const vaikhari = (Array.isArray(missions) ? missions : missions.data ?? [])
          .filter((m: { assignedTo: string | null; maturityLevel: number; status: string }) =>
            (m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro')
            && m.maturityLevel >= 3
            && m.status === 'todo')
          .sort((a: { priority: number | null }, b: { priority: number | null }) => (b.priority ?? 0) - (a.priority ?? 0))
        if (vaikhari.length > 0 && autoCodeRef.current && !isRunningRef.current) {
          handleExecute(vaikhari[0].id)
        }
      } catch { /* offline */ }
    }

    checkAndExecute()
    const interval = setInterval(checkAndExecute, 15000)
    return () => clearInterval(interval)
  }, [embedded, config.autoCode, isAgentRunning, handleExecute])

  // ─── Heartbeat polling ──────────────────────────────────────────────────
  const heartbeatRef = useRef(false)
  heartbeatRef.current = config.heartbeat
  const heartbeatRunningRef = useRef(false)
  const heartbeatConfigRef = useRef({
    workStart: config.heartbeatWorkStart,
    workEnd: config.heartbeatWorkEnd,
    model: config.models.curator,
    customModules: config.customModules,
    lobeModules: config.lobeModules,
    topMissionCount: config.topMissionCount,
    moduleValues: config.moduleValues,
  })
  heartbeatConfigRef.current = {
    workStart: config.heartbeatWorkStart,
    workEnd: config.heartbeatWorkEnd,
    model: config.models.curator,
    customModules: config.customModules,
    lobeModules: config.lobeModules,
    topMissionCount: config.topMissionCount,
    moduleValues: config.moduleValues,
  }

  useEffect(() => {
    if (embedded || !config.heartbeat) return

    const ac = new AbortController()
    let interval: ReturnType<typeof setInterval> | null = null

    const checkAndHeartbeat = async () => {
      if (!heartbeatRef.current || heartbeatRunningRef.current || isRunningRef.current) return
      const heartbeatConfig = heartbeatConfigRef.current
      const now = new Date()
      const hour = now.getHours()
      const start = heartbeatConfig.workStart
      const end = heartbeatConfig.workEnd
      if (start < end && (hour < start || hour >= end)) return
      if (start >= end && hour >= end && hour < start) return

      heartbeatRunningRef.current = true
      try {
        const resp = await fetch('/api/anorak/pro/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            model: heartbeatConfig.model,
            customModules: heartbeatConfig.customModules,
            lobeModules: heartbeatConfig.lobeModules,
            topMissionCount: heartbeatConfig.topMissionCount,
            moduleValues: heartbeatConfig.moduleValues,
          }),
        })
        if (resp.body) {
          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          const addEntry = setStreamEntriesRef.current
          addEntry(prev => [...prev, { id: entryIdRef.current++, type: 'status', content: 'Heartbeat started', lobe: 'anorak-pro', timestamp: Date.now() }])
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value)
            for (const line of text.split('\n')) {
              if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
              try {
                const evt = JSON.parse(line.slice(6))
                if (evt.type === 'text' || evt.type === 'thinking') {
                  addEntry(prev => {
                    const last = prev[prev.length - 1]
                    if (last?.type === evt.type && last?.lobe === 'anorak-pro') {
                      const updated = [...prev]
                      updated[updated.length - 1] = { ...last, content: last.content + evt.content }
                      return updated
                    }
                    return [...prev, { id: entryIdRef.current++, type: evt.type, content: evt.content, lobe: 'anorak-pro', timestamp: Date.now() }]
                  })
                } else if (evt.type === 'tool' || evt.type === 'tool_start' || evt.type === 'tool_result') {
                  addEntry(prev => [...prev, {
                    id: entryIdRef.current++, type: evt.type, content: evt.display || evt.content || evt.name || '',
                    lobe: 'anorak-pro', timestamp: Date.now(), toolName: evt.name, toolInput: evt.input,
                    toolDisplay: evt.display, toolUseId: evt.id, isError: evt.isError,
                  }])
                } else if (evt.type === 'error') {
                  addEntry(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: evt.content, lobe: 'anorak-pro', timestamp: Date.now() }])
                } else if (evt.type === 'media') {
                  addEntry(prev => [...prev, {
                    id: entryIdRef.current++, type: 'media', content: evt.prompt || '',
                    lobe: 'anorak-pro', timestamp: Date.now(),
                    mediaType: evt.mediaType, mediaUrl: evt.url, mediaPrompt: evt.prompt,
                  }])
                } else if (evt.type === 'status' || evt.type === 'result' || evt.type === 'stderr') {
                  addEntry(prev => [...prev, { id: entryIdRef.current++, type: evt.type, content: evt.content || '', lobe: 'anorak-pro', timestamp: Date.now() }])
                }
              } catch { /* malformed SSE line */ }
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') { /* offline or unexpected */ }
      }
      heartbeatRunningRef.current = false
    }

    const intervalMs = Math.max(30, config.heartbeatFrequencyMin) * 60 * 1000
    const firstDelayMs = Math.max(0, config.heartbeatFirstPingDelayMin) * 60 * 1000
    const kickoff = setTimeout(() => {
      if (ac.signal.aborted) return
      void checkAndHeartbeat()
      interval = setInterval(checkAndHeartbeat, intervalMs)
    }, firstDelayMs)

    return () => {
      clearTimeout(kickoff)
      if (interval) clearInterval(interval)
      ac.abort()
    }
  }, [embedded, config.heartbeat, config.heartbeatFirstPingDelayMin, config.heartbeatFrequencyMin])

  const isVisible = embedded || isOpen
  if (!isVisible || typeof document === 'undefined') return null

  // Compute background with settings
  const bgRgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(h => parseInt(h, 16)) || [8, 10, 15]
  const bgStyle = panelSettings.blur > 0 && panelSettings.opacity < 1
    ? { backgroundColor: `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${panelSettings.opacity})`, backdropFilter: `blur(${panelSettings.blur}px)` }
    : { backgroundColor: `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${panelSettings.opacity})` }

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'anorak-pro-panel'}
      data-ui-panel={embedded ? '' : undefined}
      className={`${embedded ? 'relative w-full h-full' : 'fixed'} rounded-xl flex flex-col overflow-hidden`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        ...bgStyle,
        border: `1px solid ${isAgentRunning ? 'rgba(20,184,166,0.6)' : 'rgba(20,184,166,0.2)'}`,
        boxShadow: isAgentRunning
          ? '0 0 40px rgba(20,184,166,0.2), inset 0 0 60px rgba(20,184,166,0.03)'
          : '0 8px 40px rgba(0,0,0,0.8)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
        ...(embedded ? EMBEDDED_SCROLL_SURFACE_STYLE : {}),
      }}
      onMouseDown={embedded ? undefined : e => { e.stopPropagation(); useOasisStore.getState().bringPanelToFront('anorak-pro'); handleDragStart(e) }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div data-drag-handle
        className={`flex items-center justify-between px-3 py-2 border-b border-white/10 select-none ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ background: isAgentRunning ? 'linear-gradient(135deg, rgba(20,184,166,0.1) 0%, rgba(0,0,0,0) 100%)' : 'rgba(20,20,30,0.5)' }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-base ${isAgentRunning ? 'animate-pulse' : ''}`}>🔮</span>
          <span className="text-teal-400 font-bold text-sm tracking-wide">Anorak Pro</span>
          {isAgentRunning && <span className="text-[10px] text-teal-300 animate-pulse font-mono">● running</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(p => !p)}
              className="text-[10px] text-[#c0ffee]/70 hover:text-teal-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-teal-500/30 transition-all cursor-pointer"
            >
              ⚙
            </button>
            {showSettings && <SettingsDropdown settings={panelSettings} onChange={updateSettings} />}
          </div>

          {/* Close */}
          {!hideCloseButton && (
            <button onClick={onClose} className="text-[#c0ffee]/70 hover:text-white transition-colors text-lg leading-none cursor-pointer">×</button>
          )}
        </div>
      </div>

      {/* ═══ TABS ═══ */}
      <div data-drag-handle className="flex border-b border-white/5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-1.5 text-[10px] font-mono tracking-wide transition-all cursor-pointer"
            style={{
              color: activeTab === tab.id ? '#14b8a6' : '#666',
              borderBottom: activeTab === tab.id ? '2px solid #14b8a6' : '2px solid transparent',
              background: activeTab === tab.id ? 'rgba(20,184,166,0.05)' : 'transparent',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      {activeTab === 'stream' && <StreamTab entries={streamEntries} onSend={handleChat} isChatting={isChatting} isStreaming={isChatting || isAgentRunning} sessionTokens={sessionTokens} sessions={sessions} activeSessionId={activeSessionId} onNewSession={handleNewSession} onSwitchSession={handleSwitchSession} audioTargetAvatarId={anorakProAvatar?.id || null} />}
      {activeTab === 'mindcraft' && <MindcraftTab onCurate={handleCurate} onExecute={handleExecute} isAgentRunning={isAgentRunning} />}
      {activeTab === 'curator-log' && <CuratorLogTab />}
      {activeTab === 'cehq' && <CEHQTab config={config} onUpdate={updateConfig} />}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
          <div className="text-teal-400 text-[10px] uppercase tracking-widest mb-3">Settings</div>
          <div className="space-y-3">
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Automation</div>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-amber-400">Auto-curate</span>
                  <input type="checkbox" checked={config.autoCurate} onChange={e => updateConfig({ autoCurate: e.target.checked })} className="accent-amber-500" />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Curates immature anorak missions automatically</div>
                <div className="flex items-center justify-between">
                  <span className="text-red-400">Auto-code</span>
                  <input type="checkbox" checked={config.autoCode} onChange={e => updateConfig({ autoCode: e.target.checked })} className="accent-red-500" />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Executes vaikhari missions automatically</div>
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Heartbeat</div>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-teal-400">Proactive heartbeat</span>
                  <input type="checkbox" checked={config.heartbeat} onChange={e => updateConfig({ heartbeat: e.target.checked })} className="accent-teal-500" />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Anorak checks in like a mentor: short reflection prompts, journaling energy, and one nudge toward the highest-leverage next move.</div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">First ping in (min)</span>
                  <input type="number" value={config.heartbeatFirstPingDelayMin} min={0} max={1440} step={5} onChange={e => { const parsed = parseInt(e.target.value, 10); updateConfig({ heartbeatFirstPingDelayMin: Math.min(1440, Math.max(0, Number.isFinite(parsed) ? parsed : 60)) }) }} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                </div>
                <div className="text-[#c0ffee]/55 text-[9px] -mt-1 ml-1">Local-only delay before the first mentor ping after enabling heartbeat. Use 0 for immediate.</div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Frequency (min)</span>
                  <input type="number" value={config.heartbeatFrequencyMin} min={30} max={480} step={30} onChange={e => updateConfig({ heartbeatFrequencyMin: Math.min(480, Math.max(30, parseInt(e.target.value) || 120)) })} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Work hours</span>
                  <div className="flex items-center gap-1">
                    <input type="number" value={config.heartbeatWorkStart} min={0} max={23} onChange={e => updateConfig({ heartbeatWorkStart: Math.min(23, Math.max(0, parseInt(e.target.value) || 9)) })} className="w-10 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                    <span className="text-[#c0ffee]/50">—</span>
                    <input type="number" value={config.heartbeatWorkEnd} min={0} max={23} onChange={e => updateConfig({ heartbeatWorkEnd: Math.min(23, Math.max(0, parseInt(e.target.value) || 18)) })} className="w-10 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                  </div>
                </div>
                <div className="text-[#c0ffee]/55 text-[9px] -mt-1 ml-1">Uses this Oasis machine&apos;s local time.</div>
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Telegram</div>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-sky-400">Telegram bridge</span>
                  <input
                    type="checkbox"
                    checked={telegramConfig.enabled}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="accent-sky-500"
                  />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Turns the local Anorak Pro Telegram bridge on. Heartbeats, replies, and polling all depend on this.</div>
                <div className="flex items-center justify-between">
                  <span className="text-teal-400">2-way local polling</span>
                  <input
                    type="checkbox"
                    checked={telegramConfig.pollingEnabled}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, pollingEnabled: e.target.checked }))}
                    className="accent-teal-500"
                  />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">No public URL needed. Oasis polls Telegram directly from your laptop and replies as Anorak Pro.</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#c0ffee]/70 shrink-0">Poll every</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={telegramConfig.pollingIntervalSec}
                      min={3}
                      max={60}
                      disabled={!telegramConfig.canMutateConfig || telegramSaving}
                      onChange={e => setTelegramConfig(prev => ({
                        ...prev,
                        pollingIntervalSec: Math.min(60, Math.max(3, parseInt(e.target.value) || 8)),
                      }))}
                      className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none"
                    />
                    <span className="text-[#c0ffee]/50">sec</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-violet-300">Voice notes {'->'} local STT</span>
                  <input
                    type="checkbox"
                    checked={telegramConfig.voiceNotesEnabled}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, voiceNotesEnabled: e.target.checked }))}
                    className="accent-violet-400"
                  />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Incoming Telegram voice messages are downloaded and transcribed with the same local STT path Anorak Pro already uses.</div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-300">Text + voice TLDR reply</span>
                  <input
                    type="checkbox"
                    checked={telegramConfig.voiceRepliesEnabled}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, voiceRepliesEnabled: e.target.checked }))}
                    className="accent-amber-400"
                  />
                </div>
                <div className="text-[#c0ffee]/60 text-[9px] -mt-1 ml-1">Telegram replies send the full written answer plus a shorter spoken recap by default.</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#c0ffee]/70 shrink-0">Bot token</span>
                  <input
                    type="password"
                    value={telegramConfig.botToken}
                    placeholder={telegramConfig.botTokenHint || '123456:ABC...'}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, botToken: e.target.value }))}
                    className="flex-1 min-w-0 bg-black/60 border border-white/10 rounded px-2 py-1 text-white/90 outline-none"
                  />
                </div>
                {telegramConfig.hasBotToken && !telegramConfig.botToken && (
                  <div className="text-[9px] text-[#c0ffee]/50 ml-1">Stored token: {telegramConfig.botTokenHint}</div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#c0ffee]/70 shrink-0">Chat ID</span>
                  <input
                    type="text"
                    value={telegramConfig.chatId}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, chatId: e.target.value }))}
                    className="w-40 bg-black/60 border border-white/10 rounded px-2 py-1 text-white/90 outline-none"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#c0ffee]/70 shrink-0">Thread ID</span>
                  <input
                    type="text"
                    value={telegramConfig.messageThreadId}
                    placeholder="optional"
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    onChange={e => setTelegramConfig(prev => ({ ...prev, messageThreadId: e.target.value }))}
                    className="w-40 bg-black/60 border border-white/10 rounded px-2 py-1 text-white/90 outline-none"
                  />
                </div>
                <div className="rounded border border-white/5 bg-black/30 px-2 py-1 space-y-1">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className={telegramConfig.polling.running ? 'text-teal-300' : 'text-[#c0ffee]/60'}>
                      {telegramConfig.polling.running ? (telegramConfig.polling.busy ? 'Polling live (busy)' : 'Polling live') : 'Polling stopped'}
                    </span>
                    <span className="text-[#c0ffee]/50">
                      {telegramConfig.polling.lastPollAt ? new Date(telegramConfig.polling.lastPollAt).toLocaleTimeString() : 'never polled'}
                    </span>
                  </div>
                  <div className="text-[9px] text-[#c0ffee]/65">
                    Processed: {telegramConfig.polling.processedUpdateCount} | Conversations: {telegramConfig.polling.conversationCount} | Missions: {telegramConfig.polling.missionCount}
                  </div>
                  <div className="text-[9px] text-[#c0ffee]/65">
                    Last inbound: {telegramConfig.polling.lastInboundAt ? new Date(telegramConfig.polling.lastInboundAt).toLocaleString() : 'none yet'}
                  </div>
                  {telegramConfig.polling.lastTranscript && (
                    <div className="text-[9px] text-violet-200/85">Last transcript: {telegramConfig.polling.lastTranscript}</div>
                  )}
                  {telegramConfig.polling.lastIgnoredChatId && (
                    <div className="text-[9px] text-amber-200/85">
                      Last ignored chat: {telegramConfig.polling.lastIgnoredChatId}
                      {telegramConfig.polling.lastIgnoredUsername ? ` (@${telegramConfig.polling.lastIgnoredUsername})` : ''}
                      {telegramConfig.polling.lastIgnoredThreadId ? ` thread ${telegramConfig.polling.lastIgnoredThreadId}` : ''}
                      {telegramConfig.polling.lastIgnoredReason ? ` - ${telegramConfig.polling.lastIgnoredReason}` : ''}
                      {telegramConfig.polling.lastIgnoredTextPreview ? ` - "${telegramConfig.polling.lastIgnoredTextPreview}"` : ''}
                    </div>
                  )}
                  {telegramConfig.polling.lastError && (
                    <div className="text-[9px] text-red-300">Polling error: {telegramConfig.polling.lastError}</div>
                  )}
                </div>
                <div className="flex items-center justify-between text-[9px] text-[#c0ffee]/55">
                  <span>{telegramConfig.configured ? `Configured via ${telegramConfig.source}` : 'Not configured yet'}</span>
                  <span>{telegramConfig.updatedAt ? new Date(telegramConfig.updatedAt).toLocaleString() : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void saveTelegramConfig()}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    className="px-2 py-1 rounded border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50 cursor-pointer text-[10px]"
                  >
                    {telegramSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => void sendTelegramTest()}
                    disabled={telegramTesting || telegramLoading}
                    className="px-2 py-1 rounded border border-teal-500/30 text-teal-300 hover:bg-teal-500/10 disabled:opacity-50 cursor-pointer text-[10px]"
                  >
                    {telegramTesting ? 'Pinging...' : 'Send Test'}
                  </button>
                  <button
                    onClick={() => void pollTelegramNow()}
                    disabled={telegramPollingNow || telegramLoading}
                    className="px-2 py-1 rounded border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 cursor-pointer text-[10px]"
                  >
                    {telegramPollingNow ? 'Polling...' : 'Poll Now'}
                  </button>
                  <button
                    onClick={() => void clearTelegramConfig()}
                    disabled={!telegramConfig.canMutateConfig || telegramSaving}
                    className="px-2 py-1 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer text-[10px]"
                  >
                    Clear
                  </button>
                </div>
                {telegramStatus && (
                  <div className="text-[9px] text-[#c0ffee]/75 rounded border border-white/5 bg-black/30 px-2 py-1">{telegramStatus}</div>
                )}
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Pipeline</div>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Reviewer threshold</span>
                  <input type="number" value={config.reviewerThreshold} min={50} max={100} onChange={e => updateConfig({ reviewerThreshold: Math.min(100, Math.max(50, parseInt(e.target.value) || 90)) })} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Batch size</span>
                  <input type="number" value={config.batchSize} min={1} max={5} onChange={e => updateConfig({ batchSize: Math.min(5, Math.max(1, parseInt(e.target.value) || 1)) })} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Recap length</span>
                  <input type="number" value={config.recapLength} min={50} max={500} step={50} onChange={e => updateConfig({ recapLength: Math.min(500, Math.max(50, parseInt(e.target.value) || 100)) })} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-white/90 outline-none" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Tester headed</span>
                  <input type="checkbox" checked={config.testerHeaded} onChange={e => updateConfig({ testerHeaded: e.target.checked })} className="accent-green-500" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">Gamer headed</span>
                  <input type="checkbox" checked={config.gamerHeaded} onChange={e => updateConfig({ gamerHeaded: e.target.checked })} className="accent-yellow-500" />
                </div>
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Roadmap World</div>
              <div className="space-y-2 text-[10px]">
                <div className="text-[#c0ffee]/60 text-[9px]">Builds or refreshes a dedicated world snapshot from the live mission DB and opens it immediately.</div>
                <button
                  onClick={() => void buildRoadmapWorld()}
                  disabled={roadmapWorldBusy}
                  className="px-2 py-1 rounded border border-teal-500/30 text-teal-300 hover:bg-teal-500/10 disabled:opacity-50 cursor-pointer text-[10px]"
                >
                  {roadmapWorldBusy ? 'Building...' : 'Open Roadmap World'}
                </button>
                {roadmapWorldStatus && (
                  <div className="text-[9px] text-[#c0ffee]/75 rounded border border-white/5 bg-black/30 px-2 py-1">{roadmapWorldStatus}</div>
                )}
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Avatar</div>
              <div className="space-y-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#c0ffee]/70">{anorakProAvatar ? 'Current avatar' : 'No avatar assigned'}</span>
                  <button
                    onClick={() => setShowAvatarGallery(true)}
                    className="px-2 py-0.5 rounded border border-teal-500/30 text-teal-400 hover:bg-teal-500/10 text-[10px] cursor-pointer"
                  >
                    {anorakProAvatar ? 'Change' : 'Select Avatar'}
                  </button>
                </div>
                {anorakProAvatar && (
                  <div className="text-[9px] text-[#c0ffee]/50 truncate">{anorakProAvatar.avatar3dUrl}</div>
                )}
              </div>
            </div>
            <div className="border border-white/5 rounded p-2">
              <div className="text-[#c0ffee]/80 font-bold text-[11px] mb-2">Appearance</div>
              <div className="space-y-2 text-[10px]">
                <div>
                  <div className="text-[#c0ffee]/70 mb-1">Background Color</div>
                  <input type="color" value={panelSettings.bgColor} onChange={e => updateSettings({ ...panelSettings, bgColor: e.target.value })} className="w-full h-6 rounded cursor-pointer bg-transparent border border-white/10" />
                </div>
                <div>
                  <div className="text-[#c0ffee]/70 mb-1">Opacity ({(panelSettings.opacity * 100).toFixed(0)}%)</div>
                  <input type="range" min={0} max={1} step={0.05} value={panelSettings.opacity} onChange={e => updateSettings({ ...panelSettings, opacity: parseFloat(e.target.value) })} className="w-full accent-teal-500" />
                </div>
                <div>
                  <div className="text-[#c0ffee]/70 mb-1">Blur ({panelSettings.blur}px)</div>
                  <input type="range" min={0} max={20} step={1} value={panelSettings.blur} onChange={e => updateSettings({ ...panelSettings, blur: parseInt(e.target.value) })} className="w-full accent-teal-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ AVATAR GALLERY ═══ */}
      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={anorakProAvatar?.avatar3dUrl || null}
          onSelect={(avatarUrl) => {
            assignSharedAgentAvatar('anorak-pro', avatarUrl)
            setShowAvatarGallery(false)
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}

      {/* ═══ RESIZE HANDLE ═══ */}
      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(20,184,166,0.3) 50%)' }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
