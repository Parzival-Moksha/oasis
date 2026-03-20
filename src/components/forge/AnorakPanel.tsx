'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PANEL — 2D overlay chrome for Claude Code Agent
// ─═̷─═̷─ॐ─═̷─═̷─ Drag, resize, header. Content lives in AnorakContent. ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '../../store/oasisStore'
import { MODELS, fmtTokens } from '../../lib/anorak-engine'
import { AnorakContent } from './AnorakContent'
import { dispatch } from '../../lib/event-bus'

// ═══════════════════════════════════════════════════════════════════════════
// PANEL LAYOUT CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 60, y: 60 }
const MIN_WIDTH = 420
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 650

const SESSION_KEY = 'oasis-anorak-session'
const POS_KEY = 'oasis-anorak-pos'
const SIZE_KEY = 'oasis-anorak-size'

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PANEL — main exported component
// ═══════════════════════════════════════════════════════════════════════════

export function AnorakPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings } = useContext(SettingsContext)

  // State synced from AnorakContent via callbacks
  const [isStreaming, setIsStreaming] = useState(false)
  const [model, setModel] = useState('opus')
  const [totalCost, setTotalCost] = useState(0)
  const [liveTokens, setLiveTokens] = useState({ input: 0, output: 0 })
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
  })
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem(POS_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  // ─═̷─ Resize state ─═̷─
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem(SIZE_KEY)
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  // ─═̷─ Drag handlers ─═̷─
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea, select, input')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(newPos)
    localStorage.setItem(POS_KEY, JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // ─═̷─ Resize handlers ─═̷─
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const newW = Math.max(MIN_WIDTH, resizeStart.current.w + (e.clientX - resizeStart.current.x))
    const newH = Math.max(MIN_HEIGHT, resizeStart.current.h + (e.clientY - resizeStart.current.y))
    setSize({ w: newW, h: newH })
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: newW, h: newH }))
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
  }, [isDragging, handleDrag, handleDragEnd, isResizing, handleResize, handleResizeEnd])

  if (!isOpen || typeof document === 'undefined') return null

  const modelColor = MODELS.find(m => m.id === model)?.color || '#a855f7'

  return createPortal(
    <div
      data-menu-portal="anorak-panel"
      className="fixed z-[9999] rounded-xl flex flex-col overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        backgroundColor: `rgba(8, 10, 15, ${Math.min(0.98, (settings.uiOpacity || 0.85) + 0.1)})`,
        border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        boxShadow: isStreaming
          ? `0 0 40px rgba(56,189,248,0.2), inset 0 0 60px rgba(56,189,248,0.03)`
          : '0 8px 40px rgba(0,0,0,0.8)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(20,20,30,0.5)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>💻</span>
          <span className="text-sky-400 font-bold text-sm tracking-wide">Anorak</span>
          {sessionId && (
            <span className="text-[9px] text-gray-600 font-mono" title={sessionId}>
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
          {/* Model selector */}
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={isStreaming}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: modelColor }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          {/* Cost indicator */}
          {totalCost > 0 && (
            <span className="text-[9px] text-gray-500 font-mono" title="Total session cost">
              ${totalCost.toFixed(3)}
            </span>
          )}

          {/* Live token counter */}
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

          {/* Session picker toggle */}
          <button
            onClick={() => setShowSessionPicker(prev => !prev)}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="Session history"
          >
            {showSessionPicker ? '▼' : '▸'} sessions
          </button>

          {/* New session */}
          <button
            onClick={() => {
              if (isStreaming) return
              setSessionId('')
              setTotalCost(0)
              setLiveTokens({ input: 0, output: 0 })
              localStorage.removeItem(SESSION_KEY)
              setResetKey(k => k + 1) // force AnorakContent remount
            }}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="New session"
          >
            +new
          </button>

          {/* Place in World */}
          <button
            onClick={() => {
              dispatch({ type: 'ENTER_PLACEMENT', payload: { pending: {
                type: 'agent',
                name: 'Anorak',
                agentType: 'anorak',
                agentSessionId: sessionId || undefined,
              } } })
              onClose()
            }}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="Place Anorak window in 3D world"
          >
            +place
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <AnorakContent
        key={resetKey}
        showSessionControls
        sessionPickerOpen={showSessionPicker}
        onSessionPickerChange={setShowSessionPicker}
        model={model}
        opacity={settings.uiOpacity}
        onStreamingChange={setIsStreaming}
        onModelChange={setModel}
        onCostChange={setTotalCost}
        onLiveTokensChange={setLiveTokens}
        onSessionChange={setSessionId}
      />

      {/* ═══ RESIZE HANDLE ═══ */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(56,189,248,0.3) 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />
    </div>,
    document.body
  )
}
