'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'

import { useOpenclawRelayBridge } from '@/hooks/useOpenclawRelayBridge'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { writeBrowserStorage } from '@/lib/browser-storage'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { awardXp } from '@/hooks/useXp'
import { useOasisStore } from '@/store/oasisStore'
import { PUBLIC_TOOL_NAMES } from '@/lib/relay/public-spellbook.js'
import { useAudioManager } from '@/lib/audio-manager'
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
}

interface RelayChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: string
  timestamp: number
}

const HERMES_RELAY_SCOPES = ['world.read', 'world.write.safe', 'screenshot.request', 'chat.stream'] as const
const HERMES_RELAY_TOOLS: readonly string[] = Object.freeze([...PUBLIC_TOOL_NAMES])
const HERMES_AGENT_TYPE = 'hermes'
const HERMES_AGENT_SLOT = 'hermes:primary'
const HERMES_AGENT_LABEL = 'hermes-bridge'
const CHAT_KEY = 'oasis-hermes-hosted-relay-chat'
const SESSION_KEY = 'oasis-hermes-hosted-relay-session'
const SETTINGS_KEY = 'oasis-hermes-hosted-relay-settings'
const DEFAULT_HERMES_AVATAR_URL = '/avatars/gallery/CoolAlien.vrm'

interface HermesRelayPanelSettings {
  bgColor: string
  opacity: number
  avatarUrl: string | null
}

const DEFAULT_PANEL_SETTINGS: HermesRelayPanelSettings = {
  bgColor: '#090704',
  opacity: 0.94,
  avatarUrl: DEFAULT_HERMES_AVATAR_URL,
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

function readStoredSessionId() {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
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

function buildHermesRelayCommand(pairing: RelayPairingResult | null, origin: string): string {
  if (!pairing) return ''
  const normalizedOrigin = normalizeCommandOrigin(origin)
  const pairingRef = normalizedOrigin
    ? `${normalizedOrigin}/pair/${encodeURIComponent(pairing.code)}`
    : pairing.code
  const base = `npx -y @04515xyz/oasis-bridge@latest hermes ${pairingRef} --agent-slot=${HERMES_AGENT_SLOT} --label=${HERMES_AGENT_LABEL}`
  if (!isLocalOasisOrigin(normalizedOrigin)) return base
  const relayHost = localRelayHostFromOrigin(normalizedOrigin)
  return `${base} --relay-url="ws://${relayHost}:4517/?role=agent"`
}

function buildHermesRelayPasteText(pairing: RelayPairingResult | null, origin: string): string {
  if (!pairing) return ''
  return [
    'Connect this Hermes agent to Oasis.',
    '',
    buildHermesRelayCommand(pairing, origin),
    '',
    'Keep that bridge process running. After it pairs, chat and Oasis world tools are live in the Hermes window.',
  ].join('\n')
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
  const assignHermesAvatar = useOasisStore(state => state.assignHermesAvatar)
  const focusPanelUI = useCallback(() => {
    useInputManager.getState().enterUIFocus()
  }, [])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingAssistantIdRef = useRef('')
  const awardedConnectionXpRef = useRef(false)
  const dragRef = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null)
  const [messages, setMessages] = useState<RelayChatMessage[]>(() => readStoredMessages())
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [relayEnabled, setRelayEnabled] = useState(false)
  const [pairing, setPairing] = useState<RelayPairingResult | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState('')
  const [copied, setCopied] = useState('')
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [sessionId, setSessionId] = useState(() => readStoredSessionId() || randomId('hermes-relay-session'))
  const [panelSettings, setPanelSettings] = useState<HermesRelayPanelSettings>(() => readStoredPanelSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ left: 18, top: 132 })
  const [draggingPanel, setDraggingPanel] = useState(false)
  const [buttonPose, setButtonPose] = useState({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const pairingPasteText = useMemo(() => buildHermesRelayPasteText(pairing, origin), [origin, pairing])
  const isVisible = embedded || isOpen
  const relayBridge = useOpenclawRelayBridge({
    enabled: isVisible && relayEnabled && Boolean(activeWorldId),
    worldId: activeWorldId || '__active__',
    agentType: HERMES_AGENT_TYPE,
    agentSlot: HERMES_AGENT_SLOT,
    availableTools: HERMES_RELAY_TOOLS,
    onChatAgentDelta: event => {
      const assistantId = pendingAssistantIdRef.current
      if (!assistantId || event.sessionId !== sessionId) return
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? { ...message, content: message.content + event.text }
          : message
      ))
    },
    onChatAgentFinal: event => {
      const assistantId = pendingAssistantIdRef.current
      if (!assistantId || event.sessionId !== sessionId) return
      setMessages(previous => previous.map(message =>
        message.id === assistantId
          ? { ...message, content: event.text || message.content }
          : message
      ))
      pendingAssistantIdRef.current = ''
      setIsStreaming(false)
    },
  })

  useAutoresizeTextarea(inputRef, input, { minPx: 48, maxPx: 180 })

  useEffect(() => {
    writeBrowserStorage(CHAT_KEY, JSON.stringify(messages.slice(-80)))
  }, [messages])

  useEffect(() => {
    writeBrowserStorage(SESSION_KEY, sessionId)
  }, [sessionId])

  useEffect(() => {
    writeBrowserStorage(SETTINGS_KEY, JSON.stringify(panelSettings))
  }, [panelSettings])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  useEffect(() => {
    if (!pairing?.expiresAt) return
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairing?.expiresAt])

  useEffect(() => {
    if (relayBridge.status === 'closed' || relayBridge.status === 'error') {
      if (isStreaming) setIsStreaming(false)
      pendingAssistantIdRef.current = ''
    }
  }, [isStreaming, relayBridge.status])

  useEffect(() => {
    if (relayBridge.status !== 'paired' || awardedConnectionXpRef.current) return
    awardedConnectionXpRef.current = true
    void awardXp('QUEST_STEP_COMPLETE', activeWorldId || undefined)
    useAudioManager.getState().play('notification')
  }, [activeWorldId, relayBridge.status])

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

  const updatePanelSettings = useCallback((patch: Partial<HermesRelayPanelSettings>) => {
    setPanelSettings(current => ({ ...current, ...patch }))
  }, [])

  const manifestHermesAvatar = useCallback((avatarUrl?: string | null) => {
    const selectedAvatar = avatarUrl || hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl || DEFAULT_HERMES_AVATAR_URL
    updatePanelSettings({ avatarUrl: selectedAvatar })
    assignHermesAvatar(selectedAvatar)
    useAudioManager.getState().play('place')
  }, [assignHermesAvatar, hermesAvatar?.avatar3dUrl, panelSettings.avatarUrl, updatePanelSettings])

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

  const flashCopied = useCallback((key: string) => {
    setCopied(key)
    window.setTimeout(() => setCopied(current => current === key ? '' : current), 1200)
  }, [])

  const requestPairing = useCallback(async () => {
    if (!activeWorldId) {
      setPairingError('active world is required')
      return
    }

    useAudioManager.getState().play('buttonClick')
    setPairingBusy(true)
    setPairingError('')
    try {
      const sessionResponse = await fetch('/api/session/init', { credentials: 'same-origin' })
      if (!sessionResponse.ok) throw new Error(`session init failed: HTTP ${sessionResponse.status}`)

      const response = await fetch('/api/relay/pairings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          worldId: activeWorldId,
          scopes: HERMES_RELAY_SCOPES,
          agentType: HERMES_AGENT_TYPE,
          agentSlot: HERMES_AGENT_SLOT,
          agentLabel: HERMES_AGENT_LABEL,
        }),
      })
      const json = await response.json().catch(() => null) as
        | { ok: true; code: string; expiresAt: number; worldId: string; scopes: string[]; agentType?: string; agentSlot?: string; agentLabel?: string }
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
      })
      setRelayEnabled(true)
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : String(error))
      setPairing(null)
    } finally {
      setPairingBusy(false)
    }
  }, [activeWorldId])

  const startNewChat = useCallback(() => {
    pendingAssistantIdRef.current = ''
    setIsStreaming(false)
    setSessionId(randomId('hermes-relay-session'))
    setMessages([])
    setInput('')
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
  }, [input, isStreaming, relayBridge, sessionId])

  const isPaired = relayBridge.status === 'paired'
  const canSend = isPaired && Boolean(input.trim()) && !isStreaming
  const canRequestPairing = Boolean(activeWorldId) && !pairingBusy
  const countdown = pairing ? formatPairingCountdown(pairing.expiresAt, countdownNow) : ''
  const relayLabel = relayStatusLabel(relayBridge.status)

  if (!isVisible || typeof document === 'undefined') return null

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'hermes-hosted-relay-panel'}
      data-ui-panel
      className={`${embedded ? 'relative h-full w-full' : 'fixed'} min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border border-amber-400/30 text-amber-50 shadow-2xl`}
      style={{
        ...(embedded ? {} : {
          zIndex: panelZIndex,
          left: panelPosition.left,
          top: panelPosition.top,
          width: 'min(600px, calc(100vw - 32px))',
          height: 'min(74vh, 680px)',
        }),
        width: embedded ? '100%' : undefined,
        height: embedded ? '100%' : undefined,
        backgroundColor: panelSettings.bgColor,
        opacity: panelSettings.opacity,
        fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
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
          <span className="rounded border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/80">
            {relayLabel}
          </span>
          {pairing && (
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
          <button
            data-no-drag
            onClick={startNewChat}
            disabled={isStreaming}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-100/75 hover:text-white disabled:opacity-40"
          >
            new
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
          <button
            data-no-drag
            onClick={() => { if (!isPaired) void requestPairing() }}
            onMouseMove={updateButtonPose}
            onMouseEnter={() => useAudioManager.getState().play('buttonHover')}
            onMouseLeave={() => setButtonPose({ x: 50, y: 50, rx: 0, ry: 0, lift: 0 })}
            disabled={!canRequestPairing && !isPaired}
            className={`group relative min-h-[126px] w-full overflow-hidden rounded-lg px-5 py-5 text-center transition duration-150 ${isPaired ? 'cursor-default border border-emerald-200/70 bg-emerald-400/20 shadow-[0_0_58px_rgba(16,185,129,0.32)]' : 'cursor-pointer border border-amber-100/50 bg-amber-300/10 shadow-[0_0_42px_rgba(245,158,11,0.28)] hover:border-white hover:shadow-[0_0_80px_rgba(250,204,21,0.42)]'} disabled:cursor-not-allowed disabled:opacity-45`}
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
              onClick={() => { void copyText(pairingPasteText); flashCopied('paste') }}
              className="w-full rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-left transition hover:border-amber-300/35"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100/62">
                paste into Hermes
              </span>
              <span className="mt-1 block break-all font-mono text-[11px] leading-5 text-amber-50/88">
                {copied === 'paste' ? 'copied ' : ''}{pairingPasteText}
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
            <span className="min-w-0 truncate text-[11px] text-amber-100/50">
              {hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl || DEFAULT_HERMES_AVATAR_URL}
            </span>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}>
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-center px-4 text-center">
            <div className="text-sm text-amber-100">Hermes relay is ready to pair.</div>
            <div className="mt-2 text-xs leading-5 text-amber-100/62">
              Mint a code, paste the command into Hermes, then chat and Oasis MCP tools share this window.
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map(message => (
            <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className="max-w-[88%] rounded-lg px-3 py-2 text-xs leading-relaxed break-words"
                style={{
                  background: message.role === 'user' ? 'rgba(245,158,11,0.16)' : 'rgba(0,0,0,0.48)',
                  border: message.role === 'user' ? '1px solid rgba(245,158,11,0.22)' : '1px solid rgba(255,255,255,0.06)',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {message.content || (message.role === 'assistant' && isStreaming ? 'Streaming...' : '')}
                {message.error && <div className="mt-2 text-red-200">{message.error}</div>}
              </div>
            </div>
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-white/10 bg-black/35 px-3 py-2">
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
            disabled={relayBridge.status !== 'paired' || isStreaming}
            placeholder={relayBridge.status === 'paired' ? 'Talk to Hermes...' : 'Pair Hermes first...'}
            className="min-h-[48px] min-w-0 flex-1 resize-none rounded-lg border border-amber-500/20 bg-white/[0.06] px-3 py-2 text-xs text-white outline-none placeholder:text-amber-100/45 disabled:opacity-60"
          />
          <button
            data-no-drag
            onClick={sendMessage}
            disabled={!canSend}
            className="rounded-lg border border-amber-500/30 bg-amber-500/35 px-3 py-2 text-xs font-bold text-white transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-30"
            style={{ minWidth: 70 }}
          >
            send
          </button>
        </div>
      </div>
      <style>{`
        @keyframes hermesConnectSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      {showAvatarGallery && (
        <AvatarGallery
          currentAvatarUrl={hermesAvatar?.avatar3dUrl || panelSettings.avatarUrl}
          onSelect={avatarUrl => {
            updatePanelSettings({ avatarUrl: avatarUrl || DEFAULT_HERMES_AVATAR_URL })
            assignHermesAvatar(avatarUrl || null)
            setShowAvatarGallery(false)
            useAudioManager.getState().play('place')
          }}
          onClose={() => setShowAvatarGallery(false)}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
