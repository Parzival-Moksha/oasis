'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

import { useOasisStore } from '@/store/oasisStore'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { CollapsibleBlock, renderMarkdown } from '@/lib/anorak-renderers'

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
const NEW_SESSION_VALUE = '__oasis_new__'
const CONNECTION_HINT = `HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=your_secret_here
HERMES_MODEL=optional_model_id`
const TUNNEL_HINT = 'ssh -L 8642:127.0.0.1:8642 user@your-vps -N'

type BrowserSpeechRecognitionResult = {
  isFinal: boolean
  0: { transcript: string }
}

type BrowserSpeechRecognitionEvent = {
  resultIndex: number
  results: ArrayLike<BrowserSpeechRecognitionResult>
}

type BrowserSpeechRecognitionErrorEvent = {
  error: string
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
  }
}

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

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function formatSessionLabel(session: HermesNativeSessionSummary): string {
  const primary = (session.title || session.preview || `Session ${session.id.slice(-8)}`).replace(/\s+/g, ' ').trim()
  const source = session.source || 'unknown'
  const preview = primary.length > 56 ? `${primary.slice(0, 56)}...` : primary
  return `${preview} • ${source}`
}

function toSpeechText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
      className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg p-3 shadow-xl w-56"
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
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const dictationBaseRef = useRef('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const spokenMessageIdsRef = useRef<Set<string>>(new Set())

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
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(VOICE_OUTPUT_KEY) === 'true' } catch { return false }
  })
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceError, setVoiceError] = useState('')
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

  const stopVoicePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setVoiceSpeaking(false)
  }, [])

  const speakAssistantReply = useCallback(async (content: string) => {
    const speechText = toSpeechText(content).slice(0, 2400)
    if (!speechText) return

    stopVoicePlayback()
    setVoiceError('')

    try {
      const response = await fetch('/api/media/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText, voice: 'rachel' }),
      })
      const data = await response.json().catch(() => ({}))

      if (response.ok && typeof data?.url === 'string') {
        const audio = new Audio(data.url)
        audioRef.current = audio
        audio.onended = () => {
          if (audioRef.current === audio) audioRef.current = null
          setVoiceSpeaking(false)
        }
        audio.onerror = () => {
          if (audioRef.current === audio) audioRef.current = null
          setVoiceSpeaking(false)
          setVoiceError('Voice playback failed.')
        }

        setVoiceSpeaking(true)
        await audio.play()
        return
      }
    } catch {
      // Fall back to browser speech synthesis below.
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      const utterance = new SpeechSynthesisUtterance(speechText)
      utterance.onend = () => setVoiceSpeaking(false)
      utterance.onerror = () => {
        setVoiceSpeaking(false)
        setVoiceError('Voice playback failed.')
      }
      setVoiceSpeaking(true)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return
    }

    setVoiceSpeaking(false)
  }, [stopVoicePlayback])

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

  const hydrateSession = useCallback(async (sessionId: string) => {
    if (!sessionId || sessionId === NEW_SESSION_VALUE) {
      setSessionHydrating(false)
      setMessages([])
      setAutoScroll(true)
      return
    }

    setSessionHydrating(true)
    setSessionsError('')

    try {
      const response = await fetch(`/api/hermes/sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.available === false) {
        throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      }

      const nextMessages: ChatMessage[] = Array.isArray(data?.messages)
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
              finishReason: entry.finishReason,
              timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
            }))
        : []

      nextMessages.forEach(message => {
        spokenMessageIdsRef.current.add(message.id)
      })

      setMessages(nextMessages)
      setAutoScroll(true)
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : 'Unable to load the selected Hermes session.')
    } finally {
      setSessionHydrating(false)
    }
  }, [])

  const toggleVoiceInput = useCallback(() => {
    if (voiceListening) {
      recognitionRef.current?.stop()
      return
    }

    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      setVoiceError('Browser speech input is not available here.')
      return
    }

    setVoiceError('')
    dictationBaseRef.current = input.trim()

    const recognition = new Recognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => setVoiceListening(true)
    recognition.onend = () => {
      setVoiceListening(false)
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
      }
      window.setTimeout(() => inputRef.current?.focus(), 80)
    }
    recognition.onerror = event => {
      setVoiceError(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input failed: ${event.error}`)
    }
    recognition.onresult = event => {
      let transcript = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const segment = result?.[0]?.transcript || ''
        if (segment) {
          transcript += `${segment} `
        }
      }

      const nextTranscript = transcript.trim()
      const prefix = dictationBaseRef.current
      setInput([prefix, nextTranscript].filter(Boolean).join(prefix && nextTranscript ? ' ' : ''))
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      setVoiceListening(false)
      setVoiceError(error instanceof Error ? error.message : 'Unable to start voice input.')
    }
  }, [input, voiceListening])

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
    setVoiceInputSupported(Boolean(getSpeechRecognitionConstructor()))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      autoConnectTriedRef.current = false
      setShowConnectionModal(false)
      setShowSettings(false)
      recognitionRef.current?.abort()
      recognitionRef.current = null
      setVoiceListening(false)
      return
    }
  }, [isOpen])

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
  }, [status.connected, tunnelStatus.configured])

  useEffect(() => {
    if (!nativeSessionsAvailable) return
    if (isStreaming) return
    if (!selectedSessionId || selectedSessionId === NEW_SESSION_VALUE) {
      setMessages([])
      setAutoScroll(true)
      return
    }

    void hydrateSession(selectedSessionId)
  }, [hydrateSession, isStreaming, nativeSessionsAvailable, selectedSessionId])

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
    stopVoicePlayback()
  }, [stopVoicePlayback, voiceOutputEnabled])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
      stopVoicePlayback()
    }
  }, [stopVoicePlayback])

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
    if (!target.closest('[data-drag-handle]')) return

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
    stopVoicePlayback()

    if (nativeSessionsAvailable) {
      setSelectedSessionId(NEW_SESSION_VALUE)
      setMessages([])
      setAutoScroll(true)
      return
    }

    setMessages([])
    try {
      localStorage.removeItem(CHAT_KEY)
    } catch {}
  }, [nativeSessionsAvailable, stopVoicePlayback])

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

      if (!assistantError && assistantText.trim() && voiceOutputEnabled) {
        spokenMessageIdsRef.current.add(assistantId)
        void speakAssistantReply(assistantText)
      }

      if (useNativeSessions) {
        void loadSessions(resolvedSessionId || undefined)
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
    speakAssistantReply,
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
        ...backgroundStyle,
        border: `1px solid ${isStreaming ? 'rgba(245,158,11,0.58)' : 'rgba(245,158,11,0.24)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(245,158,11,0.16), inset 0 0 60px rgba(245,158,11,0.04)'
          : '0 8px 40px rgba(0,0,0,0.78)',
        transition: 'box-shadow 0.35s ease, border-color 0.35s ease',
      }}
      onMouseDownCapture={event => {
        focusPanelUI()
        event.stopPropagation()
      }}
      onPointerDownCapture={event => event.stopPropagation()}
      onMouseDown={event => {
        useOasisStore.getState().bringPanelToFront('hermes')
        handleDragStart(event)
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div
        data-drag-handle
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
                void loadSessions(selectedSessionId || undefined)
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
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-400 hover:text-red-300 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer"
            title="Clear chat"
          >
            clear
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-lg leading-none cursor-pointer" title="Close">
            x
          </button>
        </div>
      </div>

      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono" style={{ background: 'rgba(0,0,0,0.22)' }}>
        <span className="text-gray-500 uppercase">session</span>
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
          className="hidden md:block text-gray-500 truncate max-w-[120px]"
          title={tunnelStatus.commandPreview || 'No managed SSH tunnel saved'}
        >
          {nativeSessionsAvailable ? (activeSession ? activeSession.source : 'native') : tunnelLabel}
        </span>
        {activeSession && showDetails ? (
          <span className="hidden lg:block text-gray-500 truncate max-w-[220px]" title={activeSession.preview || activeSession.id}>
            {activeSession.preview || activeSession.id}
          </span>
        ) : (
          status.base && showDetails && (
            <span className="hidden lg:block text-gray-500 truncate max-w-[180px]" title={status.base}>
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
                  <div className="text-xs text-gray-400 mb-4">
                    This panel talks to Hermes through the local Oasis server route, so the browser never sees your VPS API key.
                  </div>
                  {nativeSessionsAvailable && (
                    <div className="text-[11px] text-amber-200/80 mb-4 font-mono">
                      Native Hermes sessions are live. Pick one above or start a fresh chat.
                    </div>
                  )}
                  <div className="space-y-1 text-[11px] font-mono text-gray-500">
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
                  <div className="text-xs text-gray-400 mb-4">
                    Save Hermes connection data once, optionally save SSH once, then hit connect whenever you want this panel live.
                  </div>
                  <div className="text-[11px] text-left font-mono rounded-lg border border-amber-500/20 bg-black/30 px-3 py-3 space-y-1 text-gray-300">
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
                      {message.content ? renderMarkdown(message.content) : <span className="text-gray-500">Streaming...</span>}
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
                    <div className="text-[10px] font-mono text-gray-500 px-1">
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
          <div className="text-[10px] text-gray-500 font-mono mb-2 truncate" title={tunnelStatus.commandPreview || tunnelStatus.command}>
            {tunnelStatus.running ? 'managed ssh live' : tunnelStatus.autoStart ? 'managed ssh saved' : 'managed ssh saved (manual)'}
            {tunnelStatus.commandPreview ? ` | ${tunnelStatus.commandPreview}` : ''}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-2">
            <button
              data-no-drag
              onClick={toggleVoiceInput}
              disabled={!status.connected || !voiceInputSupported}
              className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-amber-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title={voiceInputSupported ? 'Dictate into the input box' : 'Browser speech input is unavailable here'}
            >
              {voiceListening ? 'stop mic' : 'mic'}
            </button>
            <button
              data-no-drag
              onClick={() => {
                if (voiceOutputEnabled) stopVoicePlayback()
                setVoiceOutputEnabled(current => !current)
              }}
              className="px-2 py-2 rounded-lg text-[10px] font-mono border border-white/10 text-amber-100"
              title="Toggle spoken Hermes replies"
            >
              {voiceSpeaking ? 'speaking' : voiceOutputEnabled ? 'voice on' : 'voice off'}
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
            className="flex-1 resize-none rounded-lg px-3 py-2 text-xs text-white outline-none placeholder-gray-600 disabled:opacity-60"
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
                className="text-gray-400 hover:text-white text-sm"
                onClick={() => setShowConnectionModal(false)}
              >
                x
              </button>
            </div>
            <div className="px-3 py-3 space-y-3">
              <div className="text-[11px] text-gray-300 font-mono">
                Save your Hermes connection block and optional SSH tunnel here. Oasis keeps the secret server-side and can re-launch the tunnel for you on future opens.
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-amber-200/80">Connection Data</div>
                  {status.source === 'pairing' && !connectionInput.trim() && (
                    <div className="text-[10px] font-mono text-gray-500">saved locally already</div>
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
                    <div className="text-[10px] font-mono text-gray-500">saved locally already</div>
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
                <label className="flex items-center gap-2 text-[11px] font-mono text-gray-300 select-none">
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
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white"
                    onClick={() => setConnectionInput(CONNECTION_HINT)}
                  >
                    secrets template
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white"
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
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white"
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
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(245,158,11,0.42) 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />
    </div>,
    document.body
  )
}
