'use client'

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useUILayer } from '@/lib/input-manager'
import { fmtTokens, getFreshInputTokens, type CodexUsage } from '@/lib/codex-engine'
import { useOasisStore } from '@/store/oasisStore'
import { dispatch } from '@/lib/event-bus'

import { SettingsContext } from '../scene-lib'
import { CodexContent } from './CodexContent'

const DEFAULT_POS = { x: 104, y: 60 }
const DEFAULT_WIDTH = 540
const DEFAULT_HEIGHT = 680
const MIN_WIDTH = 420
const MIN_HEIGHT = 420

const SESSION_KEY = 'oasis-codex-session'
const MODEL_KEY = 'oasis-codex-model'
const POS_KEY = 'oasis-codex-pos'
const SIZE_KEY = 'oasis-codex-size'

interface CodexModelOption {
  id: string
  label: string
  description?: string
  defaultReasoningLevel?: string
  supportedReasoningLevels?: string[]
}

interface CodexModelsResponse {
  models?: CodexModelOption[]
  defaultModel?: string
  configuredModelSource?: 'project' | 'user' | 'recommended' | 'fallback'
}

interface CodexSessionOption {
  sessionId: string
  title?: string
  model?: string
  lastUserPrompt?: string
  lastMessage?: string
  lastMessageRole?: string
  lastMessageAt?: string
  updatedAt?: string
  messageCount?: number
  filePath?: string
}

interface CodexSessionsResponse {
  records?: CodexSessionOption[]
}

function emptyUsage(): CodexUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  }
}

function usageTitle(usage: CodexUsage): string {
  const freshInputTokens = getFreshInputTokens(usage)
  const parts = [
    `last turn total input ${usage.inputTokens.toLocaleString()}`,
    `fresh input ${freshInputTokens.toLocaleString()}`,
    `cached ${usage.cachedInputTokens.toLocaleString()}`,
    `output ${usage.outputTokens.toLocaleString()}`,
  ]
  return parts.join(' • ')
}

function formatSessionTimestamp(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sessionLabel(option: CodexSessionOption): string {
  const title = option.title || option.lastUserPrompt || option.lastMessage || option.sessionId
  const time = formatSessionTimestamp(option.lastMessageAt || option.updatedAt)
  const model = option.model ? ` / ${option.model}` : ''
  const suffix = time ? ` / ${time}` : ''
  const label = `${title}${model}${suffix}`
  return label.length > 90 ? `${label.slice(0, 87).trim()}...` : label
}

type CodexPanelProps = {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
  windowId?: string
  initialSessionId?: string
  windowBlur?: number
}

export function CodexPanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
  windowId,
  initialSessionId,
  windowBlur = 0,
}: CodexPanelProps) {
  useUILayer('codex', isOpen && !embedded)

  const { settings } = useContext(SettingsContext)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('codex', 9999))
  const isFocused = useOasisStore(s => windowId ? s.focusedAgentWindowId === windowId : false)
  const startAgentWork = useOasisStore(s => s.startAgentWork)
  const finishAgentWork = useOasisStore(s => s.finishAgentWork)
  const updateAgentWindow = useOasisStore(s => s.updateAgentWindow)

  const [isStreaming, setIsStreaming] = useState(false)
  const [latestUsage, setLatestUsage] = useState<CodexUsage>(emptyUsage())
  const [sessionId, setSessionId] = useState<string>(() => {
    if (initialSessionId) return initialSessionId
    if (typeof window === 'undefined' || embedded || windowId) return ''
    try {
      return localStorage.getItem(SESSION_KEY) || ''
    } catch {
      return ''
    }
  })
  const [resetKey, setResetKey] = useState(0)
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined' || embedded) return DEFAULT_POS
    try {
      const saved = localStorage.getItem(POS_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch {
      return DEFAULT_POS
    }
  })
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined' || embedded) return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem(SIZE_KEY)
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch {
      return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [model, setModel] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return localStorage.getItem(MODEL_KEY) || ''
    } catch {
      return ''
    }
  })
  const [modelOptions, setModelOptions] = useState<CodexModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [configuredModelSource, setConfiguredModelSource] = useState<'project' | 'user' | 'recommended' | 'fallback'>('fallback')
  const [sessionOptions, setSessionOptions] = useState<CodexSessionOption[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const activityRunIdRef = useRef<string | null>(null)

  const handleStreamingChange = useCallback((streaming: boolean) => {
    setIsStreaming(streaming)
    if (streaming) {
      if (activityRunIdRef.current) return
      const runId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      activityRunIdRef.current = runId
      startAgentWork('codex', runId, sessionId || undefined)
      return
    }
    const runId = activityRunIdRef.current
    if (!runId) return
    activityRunIdRef.current = null
    finishAgentWork('codex', runId)
  }, [finishAgentWork, sessionId, startAgentWork])

  useEffect(() => () => {
    const runId = activityRunIdRef.current
    if (!runId) return
    activityRunIdRef.current = null
    finishAgentWork('codex', runId)
  }, [finishAgentWork])

  const isVisible = embedded || isOpen

  const loadSessionOptions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const response = await fetch('/api/codex/sessions?limit=60', { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as CodexSessionsResponse
      const records = Array.isArray(data.records)
        ? data.records.filter(record => typeof record.sessionId === 'string' && record.sessionId.trim())
        : []
      setSessionOptions(records)
    } catch {
      setSessionOptions([])
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    if (!isVisible) return
    let cancelled = false

    const loadModels = async () => {
      setLoadingModels(true)
      try {
        const response = await fetch('/api/codex/models', { cache: 'no-store' })
        const data = await response.json() as CodexModelsResponse
        if (cancelled) return

        const options = Array.isArray(data.models) && data.models.length > 0
          ? data.models
          : [{ id: 'gpt-5.4', label: 'gpt-5.4' }]
        const storedModel = typeof window !== 'undefined'
          ? localStorage.getItem(MODEL_KEY) || ''
          : ''
        const currentModel = options.some(option => option.id === model) ? model : ''
        const nextModel = currentModel
          || (storedModel && options.some(option => option.id === storedModel) ? storedModel : '')
          || (data.defaultModel && options.some(option => option.id === data.defaultModel) ? data.defaultModel : '')
          || options[0].id

        setModelOptions(options)
        setConfiguredModelSource(data.configuredModelSource || 'fallback')
        setModel(nextModel)
      } catch {
        if (cancelled) return
        const fallbackModel = model || 'gpt-5.4'
        setModelOptions([{ id: fallbackModel, label: fallbackModel }])
        setConfiguredModelSource('fallback')
        if (!model) setModel(fallbackModel)
      } finally {
        if (!cancelled) setLoadingModels(false)
      }
    }

    void loadModels()
    return () => {
      cancelled = true
    }
  }, [isVisible])

  useEffect(() => {
    if (embedded || windowId || typeof window === 'undefined' || !model) return
    try {
      localStorage.setItem(MODEL_KEY, model)
    } catch {
      // Ignore localStorage failures.
    }
  }, [embedded, model, windowId])

  useEffect(() => {
    if (!isVisible) return
    void loadSessionOptions()
  }, [isVisible, loadSessionOptions])

  useEffect(() => {
    if (!isVisible || !sessionId) return
    const timeout = window.setTimeout(() => void loadSessionOptions(), 900)
    return () => window.clearTimeout(timeout)
  }, [isVisible, loadSessionOptions, sessionId])

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    if (embedded) return
    if ((event.target as HTMLElement).closest('button, textarea, select, input')) return
    setIsDragging(true)
    dragStart.current = { x: event.clientX - position.x, y: event.clientY - position.y }
  }, [embedded, position])

  const handleDrag = useCallback((event: MouseEvent) => {
    if (embedded || !isDragging) return
    const next = { x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y }
    setPosition(next)
    localStorage.setItem(POS_KEY, JSON.stringify(next))
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
    const next = {
      w: Math.max(MIN_WIDTH, resizeStart.current.w + (event.clientX - resizeStart.current.x)),
      h: Math.max(MIN_HEIGHT, resizeStart.current.h + (event.clientY - resizeStart.current.y)),
    }
    setSize(next)
    localStorage.setItem(SIZE_KEY, JSON.stringify(next))
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

  const baseUiOpacity = Math.max(0.3, Math.min(1, settings.uiOpacity || 0.85))
  const panelBackgroundAlpha = embedded
    ? (windowBlur > 0 ? baseUiOpacity * 0.6 : baseUiOpacity)
    : Math.min(0.98, baseUiOpacity + 0.1)
  const panelStyle = {
    backgroundColor: `rgba(7, 12, 10, ${panelBackgroundAlpha})`,
    ...(embedded && windowBlur > 0 ? {
      backdropFilter: `blur(${windowBlur}px)`,
      WebkitBackdropFilter: `blur(${windowBlur}px)`,
    } : {}),
  }

  const usageVisible = latestUsage.inputTokens > 0 || latestUsage.cachedInputTokens > 0 || latestUsage.outputTokens > 0
  const freshInputTokens = getFreshInputTokens(latestUsage)
  const modelSelectTitle = configuredModelSource === 'project'
    ? 'Default model comes from .codex/config.toml in this repo.'
    : configuredModelSource === 'user'
      ? 'Default model comes from your user Codex config.'
      : configuredModelSource === 'recommended'
        ? 'Default model comes from the local Codex model catalog.'
        : 'Using a local fallback model.'

  const activeModel = useMemo(() => modelOptions.find(option => option.id === model), [model, modelOptions])
  const visibleSessionOptions = useMemo(() => {
    if (!sessionId || sessionOptions.some(option => option.sessionId === sessionId)) return sessionOptions
    return [{ sessionId, title: 'Current Codex session' }, ...sessionOptions]
  }, [sessionId, sessionOptions])

  const switchSession = useCallback((nextSessionId: string) => {
    if (isStreaming) return
    setSessionId(nextSessionId)
    if (windowId) updateAgentWindow(windowId, { sessionId: nextSessionId || undefined })
    setLatestUsage(emptyUsage())
    if (!embedded && !windowId) {
      try {
        if (nextSessionId) localStorage.setItem(SESSION_KEY, nextSessionId)
        else localStorage.removeItem(SESSION_KEY)
      } catch {
        // Ignore localStorage failures.
      }
    }
    setResetKey(prev => prev + 1)
  }, [embedded, isStreaming, updateAgentWindow, windowId])

  const handleSessionChange = useCallback((nextSessionId: string) => {
    setSessionId(nextSessionId)
    if (windowId) updateAgentWindow(windowId, { sessionId: nextSessionId || undefined })
  }, [updateAgentWindow, windowId])

  if (!isVisible || typeof document === 'undefined') return null

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'codex-panel'}
      className={`${embedded ? 'relative w-full h-full' : 'fixed'} rounded-xl flex flex-col overflow-hidden`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        ...panelStyle,
        border: `1px solid ${isStreaming ? 'rgba(16,185,129,0.6)' : 'rgba(16,185,129,0.22)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(16,185,129,0.16), inset 0 0 60px rgba(16,185,129,0.04)'
          : '0 8px 40px rgba(0,0,0,0.8)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={embedded ? undefined : event => {
        event.stopPropagation()
        useOasisStore.getState().bringPanelToFront('codex')
      }}
      onPointerDown={event => event.stopPropagation()}
      onClick={embedded ? event => event.stopPropagation() : undefined}
    >
      <div
        onMouseDown={handleDragStart}
        className={`flex items-center justify-between px-3 py-2 border-b border-white/10 select-none ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(16,24,20,0.6)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>⌘</span>
          <span className="text-emerald-300 font-bold text-sm tracking-wide">Codex</span>
          {sessionId && (
            <span className="text-[9px] text-gray-600 font-mono truncate" title={sessionId}>
              {sessionId.slice(0, 8)}...
            </span>
          )}
          {isStreaming && (
            <span className="text-[10px] text-emerald-300 animate-pulse font-mono">
              ● executing
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={model}
            onChange={event => setModel(event.target.value)}
            disabled={isStreaming || loadingModels}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: activeModel ? '#34d399' : '#d1d5db' }}
            title={modelSelectTitle}
          >
            {modelOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={sessionId}
            onChange={event => switchSession(event.target.value)}
            disabled={isStreaming || loadingSessions}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none max-w-[180px]"
            style={{ color: sessionId ? '#93c5fd' : '#6b7280' }}
            title="Codex sessions from ~/.codex session files, with Oasis cache metadata when available."
          >
            <option value="">new thread</option>
            {visibleSessionOptions.map(option => (
              <option key={option.sessionId} value={option.sessionId}>
                {sessionLabel(option)}
              </option>
            ))}
          </select>

          <button
            onClick={() => void loadSessionOptions()}
            disabled={isStreaming || loadingSessions}
            className="text-[10px] text-gray-500 hover:text-emerald-300 px-1.5 py-0.5 rounded border border-gray-800 hover:border-emerald-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="Refresh Codex sessions"
          >
            refresh
          </button>

          {usageVisible && (
            <div
              className="flex items-center gap-2 text-[9px] font-mono"
              style={{ fontVariantNumeric: 'tabular-nums' }}
              title={usageTitle(latestUsage)}
            >
              <span className="text-emerald-400/80">fresh {fmtTokens(freshInputTokens)}</span>
              {latestUsage.cachedInputTokens > 0 && (
                <span className="text-emerald-200/80">cached {fmtTokens(latestUsage.cachedInputTokens)}</span>
              )}
              <span className="text-amber-400/80">out {fmtTokens(latestUsage.outputTokens)}</span>
            </div>
          )}

          <button
            onClick={() => switchSession('')}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-emerald-300 px-1.5 py-0.5 rounded border border-gray-800 hover:border-emerald-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="Start a fresh Codex thread"
          >
            +new
          </button>

          {!embedded && (
            <button
              onClick={() => {
                dispatch({
                  type: 'ENTER_PLACEMENT',
                  payload: {
                    pending: {
                      type: 'agent',
                      name: 'Codex',
                      agentType: 'codex',
                      agentSessionId: undefined,
                    },
                  },
                })
                onClose()
              }}
              disabled={isStreaming}
              className="text-[10px] text-gray-500 hover:text-emerald-300 px-1.5 py-0.5 rounded border border-gray-800 hover:border-emerald-500/30 transition-all cursor-pointer disabled:opacity-30"
              title="Place a fresh Codex window in the 3D world"
            >
              +place
            </button>
          )}

          {!hideCloseButton && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <CodexContent
        key={resetKey}
        compact={embedded}
        initialSessionId={resetKey > 0 ? (sessionId || undefined) : (sessionId || initialSessionId)}
        windowId={windowId}
        isFocused={isFocused}
        model={model}
        onSessionChange={handleSessionChange}
        onStreamingChange={handleStreamingChange}
        onLatestUsageChange={setLatestUsage}
      />

      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(16,185,129,0.3) 50%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
