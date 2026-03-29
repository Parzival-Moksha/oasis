'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CONSOLE PANEL — Live server log viewer with ANSI rendering
// ─═̷─═̷─ॐ─═̷─═̷─ Draggable, resizable, opacity-aware, selectable text ─═̷─═̷─ॐ─═̷─═̷─
// Streams from /api/console/stream SSE — captures ALL server output
// including Next.js compilation messages, route timing, 404s
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useUILayer } from '@/lib/input-manager'

// ═══════════════════════════════════════════════════════════════════════════
// ANSI-to-HTML PARSER — handles common SGR escape codes
// ═══════════════════════════════════════════════════════════════════════════

const ANSI_COLORS: Record<number, string> = {
  30: '#4a4a4a', 31: '#ef4444', 32: '#22c55e', 33: '#eab308',
  34: '#3b82f6', 35: '#a855f7', 36: '#06b6d4', 37: '#d4d4d4',
  90: '#737373', 91: '#f87171', 92: '#4ade80', 93: '#facc15',
  94: '#60a5fa', 95: '#c084fc', 96: '#22d3ee', 97: '#ffffff',
}

const ANSI_BG_COLORS: Record<number, string> = {
  40: '#4a4a4a', 41: '#991b1b', 42: '#166534', 43: '#854d0e',
  44: '#1e3a8a', 45: '#6b21a8', 46: '#155e75', 47: '#d4d4d4',
}

interface AnsiSpan {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
}

function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let color: string | undefined
  let bg: string | undefined
  let bold = false
  let dim = false

  // Split on ANSI escape sequences — \x1b[...m
  const parts = raw.split(/\x1b\[([0-9;]*)m/)
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text segment
      const text = parts[i]
      if (text) spans.push({ text, color, bg, bold, dim })
    } else {
      // ANSI code segment
      const codes = parts[i].split(';').map(Number)
      for (const code of codes) {
        if (code === 0) { color = undefined; bg = undefined; bold = false; dim = false }
        else if (code === 1) bold = true
        else if (code === 2) dim = true
        else if (code === 22) { bold = false; dim = false }
        else if (code >= 30 && code <= 37) color = ANSI_COLORS[code]
        else if (code >= 90 && code <= 97) color = ANSI_COLORS[code]
        else if (code >= 40 && code <= 47) bg = ANSI_BG_COLORS[code]
        else if (code === 39) color = undefined
        else if (code === 49) bg = undefined
      }
    }
  }
  return spans
}

function AnsiLine({ text }: { text: string }) {
  const spans = useMemo(() => parseAnsi(text), [text])
  return (
    <span>
      {spans.map((s, i) => (
        <span key={i} style={{
          color: s.color,
          backgroundColor: s.bg,
          fontWeight: s.bold ? 700 : undefined,
          opacity: s.dim ? 0.6 : undefined,
        }}>
          {s.text}
        </span>
      ))}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL STYLES — color per level for badges + line text
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_STYLE: Record<string, { color: string; label: string; textColor: string }> = {
  log:   { color: '#9ca3af', label: 'LOG', textColor: '#ccc' },
  info:  { color: '#38bdf8', label: 'INF', textColor: '#7dd3fc' },
  warn:  { color: '#f59e0b', label: 'WRN', textColor: '#fcd34d' },
  error: { color: '#ef4444', label: 'ERR', textColor: '#fca5a5' },
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 16, y: 200 }
const DEFAULT_SIZE = { w: 620, h: 420 }
const MIN_SIZE = { w: 300, h: 200 }

function loadState<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : fallback
  } catch { return fallback }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSOLE PANEL
// ═══════════════════════════════════════════════════════════════════════════

interface ConsoleLine {
  ts: number
  level: 'log' | 'warn' | 'error' | 'info'
  text: string
}

export function ConsolePanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useUILayer('console', isOpen)
  const { settings } = useContext(SettingsContext)
  const bgAlpha = Math.max(0.3, Math.min(0.98, settings.uiOpacity))

  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(['log', 'info', 'warn', 'error']))
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // ─═̷─ Position + Size state (persisted) ─═̷─
  const [position, setPosition] = useState(() => loadState('oasis-console-pos', DEFAULT_POS))
  const [size, setSize] = useState(() => loadState('oasis-console-size', DEFAULT_SIZE))

  // ─═̷─ Drag state ─═̷─
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  // ─═̷─ Resize state ─═̷─
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  // SSE connection with exponential backoff reconnect
  useEffect(() => {
    if (!isOpen) {
      esRef.current?.close()
      esRef.current = null
      return
    }

    let retryDelay = 1000
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    function connect() {
      if (disposed) return
      const es = new EventSource('/api/console/stream')
      esRef.current = es

      es.onmessage = (ev) => {
        retryDelay = 1000 // reset backoff on successful message
        try {
          const line: ConsoleLine = JSON.parse(ev.data)
          setLines(prev => {
            const next = [...prev, line]
            return next.length > 800 ? next.slice(-800) : next
          })
        } catch { /* ignore parse errors */ }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        if (disposed) return
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30_000)
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      esRef.current?.close()
      esRef.current = null
    }
  }, [isOpen])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  // Detect manual scroll — snap out of auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  // Filter lines
  const filtered = useMemo(() => {
    const lc = filter.toLowerCase()
    return lines.filter(l => {
      if (!levelFilter.has(l.level)) return false
      if (lc && !l.text.toLowerCase().includes(lc)) return false
      return true
    })
  }, [lines, filter, levelFilter])

  const toggleLevel = useCallback((level: string) => {
    setLevelFilter(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  // ═══════════════════════════════════════════════════════════════════════
  // DRAG HANDLERS — title bar
  // ═══════════════════════════════════════════════════════════════════════

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = {
      x: Math.max(0, e.clientX - dragStart.current.x),
      y: Math.max(0, e.clientY - dragStart.current.y),
    }
    setPosition(newPos)
    localStorage.setItem('oasis-console-pos', JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd])

  // ═══════════════════════════════════════════════════════════════════════
  // RESIZE HANDLERS — bottom-right corner handle
  // ═══════════════════════════════════════════════════════════════════════

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const newSize = {
      w: Math.max(MIN_SIZE.w, resizeStart.current.w + (e.clientX - resizeStart.current.x)),
      h: Math.max(MIN_SIZE.h, resizeStart.current.h + (e.clientY - resizeStart.current.y)),
    }
    setSize(newSize)
    localStorage.setItem('oasis-console-size', JSON.stringify(newSize))
  }, [isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isResizing, handleResize, handleResizeEnd])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed z-[500] flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        background: `rgba(5, 5, 12, ${bgAlpha})`,
        border: '1px solid rgba(20, 184, 166, 0.25)',
        borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
        backdropFilter: 'blur(16px)',
        // Prevent panel from blocking text selection inside itself
        userSelect: isDragging || isResizing ? 'none' : undefined,
      }}
    >
      {/* ── Header / drag handle ── */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-move shrink-0"
        onMouseDown={handleDragStart}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold tracking-wider" style={{ color: '#14b8a6' }}>CONSOLE</span>
          <span className="text-[10px] font-mono" style={{ color: '#555' }}>{filtered.length}/{lines.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Level filter toggles */}
          {(['log', 'info', 'warn', 'error'] as const).map(level => {
            const active = levelFilter.has(level)
            const s = LEVEL_STYLE[level]
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all cursor-pointer"
                style={{
                  background: active ? `${s.color}22` : 'transparent',
                  color: active ? s.color : '#444',
                  border: `1px solid ${active ? `${s.color}44` : 'transparent'}`,
                }}
              >
                {s.label}
              </button>
            )
          })}
          {/* Clear */}
          <button
            onClick={() => setLines([])}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono text-gray-500 hover:text-gray-300 cursor-pointer"
            title="Clear console"
          >
            CLR
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            x
          </button>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter logs..."
          className="w-full bg-transparent text-xs font-mono text-gray-300 placeholder-gray-600 outline-none"
          style={{ userSelect: 'text' }}
        />
      </div>

      {/* ── Log lines — SELECTABLE TEXT ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-1"
        style={{
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          lineHeight: '18px',
          userSelect: 'text',
          cursor: 'text',
        }}
      >
        {filtered.map((line, i) => {
          const s = LEVEL_STYLE[line.level]
          const time = new Date(line.ts)
          const hh = String(time.getHours()).padStart(2, '0')
          const mm = String(time.getMinutes()).padStart(2, '0')
          const ss = String(time.getSeconds()).padStart(2, '0')
          return (
            <div key={`${line.ts}-${i}`} className="flex gap-1 px-1 hover:bg-white/[0.03] rounded" style={{ minHeight: 18 }}>
              <span className="select-text" style={{ color: '#444', flexShrink: 0 }}>{hh}:{mm}:{ss}</span>
              <span style={{ color: s.color, flexShrink: 0, width: 24, textAlign: 'center', fontWeight: 700 }}>
                {line.level === 'error' ? 'E' : line.level === 'warn' ? 'W' : line.level === 'info' ? 'I' : '.'}
              </span>
              <span className="break-all select-text" style={{ color: s.textColor }}>
                <AnsiLine text={line.text} />
              </span>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-8 font-mono select-none">
            {lines.length === 0 ? 'Waiting for server output...' : 'No matches'}
          </div>
        )}
      </div>

      {/* ── Footer — auto-scroll indicator ── */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true)
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
          className="mx-3 mb-2 py-1 rounded text-[10px] font-mono text-center cursor-pointer transition-colors select-none shrink-0"
          style={{ background: 'rgba(20,184,166,0.15)', color: '#14b8a6', border: '1px solid rgba(20,184,166,0.3)' }}
        >
          Scroll paused — click to resume
        </button>
      )}

      {/* ── Resize handle — bottom-right corner ── */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 cursor-nwse-resize select-none"
        style={{
          width: 20,
          height: 20,
          borderBottomRightRadius: 12,
        }}
      >
        {/* Three diagonal lines — classic resize grip */}
        <svg width="14" height="14" viewBox="0 0 14 14" style={{ position: 'absolute', bottom: 3, right: 3, opacity: 0.3 }}>
          <line x1="10" y1="14" x2="14" y2="10" stroke="#14b8a6" strokeWidth="1.5" />
          <line x1="6" y1="14" x2="14" y2="6" stroke="#14b8a6" strokeWidth="1.5" />
          <line x1="2" y1="14" x2="14" y2="2" stroke="#14b8a6" strokeWidth="1.5" />
        </svg>
      </div>
    </div>,
    document.body,
  )
}
