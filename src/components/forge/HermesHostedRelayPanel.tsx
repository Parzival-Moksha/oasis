'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'

import { useSharedOpenclawRelayBridge } from '@/hooks/useOpenclawRelayBridge'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { writeBrowserStorage } from '@/lib/browser-storage'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { awardXp } from '@/hooks/useXp'
import { useOasisStore } from '@/store/oasisStore'
import { PUBLIC_TOOL_NAMES } from '@/lib/relay/public-spellbook.js'
import { useAudioManager } from '@/lib/audio-manager'
import { getCameraSnapshot } from '@/lib/camera-bridge'
import { renderMarkdown } from '@/lib/anorak-renderers'
import { collectOpenclawMediaReferences, type OpenclawMediaReference } from '@/lib/openclaw-media-references'
import { MediaBubble } from './MediaBubble'
import { AvatarGallery } from './AvatarGallery'

interface HermesHostedRelayPanelProps {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
  showAdvancedDiagnostics?: boolean
  onOpenAdvancedDiagnostics?: () => void
}

interface RelayPairingResult {
  code: string
  expiresAt: number
  worldId: string
  scopes: string[]
  agentType?: string
  agentSlot?: string
  agentLabel?: string
  reused?: boolean
}

interface RelayChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: string
  timestamp: number
}

interface RelayToolEvent {
  id: string
  callId: string
  toolName: string
  args?: Record<string, unknown>
  output?: unknown
  error?: string
  state: 'running' | 'done' | 'failed'
  timestamp: number
  durationMs?: number
  worldId?: string
}

interface HermesSessionSummary {
  id: string
  title: string
  updatedAt: number
}

const HERMES_RELAY_SCOPES = ['world.read', 'world.write.safe', 'screenshot.request', 'chat.stream'] as const
const HERMES_RELAY_TOOLS: readonly string[] = Object.freeze([...PUBLIC_TOOL_NAMES])
const HERMES_AGENT_TYPE = 'hermes'
const HERMES_AGENT_SLOT = 'hermes:primary'
const HERMES_AGENT_LABEL = 'Hermes'
const CHAT_KEY = 'oasis-hermes-hosted-relay-chat'
const CHAT_SESSION_KEY_PREFIX = `${CHAT_KEY}:`
const SESSION_KEY = 'oasis-hermes-hosted-relay-session'
const SESSIONS_KEY = 'oasis-hermes-hosted-relay-sessions'
const SETTINGS_KEY = 'oasis-hermes-hosted-relay-settings'
const DEFAULT_HERMES_AVATAR_URL = '/avatars/gallery/CoolAlien.vrm'
const HERMES_STREAM_IDLE_STALL_MS = 10 * 60_000

interface HermesRelayPanelSettings {
  bgColor: string
  opacity: number
  avatarUrl: string | null
  agentLabel: string
}

const DEFAULT_PANEL_SETTINGS: HermesRelayPanelSettings = {
  bgColor: '#090704',
  opacity: 0.94,
  avatarUrl: DEFAULT_HERMES_AVATAR_URL,
  agentLabel: HERMES_AGENT_LABEL,
}

function randomId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function readStoredMessages(): RelayChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CHAT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is RelayChatMessage => {
        if (!entry || typeof entry !== 'object') return false
        const item = entry as Record<string, unknown>
        return typeof item.id === 'string'
          && (item.role === 'user' || item.role === 'assistant')
          && typeof item.content === 'string'
      })
      .slice(-80)
  } catch {
    return []
  }
}

function readStoredMessagesForSession(sessionId: string): RelayChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionId ? window.localStorage.getItem(`${CHAT_SESSION_KEY_PREFIX}${sessionId}`) : null
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is RelayChatMessage => {
            if (!entry || typeof entry !== 'object') return false
            const item = entry as Record<string, unknown>
            return typeof item.id === 'string'
              && (item.role === 'user' || item.role === 'assistant')
              && typeof item.content === 'string'
          })
          .slice(-80)
      }
    }
  } catch {
    // Fall through to the legacy single transcript.
  }

  return sessionId === readStoredSessionId() ? readStoredMessages() : []
}

function readStoredSessionId() {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
}

function titleForHermesSession(messages: RelayChatMessage[], sessionId: string): string {
  const firstUser = messages.find(message => message.role === 'user' && message.content.trim())
  const raw = firstUser?.content.trim() || `Session ${sessionId.slice(-6)}`
  return raw.length > 42 ? `${raw.slice(0, 41)}...` : raw
}

function readStoredSessionSummaries(): HermesSessionSummary[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is HermesSessionSummary => {
        if (!entry || typeof entry !== 'object') return false
        const item = entry as Record<string, unknown>
        return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.updatedAt === 'number'
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 16)
  } catch {
    return []
  }
}

function saveStoredSessionSummaries(summaries: HermesSessionSummary[]) {
  writeBrowserStorage(SESSIONS_KEY, JSON.stringify(
    summaries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 16),
  ))
}

function readStoredPanelSettings(): HermesRelayPanelSettings {
  if (typeof window === 'undefined') return DEFAULT_PANEL_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PANEL_SETTINGS
    const record = parsed as Record<string, unknown>
    const opacity = typeof record.opacity === 'number'
      ? Math.min(1, Math.max(0.55, record.opacity))
      : DEFAULT_PANEL_SETTINGS.opacity
    return {
      bgColor: typeof record.bgColor === 'string' ? record.bgColor : DEFAULT_PANEL_SETTINGS.bgColor,
      opacity,
      avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : DEFAULT_PANEL_SETTINGS.avatarUrl,
      agentLabel: typeof record.agentLabel === 'string' && record.agentLabel.trim()
        ? record.agentLabel.trim().slice(0, 48)
        : DEFAULT_PANEL_SETTINGS.agentLabel,
    }
  } catch {
    return DEFAULT_PANEL_SETTINGS
  }
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

function shellArg(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Hermes'
  if (/^[A-Za-z0-9._:-]+$/.test(trimmed)) return trimmed
  return `"${trimmed.replace(/(["\\$`])/g, '\\$1')}"`
}

function buildHermesRelayCommand(pairing: RelayPairingResult | null, origin: string, agentLabel = HERMES_AGENT_LABEL): string {
  if (!pairing) return ''
  const normalizedOrigin = normalizeCommandOrigin(origin)
  const pairingRef = normalizedOrigin
    ? `${normalizedOrigin}/pair/${encodeURIComponent(pairing.code)}`
    : pairing.code
  const base = `npx -y @04515xyz/oasis-bridge@latest hermes ${pairingRef} --agent-slot=${HERMES_AGENT_SLOT} --label=${shellArg(agentLabel)}`
  if (!isLocalOasisOrigin(normalizedOrigin)) return base
  const relayHost = localRelayHostFromOrigin(normalizedOrigin)
  return `${base} --relay-url="ws://${relayHost}:4517/?role=agent"`
}

function buildHermesRelayPasteText(pairing: RelayPairingResult | null, origin: string, agentLabel = HERMES_AGENT_LABEL): string {
  if (!pairing) return ''
  return [
    `Connect this Hermes agent to Oasis as ${agentLabel.trim() || HERMES_AGENT_LABEL}.`,
    '',
    'If your Oasis/04515 skill is missing or stale, install or update it first:',
    'hermes skills install https://openclaw.04515.xyz/skill.md --name oasis-04515 --force',
    '',
    'Then run this bridge command:',
    buildHermesRelayCommand(pairing, origin, agentLabel),
    '',
    'Important: do not add --mcp-port=4516. The Hermes bridge uses 17891 by default.',
    'Keep that bridge process running. After it pairs, run /reload-mcp in an already-open Hermes chat if Oasis tools do not appear.',
  ].join('\n')
}

function hermesWindowSpawnPosition(): [number, number, number] {
  const state = useOasisStore.getState()
  const avatar = state.placedAgentAvatars.find(entry => entry.agentType === 'hermes')
  const avatarPosition = avatar
    ? state.transforms[avatar.id]?.position || avatar.position
    : null
  if (avatarPosition) {
    return [avatarPosition[0] + 1.65, Math.max(2.2, avatarPosition[1] + 1.45), avatarPosition[2] + 1.1]
  }

  const camera = getCameraSnapshot()
  if (camera) {
    return [
      camera.position[0] + camera.forward[0] * 3.8,
      Math.max(2.2, camera.position[1] - 0.25),
      camera.position[2] + camera.forward[2] * 3.8,
    ]
  }
  return [0, 2.2, 4]
}

function formatPairingCountdown(expiresAt: number, now: number): string {
  if (!expiresAt) return 'no code'
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  if (remaining <= 0) return 'expired'
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function relayStatusLabel(status: string) {
  switch (status) {
    case 'paired': return 'paired'
    case 'connected': return 'waiting'
    case 'connecting': return 'connecting'
    case 'reconnecting': return 'reconnecting'
    case 'error': return 'error'
    default: return 'idle'
  }
}

function copyText(value: string) {
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return Promise.resolve()
  return navigator.clipboard.writeText(value).catch(() => undefined)
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 45_000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function summarizeJson(value: unknown, maxLength = 120): string {
  if (value == null) return 'no args'
  let raw = ''
  if (typeof value === 'string') {
    raw = value.trim()
  } else {
    try { raw = JSON.stringify(value) || '' } catch { raw = String(value) }
  }
  if (!raw) return 'no args'
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 3)}...` : raw
}

function summarizeToolInput(toolName: string, value: unknown, maxLength = 118): string {
  const summary = summarizeJson(value, maxLength)
  if (!summary || summary === 'no args') return summary
  return summary.replace(/\s+/g, '').toLowerCase() === toolName.replace(/\s+/g, '').toLowerCase() ? '' : summary
}

function formatToolValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') {
    return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  }
  try {
    return JSON.stringify(value, null, 2) || ''
  } catch {
    return String(value)
  }
}

function formatShortTime(value: number): string {
  if (!Number.isFinite(value)) return ''
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function HermesToolMediaBubbles({ event }: { event: RelayToolEvent }) {
  const media: OpenclawMediaReference[] = collectOpenclawMediaReferences(event.output)
  if (media.length === 0) return null

  return (
    <div className="space-y-1 pl-2">
      {media.map((entry, index) => (
        <MediaBubble
          key={`${event.id}-media-${index}-${entry.path}`}
          url={entry.path}
          mediaType={entry.mediaType}
          prompt={`Hermes ${entry.mediaType}`}
          compact={entry.mediaType !== 'image'}
          autoPlay={false}
          galleryScopeId="hermes-relay-stream"
        />
      ))}
    </div>
  )
}

function HermesToolCallPill({
  event,
  expanded,
  onToggle,
}: {
  event: RelayToolEvent
  expanded: boolean
  onToggle: () => void
}) {
  const tone = event.state === 'done'
    ? {
        border: 'rgba(16,185,129,0.34)',
        background: 'rgba(6,78,59,0.18)',
        label: '[ok]',
        text: 'text-emerald-50/90',
      }
    : event.state === 'failed'
      ? {
          border: 'rgba(244,63,94,0.34)',
          background: 'rgba(127,29,29,0.18)',
          label: '[x]',
          text: 'text-rose-50/90',
        }
      : {
          border: 'rgba(250,204,21,0.32)',
          background: 'rgba(120,53,15,0.18)',
          label: '[...]',
          text: 'text-amber-50/90',
        }
  const inputSummary = summarizeToolInput(event.toolName, event.args)

  return (
    <div className="space-y-2">
      <button
        type="button"
        data-no-drag
        onClick={onToggle}
        className="w-full rounded-lg border px-3 py-2 text-left transition hover:brightness-125"
        style={{ borderColor: tone.border, background: tone.background }}
      >
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em]">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true">{tone.label}</span>
            <span className={`truncate ${tone.text}`}>{event.toolName || 'tool'}</span>
            {inputSummary && inputSummary !== 'no args' && (
              <span className="truncate text-amber-50/44">{inputSummary}</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-amber-50/38">
            {typeof event.durationMs === 'number' && <span>{event.durationMs}ms</span>}
            <span>{formatShortTime(event.timestamp)}</span>
          </div>
        </div>
        {expanded && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-amber-50/46">input</div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-5 text-amber-50/78">
{formatToolValue(event.args ?? {})}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-amber-50/46">output</div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-5 text-amber-50/78">
{formatToolValue(event.output ?? event.error ?? {})}
              </pre>
            </div>
          </div>
        )}
      </button>
      <HermesToolMediaBubbles event={event} />
    </div>
  )
}

export function HermesHostedRelayPanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
  showAdvancedDiagnostics = false,
  onOpenAdvancedDiagnostics,
}: HermesHostedRelayPanelProps) {
  useUILayer('hermes', isOpen && !embedded)

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('hermes', 9998))
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const hermesAvatar = useOasisStore(state => state.placedAgentAvatars.find(entry => entry.agentType === 'hermes') || null)
  const focusPanelUI = useCallback(() => {
    useInputManager.getState().enterUIFocus()
  }, [])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingAssistantIdRef = useRef('')
  const awardedConnectionXpRef = useRef(false)
  const dragRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)
  const restoredPairingRef = useRef('')
  const initialSessionIdRef = useRef('')
  if (!initialSessionIdRef.current) {
    initialSessionIdRef.current = readStoredSessionId() || randomId('hermes-relay-session')
  }
  const panelInstanceIdRef = useRef('')
  if (!panelInstanceIdRef.current) {
    panelInstanceIdRef.current = randomId('hermes-relay-panel')
  }
  const [sessionId, setSessionId] = useState(() => initialSessionIdRef.current)
  const [messages, setMessages] = useState<RelayChatMessage[]>(() => readStoredMessagesForSession(initialSessionIdRef.current))
  const [sessionSummaries, setSessionSummaries] = useState<HermesSessionSummary[]>(() => {
    const stored = readStoredSessionSummaries()
    if (stored.some(session => session.id === initialSessionIdRef.current)) return stored
    return [{ id: initialSessionIdRef.current, title: 'Current session', updatedAt: Date.now() }, ...stored].slice(0, 16)
  })
  const [toolEvents, setToolEvents] = useState<RelayToolEvent[]>([])
  const [expandedToolIds, setExpandedToolIds] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [pairing, setPairing] = useState<RelayPairingResult | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const [copied, setCopied] = useState('')
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [hideConnectedHero, setHideConnectedHero] = useState(false)
  const [panelSettings, setPanelSettings] = useState<HermesRelayPanelSettings>(() => readStoredPanelSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ left: 18, top: 132 })
  const [panelSize, setPanelSize] = useState({ width: 600, height: 680 })
  const [draggingPanel, setDraggingPanel] = useState(false)
  const [resizingPanel, setResizingPanel] = useState(false)
  const [buttonPose, setButtonPose] = useState({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })
  const [pastePose, setPastePose] = useState({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })
  const [streamActivityTick, setStreamActivityTick] = useState(0)
  const lastStreamActivityAtRef = useRef(Date.now())

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const agentLabel = panelSettings.agentLabel.trim() || HERMES_AGENT_LABEL
  const pairingPasteText = useMemo(() => buildHermesRelayPasteText(pairing, origin, agentLabel), [agentLabel, origin, pairing])
  const markStreamActivity = useCallback(() => {
    lastStreamActivityAtRef.current = Date.now()
    setStreamActivityTick(value => value + 1)
  }, [])
  const stopStreaming = useCallback((
    reason = 'Stopped locally. Hermes may still finish in the bridge process.',
    options: { releasePending?: boolean } = {},
  ) => {
    const assistantId = pendingAssistantIdRef.current
    const releasePending = options.releasePending !== false
    if (releasePending) pendingAssistantIdRef.current = ''
    setIsStreaming(false)
    if (!assistantId) return
    setMessages(previous => previous.map(message => {
      if (message.id !== assistantId) return message
      return {
        ...message,
        content: releasePending ? (message.content || reason) : message.content,
        error: reason,
      }
    }))
  }, [])
  const isVisible = embedded || isOpen
  const relayBridge = useSharedOpenclawRelayBridge({
    enabled: isVisible && relayEnabled && Boolean(activeWorldId),
    worldId: activeWorldId || '__active__',
    agentType: HERMES_AGENT_TYPE,
    agentSlot: HERMES_AGENT_SLOT,
    availableTools: HERMES_RELAY_TOOLS,
    onChatAgentDelta: event => {
      const assistantId = pendingAssistantIdRef.current
      if (!assistantId) return
      markStreamActivity()
      if (event.sessionId !== sessionId) {
        console.warn('[HermesRelay] accepting delta for pending assistant despite session mismatch', { eventSessionId: event.sessionId, sessionId })
      }
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? { ...message, content: message.content + event.text, error: undefined, timestamp: Date.now() }
          : message
      ))
    },
    onChatAgentFinal: event => {
      const assistantId = pendingAssistantIdRef.current
      if (!assistantId) return
      markStreamActivity()
      if (event.sessionId !== sessionId) {
        console.warn('[HermesRelay] accepting final for pending assistant despite session mismatch', { eventSessionId: event.sessionId, sessionId })
      }
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? { ...message, content: event.text || message.content, error: undefined, timestamp: Date.now() }
          : message
      ))
      pendingAssistantIdRef.current = ''
      setIsStreaming(false)
    },
    onToolCall: event => {
      markStreamActivity()
      setToolEvents(previous => {
        const withoutExisting = previous.filter(item => item.callId !== event.callId)
        const nextEvent: RelayToolEvent = {
          id: randomId('hermes-tool'),
          callId: event.callId,
          toolName: event.toolName,
          args: event.args,
          state: 'running',
          timestamp: Date.now(),
          worldId: event.worldId,
        }
        return [
          ...withoutExisting,
          nextEvent,
        ].slice(-32)
      })
    },
    onToolResult: event => {
      markStreamActivity()
      setToolEvents(previous => {
        const timestamp = Date.now()
        const existingIndex = previous.findIndex(item => item.callId === event.callId)
        const nextEvent: RelayToolEvent = {
          id: existingIndex >= 0 ? previous[existingIndex].id : randomId('hermes-tool'),
          callId: event.callId,
          toolName: event.toolName,
          args: existingIndex >= 0 ? previous[existingIndex].args : undefined,
          output: event.data,
          error: event.error?.message,
          state: event.ok ? 'done' : 'failed',
          timestamp,
          durationMs: event.durationMs,
          worldId: event.worldId,
        }
        const next = existingIndex >= 0
          ? previous.map((item, index) => index === existingIndex ? { ...item, ...nextEvent } : item)
          : [...previous, nextEvent]
        return next.slice(-32)
      })
    },
  })

  useAutoresizeTextarea(inputRef, input, { minPx: 48, maxPx: 180 })

  useEffect(() => {
    if (!isStreaming) return
    const idleFor = Date.now() - lastStreamActivityAtRef.current
    const timeoutMs = Math.max(1_000, HERMES_STREAM_IDLE_STALL_MS - idleFor)
    const timer = window.setTimeout(() => {
      stopStreaming('Hermes has been quiet locally for 10 minutes. Input is unlocked, but this bubble will still accept a late final if the bridge sends one.', { releasePending: false })
    }, timeoutMs)
    return () => window.clearTimeout(timer)
  }, [isStreaming, streamActivityTick, stopStreaming])

  useEffect(() => {
    const storedMessages = messages.slice(-80)
    writeBrowserStorage(`${CHAT_SESSION_KEY_PREFIX}${sessionId}`, JSON.stringify(storedMessages))
    writeBrowserStorage(CHAT_KEY, JSON.stringify(storedMessages))
    setSessionSummaries(previous => {
      const nextSummary: HermesSessionSummary = {
        id: sessionId,
        title: titleForHermesSession(storedMessages, sessionId),
        updatedAt: Date.now(),
      }
      const next = [nextSummary, ...previous.filter(session => session.id !== sessionId)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 16)
      saveStoredSessionSummaries(next)
      return next
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('oasis:hermes-relay-session', {
        detail: {
          source: panelInstanceIdRef.current,
          sessionId,
          messages: storedMessages,
        },
      }))
    }
  }, [messages, sessionId])

  useEffect(() => {
    writeBrowserStorage(SESSION_KEY, sessionId)
  }, [sessionId])

  useEffect(() => {
    const handleSessionSync = (event: Event) => {
      const custom = event as CustomEvent<{ source?: string; sessionId?: string; messages?: RelayChatMessage[] }>
      const detail = custom.detail
      if (!detail || detail.source === panelInstanceIdRef.current) return
      setSessionSummaries(readStoredSessionSummaries())
      if (detail.sessionId === sessionId && Array.isArray(detail.messages)) {
        const incoming = detail.messages.slice(-80)
        setMessages(previous => JSON.stringify(previous) === JSON.stringify(incoming) ? previous : incoming)
      }
    }
    window.addEventListener('oasis:hermes-relay-session', handleSessionSync)
    window.addEventListener('storage', handleSessionSync)
    return () => {
      window.removeEventListener('oasis:hermes-relay-session', handleSessionSync)
      window.removeEventListener('storage', handleSessionSync)
    }
  }, [sessionId])

  useEffect(() => {
    writeBrowserStorage(SETTINGS_KEY, JSON.stringify(panelSettings))
  }, [panelSettings])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, toolEvents, isStreaming])

  useEffect(() => {
    if (!pairing?.expiresAt) return
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairing?.expiresAt])

  useEffect(() => {
    if (!isVisible || !activeWorldId || pairing || relayBridge.status === 'paired') return
    const restoreKey = `${activeWorldId}:${HERMES_AGENT_SLOT}`
    if (restoredPairingRef.current === restoreKey) return
    restoredPairingRef.current = restoreKey

    let cancelled = false
    const params = new URLSearchParams({
      agentType: HERMES_AGENT_TYPE,
      agentSlot: HERMES_AGENT_SLOT,
      worldId: activeWorldId,
    })
    fetch(`/api/relay/pairings?${params.toString()}`, { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then((json: unknown) => {
        if (cancelled) return
        const pairings = (json as { pairings?: RelayPairingResult[] } | null)?.pairings
        const active = Array.isArray(pairings) ? pairings[0] : null
        if (active?.code && active.expiresAt > Date.now()) {
          setPairing(active)
          setRelayEnabled(true)
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [activeWorldId, isVisible, pairing, relayBridge.status])

  useEffect(() => {
    if (relayBridge.status === 'closed' || relayBridge.status === 'error') {
      if (isStreaming) {
        stopStreaming('Hermes relay disconnected locally. Input is unlocked; this bubble will still accept a late final if the bridge reconnects and sends one.', { releasePending: false })
      }
    }
  }, [isStreaming, relayBridge.status, stopStreaming])

  useEffect(() => {
    if (relayBridge.status !== 'paired' || awardedConnectionXpRef.current) return
    awardedConnectionXpRef.current = true
    void awardXp('QUEST_STEP_COMPLETE', activeWorldId || undefined)
    useAudioManager.getState().play('connected')
  }, [activeWorldId, relayBridge.status])

  useEffect(() => {
    if (relayBridge.status !== 'paired') {
      setHideConnectedHero(false)
      return
    }
    const timer = window.setTimeout(() => setHideConnectedHero(true), 5000)
    return () => window.clearTimeout(timer)
  }, [relayBridge.status])

  useEffect(() => {
    if (!draggingPanel) return
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current) return
      const nextLeft = dragRef.current.left + event.clientX - dragRef.current.startX
      const nextTop = dragRef.current.top + event.clientY - dragRef.current.startY
      const maxLeft = Math.max(8, window.innerWidth - 96)
      const maxTop = Math.max(8, window.innerHeight - 80)
      setPanelPosition({
        left: Math.min(maxLeft, Math.max(8, nextLeft)),
        top: Math.min(maxTop, Math.max(8, nextTop)),
      })
    }
    const handleUp = () => {
      dragRef.current = null
      setDraggingPanel(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [draggingPanel])

  useEffect(() => {
    if (!resizingPanel) return
    const handleMove = (event: MouseEvent) => {
      if (!resizeRef.current) return
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const maxWidth = Math.max(360, viewportWidth - panelPosition.left - 12)
      const maxHeight = Math.max(360, viewportHeight - panelPosition.top - 12)
      setPanelSize({
        width: Math.min(maxWidth, Math.max(420, resizeRef.current.width + event.clientX - resizeRef.current.startX)),
        height: Math.min(maxHeight, Math.max(420, resizeRef.current.height + event.clientY - resizeRef.current.startY)),
      })
    }
    const handleUp = () => {
      resizeRef.current = null
      setResizingPanel(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [panelPosition.left, panelPosition.top, resizingPanel])

  const startPanelDrag = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (embedded || event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-no-drag]')) return
    event.preventDefault()
    event.stopPropagation()
    useOasisStore.getState().bringPanelToFront('hermes')
    focusPanelUI()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      left: panelPosition.left,
      top: panelPosition.top,
    }
    setDraggingPanel(true)
  }, [embedded, focusPanelUI, panelPosition.left, panelPosition.top])

  const startPanelResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (embedded || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    useOasisStore.getState().bringPanelToFront('hermes')
    focusPanelUI()
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: panelSize.width,
      height: panelSize.height,
    }
    setResizingPanel(true)
  }, [embedded, focusPanelUI, panelSize.height, panelSize.width])

  const updatePanelSettings = useCallback((patch: Partial<HermesRelayPanelSettings>) => {
    setPanelSettings(current => ({ ...current, ...patch }))
  }, [])

  const manifestHermesAvatar = useCallback((avatarUrl?: string | null) => {
    const selectedAvatar = avatarUrl || hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl || DEFAULT_HERMES_AVATAR_URL
    let windowId = useOasisStore.getState().placedAgentWindows.find(entry => entry.agentType === 'hermes')?.id || ''
    if (!windowId) {
      windowId = 'agent-hermes-default'
      useOasisStore.getState().addAgentWindow({
        id: windowId,
        agentType: 'hermes',
        position: hermesWindowSpawnPosition(),
        rotation: [0, 0, 0],
        scale: 0.15,
        width: 800,
        height: 600,
        label: 'Hermes',
        renderMode: 'live-html',
        frameStyle: 'fire',
        frameThickness: 6,
      })
    }
    updatePanelSettings({ avatarUrl: selectedAvatar })
    useOasisStore.getState().assignSharedAgentAvatar('hermes', selectedAvatar, { preferredWindowId: windowId })
    useAudioManager.getState().play('place')
  }, [hermesAvatar?.avatar3dUrl, panelSettings.avatarUrl, updatePanelSettings])

  const openHermesWindowInspector = useCallback(() => {
    let windowId = useOasisStore.getState().placedAgentWindows.find(entry => entry.agentType === 'hermes')?.id || ''
    if (!windowId) {
      manifestHermesAvatar()
      windowId = 'agent-hermes-default'
    }

    const input = useInputManager.getState()
    if (input.inputState === 'agent-focus') input.returnToPrevious()
    if (input.pointerLocked) input.releasePointerLock()
    if (input.inputState === 'orbit' || input.inputState === 'noclip' || input.inputState === 'third-person') {
      input.enterUIFocus()
    }

    const store = useOasisStore.getState()
    store.selectObject(windowId)
    store.setInspectedObject(windowId)
    useAudioManager.getState().play('buttonClick')
  }, [manifestHermesAvatar])

  const updateButtonPose = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    setButtonPose({
      x,
      y,
      rx: (50 - y) * 0.34,
      ry: (x - 50) * 0.42,
      lift: 1,
    })
  }, [])

  const updatePastePose = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    setPastePose({
      x,
      y,
      rx: (50 - y) * 0.12,
      ry: (x - 50) * 0.14,
      lift: 1,
    })
  }, [])

  const flashCopied = useCallback((key: string) => {
    setCopied(key)
    window.setTimeout(() => setCopied(current => current === key ? '' : current), 1200)
  }, [])

  const requestPairing = useCallback(async () => {
    if (!activeWorldId) {
      setPairingError('active world is required')
      return
    }
    if (pairing && pairing.expiresAt > Date.now()) {
      setRelayEnabled(true)
      flashCopied('paste')
      void copyText(pairingPasteText)
      useAudioManager.getState().play('select')
      return
    }

    useAudioManager.getState().play('buttonClick')
    setPairingBusy(true)
    setPairingError('')
    try {
      const pairingRequest: RequestInit = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worldId: activeWorldId,
          scopes: HERMES_RELAY_SCOPES,
          agentType: HERMES_AGENT_TYPE,
          agentSlot: HERMES_AGENT_SLOT,
          agentLabel,
          reuseActive: true,
        }),
      }
      let response = await fetchWithTimeout('/api/relay/pairings', pairingRequest)
      if (response.status === 401) {
        const sessionResponse = await fetchWithTimeout('/api/session/init', { credentials: 'same-origin' })
        if (!sessionResponse.ok) throw new Error(`session init failed: HTTP ${sessionResponse.status}`)
        response = await fetchWithTimeout('/api/relay/pairings', pairingRequest)
      }
      const json = await response.json().catch(() => null) as
        | { ok: true; reused?: boolean; code: string; expiresAt: number; worldId: string; scopes: string[]; agentType?: string; agentSlot?: string; agentLabel?: string }
        | { ok: false; error: { code: string; message: string } }
        | null
      if (!json) throw new Error(`pairing failed: HTTP ${response.status}`)
      if (!json.ok) throw new Error(`${json.error.code}: ${json.error.message}`)

      setPairing({
        code: json.code,
        expiresAt: json.expiresAt,
        worldId: json.worldId,
        scopes: json.scopes,
        agentType: json.agentType,
        agentSlot: json.agentSlot,
        agentLabel: json.agentLabel,
        reused: 'reused' in json ? Boolean(json.reused) : false,
      })
      setRelayEnabled(true)
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error))
    } finally {
      setPairingBusy(false)
    }
  }, [activeWorldId, agentLabel, flashCopied, pairing, pairingPasteText])

  const startNewChat = useCallback(() => {
    pendingAssistantIdRef.current = ''
    setIsStreaming(false)
    const nextSessionId = randomId('hermes-relay-session')
    setSessionId(nextSessionId)
    setMessages([])
    setToolEvents([])
    setExpandedToolIds([])
    setInput('')
  }, [])

  const switchChatSession = useCallback((nextSessionId: string) => {
    if (!nextSessionId || nextSessionId === sessionId) return
    pendingAssistantIdRef.current = ''
    setIsStreaming(false)
    setSessionId(nextSessionId)
    setMessages(readStoredMessagesForSession(nextSessionId))
    setToolEvents([])
    setExpandedToolIds([])
    setInput('')
  }, [sessionId])

  const toggleToolExpanded = useCallback((toolId: string) => {
    setExpandedToolIds(previous => previous.includes(toolId)
      ? previous.filter(id => id !== toolId)
      : [...previous, toolId])
  }, [])

  const sendMessage = useCallback(() => {
    const prompt = input.trim()
    if (!prompt || isStreaming || relayBridge.status !== 'paired') return

    const userMessage: RelayChatMessage = {
      id: randomId('user'),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }
    const assistantId = randomId('assistant')
    const assistantMessage: RelayChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    pendingAssistantIdRef.current = assistantId
    markStreamActivity()
    setMessages(previous => [...previous, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)

    const sent = relayBridge.sendChatUser(sessionId, prompt)
    if (!sent) {
      pendingAssistantIdRef.current = ''
      setIsStreaming(false)
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? { ...message, error: 'Hermes relay is not paired.' }
          : message
      ))
    }
  }, [input, isStreaming, markStreamActivity, relayBridge, sessionId])

  const isPaired = relayBridge.status === 'paired'
  const canSend = isPaired && Boolean(input.trim()) && !isStreaming
  const canRequestPairing = Boolean(activeWorldId) && !pairingBusy
  const countdown = pairing && !isPaired ? formatPairingCountdown(pairing.expiresAt, countdownNow) : ''
  const relayLabel = relayStatusLabel(relayBridge.status)
  const relayBadgeClass = isPaired
    ? 'border-emerald-300/45 bg-emerald-400/12 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.24)]'
    : relayBridge.status === 'error' || relayBridge.status === 'closed'
      ? 'border-red-300/45 bg-red-500/10 text-red-100'
      : 'border-amber-400/25 text-amber-100/80'
  const timelineItems = useMemo(() => [
    ...messages.map((message, index) => ({
      kind: 'message' as const,
      id: message.id,
      timestamp: message.timestamp,
      order: message.role === 'assistant' ? 2 : 0,
      index,
      message,
    })),
    ...toolEvents.map((event, index) => ({
      kind: 'tool' as const,
      id: event.id,
      timestamp: event.timestamp,
      order: 1,
      index,
      event,
    })),
  ].sort((a, b) => (a.timestamp - b.timestamp) || (a.order - b.order) || (a.index - b.index)), [messages, toolEvents])
  const showPairingHero = !isPaired || !hideConnectedHero

  if (!isVisible || typeof document === 'undefined') return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const renderedPanelWidth = Math.min(panelSize.width, Math.max(420, viewportWidth - panelPosition.left - 12))
  const renderedPanelHeight = Math.min(panelSize.height, Math.max(420, viewportHeight - panelPosition.top - 12))

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'hermes-hosted-relay-panel'}
      data-ui-panel
      className={`${embedded ? 'relative h-full w-full' : 'fixed'} min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border border-amber-400/30 text-amber-50 shadow-2xl`}
      style={{
        zIndex: embedded ? undefined : panelZIndex,
        left: embedded ? undefined : panelPosition.left,
        top: embedded ? undefined : panelPosition.top,
        width: embedded ? '100%' : renderedPanelWidth,
        height: embedded ? '100%' : renderedPanelHeight,
        maxWidth: embedded ? undefined : 'calc(100vw - 16px)',
        maxHeight: embedded ? undefined : 'calc(100vh - 16px)',
        backgroundColor: panelSettings.bgColor,
        opacity: panelSettings.opacity,
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
        userSelect: draggingPanel || resizingPanel ? 'none' : 'auto',
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
        className={`flex items-center justify-between border-b border-white/10 bg-black/40 px-3 py-2 ${embedded ? '' : 'cursor-grab'} ${draggingPanel ? 'cursor-grabbing' : ''}`}
        onMouseDown={startPanelDrag}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-black tracking-[0.18em] text-amber-200 drop-shadow-[0_0_10px_rgba(251,191,36,0.65)]">HERMES</span>
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-mono transition ${relayBadgeClass}`}>
            {relayLabel}
          </span>
          {countdown && (
            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/65">
              {countdown}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {showAdvancedDiagnostics && (
            <button
              data-no-drag
              onClick={onOpenAdvancedDiagnostics}
              className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/75 hover:border-amber-300/35 hover:text-white"
            >
              advanced
            </button>
          )}
          <button
            data-no-drag
            onClick={() => setSettingsOpen(value => !value)}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/75 hover:border-cyan-300/40 hover:text-white"
          >
            settings
          </button>
          <button
            data-no-drag
            onClick={() => setRelayEnabled(value => !value)}
            disabled={!activeWorldId}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/75 hover:text-white disabled:opacity-40"
          >
            {relayEnabled ? 'stop relay' : 'start relay'}
          </button>
          {!hideCloseButton && (
            <button onClick={onClose} className="text-lg leading-none text-amber-100/80 hover:text-white" title="Close">
              x
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-white/10 bg-black/30 px-3 py-3">
        <div className="space-y-3">
          <div className="hidden">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-200/70">agent relay</div>
            <div className="mt-1 truncate text-[11px] text-amber-100/60" title={activeWorldId || ''}>
              world {activeWorldId ? activeWorldId.slice(0, 10) : 'none'}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-amber-100/45">
              tools {HERMES_RELAY_TOOLS.length} · calls {relayBridge.totalCalls} · active {relayBridge.inFlightCalls}
              {relayBridge.lastToolName ? ` · ${relayBridge.lastToolName}` : ''}
              {relayBridge.droppedCalls > 0 ? ` · dropped ${relayBridge.droppedCalls}` : ''}
            </div>
          </div>
          {showPairingHero && (
            <button
              data-no-drag
              onClick={() => { if (!isPaired) void requestPairing() }}
              onMouseMove={updateButtonPose}
              onMouseEnter={() => useAudioManager.getState().play('buttonHover')}
              onMouseLeave={() => setButtonPose({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })}
              disabled={!canRequestPairing && !isPaired}
              className={`group relative min-h-[126px] w-full overflow-hidden rounded-lg px-5 py-5 text-center transition duration-500 ${isPaired ? 'cursor-default border border-emerald-200/70 bg-emerald-400/20 shadow-[0_0_58px_rgba(16,185,129,0.32)] animate-[hermesConnectedSoftExit_5s_ease_forwards]' : 'cursor-pointer border border-amber-100/50 bg-amber-300/10 shadow-[0_0_42px_rgba(245,158,11,0.28)] hover:border-white hover:shadow-[0_0_80px_rgba(250,204,21,0.42)]'} disabled:cursor-not-allowed disabled:opacity-45`}
              style={{
                '--mx': `${buttonPose.x}%`,
                '--my': `${buttonPose.y}%`,
                transform: `perspective(760px) rotateX(${buttonPose.rx}deg) rotateY(${buttonPose.ry}deg) translateY(${buttonPose.lift ? -3 : 0}px) scale(${buttonPose.lift ? 1.018 : 1})`,
                transformStyle: 'preserve-3d',
              } as CSSProperties}
            >
              <span className="absolute inset-0 opacity-95" style={{
                background: isPaired
                  ? 'linear-gradient(110deg, rgba(16,185,129,0.28), rgba(45,212,191,0.22), rgba(250,204,21,0.18))'
                  : 'linear-gradient(110deg, rgba(255,0,128,0.30), rgba(250,204,21,0.24), rgba(34,211,238,0.24), rgba(168,85,247,0.26))',
              }} />
              <span className="absolute inset-[-35%] animate-[hermesConnectSpin_5s_linear_infinite] opacity-75" style={{
                background: 'conic-gradient(from 0deg, transparent, rgba(255,255,255,0.42), transparent, rgba(251,191,36,0.34), transparent)',
              }} />
              <span className="absolute inset-0 opacity-0 transition group-hover:opacity-100" style={{
                background: 'radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.62), rgba(255,255,255,0.16) 18%, transparent 44%)',
              }} />
              <span className={`absolute inset-2 rounded-md border ${isPaired ? 'border-emerald-100/32' : 'border-white/24'} shadow-[inset_0_0_32px_rgba(255,255,255,0.16)]`} />
              <span className={`relative block text-[24px] font-black uppercase tracking-[0.22em] ${isPaired ? 'text-emerald-50 drop-shadow-[0_0_18px_rgba(52,211,153,0.95)]' : 'text-white drop-shadow-[0_0_18px_rgba(251,191,36,0.96)]'}`}>
                {isPaired ? 'HERMES CONNECTED' : pairingBusy ? 'SUMMONING HERMES' : 'CONNECT HERMES'}
              </span>
              <span className="relative mt-2 block text-[10px] uppercase tracking-[0.18em] text-amber-100/58">
                {isPaired ? 'chat, tools, and XP online' : activeWorldId ? 'one click pairing ritual' : 'load a world first'}
              </span>
            </button>
          )}
        </div>

        {pairing && relayBridge.status !== 'paired' && (
          <div className="mt-2 space-y-2">
            <button
              data-no-drag
              onClick={() => { void copyText(pairing.code); flashCopied('code') }}
              className="w-full rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-left font-mono text-[12px] text-amber-50 transition hover:border-amber-300/35"
            >
              {copied === 'code' ? 'copied ' : ''}{pairing.code}
            </button>
            <button
              data-no-drag
              onClick={() => {
                useAudioManager.getState().play('notification')
                void copyText(pairingPasteText)
                flashCopied('paste')
              }}
              onMouseMove={updatePastePose}
              onMouseEnter={() => useAudioManager.getState().play('buttonHover')}
              onMouseLeave={() => setPastePose({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })}
              className="group relative w-full overflow-hidden rounded-lg border border-cyan-200/25 bg-black/40 px-3 py-2 text-left transition duration-150 hover:border-cyan-100 hover:shadow-[0_0_38px_rgba(34,211,238,0.24)]"
              style={{
                '--px': `${pastePose.x}%`,
                '--py': `${pastePose.y}%`,
                transform: `perspective(760px) rotateX(${pastePose.rx}deg) rotateY(${pastePose.ry}deg) translateY(${pastePose.lift ? -2 : 0}px)`,
                transformStyle: 'preserve-3d',
              } as CSSProperties}
            >
              <span
                className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100"
                style={{
                  background: 'radial-gradient(circle at var(--px) var(--py), rgba(255,255,255,0.42), rgba(34,211,238,0.15) 22%, transparent 52%)',
                }}
              />
              <span className="pointer-events-none absolute inset-x-[-40%] top-0 h-px bg-gradient-to-r from-transparent via-cyan-200 to-transparent opacity-80 transition group-hover:translate-x-1/3" />
              <span className="relative flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/78">
                <span>paste into Hermes</span>
                <span className="rounded border border-cyan-200/25 px-2 py-0.5 text-[9px] text-white/85">
                  {copied === 'paste' ? 'copied' : 'copy text'}
                </span>
              </span>
              <span className="relative mt-2 block max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/34 p-2 font-mono text-[11px] leading-5 text-amber-50/88">
                {pairingPasteText}
              </span>
            </button>
          </div>
        )}

        {(pairingError || relayBridge.lastError) && (
          <div className="mt-2 rounded border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">
            {pairingError || relayBridge.lastError}
          </div>
        )}
      </div>

      {settingsOpen && (
        <div data-no-drag className="border-b border-white/10 bg-black/50 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-[10px] uppercase tracking-[0.16em] text-amber-100/62">
              Agent name
              <input
                type="text"
                value={panelSettings.agentLabel}
                maxLength={48}
                onChange={event => updatePanelSettings({ agentLabel: event.target.value })}
                className="mt-1 h-9 w-full rounded border border-white/10 bg-black/40 px-2 text-[12px] normal-case tracking-normal text-amber-50 outline-none focus:border-cyan-200/45"
              />
            </label>
            <label className="min-w-0 text-[10px] uppercase tracking-[0.16em] text-amber-100/62">
              Background
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={panelSettings.bgColor}
                  onChange={event => updatePanelSettings({ bgColor: event.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-black"
                />
                <span className="truncate font-mono text-[11px] text-amber-50/80">{panelSettings.bgColor}</span>
              </div>
            </label>
            <label className="min-w-0 text-[10px] uppercase tracking-[0.16em] text-amber-100/62">
              Opacity
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="range"
                  min="0.55"
                  max="1"
                  step="0.01"
                  value={panelSettings.opacity}
                  onChange={event => updatePanelSettings({ opacity: Number(event.target.value) })}
                  className="min-w-0 flex-1 accent-emerald-400"
                />
                <span className="w-10 text-right font-mono text-[11px] text-amber-50/80">{Math.round(panelSettings.opacity * 100)}%</span>
              </div>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              data-no-drag
              onClick={() => setShowAvatarGallery(true)}
              className="rounded border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-50 transition hover:border-cyan-100 hover:bg-cyan-300/20"
            >
              avatar
            </button>
            <button
              data-no-drag
              onClick={() => manifestHermesAvatar()}
              className="rounded border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-50 transition hover:border-emerald-100 hover:bg-emerald-300/20"
            >
              place 3D Hermes
            </button>
            <button
              data-no-drag
              onClick={openHermesWindowInspector}
              className="rounded border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-fuchsia-50 transition hover:border-fuchsia-100 hover:bg-fuchsia-300/20"
            >
              advanced
            </button>
            <span className="min-w-0 truncate text-[11px] text-amber-100/50">
              {hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl || DEFAULT_HERMES_AVATAR_URL}
            </span>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}>
        {timelineItems.length === 0 && (
          <div className="flex h-full flex-col justify-center px-4 text-center">
            <div className="text-sm text-amber-100">
              {isPaired ? 'Hermes is connected!' : 'Hermes is waiting to pair.'}
            </div>
            <div className="mt-2 text-xs leading-5 text-amber-100/62">
              {isPaired
                ? 'Chat and Oasis tools are online in this window.'
                : 'Mint a code, paste the command into Hermes, then chat and Oasis tools come online here.'}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {timelineItems.map(item => {
            if (item.kind === 'tool') {
              return (
                <HermesToolCallPill
                  key={item.id}
                  event={item.event}
                  expanded={expandedToolIds.includes(item.event.id)}
                  onToggle={() => toggleToolExpanded(item.event.id)}
                />
              )
            }
            const message = item.message
            return (
              <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className="max-w-[88%] rounded-lg px-3 py-2 text-xs leading-relaxed break-words"
                  style={{
                    background: message.role === 'user' ? 'rgba(245,158,11,0.16)' : 'rgba(0,0,0,0.48)',
                    border: message.role === 'user' ? '1px solid rgba(245,158,11,0.22)' : '1px solid rgba(255,255,255,0.06)',
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  <div className="whitespace-pre-wrap">
                    {message.content ? renderMarkdown(message.content) : (message.role === 'assistant' && isStreaming ? 'Streaming...' : '')}
                  </div>
                  {message.error && <div className="mt-2 text-red-200">{message.error}</div>}
                </div>
              </div>
            )
          })}
        </div>
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-white/10 bg-black/35 px-3 py-2">
        <div className="mb-2 flex items-center gap-2">
          <select
            data-no-drag
            value={sessionId}
            onChange={event => switchChatSession(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/45 px-2 py-1.5 text-[11px] text-amber-50 outline-none hover:border-amber-300/35"
          >
            {sessionSummaries.map(session => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
          <button
            data-no-drag
            onClick={startNewChat}
            className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-50 transition hover:border-cyan-100 hover:bg-cyan-300/20"
          >
            new session
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            data-no-drag
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage()
              }
            }}
            rows={3}
            maxLength={6000}
            disabled={relayBridge.status !== 'paired'}
            placeholder={relayBridge.status === 'paired' ? 'Talk to Hermes...' : 'Pair Hermes first...'}
            className="min-h-[48px] min-w-0 flex-1 resize-none rounded-lg border border-amber-500/20 bg-white/[0.06] px-3 py-2 text-xs text-white outline-none placeholder:text-amber-100/45 disabled:opacity-60"
          />
          <button
            data-no-drag
            onClick={isStreaming ? () => stopStreaming() : sendMessage}
            disabled={isStreaming ? false : !canSend}
            className={`rounded-lg border px-3 py-2 text-xs font-bold text-white transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-30 ${
              isStreaming
                ? 'border-red-400/35 bg-red-500/35'
                : 'border-amber-500/30 bg-amber-500/35'
            }`}
            style={{ minWidth: 70 }}
          >
            {isStreaming ? 'stop' : 'send'}
          </button>
        </div>
      </div>
      {!embedded && (
        <button
          data-no-drag
          aria-label="Resize Hermes panel"
          onMouseDown={startPanelResize}
          className="absolute bottom-1 right-1 h-5 w-5 cursor-nwse-resize rounded border border-white/10 bg-white/[0.04] text-[10px] text-amber-100/50 hover:border-cyan-200/40 hover:text-cyan-100"
        >
          /
        </button>
      )}
      <style>{`
        @keyframes hermesConnectSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes hermesConnectedSoftExit {
          0%, 74% { opacity: 1; filter: saturate(1.12) brightness(1); }
          88% { opacity: 0.88; filter: saturate(1.6) brightness(1.35); transform: translateY(-2px) scale(1.012); }
          100% { opacity: 0; max-height: 0; min-height: 0; padding-top: 0; padding-bottom: 0; margin: 0; border-width: 0; }
        }
      `}</style>
      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl}
          onSelect={avatarUrl => {
            manifestHermesAvatar(avatarUrl || DEFAULT_HERMES_AVATAR_URL)
            setShowAvatarGallery(false)
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
