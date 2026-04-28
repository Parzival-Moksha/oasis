'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '../../store/oasisStore'
import { MODELS, fmtTokens } from '../../lib/anorak-engine'
import { AnorakContent } from './AnorakContent'
import { dispatch } from '../../lib/event-bus'
import { useUILayer } from '@/lib/input-manager'

const DEFAULT_POS = { x: 60, y: 60 }
const MIN_WIDTH = 420
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 650

const SESSION_KEY = 'oasis-anorak-session'
const POS_KEY = 'oasis-anorak-pos'
const SIZE_KEY = 'oasis-anorak-size'

type AnorakPanelProps = {
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  hideCloseButton?: boolean
  windowId?: string
  initialSessionId?: string
  windowBlur?: number
}

export function AnorakPanel({
  isOpen,
  onClose,
  embedded = false,
  hideCloseButton = false,
  windowId,
  initialSessionId,
  windowBlur = 0,
}: AnorakPanelProps) {
  useUILayer('anorak', isOpen && !embedded)
  const { settings } = useContext(SettingsContext)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('anorak', 9999))
  const isFocused = useOasisStore(s => windowId ? s.focusedAgentWindowId === windowId : false)
  const startAgentWork = useOasisStore(s => s.startAgentWork)
  const finishAgentWork = useOasisStore(s => s.finishAgentWork)

  const [isStreaming, setIsStreaming] = useState(false)
  const [model, setModel] = useState('opus')
  const [totalCost, setTotalCost] = useState(0)
  const [liveTokens, setLiveTokens] = useState({ input: 0, output: 0 })
  const [sessionId, setSessionId] = useState<string>(() => {
    if (initialSessionId) return initialSessionId
    if (typeof window === 'undefined' || embedded || windowId) return ''
    try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
  })
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const activityRunIdRef = useRef<string | null>(null)

  const handleStreamingChange = useCallback((streaming: boolean) => {
    setIsStreaming(streaming)
    if (streaming) {
      if (activityRunIdRef.current) return
      const runId = `anorak-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      activityRunIdRef.current = runId
      startAgentWork('anorak', runId, sessionId || undefined)
      return
    }
    const runId = activityRunIdRef.current
    if (!runId) return
    activityRunIdRef.current = null
    finishAgentWork('anorak', runId)
  }, [finishAgentWork, sessionId, startAgentWork])

  useEffect(() => () => {
    const runId = activityRunIdRef.current
    if (!runId) return
    activityRunIdRef.current = null
    finishAgentWork('anorak', runId)
  }, [finishAgentWork])

  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined' || embedded) return DEFAULT_POS
    try {
      const saved = localStorage.getItem(POS_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch {
      return DEFAULT_POS
    }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined' || embedded) return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem(SIZE_KEY)
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch {
      return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (embedded) return
    if ((e.target as HTMLElement).closest('button, textarea, select, input')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [embedded, position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (embedded || !isDragging) return
    const next = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(next)
    localStorage.setItem(POS_KEY, JSON.stringify(next))
  }, [embedded, isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (embedded) return
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [embedded, size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (embedded || !isResizing) return
    const nextW = Math.max(MIN_WIDTH, resizeStart.current.w + (e.clientX - resizeStart.current.x))
    const nextH = Math.max(MIN_HEIGHT, resizeStart.current.h + (e.clientY - resizeStart.current.y))
    const next = { w: nextW, h: nextH }
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

  const isVisible = embedded || isOpen
  if (!isVisible || typeof document === 'undefined') return null

  const modelColor = MODELS.find(entry => entry.id === model)?.color || '#38bdf8'
  const baseUiOpacity = Math.max(0.3, Math.min(1, settings.uiOpacity || 0.85))
  const panelBackgroundAlpha = embedded
    ? (windowBlur > 0 ? baseUiOpacity * 0.6 : baseUiOpacity)
    : Math.min(0.98, baseUiOpacity + 0.1)
  const panelStyle = {
    backgroundColor: `rgba(8, 10, 15, ${panelBackgroundAlpha})`,
    ...(embedded && windowBlur > 0 ? {
      backdropFilter: `blur(${windowBlur}px)`,
      WebkitBackdropFilter: `blur(${windowBlur}px)`,
    } : {}),
  }

  const panelBody = (
    <div
      data-menu-portal={embedded ? undefined : 'anorak-panel'}
      className={`${embedded ? 'relative w-full h-full' : 'fixed'} rounded-xl flex flex-col overflow-hidden`}
      style={{
        ...(embedded ? {} : { zIndex: panelZIndex, left: position.x, top: position.y }),
        width: embedded ? '100%' : size.w,
        height: embedded ? '100%' : size.h,
        ...panelStyle,
        border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(56,189,248,0.2), inset 0 0 60px rgba(56,189,248,0.03)'
          : '0 8px 40px rgba(0,0,0,0.8)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={embedded ? undefined : e => {
        e.stopPropagation()
        useOasisStore.getState().bringPanelToFront('anorak')
      }}
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onClick={embedded ? e => e.stopPropagation() : undefined}
    >
      <div
        onMouseDown={handleDragStart}
        className={`flex items-center justify-between px-3 py-2 border-b border-white/10 select-none ${embedded ? '' : 'cursor-grab active:cursor-grabbing'}`}
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(20,20,30,0.5)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>💻</span>
          <span className="text-sky-400 font-bold text-sm tracking-wide">Anorak</span>
          {sessionId && (
            <span className="text-[9px] text-gray-600 font-mono truncate" title={sessionId}>
              {sessionId.slice(0, 8)}...
            </span>
          )}
          {isStreaming && (
            <span className="text-[10px] text-sky-300 animate-pulse font-mono">
              ● executing
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={isStreaming}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: modelColor }}
          >
            {MODELS.map(entry => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>

          {totalCost > 0 && (
            <span className="text-[9px] text-gray-500 font-mono" title="Total session cost">
              ${totalCost.toFixed(3)}
            </span>
          )}

          {isStreaming && (liveTokens.input > 0 || liveTokens.output > 0) && (
            <div className="flex items-center gap-1 text-[9px] font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="text-sky-400/70">
                {fmtTokens(liveTokens.input)}↓
              </span>
              <span className="text-amber-400/70">
                {fmtTokens(liveTokens.output)}↑
              </span>
            </div>
          )}

          <button
            onClick={() => setShowSessionPicker(prev => !prev)}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="Session history"
          >
            {showSessionPicker ? '▼' : '▸'} sessions
          </button>

          <button
            onClick={() => {
              if (isStreaming) return
              setSessionId('')
              setTotalCost(0)
              setLiveTokens({ input: 0, output: 0 })
              setShowSessionPicker(false)
              if (!embedded && !windowId) localStorage.removeItem(SESSION_KEY)
              setResetKey(prev => prev + 1)
            }}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="New session"
          >
            +new
          </button>

          {!embedded && (
            <button
              onClick={() => {
                dispatch({ type: 'ENTER_PLACEMENT', payload: { pending: {
                  type: 'agent',
                  name: 'Anorak',
                  agentType: 'anorak',
                  agentSessionId: undefined,
                } } })
                onClose()
              }}
              disabled={isStreaming}
              className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
              title="Place Anorak window in 3D world"
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

      <AnorakContent
        key={resetKey}
        compact={embedded}
        initialSessionId={resetKey > 0 ? undefined : initialSessionId}
        windowId={windowId}
        isFocused={isFocused}
        showSessionControls
        sessionPickerOpen={showSessionPicker}
        onSessionPickerChange={setShowSessionPicker}
        model={model}
        opacity={settings.uiOpacity}
        onStreamingChange={handleStreamingChange}
        onModelChange={setModel}
        onCostChange={setTotalCost}
        onLiveTokensChange={setLiveTokens}
        onSessionChange={setSessionId}
      />

      {!embedded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(56,189,248,0.3) 50%)',
            borderRadius: '0 0 12px 0',
          }}
        />
      )}
    </div>
  )

  if (embedded) return panelBody
  return createPortal(panelBody, document.body)
}
