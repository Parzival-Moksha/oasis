'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

import { useOasisStore } from '@/store/oasisStore'
import { useUILayer } from '@/lib/input-manager'
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
interface HermesMetaEvent { type: 'meta'; model?: string; upstream?: string }
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

const POS_KEY = 'oasis-hermes-pos'
const SIZE_KEY = 'oasis-hermes-size'
const SETTINGS_KEY = 'oasis-hermes-settings'
const MODEL_KEY = 'oasis-hermes-model'
const DETAILS_KEY = 'oasis-hermes-details'
const PAIRING_HINT = `HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_KEY=your_secret_here
HERMES_MODEL=optional_model_id`

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
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}
      title={source === 'pairing' ? 'Using local paired config' : 'Using server env config'}
    >
      {source}
    </span>
  )
}

function SettingsDropdown({ settings, onChange }: { settings: PanelSettings; onChange: (next: PanelSettings) => void }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg p-3 shadow-xl w-56">
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState<HermesStatus>(DEFAULT_STATUS)
  const [statusLoading, setStatusLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(MODEL_KEY) || '' } catch { return '' }
  })
  const [showDetails, setShowDetails] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return localStorage.getItem(DETAILS_KEY) !== 'false' } catch { return true }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [showPairing, setShowPairing] = useState(false)
  const [pairingInput, setPairingInput] = useState(PAIRING_HINT)
  const [pairingSaving, setPairingSaving] = useState(false)
  const [pairingError, setPairingError] = useState('')
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

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const [statusResponse, configResponse] = await Promise.all([
        fetch('/api/hermes', { cache: 'no-store' }),
        fetch('/api/hermes/config', { cache: 'no-store' }),
      ])

      const data = await statusResponse.json().catch(() => ({}))
      const cfg = await configResponse.json().catch(() => ({}))

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
        return
      }

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
      setSelectedModel(current => {
        const fallback = current && nextStatus.models.includes(current)
          ? current
          : nextStatus.defaultModel || nextStatus.models[0] || current || ''
        try {
          if (fallback) localStorage.setItem(MODEL_KEY, fallback)
        } catch {}
        return fallback
      })
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

  useEffect(() => {
    if (!isOpen) return
    void loadStatus()
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [isOpen, loadStatus])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' })
  }, [messages, isStreaming])

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
    setMessages([])
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const savePairing = useCallback(async () => {
    const payload = pairingInput.trim()
    if (!payload || pairingSaving) return

    setPairingSaving(true)
    setPairingError('')
    try {
      const response = await fetch('/api/hermes/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing: payload }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setPairingError(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
        return
      }
      setShowPairing(false)
      await loadStatus()
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Unable to save pairing data.')
    } finally {
      setPairingSaving(false)
    }
  }, [loadStatus, pairingInput, pairingSaving])

  const unlinkPairing = useCallback(async () => {
    if (pairingSaving) return
    setPairingSaving(true)
    setPairingError('')
    try {
      const response = await fetch('/api/hermes/config', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setPairingError(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
        return
      }
      setMessages([])
      await loadStatus()
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Unable to clear pairing.')
    } finally {
      setPairingSaving(false)
    }
  }, [loadStatus, pairingSaving])

  const sendMessage = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming || !status.connected) return

    const history = messages.map(message => ({
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
          model: selectedModel || undefined,
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
  }, [input, isStreaming, messages, selectedModel, status.connected])

  if (!isOpen || typeof document === 'undefined') return null

  const rgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(part => parseInt(part, 16)) || [18, 12, 4]
  const backgroundStyle = panelSettings.blur > 0 && panelSettings.opacity < 1
    ? {
        backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})`,
        backdropFilter: `blur(${panelSettings.blur}px)`,
      }
    : { backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${panelSettings.opacity})` }

  const canSend = status.connected && Boolean(input.trim()) && !isStreaming

  return createPortal(
    <div
      data-menu-portal="hermes-panel"
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
      onMouseDown={event => {
        event.stopPropagation()
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
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>☤</span>
          <span className="text-amber-300 font-bold text-sm tracking-wide">Hermes</span>
          <StatusBadge status={status} loading={statusLoading} />
          <SourceBadge source={status.source} />
        </div>

        <div className="flex items-center gap-1.5">
          {status.canMutateConfig && (
            <button
              onClick={() => {
                setPairingError('')
                setShowPairing(true)
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer disabled:opacity-50"
              title="Pair Hermes with this Oasis instance"
              disabled={pairingSaving}
            >
              pair
            </button>
          )}
          {status.source === 'pairing' && (
            <button
              onClick={() => void unlinkPairing()}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono text-red-300/80 hover:text-red-200 border border-red-500/25 hover:border-red-500/40 transition-all cursor-pointer disabled:opacity-50"
              title="Remove local pairing"
              disabled={pairingSaving}
            >
              unlink
            </button>
          )}
          <button
            onClick={() => void loadStatus()}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200/70 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 transition-all cursor-pointer"
            title="Refresh Hermes status"
          >
            sync
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
        <span className="text-gray-500 uppercase">model</span>
        <select
          data-no-drag
          value={selectedModel}
          onChange={event => {
            setSelectedModel(event.target.value)
            localStorage.setItem(MODEL_KEY, event.target.value)
          }}
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-amber-100 outline-none"
        >
          {selectedModel && !status.models.includes(selectedModel) && (
            <option value={selectedModel}>{selectedModel}</option>
          )}
          {!selectedModel && <option value="">Select model</option>}
          {status.models.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
        {status.base && showDetails && (
          <span className="hidden md:block text-gray-500 truncate max-w-[160px]" title={status.base}>
            {status.base}
          </span>
        )}
      </div>

      {pairingError && (
        <div className="px-3 py-1.5 text-[10px] text-red-200 border-b border-red-500/20 bg-red-500/10 font-mono">
          {pairingError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}>
        {messages.length === 0 && (
          <div className="h-full flex flex-col justify-center text-center px-4">
            <div className="text-4xl mb-3 text-amber-300">☤</div>
            <div className="text-sm text-amber-100 mb-1">Your Hermes link lives here.</div>
            {status.connected ? (
              <>
                <div className="text-xs text-gray-400 mb-4">
                  This panel talks to Hermes through the local Oasis server route, so the browser never sees your VPS API key.
                </div>
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
                  Pair this Oasis instance with a setup block from Hermes, then press sync.
                </div>
                <div className="text-[11px] text-left font-mono rounded-lg border border-amber-500/20 bg-black/30 px-3 py-3 space-y-1 text-gray-300">
                  <div>1. Ask Hermes for an Oasis pairing block.</div>
                  <div>2. {status.canMutateConfig ? 'Click `pair` above and paste the block.' : 'Open this panel on localhost to enable `pair`, then paste the block.'}</div>
                  <div>3. If Hermes is remote, run the SSH tunnel Hermes gives you.</div>
                  <div>4. Press `sync` and start chatting.</div>
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

      <div className="px-3 py-2 border-t border-white/10" style={{ background: 'rgba(8,6,3,0.8)' }}>
        {!status.connected && status.error && (
          <div className="text-[10px] text-red-300 mb-2">{status.error}</div>
        )}
        <div className="flex gap-2 items-end">
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

      {showPairing && (
        <div className="absolute inset-0 z-40 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-3">
          <div className="w-full max-w-[520px] rounded-lg border border-amber-500/30 bg-[#120f08] shadow-2xl">
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-mono text-amber-200">Pair Hermes</div>
              <button
                data-no-drag
                className="text-gray-400 hover:text-white text-sm"
                onClick={() => setShowPairing(false)}
              >
                x
              </button>
            </div>
            <div className="px-3 py-3 space-y-2">
              <div className="text-[11px] text-gray-300 font-mono">
                Paste the block Hermes gave you. Supported formats: env lines, JSON, or oasis:// URL.
              </div>
              <textarea
                data-no-drag
                value={pairingInput}
                onChange={event => setPairingInput(event.target.value)}
                className="w-full h-44 rounded border border-white/10 bg-black/40 px-2 py-2 text-[11px] text-amber-100 font-mono outline-none"
                spellCheck={false}
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  data-no-drag
                  className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white"
                  onClick={() => setPairingInput(PAIRING_HINT)}
                >
                  template
                </button>
                <div className="flex items-center gap-2">
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-white/10 text-[10px] font-mono text-gray-300 hover:text-white"
                    onClick={() => setShowPairing(false)}
                  >
                    cancel
                  </button>
                  <button
                    data-no-drag
                    className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/20 text-[10px] font-mono text-amber-100 disabled:opacity-50"
                    onClick={() => void savePairing()}
                    disabled={pairingSaving || !pairingInput.trim()}
                  >
                    {pairingSaving ? 'saving...' : 'save pairing'}
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
