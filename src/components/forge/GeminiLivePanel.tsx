'use client'

import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useUILayer } from '@/lib/input-manager'
import {
  GEMINI_AGENT_TYPE,
  GEMINI_LIVE_MODELS,
  type GeminiLiveConfigPayload,
  type GeminiLiveConnectionState,
  type GeminiLiveSessionPayload,
} from '@/lib/gemini-live'
import { useOasisStore } from '@/store/oasisStore'

interface GeminiLivePanelProps {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
}

interface GeminiTranscriptMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTimestamp(value: number): string {
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function StatusBadge({ state }: { state: GeminiLiveConnectionState }) {
  const palette = state === 'error'
    ? { color: '#fda4af', border: 'rgba(244,63,94,0.32)', background: 'rgba(127,29,29,0.2)' }
    : state === 'ready'
      ? { color: '#86efac', border: 'rgba(16,185,129,0.32)', background: 'rgba(6,78,59,0.18)' }
      : state === 'starting'
        ? { color: '#fbbf24', border: 'rgba(245,158,11,0.32)', background: 'rgba(120,53,15,0.18)' }
        : { color: '#a5f3fc', border: 'rgba(34,211,238,0.28)', background: 'rgba(8,51,68,0.18)' }

  const label = state === 'ready'
    ? 'manifest'
    : state === 'starting'
      ? 'starting'
      : state === 'stopped'
        ? 'stopped'
        : state

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em]"
      style={{ color: palette.color, borderColor: palette.border, background: palette.background }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: palette.color }} />
      {label}
    </span>
  )
}

function messageTone(role: GeminiTranscriptMessage['role']) {
  switch (role) {
    case 'assistant':
      return { border: 'rgba(34,211,238,0.28)', background: 'rgba(8,51,68,0.18)', label: '#a5f3fc' }
    case 'user':
      return { border: 'rgba(16,185,129,0.24)', background: 'rgba(6,78,59,0.16)', label: '#86efac' }
    case 'tool':
      return { border: 'rgba(245,158,11,0.26)', background: 'rgba(120,53,15,0.16)', label: '#fcd34d' }
    default:
      return { border: 'rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.28)', label: '#cbd5e1' }
  }
}

export function GeminiLivePanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
}: GeminiLivePanelProps) {
  useUILayer('gemini-live', isOpen && !embedded)

  const [config, setConfig] = useState<GeminiLiveConfigPayload | null>(null)
  const [configError, setConfigError] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>(GEMINI_LIVE_MODELS[0])
  const [connectionState, setConnectionState] = useState<GeminiLiveConnectionState>('idle')
  const [connectionDetail, setConnectionDetail] = useState('Idle.')
  const [session, setSession] = useState<GeminiLiveSessionPayload | null>(null)
  const [messages, setMessages] = useState<GeminiTranscriptMessage[]>([
    {
      id: makeId('gemini-system'),
      role: 'system',
      content: 'Gemini Live lab initialized.',
      timestamp: Date.now(),
    },
  ])
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  const activeWorldId = useOasisStore(state => state.activeWorldId)
  const activeWorldName = useOasisStore(state => state.worldRegistry.find(world => world.id === state.activeWorldId)?.name || 'Current world')
  const enterPlacementMode = useOasisStore(state => state.enterPlacementMode)

  const modelOptions = useMemo(() => {
    return config?.models?.length ? config.models : [...GEMINI_LIVE_MODELS]
  }, [config])

  const appendMessage = useCallback((role: GeminiTranscriptMessage['role'], content: string) => {
    setMessages(current => [
      ...current,
      {
        id: makeId(`gemini-${role}`),
        role,
        content,
        timestamp: Date.now(),
      },
    ].slice(-80))
  }, [])

  useEffect(() => {
    if (!isOpen && !embedded) return
    let cancelled = false
    setConfigError('')

    fetch('/api/gemini-live/config', { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload?.error || `Config request failed (${response.status})`)
        }
        return payload as GeminiLiveConfigPayload
      })
      .then(payload => {
        if (cancelled) return
        setConfig(payload)
        setSelectedModel(current => payload.models.includes(current) ? current : payload.model)
      })
      .catch(error => {
        if (cancelled) return
        setConfigError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [embedded, isOpen])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const startSession = useCallback(async () => {
    if (connectionState === 'starting' || connectionState === 'ready') return
    setConnectionState('starting')
    setConnectionDetail('Preparing server-side Gemini Live manifest.')
    setSession(null)

    try {
      const response = await fetch('/api/gemini-live/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          worldId: activeWorldId,
          worldName: activeWorldName,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || `Session request failed (${response.status})`)
      }

      const manifest = payload as GeminiLiveSessionPayload
      setSession(manifest)
      setConnectionState('ready')
      setConnectionDetail('Manifest ready. Live WebSocket/audio transport is still intentionally unattached.')
      appendMessage('system', `Session ${manifest.sessionId} prepared for ${manifest.model}.`)
      appendMessage('tool', `Declared Oasis tools: ${manifest.toolDeclarationNames.join(', ')}.`)
    } catch (error) {
      setConnectionState('error')
      const message = error instanceof Error ? error.message : String(error)
      setConnectionDetail(message)
      appendMessage('system', `Session start failed: ${message}`)
    }
  }, [activeWorldId, activeWorldName, appendMessage, connectionState, selectedModel])

  const stopSession = useCallback(() => {
    setSession(null)
    setConnectionState('stopped')
    setConnectionDetail('Stopped locally.')
    appendMessage('system', 'Gemini Live lab session stopped.')
  }, [appendMessage])

  const placeGeminiWindow = useCallback(() => {
    enterPlacementMode({
      type: 'agent',
      name: 'Gemini',
      agentType: GEMINI_AGENT_TYPE,
      agentRenderMode: 'live-html',
    })
    if (!embedded) onClose()
  }, [embedded, enterPlacementMode, onClose])

  const configured = Boolean(config?.configured)
  const canStart = configured && connectionState !== 'starting' && connectionState !== 'ready'
  const containerStyle = embedded
    ? {
        position: 'relative' as const,
        width: '100%',
        height: '100%',
        borderRadius: 0,
      }
    : {
        position: 'fixed' as const,
        top: 92,
        left: 88,
        width: 470,
        maxWidth: 'calc(100vw - 112px)',
        height: 'min(760px, calc(100vh - 128px))',
        borderRadius: 16,
        zIndex: 9998,
      }

  const panelBody = (
    <div
      data-ui-panel=""
      className="flex flex-col overflow-hidden border shadow-2xl"
      style={{
        ...containerStyle,
        borderColor: 'rgba(34,211,238,0.22)',
        background: 'linear-gradient(145deg, rgba(5,16,22,0.96), rgba(12,18,28,0.95) 50%, rgba(22,18,8,0.92))',
        boxShadow: embedded ? 'none' : '0 22px 80px rgba(0,0,0,0.55), 0 0 40px rgba(34,211,238,0.16)',
        color: '#e0f2fe',
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'rgba(34,211,238,0.16)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-black" style={{ borderColor: 'rgba(34,211,238,0.34)', color: '#67e8f9', background: 'rgba(8,51,68,0.3)' }}>
              G
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100">Gemini Live Lab</div>
              <div className="text-[11px] text-cyan-100/55">{activeWorldName}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge state={connectionState} />
          {!hideCloseButton && !embedded && (
            <button
              onClick={onClose}
              className="rounded-lg border px-2 py-1 text-xs text-cyan-100/70 transition hover:text-white"
              style={{ borderColor: 'rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.35)' }}
              aria-label="Close Gemini Live lab"
            >
              x
            </button>
          )}
        </div>
      </div>

      <div className="border-b px-4 py-3" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(2,6,23,0.26)' }}>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-[10px] font-mono uppercase tracking-[0.16em] text-cyan-100/60">
            model
            <select
              value={selectedModel}
              disabled={connectionState === 'starting' || connectionState === 'ready'}
              onChange={event => setSelectedModel(event.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-xs outline-none disabled:opacity-50"
              style={{ borderColor: 'rgba(34,211,238,0.2)', background: 'rgba(8,13,24,0.92)', color: '#ecfeff' }}
            >
              {modelOptions.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </label>
          <button
            onClick={placeGeminiWindow}
            className="self-end rounded-lg border px-3 py-2 text-[10px] font-mono uppercase tracking-[0.14em] transition hover:-translate-y-0.5"
            style={{ borderColor: 'rgba(16,185,129,0.28)', background: 'rgba(6,78,59,0.22)', color: '#bbf7d0' }}
          >
            place 3D
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-cyan-100/55">
          <span>env: {configured ? 'configured' : 'missing'}</span>
          <span>transport: {session?.transport || 'idle'}</span>
          <span>tools: {config?.toolDeclarations.length ?? 0}</span>
        </div>
        {configError && <div className="mt-2 text-[12px] text-rose-300">{configError}</div>}
        {config && !configured && (
          <div className="mt-2 text-[12px] text-amber-300">GEMINI_API_KEY is missing on the server.</div>
        )}
      </div>

      <div className="border-b px-4 py-3 text-[12px] leading-5 text-cyan-50/82" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(15,23,42,0.22)' }}>
        <div>{connectionDetail}</div>
        {session && (
          <div className="mt-1 text-cyan-100/52">
            WebSocket endpoint and setup payload are prepared server-side; raw API keys stay server-only.
          </div>
        )}
      </div>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map(message => {
          const tone = messageTone(message.role)
          return (
            <div
              key={message.id}
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: tone.border, background: tone.background }}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.16em]">
                <span style={{ color: tone.label }}>{message.role}</span>
                <span className="text-cyan-100/35">{formatTimestamp(message.timestamp)}</span>
              </div>
              <div className="whitespace-pre-wrap text-[13px] leading-5 text-cyan-50/90">{message.content}</div>
            </div>
          )
        })}
      </div>

      <div className="border-t px-4 py-4" style={{ borderColor: 'rgba(34,211,238,0.12)', background: 'rgba(2,6,23,0.32)' }}>
        <button
          onClick={connectionState === 'ready' ? stopSession : startSession}
          disabled={connectionState === 'ready' ? false : !canStart}
          className="w-full rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-[0.16em] transition disabled:opacity-40"
          style={{
            borderColor: connectionState === 'ready' ? 'rgba(251,146,60,0.36)' : 'rgba(34,211,238,0.32)',
            background: connectionState === 'ready'
              ? 'rgba(124,45,18,0.2)'
              : 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(16,185,129,0.18))',
            color: connectionState === 'ready' ? '#fed7aa' : '#cffafe',
          }}
        >
          {connectionState === 'ready' ? 'Stop Conversation' : connectionState === 'starting' ? 'Starting...' : 'Start Conversation'}
        </button>
      </div>
    </div>
  )

  if (embedded) return panelBody
  if (!isOpen || typeof document === 'undefined') return null
  return createPortal(panelBody, document.body)
}
