'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL 3D WINDOW CONTENT — Thought stream inside the Oasis world
// Follows AnorakWindowContent pattern: SSE stream, auto-scroll, compact UI
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useEffect, useRef, useContext } from 'react'
import { SettingsContext } from '../scene-lib'

interface BrainState {
  mode: string
}

const MODE_COLORS: Record<string, string> = {
  coach: '#14b8a6',
  coder: '#fb923c',
  curator: '#22d3ee',
  hacker: '#f87171',
}

// Simple inline markdown: **bold**, *italic*, `code`, [link](url)
function renderInlineMd(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  // Split on markdown patterns
  const regex = /(\*\*.*?\*\*|\*.*?\*|`[^`]+`|\[([^\]]+)\]\([^)]+\))/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const m = match[0]
    if (m.startsWith('**')) parts.push(<strong key={key++} style={{ color: '#e2e8f0' }}>{m.slice(2, -2)}</strong>)
    else if (m.startsWith('*')) parts.push(<em key={key++} style={{ color: '#cbd5e1' }}>{m.slice(1, -1)}</em>)
    else if (m.startsWith('`')) parts.push(<code key={key++} style={{ background: 'rgba(255,255,255,0.08)', padding: '0 3px', borderRadius: 2, color: '#7dd3fc' }}>{m.slice(1, -1)}</code>)
    else if (m.startsWith('[')) parts.push(<span key={key++} style={{ color: '#38bdf8', textDecoration: 'underline' }}>{match[2]}</span>)
    last = match.index + m.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 0 ? text : <>{parts}</>
}

export function ParzivalWindowContent({ windowBlur = 0 }: { windowBlur?: number }) {
  const [brain, setBrain] = useState<BrainState | null>(null)
  const [thoughts, setThoughts] = useState<Array<{ type: string; text: string }>>([])
  const [online, setOnline] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Global UI opacity from settings
  const { settings } = useContext(SettingsContext)
  const bgAlpha = Math.max(0.3, Math.min(1, settings.uiOpacity))

  // Poll brain state
  useEffect(() => {
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
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  // SSE thought stream
  useEffect(() => {
    let evtSource: EventSource | null = null

    try {
      evtSource = new EventSource('http://localhost:4517/api/thoughts/stream')

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'heartbeat') return
          // Extract meaningful text from thought events
          const text = data.text || data.content || data.message || data.thought || data.summary || JSON.stringify(data)
          setThoughts(prev => [
            ...prev.slice(-50),
            { type: data.type, text: typeof text === 'string' ? text : JSON.stringify(text) },
          ])
        } catch { /* skip */ }
      }
    } catch { /* not running */ }

    return () => { evtSource?.close() }
  }, [])

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thoughts])

  const mode = brain?.mode ?? 'coach'
  const color = MODE_COLORS[mode] ?? '#14b8a6'

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: windowBlur > 0 ? `rgba(5, 5, 15, ${bgAlpha * 0.6})` : `rgba(5, 5, 15, ${bgAlpha})`,
      backdropFilter: windowBlur > 0 ? `blur(${windowBlur}px)` : undefined,
      WebkitBackdropFilter: windowBlur > 0 ? `blur(${windowBlur}px)` : undefined,
      color: '#ccc',
      fontFamily: 'monospace',
      fontSize: 12,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: `1px solid ${color}30`,
        background: `linear-gradient(135deg, ${color}15, transparent)`,
      }}>
        <span style={{ fontSize: 14 }}>🧿</span>
        <span style={{ color, fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>PARZIVAL</span>
        <span style={{ color: '#666', fontSize: 10, textTransform: 'uppercase' }}>{mode}</span>
        <div style={{ flex: 1 }} />
        {/* Status */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: online ? '#22c55e' : '#ef4444',
        }} />
      </div>

      {/* Thought stream */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '4px 8px',
      }}>
        {!online && (
          <div style={{ textAlign: 'center', padding: 20, color: '#555' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💀</div>
            <div>Parzival offline</div>
          </div>
        )}

        {thoughts.map((t, i) => (
          <div key={i} style={{
            padding: '2px 0',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            display: 'flex',
            gap: 6,
          }}>
            <span style={{
              color,
              fontSize: 10,
              minWidth: 60,
              opacity: 0.7,
            }}>
              {t.type}
            </span>
            <span style={{
              color: '#999',
              fontSize: 10,
              lineHeight: 1.4,
              wordBreak: 'break-word',
            }}>
              {renderInlineMd(t.text)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
