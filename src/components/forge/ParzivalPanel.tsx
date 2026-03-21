'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL PANEL — The Brain's Window into the Oasis
// ─═̷─═̷─ॐ─═̷─═̷─ Mode • HP • Thoughts • Chat ─═̷─═̷─ॐ─═̷─═̷─
//
// 2D overlay panel following MerlinPanel pattern.
// Streams thoughts from ae_parzival via SSE + proxied chat.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface BrainState {
  mode: string
  hp: number
  maxHp: number
  missions: Record<string, number>
  uptime: number
  heartbeat: { running: boolean; beatCount: number }
}

interface ParzivalMessage {
  id: string
  role: 'user' | 'parzival'
  content: string
  mode?: string
  toolsCalled?: string[]
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MODE_META: Record<string, { icon: string; color: string; label: string }> = {
  coach:   { icon: '🧠', color: '#c084fc', label: 'Coach' },
  coder:   { icon: '🔥', color: '#fb923c', label: 'Coder' },
  curator: { icon: '📋', color: '#22d3ee', label: 'Curator' },
  hacker:  { icon: '💉', color: '#f87171', label: 'Hacker' },
  unknown: { icon: '💀', color: '#666',    label: 'Offline' },
}

const DEFAULT_POS = { x: 80, y: 80 }
const DEFAULT_SIZE = { w: 480, h: 600 }
const STORAGE_POS = 'oasis-parzival-pos'
const STORAGE_SIZE = 'oasis-parzival-size'

function loadPos() {
  if (typeof window === 'undefined') return DEFAULT_POS
  try { return JSON.parse(localStorage.getItem(STORAGE_POS) ?? 'null') ?? DEFAULT_POS } catch { return DEFAULT_POS }
}
function loadSize() {
  if (typeof window === 'undefined') return DEFAULT_SIZE
  try { return JSON.parse(localStorage.getItem(STORAGE_SIZE) ?? 'null') ?? DEFAULT_SIZE } catch { return DEFAULT_SIZE }
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE THOUGHT STREAM — subscribes to ae_parzival:4517/api/thoughts/stream
// ═══════════════════════════════════════════════════════════════════════════

function useThoughtStream(active: boolean) {
  const [thoughts, setThoughts] = useState<Array<{ type: string; data: Record<string, unknown>; ts: number }>>([])

  useEffect(() => {
    if (!active) return

    const parzivalUrl = 'http://localhost:4517'
    let evtSource: EventSource | null = null

    try {
      evtSource = new EventSource(`${parzivalUrl}/api/thoughts/stream`)

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'heartbeat') return // Skip heartbeats
          setThoughts(prev => [...prev.slice(-100), { type: data.type, data, ts: Date.now() }])
        } catch { /* non-JSON event */ }
      }

      evtSource.onerror = () => {
        // SSE will auto-reconnect
      }
    } catch {
      // Parzival not running
    }

    return () => { evtSource?.close() }
  }, [active])

  return thoughts
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function ParzivalPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings } = useContext(SettingsContext)

  // State
  const [messages, setMessages] = useState<ParzivalMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [brain, setBrain] = useState<BrainState | null>(null)
  const [selectedMode, setSelectedMode] = useState<string | null>(null)
  const [online, setOnline] = useState(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Position & size (draggable + resizable)
  const [pos, setPos] = useState(loadPos)
  const [size, setSize] = useState(loadSize)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  // Thought stream
  const thoughts = useThoughtStream(isOpen)

  // Poll brain state
  useEffect(() => {
    if (!isOpen) return

    const poll = async () => {
      try {
        const res = await fetch('/api/parzival')
        if (res.ok) {
          const data = await res.json()
          if (!data.error) {
            setBrain(data)
            setOnline(true)
            return
          }
        }
        setOnline(false)
      } catch { setOnline(false) }
    }

    poll()
    const interval = setInterval(poll, 10000)
    return () => clearInterval(interval)
  }, [isOpen])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100)
  }, [isOpen])

  // ─── Chat submit ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    const userMsg: ParzivalMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])

    setIsStreaming(true)
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/parzival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, mode: selectedMode }),
        signal: abort.signal,
      })

      const data = await res.json()

      const parzivalMsg: ParzivalMessage = {
        id: `parzival-${Date.now()}`,
        role: 'parzival',
        content: data.content ?? data.error ?? 'No response',
        mode: data.mode,
        toolsCalled: data.toolsCalled,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, parzivalMsg])

    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: 'parzival',
          content: `Connection error: ${(error as Error).message}`,
          timestamp: Date.now(),
        }])
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, selectedMode])

  // ─── Drag handlers ────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const newPos = {
        x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX),
        y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY),
      }
      setPos(newPos)
      localStorage.setItem(STORAGE_POS, JSON.stringify(newPos))
    }

    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [pos])

  // ─── Resize handlers ──────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const origW = size.w
    const origH = size.h

    const handleMove = (ev: MouseEvent) => {
      const newSize = {
        w: Math.max(360, origW + ev.clientX - startX),
        h: Math.max(400, origH + ev.clientY - startY),
      }
      setSize(newSize)
      localStorage.setItem(STORAGE_SIZE, JSON.stringify(newSize))
    }

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [size])

  if (!isOpen) return null

  const modeInfo = MODE_META[brain?.mode ?? 'unknown'] ?? MODE_META.unknown
  const hpPercent = brain ? (brain.hp / brain.maxHp) * 100 : 0
  const hpColor = hpPercent > 70 ? '#22c55e' : hpPercent > 40 ? '#eab308' : '#ef4444'
  const uiOpacity = settings?.uiOpacity ?? 0.95

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        overflow: 'hidden',
        background: `rgba(10, 10, 20, ${uiOpacity})`,
        border: `1px solid ${online ? `${modeInfo.color}40` : 'rgba(255,255,255,0.1)'}`,
        boxShadow: online
          ? `0 0 30px ${modeInfo.color}20, 0 8px 32px rgba(0,0,0,0.6)`
          : '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(12px)',
        fontFamily: 'monospace',
        fontSize: 13,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${modeInfo.color}30`,
          cursor: 'grab',
          userSelect: 'none',
          background: `linear-gradient(135deg, ${modeInfo.color}15, transparent)`,
        }}
      >
        <span style={{ fontSize: 18 }}>🧿</span>
        <span style={{ color: modeInfo.color, fontWeight: 700, letterSpacing: 1 }}>
          PARZIVAL
        </span>

        {/* Mode badge */}
        <span style={{
          padding: '2px 8px',
          borderRadius: 6,
          background: `${modeInfo.color}20`,
          color: modeInfo.color,
          fontSize: 11,
        }}>
          {modeInfo.icon} {modeInfo.label}
        </span>

        {/* HP bar */}
        {online && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: 'rgba(255,255,255,0.1)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${hpPercent}%`,
                height: '100%',
                background: hpColor,
                borderRadius: 3,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <span style={{ fontSize: 10, color: hpColor }}>{brain?.hp}/{brain?.maxHp}</span>
          </div>
        )}

        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: online ? '#22c55e' : '#ef4444',
          boxShadow: online ? '0 0 6px #22c55e' : '0 0 6px #ef4444',
        }} />

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#666',
            cursor: 'pointer', fontSize: 16, padding: '0 4px',
          }}
        >✕</button>
      </div>

      {/* ─── Mode Switcher ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {(['coach', 'coder', 'curator', 'hacker'] as const).map(mode => {
          const meta = MODE_META[mode]
          const isActive = brain?.mode === mode
          const isSelected = selectedMode === mode
          return (
            <button
              key={mode}
              onClick={() => setSelectedMode(isSelected ? null : mode)}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                border: `1px solid ${isActive ? meta.color + '60' : isSelected ? meta.color + '40' : 'rgba(255,255,255,0.08)'}`,
                background: isActive ? meta.color + '20' : isSelected ? meta.color + '10' : 'transparent',
                color: isActive ? meta.color : isSelected ? meta.color : '#888',
                cursor: 'pointer',
                fontSize: 11,
                transition: 'all 0.2s',
              }}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      {/* ─── Thought Stream (live events from SSE) ───────────────────── */}
      {thoughts.length > 0 && (
        <div style={{
          maxHeight: 60,
          overflow: 'hidden',
          padding: '4px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
        }}>
          {thoughts.slice(-3).map((t, i) => (
            <div key={i} style={{
              fontSize: 10,
              color: '#666',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              <span style={{ color: modeInfo.color }}>{t.type}</span>
              {' '}
              {JSON.stringify(t.data).substring(0, 80)}
            </div>
          ))}
        </div>
      )}

      {/* ─── Messages ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: '#555',
            padding: 40,
          }}>
            {online ? (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🧿</div>
                <div>Talk to Parzival</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Mode: {modeInfo.icon} {modeInfo.label} • HP: {brain?.hp}/{brain?.maxHp}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>💀</div>
                <div>Parzival is offline</div>
                <div style={{ fontSize: 11, marginTop: 4, color: '#666' }}>
                  cd c:/ae_parzival && pnpm dev
                </div>
              </>
            )}
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: msg.role === 'user'
                ? 'rgba(255,255,255,0.05)'
                : `${(MODE_META[msg.mode ?? 'coach']?.color ?? '#c084fc')}10`,
              borderLeft: msg.role === 'parzival'
                ? `3px solid ${MODE_META[msg.mode ?? 'coach']?.color ?? '#c084fc'}60`
                : 'none',
            }}
          >
            <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
              {msg.role === 'user' ? '👤 You' : `🧿 Parzival (${MODE_META[msg.mode ?? 'coach']?.label ?? 'Coach'})`}
              {msg.toolsCalled?.length ? ` • ${msg.toolsCalled.length} tools` : ''}
            </div>
            <div style={{
              color: '#ddd',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div style={{ textAlign: 'center', color: modeInfo.color, padding: 8 }}>
            <span className="animate-pulse">● thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── Input ───────────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        gap: 8,
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          disabled={isStreaming || !online}
          placeholder={online ? 'Talk to Parzival...' : 'Parzival is offline'}
          rows={1}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '8px 12px',
            color: '#ddd',
            fontSize: 13,
            fontFamily: 'monospace',
            resize: 'none',
            outline: 'none',
          }}
        />
        <button
          onClick={isStreaming ? () => abortRef.current?.abort() : handleSubmit}
          disabled={!online && !isStreaming}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: isStreaming ? '#ef444440' : `${modeInfo.color}30`,
            color: isStreaming ? '#ef4444' : modeInfo.color,
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 700,
          }}
        >
          {isStreaming ? '■' : '→'}
        </button>
      </div>

      {/* ─── Resize handle ───────────────────────────────────────────── */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute',
          right: 0, bottom: 0,
          width: 16, height: 16,
          cursor: 'se-resize',
          background: `linear-gradient(135deg, transparent 50%, ${modeInfo.color}30 50%)`,
          borderRadius: '0 0 12px 0',
        }}
      />
    </div>,
    document.body
  )
}
