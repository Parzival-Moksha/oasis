'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { useOasisStore } from '@/store/oasisStore'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
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
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

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

type SmokeMode = 'core' | 'live' | 'external'
type SmokeStatus = 'passed' | 'failed' | 'skipped'
type SmokeCategory = 'transport' | 'world' | 'avatar' | 'craft' | 'live-bridge' | 'conjure'

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
const DEFAULT_SETTINGS: PanelSettings = { bgColor: '#06161d', opacity: 0.92, blur: 8 }
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

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function saveStored<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function saveStoredString(key: string, value: string) {
  if (typeof window === 'undefined') return
  if (!value) {
    window.localStorage.removeItem(key)
    return
  }
  window.localStorage.setItem(key, value)
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

function StatusBadge({ label, tone }: { label: string; tone: 'online' | 'warn' | 'offline' }) {
  const styles = toneStyles(tone)
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em]"
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
}: {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}) {
  useUILayer('openclaw', isOpen && !embedded)

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('openclaw', 9998))
  const bringPanelToFront = useOasisStore(state => state.bringPanelToFront)
  const activeWorldId = useOasisStore(state => state.activeWorldId)

  const [position, setPosition] = useState(() => embedded ? DEFAULT_POS : loadStored(POS_KEY, DEFAULT_POS))
  const [size, setSize] = useState(() => embedded ? DEFAULT_SIZE : loadStored(SIZE_KEY, DEFAULT_SIZE))
  const [panelSettings, setPanelSettings] = useState(() => loadStored(SETTINGS_KEY, DEFAULT_SETTINGS))
  const [status, setStatus] = useState<OpenclawStatus>(DEFAULT_STATUS)
  const [configDraft, setConfigDraft] = useState({
    gatewayUrl: DEFAULT_STATUS.gatewayUrl,
    controlUiUrl: DEFAULT_STATUS.controlUiUrl,
    browserControlUrl: DEFAULT_STATUS.browserControlUrl,
    sshHost: '',
    deviceToken: '',
  })
  const [sessions, setSessions] = useState<OpenclawSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(SESSION_KEY) || ''
  })
  const [messages, setMessages] = useState<OpenclawMessage[]>([])
  const [composer, setComposer] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
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

  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const focusHandleRef = useRef<{ focus: () => void } | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    focusHandleRef.current = { focus: () => inputRef.current?.focus() }
  }, [])

  useAutoresizeTextarea(inputRef, composer, { minPx: 42, maxPx: 180 })

  const voice = useAgentVoiceInput({
    enabled: embedded || isOpen,
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => {
      setComposer(current => current ? `${current}\n${transcript}` : transcript)
    },
    focusTargetRef: focusHandleRef,
  })

  const isVisible = embedded || isOpen
  const currentSession = useMemo(
    () => sessions.find(entry => entry.id === selectedSessionId) || null,
    [selectedSessionId, sessions],
  )

  const focusPanelUi = useCallback(() => {
    const input = useInputManager.getState()
    if (input.pointerLocked) input.releasePointerLock()
    if (input.inputState === 'orbit' || input.inputState === 'noclip' || input.inputState === 'third-person') {
      input.enterUIFocus()
    }
  }, [])

  const updatePanelSettings = useCallback((next: PanelSettings) => {
    setPanelSettings(next)
    saveStored(SETTINGS_KEY, next)
  }, [])

  const flashCopied = useCallback((key: string) => {
    setCopiedKey(key)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setCopiedKey(''), 1400)
  }, [])

  const loadStatus = useCallback(async () => {
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
  }, [])

  const loadMcpInfo = useCallback(async () => {
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
  }, [])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const response = await fetch('/api/openclaw/sessions', { cache: 'no-store' })
      const payload = await response.json() as { sessions?: OpenclawSessionSummary[] }
      const nextSessions = Array.isArray(payload.sessions) ? payload.sessions : []
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
  }, [selectedSessionId, status.defaultSessionId, status.lastSessionId])

  const loadMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setMessages([])
      return
    }

    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/openclaw/sessions?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      const payload = await response.json() as { messages?: OpenclawMessage[] }
      setMessages(Array.isArray(payload.messages) ? payload.messages : [])
    } catch {
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) return

    void loadStatus()
    void loadSessions()
    void loadMcpInfo()

    const interval = window.setInterval(() => {
      void loadStatus()
    }, 30000)

    return () => {
      window.clearInterval(interval)
    }
  }, [isVisible, loadMcpInfo, loadSessions, loadStatus])

  useEffect(() => {
    if (!isVisible) return
    if (!selectedSessionId) {
      setMessages([])
      return
    }
    saveStoredString(SESSION_KEY, selectedSessionId)
    void loadMessages(selectedSessionId)
  }, [isVisible, loadMessages, selectedSessionId])

  const handleCreateSession = useCallback(async () => {
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
    } catch {
      // Session creation is best effort for now.
    }
  }, [])

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true)
    try {
      await fetch('/api/openclaw/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(configDraft),
      })
      await loadStatus()
      setShowConfig(false)
    } finally {
      setSavingConfig(false)
    }
  }, [configDraft, loadStatus])

  const handleResetConfig = useCallback(async () => {
    setSavingConfig(true)
    try {
      await fetch('/api/openclaw/config', { method: 'DELETE' })
      await loadStatus()
      setShowConfig(false)
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

  const talkSurfaceLabel = status.recommendedTalkSurface === 'control-ui'
    ? 'Control UI on 18789'
    : 'Telegram or OpenClaw CLI'
  const gatewayTone = probeTone(status.gateway)
  const controlTone = probeTone(status.controlUi)
  const browserTone = probeTone(status.browserControl)
  const gatewayCliTone = status.gatewayCli.state === 'ready'
    ? 'online'
    : status.gatewayCli.state === 'pairing-required'
      ? 'warn'
      : status.gatewayCli.state === 'offline' || status.gatewayCli.state === 'error'
        ? 'offline'
        : 'warn'

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
            <StatusBadge label={status.gateway.label} tone={gatewayTone} />
          </div>
          <div className="mt-1 text-[11px] text-cyan-50/70">
            Phase 1 bridge: Oasis MCP is ready while chat still lives on the OpenClaw side.
          </div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <button
            data-no-drag
            onClick={() => { setShowConfig(current => !current); setShowSettings(false) }}
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            title="Gateway config"
          >
            config
          </button>
          <button
            data-no-drag
            onClick={() => { setShowSettings(current => !current); setShowConfig(false) }}
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            title="Panel settings"
          >
            look
          </button>
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

      {(showSettings || showConfig) && (
        <div className="border-b border-white/8 bg-black/20 px-3 py-3 text-[11px] text-cyan-50/80">
          {showSettings && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
            </div>
          )}

          {showConfig && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Gateway WS</span>
                  <input
                    data-no-drag
                    value={configDraft.gatewayUrl}
                    onChange={event => setConfigDraft(current => ({ ...current, gatewayUrl: event.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                    placeholder="ws://127.0.0.1:18789"
                  />
                </label>
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
                  <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Browser control</span>
                  <input
                    data-no-drag
                    value={configDraft.browserControlUrl}
                    onChange={event => setConfigDraft(current => ({ ...current, browserControlUrl: event.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                    placeholder="http://127.0.0.1:18791"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block uppercase tracking-[0.16em] text-cyan-100/70">SSH host alias</span>
                  <input
                    data-no-drag
                    value={configDraft.sshHost}
                    onChange={event => setConfigDraft(current => ({ ...current, sshHost: event.target.value }))}
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                    placeholder="parzival-us"
                  />
                </label>
              </div>
              <label className="space-y-1">
                <span className="block uppercase tracking-[0.16em] text-cyan-100/70">Device token</span>
                <input
                  data-no-drag
                  type="password"
                  value={configDraft.deviceToken}
                  onChange={event => setConfigDraft(current => ({ ...current, deviceToken: event.target.value }))}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-300/40"
                  placeholder={status.hasDeviceToken ? 'Saved on backend. Paste a new one only if you need to rotate it.' : 'Leave blank until pairing returns a device token.'}
                />
              </label>
              <div className="flex flex-wrap gap-2">
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
                <span className="self-center text-[10px] text-cyan-50/55">
                  Stored server-side in <code>data/openclaw-config.local.json</code>.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

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
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[11px] normal-case tracking-normal text-cyan-50 outline-none focus:border-cyan-300/40"
        >
          <option value="">No session selected</option>
          {sessions.map(session => (
            <option key={session.id} value={session.id}>
              {session.title} [{formatSessionSource(session.source)}]
            </option>
          ))}
        </select>
        <button
          data-no-drag
          onClick={() => void handleCreateSession()}
          className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
        >
          + new
        </button>
      </div>

      <div
        data-agent-window-scroll-root=""
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent', ...EMBEDDED_SCROLL_SURFACE_STYLE }}
      >
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
              <StatusBadge label={`gateway ${status.gateway.label}`} tone={gatewayTone} />
              <StatusBadge label={`ws ${status.gatewayCli.label}`} tone={gatewayCliTone} />
              <StatusBadge label={`ui ${status.controlUi.label}`} tone={controlTone} />
              <StatusBadge label={`browser ${status.browserControl.label}`} tone={browserTone} />
            </div>
            <div className="mt-3 space-y-2 text-[12px] text-cyan-50/72">
              <div>
                Talk to OpenClaw now through <span className="font-semibold text-cyan-50">{talkSurfaceLabel}</span>.
              </div>
              <div>
                Port 18791 is browser control, not your normal human chat surface.
              </div>
              {status.gatewayCli.state === 'pairing-required' && (
                <div>
                  Gateway auth is still blocked on pairing. That means the page is reachable, but Oasis is not yet a trusted device.
                </div>
              )}
              <div>
                Pair approval runs on the machine hosting the Gateway, using the OpenClaw CLI there.
              </div>
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100">Oasis MCP ready</span>
              <button
                data-no-drag
                onClick={() => { void copyText(status.mcpUrl); flashCopied('mcp') }}
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-100/80 transition hover:border-emerald-300/30 hover:text-white"
              >
                {copiedKey === 'mcp' ? 'copied' : 'copy'}
              </button>
            </div>
            <div className="mt-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-emerald-50/82">
              {status.mcpUrl}
            </div>
            {mcpInfo && (
              <div className="mt-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-emerald-50/82">
                {mcpInfo.command}
              </div>
            )}
            <div className="mt-3 space-y-2 text-[12px] text-emerald-50/72">
              <div>
                Phase 1 plan: let local OpenClaw use Oasis tools here while you still talk to it through its own UI.
              </div>
              <div>
                This keeps comms and tools separate while we validate the MCP side first.
              </div>
              <div>
                This writes to <code>mcp.servers.oasis</code> inside <code>{mcpInfo?.configPath || status.runtimeMcpConfigPath}</code>.
              </div>
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
                {loadingMcp ? 'reading config...' : status.mcpInstalled ? 'OpenClaw already has Oasis MCP configured.' : 'Not installed in OpenClaw config yet.'}
              </span>
            </div>
          </div>
        </div>

        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Gateway handshake notes</span>
            <button
              data-no-drag
              onClick={() => { void copyText(status.approveCommandHint); flashCopied('approve') }}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            >
              {copiedKey === 'approve' ? 'copied' : 'copy approve'}
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-2 text-[12px] text-cyan-50/72">
              <div>1. Oasis opens a WebSocket to the Gateway.</div>
              <div>2. Gateway sends a fresh challenge nonce.</div>
              <div>3. Oasis signs it and, if new, gets marked pending for pairing.</div>
              <div>4. Owner approves on the Gateway host, then a device token can be saved on the backend.</div>
            </div>
            <div className="space-y-2 text-[12px] text-cyan-50/72">
              <div>{status.pairingHint}</div>
              <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-cyan-50/82">
                {status.approveCommandHint}
              </div>
              <div>
                If you later use a VPS, the same command runs there over SSH, not on your Oasis browser.
              </div>
              {status.gatewayCli.detail && (
                <div className="rounded-lg border border-white/8 bg-black/25 px-3 py-2 text-[11px] text-cyan-50/70">
                  {status.gatewayCli.detail}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Smoke rig</span>
              <div className="mt-1 text-[11px] text-cyan-50/52">
                Core smoke spins up a scratch world, exercises the live MCP surface, then clears the world again.
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
              {runningSmokeMode === 'core' ? 'running core' : 'run core smoke'}
            </button>
            <button
              data-no-drag
              onClick={() => void handleRunSmoke('live')}
              disabled={!!runningSmokeMode}
              className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {runningSmokeMode === 'live' ? 'running live' : 'run live smoke'}
            </button>
            <button
              data-no-drag
              onClick={() => void handleRunSmoke('external')}
              disabled={!!runningSmokeMode}
              className="rounded-lg border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {runningSmokeMode === 'external' ? 'running external' : 'run external smoke'}
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

        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Session memory</span>
              <div className="mt-1 text-[11px] text-cyan-50/52">
                The selector is ready for real Gateway history later. Draft sessions live locally already.
              </div>
            </div>
            <div className="text-right text-[10px] text-cyan-50/45">
              {loadingSessions ? 'loading sessions' : `${sessions.length} cached`}
            </div>
          </div>

          {currentSession ? (
            <div className="mt-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-cyan-50">{currentSession.title}</div>
                  <div className="mt-1 text-[11px] text-cyan-50/55">
                    {formatSessionSource(currentSession.source)} • {currentSession.messageCount} msgs • updated {formatTimestamp(currentSession.updatedAt)}
                  </div>
                </div>
                <StatusBadge label={formatSessionSource(currentSession.source)} tone={currentSession.source === 'draft' ? 'warn' : 'online'} />
              </div>
              <div className="mt-2 text-[12px] text-cyan-50/65">
                {currentSession.preview || 'No cached preview yet.'}
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-cyan-50/55">
              No OpenClaw session selected yet. Use <span className="font-semibold text-cyan-50">+ new</span> for a local draft, or wait for Gateway session sync in phase 2.
            </div>
          )}
        </div>

        <div
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Transcript</span>
            <span className="text-[10px] text-cyan-50/45">
              {loadingMessages ? 'loading history' : `${messages.length} cached messages`}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-[12px] text-cyan-50/55">
                No cached transcript yet. Once the Gateway transport lands, this area can hydrate old OpenClaw sessions and their full message history.
              </div>
            ) : (
              messages.map(message => (
                <div
                  key={message.id}
                  className="rounded-xl border px-3 py-2"
                  style={{
                    borderColor: message.role === 'assistant'
                      ? 'rgba(110,231,183,0.18)'
                      : message.role === 'system'
                        ? 'rgba(251,191,36,0.18)'
                        : 'rgba(34,211,238,0.18)',
                    background: message.role === 'assistant'
                      ? 'rgba(4,18,16,0.35)'
                      : message.role === 'system'
                        ? 'rgba(24,18,4,0.34)'
                        : 'rgba(4,12,18,0.34)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-50/58">{message.role}</span>
                    <span className="text-[10px] text-cyan-50/38">{formatTimestamp(message.timestamp)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-cyan-50/82">
                    {message.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-white/8 bg-black/20 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-cyan-50/55">
          <span>Panel shell is ready: auto-grow input, mic capture, attachment slots, and session plumbing.</span>
          <span>Gateway send/stream lands in phase 2.</span>
        </div>
        <div className="flex items-end gap-2">
          <button
            data-no-drag
            type="button"
            onClick={() => void voice.toggle()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-sm text-cyan-50/80 transition hover:border-cyan-300/30 hover:text-white"
            title={voice.listening ? 'Stop microphone capture' : voice.ready ? 'Record voice and transcribe into the composer' : voice.backendMessage || 'Warm up local STT first'}
          >
            {voice.listening ? 'stop' : voice.transcribing ? '...' : 'mic'}
          </button>
          <button
            data-no-drag
            type="button"
            disabled
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-sm text-cyan-50/35"
            title="Image, video, and voice-message sending joins the real transport in phase 2."
          >
            img
          </button>
          <button
            data-no-drag
            type="button"
            disabled
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-sm text-cyan-50/35"
            title="Video attachments arrive with the OpenClaw transport."
          >
            vid
          </button>
          <div className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
            <textarea
              data-no-drag
              ref={inputRef}
              value={composer}
              onChange={event => setComposer(event.target.value)}
              rows={1}
              placeholder="Compose here. In phase 1 this is a scratchpad while real chat stays on the OpenClaw side."
              className="w-full resize-none bg-transparent text-[13px] leading-6 text-cyan-50 outline-none placeholder:text-cyan-50/35"
              style={{ minHeight: 42 }}
            />
          </div>
          <button
            data-no-drag
            type="button"
            disabled
            className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/12 bg-cyan-400/8 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50/45"
            title="Real send streams through the Gateway in phase 2."
          >
            send
          </button>
        </div>
        {(voice.error || voice.backendMessage) && (
          <div className="mt-2 text-[11px] text-cyan-50/55">
            {voice.error || voice.backendMessage}
          </div>
        )}
      </div>

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
