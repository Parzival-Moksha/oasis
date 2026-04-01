'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MISSION WINDOW — Floating 2D panel for mission details
// ─═̷─═̷─ॐ─═̷─═̷─ Ported from Mindcraft2 SankalpaExpansion ─═̷─═̷─ॐ─═̷─═̷─
// Rendered OUTSIDE Canvas (via Scene.tsx MindcraftMissionWindowBridge)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MATURITY_ACCENTS, type MissionData } from './MissionCard3D'

const POS_KEY = 'oasis-mission-window-pos'
const SIZE_KEY = 'oasis-mission-window-size'
const DEFAULT_POS = { x: 100, y: 100 }
const DEFAULT_SIZE = { w: 520, h: 650 }
const MIN_W = 400
const MIN_H = 500

const MATURITY_LABELS: Record<number, string> = {
  0: '🌑 Para', 1: '🌘 Pashyanti', 2: '🌗 Madhyama', 3: '🌕 Vaikhari',
  4: '⚒️ Built', 5: '🔍 Reviewed', 6: '✅ Tested', 7: '🎮 Gamertested', 8: '🏆 Carbontested',
}

interface HistoryEntry { timestamp: string; actor: string; action: string; comment?: string; message?: string }

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}

function formatDateCompact(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`
}

// Local API — NOT Parzival. Mindcraft 3D uses af_oasis endpoints directly.
const localFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(`/api/${path}`, options)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`)
  return data
}

export function MissionWindow({ mission, onClose, onRefetch }: {
  mission: MissionData; onClose: () => void; onRefetch: () => void
}) {
  const [pos, setPos] = useState(() => loadStored(POS_KEY, DEFAULT_POS))
  const [size, setSize] = useState(() => loadStored(SIZE_KEY, DEFAULT_SIZE))
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const posRef = useRef(pos)
  posRef.current = pos
  const containerRef = useRef<HTMLDivElement>(null)

  const [showDesc, setShowDesc] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => { localStorage.setItem(POS_KEY, JSON.stringify(pos)) }, [pos])
  useEffect(() => { localStorage.setItem(SIZE_KEY, JSON.stringify(size)) }, [size])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    dragOffset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent) => {
      setSize({ w: Math.max(MIN_W, e.clientX - posRef.current.x), h: Math.max(MIN_H, e.clientY - posRef.current.y) })
    }
    const onUp = () => setResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizing])

  const historyEntries = useMemo<HistoryEntry[]>(() => {
    if (!mission.history) return []
    try { return JSON.parse(mission.history) } catch { return [] }
  }, [mission.history])

  const handleRefine = async () => {
    if (!replyText.trim()) return
    setSending(true)
    try {
      await localFetch('anorak/pro/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mission.id,
          mature: false,
          verdict: 'modify',
          rating: 5,
          carbondevMsg: replyText.trim(),
        }),
      })
      setReplyText(''); onRefetch()
    } catch (err) { console.error('MissionWindow handleRefine failed:', err) }
    setSending(false)
  }

  const handleBump = async () => {
    setSending(true)
    try {
      await localFetch('anorak/pro/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mission.id,
          mature: true,
          verdict: 'accept',
          rating: 7,
          carbondevMsg: replyText.trim() || undefined,
        }),
      })
      setReplyText(''); onRefetch()
    } catch (err) { console.error('MissionWindow handleBump failed:', err) }
    setSending(false)
  }

  const actionIcons: Record<string, string> = {
    created: '🌱', comment: '💬', refine: '✨', bump: '⬆️',
    mature: '📋', execute: '🔥', complete: '✅', reject: '❌',
  }

  const accent = MATURITY_ACCENTS[mission.maturityLevel] ?? '#666'

  const panel = (
    <div ref={containerRef} style={{
      position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h,
      background: '#080a0f', opacity: 0.95, border: `3px solid ${accent}`, borderRadius: 10,
      boxShadow: `0 0 30px ${accent}40, 0 8px 32px rgba(0,0,0,0.6)`, zIndex: 10000,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'monospace', color: '#ddd', fontSize: 12,
      userSelect: dragging || resizing ? 'none' : 'auto',
    }} onMouseDown={e => e.stopPropagation()}>
      {/* HEADER */}
      <div onMouseDown={onDragStart} style={{
        padding: '8px 12px', background: `${accent}15`, borderBottom: `1px solid ${accent}40`,
        cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: accent, fontWeight: 700 }}>#{mission.id}</span>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mission.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${accent}25`, color: accent, fontWeight: 600 }}>
            {MATURITY_LABELS[mission.maturityLevel] ?? `Level ${mission.maturityLevel}`}
          </span>
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, textTransform: 'uppercase',
            background: mission.status === 'wip' ? '#f59e0b25' : mission.status === 'done' ? '#22c55e25' : '#66666625',
            color: mission.status === 'wip' ? '#f59e0b' : mission.status === 'done' ? '#22c55e' : '#999',
          }}>{mission.status}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>✕</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11 }}>
          <span>U: <b style={{ color: '#ef4444' }}>{mission.urgency}</b></span>
          <span>E: <b style={{ color: '#22c55e' }}>{mission.easiness}</b></span>
          <span>I: <b style={{ color: '#3b82f6' }}>{mission.impact}</b></span>
          <span>Pri: <b style={{ color: accent }}>{(mission.priority ?? 1).toFixed(2)}</b></span>
          {mission.valor != null && <span>Val: <b style={{ color: '#f59e0b' }}>{mission.valor}</b></span>}
          {mission.score != null && <span>Score: <b style={{ color: '#fbbf24' }}>{mission.score.toFixed(1)}</b></span>}
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 10, color: '#888' }}>
          <span>Assigned: <b style={{ color: '#bbb' }}>{mission.assignedTo ?? 'none'}</b></span>
          <span>Created: {formatDateCompact(mission.createdAt)}</span>
          {mission.endedAt && <span>Ended: {formatDateCompact(mission.endedAt)}</span>}
        </div>

        <div style={{ fontSize: 10, color: accent, marginBottom: 4, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }} onClick={() => setShowDesc(!showDesc)}>
          {showDesc ? '▼' : '▶'} Descriptions
        </div>
        {showDesc && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>📋 Carbon (description)</div>
              <div style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 150, overflowY: 'auto' }}>{mission.description || '(none)'}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>🔧 Silicon (tech spec)</div>
              <div style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 150, overflowY: 'auto', fontFamily: 'monospace' }}>{mission.technicalSpec || '(none)'}</div>
            </div>
          </div>
        )}

        {historyEntries.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: 250, overflowY: 'auto', padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: 10, color: accent, marginBottom: 6, fontWeight: 600 }}>📜 Conversation</div>
            {historyEntries.map((entry, i) => {
              const isDev = entry.actor === 'carbondev'
              const text = entry.message || entry.comment || entry.action
              return (
                <div key={i} style={{ display: 'flex', flexDirection: isDev ? 'row' : 'row-reverse', marginBottom: 4, gap: 6 }}>
                  <div style={{
                    maxWidth: '80%', padding: '4px 8px', borderRadius: 8,
                    background: isDev ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)',
                    border: `1px solid ${isDev ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)'}`,
                    borderTopLeftRadius: isDev ? 2 : 8, borderTopRightRadius: isDev ? 8 : 2,
                  }}>
                    <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>
                      {isDev ? '👤' : '🧿'} {actionIcons[entry.action] ?? '•'} {entry.action}
                      <span style={{ marginLeft: 6, color: '#555' }}>{formatDateCompact(entry.timestamp)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#ccc', lineHeight: 1.3 }}>{text}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {mission.status === 'todo' && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Comment..." rows={2}
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#ddd', fontSize: 11, fontFamily: 'monospace', resize: 'none', outline: 'none' }}
              disabled={sending} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={handleRefine} disabled={sending || !replyText.trim()} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#a855f720', color: '#a855f7', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }}>✨ Refine</button>
              <button onClick={handleBump} disabled={sending} style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#22c55e20', color: '#22c55e', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 }}>⬆️ Bump</button>
            </div>
          </div>
        )}
      </div>

      <div onMouseDown={e => { e.preventDefault(); setResizing(true) }} style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', opacity: 0.3 }}>
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M14 16L16 14M10 16L16 10M6 16L16 6" stroke={accent} strokeWidth="1.5" /></svg>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(panel, document.body)
}
