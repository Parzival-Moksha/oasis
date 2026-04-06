'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

import { useOasisStore } from '@/store/oasisStore'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { CollapsibleBlock, renderMarkdown } from '@/lib/anorak-renderers'
import { collapseDuplicateHermesMessages, mergeHydratedHermesMessages } from '@/lib/hermes-message-merge'
import { MediaBubble, type MediaType } from './MediaBubble'

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
}

interface HermesStatus {
  configured: boolean
  connected: boolean
  base: string | null
  defaultModel: string | null
  models: string[]
  source?: 'pairing' | 'env' | 'none'
  canMutateConfig?: boolean
  error?: string
}

interface HermesTunnelStatus {
  configured: boolean
  running: boolean
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
const DEFAULT_SETTINGS: PanelSettings = { bgColor: '#120c04', opacity: 0.92, blur: 0 }
const DEFAULT_STATUS: HermesStatus = { configured: false, connected: false, base: null, defaultModel: null, models: [] }
const DEFAULT_TUNNEL_STATUS: HermesTunnelStatus = { configured: false, running: false, command: '', autoStart: true }

const POS_KEY = 'oasis-hermes-pos'
const SIZE_KEY = 'oasis-hermes-size'
const SETTINGS_KEY = 'oasis-hermes-settings'
const DETAILS_KEY = 'oasis-hermes-details'
const CHAT_KEY = 'oasis-hermes-chat-history'
const SESSION_KEY = 'oasis-hermes-session'
const VOICE_OUTPUT_KEY = 'oasis-hermes-voice-output'
const NATIVE_SESSION_CACHE_KEY = 'oasis-hermes-native-session-cache'
const NEW_SESSION_VALUE = '__oasis_new__'
const CONNECTION_HINT = `HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=your_secret_here
HERMES_MODEL=optional_model_id`
const TUNNEL_HINT = 'ssh -L 8642:127.0.0.1:8642 user@your-vps -N'

function readStoredMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((entry): entry is ChatMessage => {
        if (!entry || typeof entry !== 'object') return false
        const obj = entry as Record<string, unknown>
        return (
          (obj.role === 'user' || obj.role === 'assistant') &&
          typeof obj.id === 'string' &&
          typeof obj.content === 'string'
        )
      })
      .slice(-60)
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
      content: entry.content,
      reasoning: entry.reasoning,
      tools: Array.isArray(entry.tools) ? entry.tools : undefined,
      usage: entry.usage,
      finishReason: entry.finishReason,
      error: entry.error,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
    }))
    .slice(-80)
}

function readNativeSessionCache(sessionId: string): ChatMessage[] {
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

function writeNativeSessionCache(sessionId: string, messages: ChatMessage[]) {
  if (typeof window === 'undefined' || !sessionId) return

  try {
    const raw = localStorage.getItem(NATIVE_SESSION_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    const next: Record<string, unknown> = parsed && typeof parsed === 'object' ? parsed : {}
    next[sessionId] = sanitizeCachedMessages(messages)

    const orderedEntries = Object.entries(next)
    while (orderedEntries.length > 24) {
      const [oldestKey] = orderedEntries.shift() || []
      if (oldestKey) delete next[oldestKey]
    }

    localStorage.setItem(NATIVE_SESSION_CACHE_KEY, JSON.stringify(next))
  } catch {
    // Ignore storage errors.
  }
}

function formatToolName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function prettyToolArguments(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '(streaming tool arguments...)'
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

function detectHermesMediaType(path: string): MediaType | null {
  const normalized = normalizeHermesMediaPath(path)
  if (/\.(?:mp3|wav|ogg|oga|opus|m4a)(?:\?|$)/i.test(normalized)) return 'audio'
  if (/\.(?:png|jpg|jpeg|gif|webp)(?:\?|$)/i.test(normalized)) return 'image'
  if (/\.(?:mp4|webm|m4v)(?:\?|$)/i.test(normalized)) return 'video'
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

function extractHermesMediaReferences(content: string): HermesMediaReference[] {
  const refs: HermesMediaReference[] = []

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('MEDIA:')) continue

    const path = normalizeHermesMediaPath(trimmed.slice('MEDIA:'.length))
    const mediaType = detectHermesMediaType(path)
    if (!path || !mediaType) continue

    refs.push({
      path,
      mediaType,
    })
  }

  return refs
}

function HermesRemoteAudioBubble({
  mediaUrl,
  prompt,
  autoPlay,
}: {
  mediaUrl: string
  prompt: string
  autoPlay: boolean
}) {
  const [blobUrl, setBlobUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
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
        setBlobUrl(objectUrl)
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
  }, [mediaUrl, retryNonce])

  if (loading) {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-black/35 px-3 py-3">
        <div className="text-[11px] text-amber-100">Loading Hermes audio...</div>
      </div>
    )
  }

  if (error || !blobUrl) {
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

  return <MediaBubble url={blobUrl} mediaType="audio" prompt={prompt} compact autoPlay={autoPlay} />
}

function renderHermesAssistantContent(content: string, autoPlayAudio: boolean): React.ReactNode {
  const blocks: React.ReactNode[] = []
  const textBuffer: string[] = []
  let key = 0

  const flushText = () => {
    const text = textBuffer
      .filter(line => !isHermesControlLine(line))
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
        flushText()
        if (mediaType === 'audio') {
          const mediaUrl = buildHermesMediaUrl(path)
          const useRemoteFetch = !isDirectHermesMediaUrl(path)
          blocks.push(
            useRemoteFetch ? (
              <HermesRemoteAudioBubble
                key={`media-${key += 1}`}
                mediaUrl={mediaUrl}
                prompt="Hermes audio"
                autoPlay={autoPlayAudio}
              />
            ) : (
              <MediaBubble
                key={`media-${key += 1}`}
                url={mediaUrl}
                mediaType="audio"
                prompt="Hermes audio"
                compact
                autoPlay={autoPlayAudio}
              />
            )
          )
        } else {
          blocks.push(
            <MediaBubble
              key={`media-${key += 1}`}
              url={buildHermesMediaUrl(path)}
              mediaType={mediaType}
              prompt={`Hermes ${mediaType}`}
              compact
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
    return renderMarkdown(content)
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

function SettingsDropdown({ settings, onChange }: { settings: PanelSettings; onChange: (next: PanelSettings) => void }) {
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
      </div>
    </div>
  )
}

function ToolDetails({ tool }: { tool: HermesToolCall }) {
  const label = summarizeToolArguments(tool.arguments)
  return (
    <CollapsibleBlock
      label={label ? `${formatToolName(tool.name)} - ${label}` : formatToolName(tool.name)}
      icon="[]"
      content={prettyToolArguments(tool.arguments)}
      accentColor="rgba(245,158,11,0.38)"
      compact
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

export function HermesPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useUILayer('hermes', isOpen)

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('hermes', 9998))
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const autoConnectTriedRef = useRef(false)
  const lastHydratedSessionIdRef = useRef('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])

  const [messages, setMessages] = useState<ChatMessage[]>(() => readStoredMessages())
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
  const [showConnectionModal, setShowConnectionModal] = useState(false)
  const [connectionInput, setConnectionInput] = useState('')
  const [tunnelInput, setTunnelInput] = useState('')
  const [tunnelAutoStart, setTunnelAutoStart] = useState(true)
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [voiceInputSupported, setVoiceInputSupported] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceTranscribing, setVoiceTranscribing] = useState(false)
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(VOICE_OUTPUT_KEY) === 'true' } catch { return false }
  })
  const [voiceError, setVoiceError] = useState('')
  const [autoPlayMediaMessageId, setAutoPlayMediaMessageId] = useState('')
  const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })

  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null') || DEFAULT_POS } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SIZE
    try { return JSON.parse(localStorage.getItem(SIZE_KEY) || 'null') || DEFAULT_SIZE } catch { return DEFAULT_SIZE }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

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
          defaultModel: null,
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
          defaultModel: typeof data?.defaultModel === 'string' ? data.defaultModel : null,
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
        defaultModel: null,
        models: [],
        error: error instanceof Error ? error.message : 'Unable to check Hermes status.',
      })
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const stopRecordingStream = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
    recordingStreamRef.current = null
  }, [])

  const transcribeRecordedAudio = useCallback(async (audioBlob: Blob, fileName: string) => {
    setVoiceTranscribing(true)
    setVoiceError('')

    try {
      const form = new FormData()
      form.append('audio', audioBlob, fileName)

      const response = await fetch('/api/hermes/transcribe', {
        method: 'POST',
        body: form,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const transcript = typeof data?.transcript === 'string' ? data.transcript.trim() : ''
      if (!transcript) {
        throw new Error('Hermes returned an empty transcript.')
      }

      setInput(current => joinPrompt(current, transcript))
      window.setTimeout(() => inputRef.current?.focus(), 80)
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Voice transcription failed.')
    } finally {
      setVoiceTranscribing(false)
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

      const nextSessions: HermesNativeSessionSummary[] = Array.isArray(data?.sessions)
        ? data.sessions.filter((entry: unknown): entry is HermesNativeSessionSummary => {
            if (!entry || typeof entry !== 'object') return false
            const item = entry as Record<string, unknown>
            return typeof item.id === 'string'
          })
        : []

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

        if (!next && keepNew) {
          next = NEW_SESSION_VALUE
        }

        if (!next) {
          next = nextSessions[0]?.id || NEW_SESSION_VALUE
        }

        try {
          localStorage.setItem(SESSION_KEY, next)
        } catch {
          // Ignore storage errors.
        }

        return next
      })
    } catch (error) {
      setNativeSessionsAvailable(false)
      setSessions([])
      setSessionsError(error instanceof Error ? error.message : 'Unable to load Hermes sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }, [status.connected, tunnelStatus.configured])

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
      const response = await fetch(`/api/hermes/sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.available === false) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const remoteMessages: ChatMessage[] = Array.isArray(data?.messages)
        ? data.messages
            .filter((entry: unknown): entry is ChatMessage => {
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
              content: entry.content,
              reasoning: entry.reasoning,
              tools: Array.isArray(entry.tools) ? entry.tools : undefined,
              usage: entry.usage,
              finishReason: entry.finishReason,
              error: entry.error,
              timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
            }))
        : []

      const cachedMessages = options?.mergeMessages?.length
        ? mergeHydratedHermesMessages(remoteMessages, options.mergeMessages)
        : mergeHydratedHermesMessages(remoteMessages, readNativeSessionCache(sessionId))

      const nextMessages = collapseDuplicateHermesMessages(cachedMessages)
      setMessages(nextMessages)
      setAutoScroll(true)
      writeNativeSessionCache(sessionId, nextMessages)
      return nextMessages
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : 'Unable to load the selected Hermes session.')
      const fallbackMessages = options?.mergeMessages || readNativeSessionCache(sessionId)
      if (fallbackMessages.length) {
        setMessages(fallbackMessages)
        return fallbackMessages
      }
      return []
    } finally {
      setSessionHydrating(false)
    }
  }, [])

  const toggleVoiceInput = useCallback(async () => {
    if (voiceListening) {
      mediaRecorderRef.current?.stop()
      return
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setVoiceError('Mic input needs localhost or HTTPS. Open Oasis locally or behind HTTPS and try again.')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Browser microphone capture is unavailable here.')
      return
    }

    setVoiceError('')

    try {
      const permissionStatus = typeof navigator.permissions?.query === 'function'
        ? await navigator.permissions.query({ name: 'microphone' as PermissionName })
        : null
      if (permissionStatus?.state === 'denied') {
        setVoiceError('Microphone access is blocked in the browser. In Brave, click the lock icon in the address bar and allow the microphone for this site.')
        return
      }
    } catch {
      // Permissions API is optional.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream

      const recorderMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ].find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) || ''

      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream)

      recordedChunksRef.current = []
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setVoiceListening(false)
        stopRecordingStream()
        setVoiceError('Microphone recording failed.')
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || recorderMimeType || 'audio/webm'
        const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm'
        const audioBlob = new Blob(recordedChunksRef.current, { type: mimeType })
        recordedChunksRef.current = []
        mediaRecorderRef.current = null
        setVoiceListening(false)
        stopRecordingStream()

        if (audioBlob.size > 0) {
          void transcribeRecordedAudio(audioBlob, `oasis-voice.${extension}`)
        }
      }

      recorder.start()
      setVoiceListening(true)
    } catch (error) {
      stopRecordingStream()
      const message = error instanceof Error ? error.message : 'Microphone permission was denied.'
      setVoiceListening(false)
      setVoiceError(message)
    }
  }, [stopRecordingStream, transcribeRecordedAudio, voiceListening])

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
      }

      let connected = false
      let lastError = ''
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch('/api/hermes', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (response.ok && data?.connected) {
          connected = true
          break
        }
        lastError = typeof data?.error === 'string' ? data.error : lastError
        if (attempt < 5) {
          await new Promise(resolve => window.setTimeout(resolve, 450))
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
    setShowConnectionModal(true)
  }, [])

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
      if (nextConnection) {
        const response = await fetch('/api/hermes/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairing: nextConnection }),
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
      try {
        localStorage.removeItem(CHAT_KEY)
      } catch {}
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
    setVoiceInputSupported(
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    )
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      autoConnectTriedRef.current = false
      setShowConnectionModal(false)
      setShowSettings(false)
      recordedChunksRef.current = []
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      stopRecordingStream()
      setVoiceListening(false)
      return
    }
  }, [isOpen, stopRecordingStream])

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
    }
  }, [messages, isStreaming, autoScroll])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (nativeSessionsAvailable) return
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-60)))
    } catch {
      // Ignore storage errors.
    }
  }, [messages, nativeSessionsAvailable])

  useEffect(() => {
    if (!nativeSessionsAvailable) return
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_VALUE) return
    if (sessionHydrating) return
    if (!isStreaming && lastHydratedSessionIdRef.current !== selectedSessionId) return
    writeNativeSessionCache(selectedSessionId, messages)
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
    try {
      localStorage.setItem(VOICE_OUTPUT_KEY, String(voiceOutputEnabled))
    } catch {
      // Ignore storage errors.
    }
  }, [voiceOutputEnabled])

  useEffect(() => {
    if (!isOpen || !status.connected || !tunnelStatus.configured) return
    void loadSessions()
  }, [isOpen, loadSessions, status.connected, tunnelStatus.configured])

  useEffect(() => {
    if (status.connected && tunnelStatus.configured) return
    setNativeSessionsAvailable(false)
    setSessions([])
    setSessionHydrating(false)
    lastHydratedSessionIdRef.current = ''
  }, [status.connected, tunnelStatus.configured])

  useEffect(() => {
    if (!nativeSessionsAvailable) return
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_VALUE) {
      lastHydratedSessionIdRef.current = selectedSessionId || NEW_SESSION_VALUE
      setAutoPlayMediaMessageId('')
      setMessages([])
      setAutoScroll(true)
      return
    }

    if (isStreaming) return
    if (lastHydratedSessionIdRef.current === selectedSessionId && messages.length > 0) return

    lastHydratedSessionIdRef.current = selectedSessionId
    void hydrateSession(selectedSessionId)
  }, [hydrateSession, isStreaming, messages.length, nativeSessionsAvailable, selectedSessionId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!selectedSessionId) return
    try {
      localStorage.setItem(SESSION_KEY, selectedSessionId)
    } catch {
      // Ignore storage errors.
    }
  }, [selectedSessionId])

  useEffect(() => {
    if (voiceOutputEnabled) return
    setAutoPlayMediaMessageId('')
  }, [voiceOutputEnabled])

  useEffect(() => {
    return () => {
      recordedChunksRef.current = []
      mediaRecorderRef.current?.stop()
      mediaRecorderRef.current = null
      stopRecordingStream()
    }
  }, [stopRecordingStream])

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
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, select, option, a, [data-no-drag]')) return

    event.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: event.clientX - position.x, y: event.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((event: MouseEvent) => {
    if (!isDragging) return
    const nextPos = {
      x: event.clientX - dragStart.current.x,
      y: Math.max(-8, event.clientY - dragStart.current.y),
    }
    setPosition(nextPos)
    localStorage.setItem(POS_KEY, JSON.stringify(nextPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: event.clientX, y: event.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((event: MouseEvent) => {
    if (!isResizing) return
    const nextSize = {
      w: Math.max(MIN_WIDTH, resizeStart.current.w + (event.clientX - resizeStart.current.x)),
      h: Math.max(MIN_HEIGHT, resizeStart.current.h + (event.clientY - resizeStart.current.y)),
    }
    setSize(nextSize)
    localStorage.setItem(SIZE_KEY, JSON.stringify(nextSize))
  }, [isResizing])

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
  }, [handleDrag, handleDragEnd, handleResize, handleResizeEnd, isDragging, isResizing])

  const updatePanelSettings = useCallback((next: PanelSettings) => {
    setPanelSettings(next)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  }, [])

  const toggleDetails = useCallback(() => {
    setShowDetails(current => {
      const next = !current
      try { localStorage.setItem(DETAILS_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    setAutoPlayMediaMessageId('')

    if (nativeSessionsAvailable) {
      lastHydratedSessionIdRef.current = NEW_SESSION_VALUE
      setSelectedSessionId(NEW_SESSION_VALUE)
      setMessages([])
      setAutoScroll(true)
      return
    }

    setMessages([])
    try {
      localStorage.removeItem(CHAT_KEY)
    } catch {}
  }, [nativeSessionsAvailable])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const sendMessage = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming || !status.connected) return

    const useNativeSessions = nativeSessionsAvailable
    const sessionIdForRequest = useNativeSessions && selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE
      ? selectedSessionId
      : ''
    const history = useNativeSessions
      ? []
      : messages.map(message => ({
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

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          history,
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
      let resolvedSessionId = sessionIdForRequest
      const toolMap = new Map<number, HermesToolCall>()

      for await (const event of parseHermesSSE(response)) {
        if (controller.signal.aborted) break

        switch (event.type) {
          case 'text':
            assistantText += event.content
            break
          case 'reasoning':
            assistantReasoning += event.content
            break
          case 'tool': {
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
            break
          case 'error':
            assistantError = event.message
            break
          case 'meta':
            if (event.sessionId) {
              resolvedSessionId = event.sessionId
              setSelectedSessionId(event.sessionId)
            }
            break
        }

        const orderedTools = Array.from(toolMap.values()).sort((left, right) => left.index - right.index)
        setMessages(previous => previous.map(message =>
          message.id === assistantId
            ? {
                ...message,
                content: assistantText,
                reasoning: assistantReasoning || undefined,
                tools: orderedTools.length ? orderedTools : undefined,
                usage: assistantUsage,
                finishReason,
                error: assistantError,
              }
            : message
        ))
      }

      const finalAssistantMessage: ChatMessage = {
        ...assistantMessage,
        content: assistantText,
        reasoning: assistantReasoning || undefined,
        tools: Array.from(toolMap.values()).sort((left, right) => left.index - right.index),
        usage: assistantUsage,
        finishReason,
        error: assistantError,
      }

      let voiceTargetMessage = finalAssistantMessage
      if (useNativeSessions && resolvedSessionId) {
        const mergedMessages = await hydrateSession(resolvedSessionId, {
          mergeMessages: [...messages, userMessage, finalAssistantMessage],
        })
        const mergedAssistant = [...mergedMessages].reverse().find(message => message.role === 'assistant')
        if (mergedAssistant) {
          voiceTargetMessage = mergedAssistant
        }
        lastHydratedSessionIdRef.current = resolvedSessionId
        void loadSessions(resolvedSessionId)
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
      if ((error as Error).name === 'AbortError') return
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
    input,
    isStreaming,
    loadSessions,
    messages,
    nativeSessionsAvailable,
    selectedSessionId,
    status.connected,
    voiceOutputEnabled,
  ])

  if (!isOpen || typeof document === 'undefined') return null

  const rgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(part => parseInt(part, 16)) || [18, 12, 4]
  const backgroundStyle = panelSettings.blur > 0 && panelSettings.opacity < 1
    ? {
        backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})`,
        backdropFilter: `blur(${panelSettings.blur}px)`,
      }
    : { backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})` }

  const canSend = status.connected && Boolean(input.trim()) && !isStreaming
  const canMutateAnyConfig = Boolean(status.canMutateConfig || tunnelStatus.canMutateConfig)
  const tunnelLabel = tunnelStatus.running
    ? 'ssh running'
    : tunnelStatus.configured
      ? tunnelStatus.autoStart
        ? 'ssh saved'
        : 'ssh manual'
      : 'direct'
  const sessionValue = nativeSessionsAvailable ? (selectedSessionId || sessions[0]?.id || NEW_SESSION_VALUE) : NEW_SESSION_VALUE
  const activeSession = sessions.find(session => session.id === sessionValue) || null

  return createPortal(
    <div
      data-menu-portal="hermes-panel"
      data-ui-panel
      className="fixed rounded-xl flex flex-col overflow-hidden"
      style={{
        zIndex: panelZIndex,
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        userSelect: isDragging || isResizing ? 'none' : 'auto',
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
        useOasisStore.getState().bringPanelToFront('hermes')
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div
        data-drag-handle
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
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
            onClick={() => {
              void loadStatus()
              if (status.connected && tunnelStatus.configured) {
                lastHydratedSessionIdRef.current = ''
                void loadSessions(selectedSessionId || undefined)
                if (selectedSessionId && selectedSessionId !== NEW_SESSION_VALUE && !isStreaming) {
                  void hydrateSession(selectedSessionId)
                }
              }
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer"
            title="Refresh Hermes status and native sessions"
          >
            refresh
          </button>
          <button
            onClick={toggleDetails}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all cursor-pointer"
            style={{
              color: showDetails ? '#fbbf24' : '#9ca3af',
              borderColor: showDetails ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.08)',
              background: showDetails ? 'rgba(251,191,36,0.08)' : 'transparent',
            }}
            title="Toggle reasoning and tool details"
          >
            info
          </button>
          <div className="relative">
            <button
              onClick={() => setShowSettings(current => !current)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer"
              title="Panel settings"
            >
              set
            </button>
            {showSettings && <SettingsDropdown settings={panelSettings} onChange={updatePanelSettings} />}
          </div>
          <button
            onClick={clearChat}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-100/80 hover:text-red-200 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer"
            title="Clear chat"
          >
            clear
          </button>
          <button onClick={onClose} className="text-amber-100/80 hover:text-white transition-colors text-lg leading-none cursor-pointer" title="Close">
            x
          </button>
        </div>
      </div>

      <div
        data-drag-handle
        onMouseDown={handleDragStart}
        className="px-3 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono"
        style={{ background: 'rgba(0,0,0,0.22)' }}
      >
        <span className="text-amber-100/70 uppercase">session</span>
        <select
          data-no-drag
          value={sessionValue}
          onChange={event => setSelectedSessionId(event.target.value)}
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
          title={tunnelStatus.commandPreview || 'No managed SSH tunnel saved'}
        >
          {nativeSessionsAvailable ? (activeSession ? activeSession.source : 'native') : tunnelLabel}
        </span>
        {activeSession && showDetails ? (
          <span className="hidden lg:block text-amber-100/65 truncate max-w-[220px]" title={activeSession.preview || activeSession.id}>
            {activeSession.preview || activeSession.id}
          </span>
        ) : (
          status.base && showDetails && (
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

      {sessionsError && !connectionError && (
        <div className="px-3 py-1.5 text-[10px] text-amber-100 border-b border-amber-500/20 bg-amber-500/10 font-mono">
          {sessionsError}
        </div>
      )}

      {voiceError && !connectionError && !sessionsError && (
        <div className="px-3 py-1.5 text-[10px] text-amber-100 border-b border-amber-500/20 bg-amber-500/10 font-mono">
          {voiceError}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          className="h-full overflow-y-auto px-3 py-3 space-y-3 min-h-0"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}
        >
          {sessionHydrating && (
            <div className="px-3 py-2 rounded-lg text-[11px] font-mono text-amber-100 border border-amber-500/20 bg-black/30">
              loading session...
            </div>
          )}

          {messages.length === 0 && (
            <div className="h-full flex flex-col justify-center text-center px-4">
              <div className="text-4xl mb-3 text-amber-300">?</div>
              <div className="text-sm text-amber-100 mb-1">Your Hermes link lives here.</div>
              {status.connected ? (
                <>
                  <div className="text-xs text-amber-100/80 mb-4">
                    This panel talks to Hermes through the local Oasis server route, so the browser never sees your VPS API key.
                  </div>
                  {nativeSessionsAvailable && (
                    <div className="text-[11px] text-amber-200/80 mb-4 font-mono">
                      Native Hermes sessions are live. Pick one above or start a fresh chat.
                    </div>
                  )}
                  <div className="space-y-1 text-[11px] font-mono text-amber-100/80">
                    <button className="block w-full hover:text-amber-300 transition-colors cursor-pointer" onClick={() => setInput('Summarize what tools and capabilities you expose right now.')}>
                      Summarize what tools you expose right now.
                    </button>
                    <button className="block w-full hover:text-amber-300 transition-colors cursor-pointer" onClick={() => setInput('What can you tell me about your current runtime, transport, and constraints?')}>
                      What can you tell me about your current runtime, transport, and constraints?
                    </button>
                    <button className="block w-full hover:text-amber-300 transition-colors cursor-pointer" onClick={() => setInput('Help me design an Oasis connector for you, but do not modify files yet.')}>
                      Help me design an Oasis connector for you, but do not modify files yet.
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-amber-100/80 mb-4">
                    Save Hermes connection data once, optionally save SSH once, then hit connect whenever you want this panel live.
                  </div>
                  <div className="text-[11px] text-left font-mono rounded-lg border border-amber-500/20 bg-black/30 px-3 py-3 space-y-1 text-amber-100/85">
                    <div>1. Ask Hermes for an Oasis connection block.</div>
                    <div>2. {canMutateAnyConfig ? 'Click `config` and paste the block.' : 'Open this panel on localhost to edit saved connection data.'}</div>
                    <div>3. Optional: paste your SSH tunnel command in the second field.</div>
                    <div>4. Press `connect` and start chatting.</div>
                  </div>
                  {status.error && (
                    <div className="mt-3 text-xs text-red-300">{status.error}</div>
                  )}
                </>
              )}
            </div>
          )}

          {messages.map(message => (
            <div key={message.id} className="space-y-2">
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
                        ? renderHermesAssistantContent(message.content, autoPlayMediaMessageId === message.id && voiceOutputEnabled)
                        : <span className="text-amber-100/75">Streaming...</span>}
                    </div>
                  )}

                  {message.error && (
                    <div className="px-3 py-2 rounded-lg text-xs text-red-200 border border-red-500/25 bg-red-500/10">
                      {message.error}
                    </div>
                  )}

                  {showDetails && message.reasoning && (
                    <CollapsibleBlock
                      label={`reasoning (${message.reasoning.length} chars)`}
                      icon="::"
                      content={message.reasoning}
                      accentColor="rgba(148,163,184,0.35)"
                      compact
                    />
                  )}

                  {showDetails && message.tools && message.tools.length > 0 && (
                    <div className="space-y-1.5">
                      {message.tools.map(tool => (
                        <ToolDetails key={`${message.id}-${tool.index}-${tool.id || tool.name}`} tool={tool} />
                      ))}
                    </div>
                  )}

                  {showDetails && message.usage && (
                    <CollapsibleBlock
                      label={`usage (${message.usage.totalTokens || 0} total tokens)`}
                      icon="##"
                      content={JSON.stringify(message.usage, null, 2)}
                      accentColor="rgba(52,211,153,0.35)"
                      compact
                    />
                  )}

                  {(message.finishReason || (isStreaming && message === messages[messages.length - 1])) && (
                    <div className="text-[10px] font-mono text-amber-100/65 px-1">
                      {isStreaming && message === messages[messages.length - 1]
                        ? 'streaming...'
                        : `finish_reason=${message.finishReason}`}
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
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        {nativeSessionsAvailable && (
          <div className="text-[10px] text-amber-100/80 font-mono mb-2 truncate" title={activeSession?.id || 'New Oasis session'}>
            {sessionValue === NEW_SESSION_VALUE
              ? 'native session | new chat'
              : `native session | ${activeSession?.title || activeSession?.id || sessionValue}`}
          </div>
        )}
        {tunnelStatus.configured && (
          <div className="text-[10px] text-amber-100/60 font-mono mb-2 truncate" title={tunnelStatus.commandPreview || tunnelStatus.command}>
            {tunnelStatus.running ? 'managed ssh live' : tunnelStatus.autoStart ? 'managed ssh saved' : 'managed ssh saved (manual)'}
            {tunnelStatus.commandPreview ? ` | ${tunnelStatus.commandPreview}` : ''}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-2">
            <button
              data-no-drag
              onClick={toggleVoiceInput}
              disabled={!status.connected || !voiceInputSupported || voiceTranscribing}
              className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-amber-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title={voiceInputSupported ? 'Record a voice note, then Hermes on Ashburn will transcribe it' : 'Browser microphone capture is unavailable here'}
            >
              {voiceTranscribing ? 'transcribing' : voiceListening ? 'stop rec' : 'mic'}
            </button>
            <button
              data-no-drag
              onClick={() => {
                if (voiceOutputEnabled) setAutoPlayMediaMessageId('')
                setVoiceOutputEnabled(current => !current)
              }}
              className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-amber-100"
              title="Toggle auto-play for Hermes audio notes only"
            >
              {voiceOutputEnabled ? 'audio on' : 'audio off'}
            </button>
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

      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(245,158,11,0.42) 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />
    </div>,
    document.body
  )
}
