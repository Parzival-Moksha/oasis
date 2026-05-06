'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useOpenclawRelayBridge } from '@/hooks/useOpenclawRelayBridge'
import { useInputManager, useUILayer } from '@/lib/input-manager'
import { writeBrowserStorage } from '@/lib/browser-storage'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { useOasisStore } from '@/store/oasisStore'

interface HermesHostedRelayPanelProps {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}

interface RelayPairingResult {
  code: string
  expiresAt: number
  worldId: string
  scopes: string[]
}

interface RelayChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: string
  timestamp: number
}

const HERMES_RELAY_SCOPES = ['chat.stream'] as const
const HERMES_RELAY_TOOLS: readonly string[] = Object.freeze([])
const CHAT_KEY = 'oasis-hermes-hosted-relay-chat'
const SESSION_KEY = 'oasis-hermes-hosted-relay-session'

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
  const base = `node scripts/hermes-oasis-bridge.mjs ${pairingRef}`
  if (!isLocalOasisOrigin(normalizedOrigin)) return base
  const relayHost = localRelayHostFromOrigin(normalizedOrigin)
  return `${base} --relay-url="ws://${relayHost}:4517/?role=agent"`
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
}: HermesHostedRelayPanelProps) {
  useUILayer('hermes', isOpen && !embedded)

  const panelZIndex = useOasisStore(state => state.getPanelZIndex('hermes', 9998))
  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const focusPanelUI = useCallback(() => {
    useInputManager.getState().enterUIFocus()
  }, [])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingAssistantIdRef = useRef('')
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

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const pairingCommand = useMemo(() => buildHermesRelayCommand(pairing, origin), [origin, pairing])
  const isVisible = embedded || isOpen
  const relayBridge = useOpenclawRelayBridge({
    enabled: isVisible && relayEnabled && Boolean(activeWorldId),
    worldId: activeWorldId || '__active__',
    agentType: 'hermes',
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

  const flashCopied = useCallback((key: string) => {
    setCopied(key)
    window.setTimeout(() => setCopied(current => current === key ? '' : current), 1200)
  }, [])

  const requestPairing = useCallback(async () => {
    if (!activeWorldId) {
      setPairingError('active world is required')
      return
    }

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
        }),
      })
      const json = await response.json().catch(() => null) as
        | { ok: true; code: string; expiresAt: number; worldId: string; scopes: string[] }
        | { ok: false; error: { code: string; message: string } }
        | null
      if (!json) throw new Error(`pairing failed: HTTP ${response.status}`)
      if (!json.ok) throw new Error(`${json.error.code}: ${json.error.message}`)

      setPairing({
        code: json.code,
        expiresAt: json.expiresAt,
        worldId: json.worldId,
        scopes: json.scopes,
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

  const canSend = relayBridge.status === 'paired' && Boolean(input.trim()) && !isStreaming
  const countdown = pairing ? formatPairingCountdown(pairing.expiresAt, countdownNow) : ''
  const relayLabel = relayStatusLabel(relayBridge.status)

  if (!isVisible || typeof document === 'undefined') return null

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'hermes-hosted-relay-panel'}
      data-ui-panel
      className={`${embedded ? 'relative h-full w-full' : 'fixed'} flex flex-col overflow-hidden rounded-xl border border-amber-500/24 bg-[#120c04] text-amber-50 shadow-2xl`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: 16, top: 120, width: 420, height: 620 }),
        width: embedded ? '100%' : undefined,
        height: embedded ? '100%' : undefined,
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
      <div className="flex items-center justify-between border-b border-white/10 bg-black/25 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-bold tracking-wide text-amber-300">Hermes</span>
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

      <div className="border-b border-white/10 bg-black/18 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-amber-200/70">hosted relay</div>
            <div className="mt-1 truncate text-[11px] text-amber-100/60" title={activeWorldId || ''}>
              world {activeWorldId ? activeWorldId.slice(0, 10) : 'none'}
            </div>
          </div>
          <button
            data-no-drag
            onClick={() => void requestPairing()}
            disabled={pairingBusy || !activeWorldId}
            className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-50 transition hover:bg-amber-400/18 disabled:cursor-wait disabled:opacity-45"
          >
            {pairingBusy ? 'minting' : 'mint code'}
          </button>
        </div>

        {pairing && (
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
              onClick={() => { void copyText(pairingCommand); flashCopied('command') }}
              className="w-full rounded-lg border border-white/10 bg-black/24 px-3 py-2 text-left transition hover:border-amber-300/35"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100/62">
                run beside Hermes
              </span>
              <span className="mt-1 block break-all font-mono text-[11px] leading-5 text-amber-50/88">
                {copied === 'command' ? 'copied ' : ''}{pairingCommand}
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

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4b5563 transparent' }}>
        {messages.length === 0 && (
          <div className="flex h-full flex-col justify-center px-4 text-center">
            <div className="text-sm text-amber-100">Hermes relay chat is ready to pair.</div>
            <div className="mt-2 text-xs leading-5 text-amber-100/62">
              Mint a code, run the bridge beside Hermes, then chat through this window.
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map(message => (
            <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className="max-w-[88%] rounded-lg px-3 py-2 text-xs leading-relaxed"
                style={{
                  background: message.role === 'user' ? 'rgba(245,158,11,0.16)' : 'rgba(0,0,0,0.48)',
                  border: message.role === 'user' ? '1px solid rgba(245,158,11,0.22)' : '1px solid rgba(255,255,255,0.06)',
                  whiteSpace: 'pre-wrap',
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
            className="min-h-[48px] flex-1 resize-none rounded-lg border border-amber-500/18 bg-white/[0.06] px-3 py-2 text-xs text-white outline-none placeholder:text-amber-100/45 disabled:opacity-60"
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
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
