'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL 3D WINDOW CONTENT — Thought stream inside the Oasis world
// Follows AnorakWindowContent pattern: SSE stream, auto-scroll, compact UI
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useEffect, useRef, useContext } from 'react'
import { SettingsContext } from '../scene-lib'

interface BrainState {
  mode: string
  hp: number
  maxHp: number
}

const MODE_COLORS: Record<string, string> = {
  coach: '#c084fc',
  coder: '#fb923c',
  curator: '#22d3ee',
  hacker: '#f87171',
}

const MODE_ICONS: Record<string, string> = {
  coach: '🧠',
  coder: '🔥',
  curator: '📋',
  hacker: '💉',
}

export function ParzivalWindowContent() {
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
          setThoughts(prev => [
            ...prev.slice(-50),
            { type: data.type, text: JSON.stringify(data).substring(0, 120) },
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
  const color = MODE_COLORS[mode] ?? '#c084fc'
  const hpPercent = brain ? (brain.hp / brain.maxHp) * 100 : 0
  const hpColor = hpPercent > 70 ? '#22c55e' : hpPercent > 40 ? '#eab308' : '#ef4444'

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: `rgba(5, 5, 15, ${bgAlpha})`,
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
        <span style={{ color, fontSize: 10 }}>
          {MODE_ICONS[mode]} {mode.toUpperCase()}
        </span>

        {/* HP mini bar */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            flex: 1, height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.1)',
          }}>
            <div style={{
              width: `${hpPercent}%`, height: '100%',
              background: hpColor, borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: 9, color: hpColor }}>{brain?.hp ?? '?'}</span>
        </div>

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
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {t.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
