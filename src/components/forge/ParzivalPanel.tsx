'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL PANEL — mini-Synapse inside the Oasis
// ─═̷─═̷─ॐ─═̷─═̷─ Chat • Mindcraft • Console • CEHQ ─═̷─═̷─ॐ─═̷─═̷─
//
// Tabs:
//   💬 Chat     — talk to Parzival (coach mode, conversation continuity)
//   ⚔️ Mindcraft — mission list, mature/bump/execute pipeline
//   📡 Console  — live thought stream (SSE from ae_parzival)
//   🧬 CEHQ     — context modules viewer/toggler
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '../../store/oasisStore'
import { Mindcraft2 } from './Mindcraft2'
import { useUILayer } from '@/lib/input-manager'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface BrainState {
  mode: string
  hp: number
  maxHp: number
  missions: Record<string, number>
  uptime: number
}

interface ParzivalMessage {
  id: string
  role: 'user' | 'parzival'
  content: string
  mode?: string
  timestamp: number
}

interface Mission {
  id: number
  name: string
  description: string | null
  status: string
  maturityLevel: number
  urgency: number
  easiness: number
  impact: number
  priority: number | null
  score: number | null
  valor: number
  queuePosition: number | null
  assignedTo: string | null
  technicalSpec: string | null
  history: string | null
  createdAt: string
  endedAt: string | null
}

interface ContextModule {
  id: number
  moduleName: string
  modeName: string
  enabled: boolean
  content: string | null
}

type TabId = 'chat' | 'mindcraft' | 'mindcraft2' | 'console' | 'cehq'

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

const TABS: Array<{ id: TabId; icon: string; label: string }> = [
  { id: 'chat', icon: '💬', label: 'Chat' },
  { id: 'mindcraft', icon: '⚔️', label: 'Mindcraft' },
  { id: 'mindcraft2', icon: '🎯', label: 'Mindcraft2' },
  { id: 'console', icon: '📡', label: 'Console' },
  { id: 'cehq', icon: '🧬', label: 'CEHQ' },
]

const MATURITY_LABELS = ['🟥 Raw', '🟧 Formulated', '🟨 Analyzed', '🟩 Ready']

const DEFAULT_POS = { x: 80, y: 80 }
const DEFAULT_SIZE = { w: 520, h: 640 }
const STORAGE_POS = 'oasis-parzival-pos'
const STORAGE_SIZE = 'oasis-parzival-size'

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARZIVAL API HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const parzivalFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(`/api/parzival/proxy/${path}`, options)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function ParzivalPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useUILayer('parzival', isOpen)
  const { settings } = useContext(SettingsContext)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('parzival', 9999))

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('chat')

  // Brain state
  const [brain, setBrain] = useState<BrainState | null>(null)
  const [online, setOnline] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ParzivalMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Mindcraft state
  const [missions, setMissions] = useState<Mission[]>([])
  const [missionLoading, setMissionLoading] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<string>('queuePosition')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedMission, setExpandedMission] = useState<number | null>(null)

  // Console state
  const [thoughts, setThoughts] = useState<Array<{ type: string; data: string; ts: number }>>([])
  const consoleEndRef = useRef<HTMLDivElement>(null)

  // CEHQ state
  const [contextModules, setContextModules] = useState<ContextModule[]>([])
  const [expandedModule, setExpandedModule] = useState<string | null>(null)

  // Position & size
  const [pos, setPos] = useState(() => loadStored(STORAGE_POS, DEFAULT_POS))
  const [size, setSize] = useState(() => loadStored(STORAGE_SIZE, DEFAULT_SIZE))
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  // ─── Poll brain state ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    const poll = async () => {
      try {
        const res = await fetch('/api/parzival')
        if (res.ok) {
          const data = await res.json()
          if (!data.error) { setBrain(data); setOnline(true); return }
        }
        setOnline(false)
      } catch { setOnline(false) }
    }

    poll()
    const interval = setInterval(poll, 10000)
    return () => clearInterval(interval)
  }, [isOpen])

  // ─── SSE Thought Stream ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    let evtSource: EventSource | null = null
    try {
      evtSource = new EventSource('/api/parzival/proxy/thoughts/stream')
      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'heartbeat') return
          setThoughts(prev => [...prev.slice(-200), {
            type: data.type,
            data: JSON.stringify(data),
            ts: Date.now(),
          }])
        } catch { /* skip */ }
      }
    } catch { /* not running */ }

    return () => { evtSource?.close() }
  }, [isOpen])

  // ─── Load missions when Mindcraft tab activates ────────────────────────
  useEffect(() => {
    if (!isOpen || activeTab !== 'mindcraft' || !online) return
    parzivalFetch('missions').then(data => {
      if (Array.isArray(data)) setMissions(data)
    }).catch(() => {})
  }, [isOpen, activeTab, online])

  // ─── Load context modules when CEHQ tab activates ─────────────────────
  useEffect(() => {
    if (!isOpen || activeTab !== 'cehq' || !online) return
    parzivalFetch('context').then(data => {
      if (Array.isArray(data)) setContextModules(data)
    }).catch(() => {})
  }, [isOpen, activeTab, online])

  // ─── Auto-scroll ──────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thoughts])

  // ─── Focus input ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && activeTab === 'chat') setTimeout(() => inputRef.current?.focus(), 100)
  }, [isOpen, activeTab])

  // ─── Chat submit ──────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || isStreaming) return
    setChatInput('')

    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() }])
    setIsStreaming(true)
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/parzival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: abort.signal,
      })
      const data = await res.json()
      setMessages(prev => [...prev, {
        id: `p-${Date.now()}`, role: 'parzival',
        content: data.content ?? data.error ?? 'No response',
        mode: data.mode, timestamp: Date.now(),
      }])
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, {
          id: `e-${Date.now()}`, role: 'parzival',
          content: `Error: ${(error as Error).message}`, timestamp: Date.now(),
        }])
      }
    } finally { setIsStreaming(false); abortRef.current = null }
  }, [chatInput, isStreaming])

  // ─── Mission actions ──────────────────────────────────────────────────
  const missionAction = useCallback(async (id: number, action: string, body?: object) => {
    setMissionLoading(id)
    try {
      await parzivalFetch(`missions/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      // Refresh missions
      const data = await parzivalFetch('missions')
      if (Array.isArray(data)) setMissions(data)
    } catch { /* swallow */ }
    setMissionLoading(null)
  }, [])

  // ─── Context module toggle ────────────────────────────────────────────
  const toggleModule = useCallback(async (id: number, enabled: boolean) => {
    await parzivalFetch(`context/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    setContextModules(prev => prev.map(m => m.id === id ? { ...m, enabled } : m))
  }, [])

  // ─── Drag ─────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const p = { x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX), y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY) }
      setPos(p); localStorage.setItem(STORAGE_POS, JSON.stringify(p))
    }
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [pos])

  // ─── Resize ───────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY, ow = size.w, oh = size.h
    const move = (ev: MouseEvent) => {
      const s = { w: Math.max(400, ow + ev.clientX - sx), h: Math.max(480, oh + ev.clientY - sy) }
      setSize(s); localStorage.setItem(STORAGE_SIZE, JSON.stringify(s))
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [size])

  if (!isOpen) return null

  const modeInfo = MODE_META[brain?.mode ?? 'unknown'] ?? MODE_META.unknown
  const hpPercent = brain ? (brain.hp / brain.maxHp) * 100 : 0
  const hpColor = hpPercent > 70 ? '#22c55e' : hpPercent > 40 ? '#eab308' : '#ef4444'
  const uiOpacity = settings?.uiOpacity ?? 0.95
  const panelColor = modeInfo.color

  return createPortal(
    <div
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h,
        zIndex: panelZIndex, display: 'flex', flexDirection: 'column',
        borderRadius: 12, overflow: 'hidden',
        background: `rgba(10, 10, 20, ${uiOpacity})`,
        border: `1px solid ${online ? panelColor + '40' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: online ? `0 0 30px ${panelColor}20, 0 8px 32px rgba(0,0,0,0.6)` : '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(12px)', fontFamily: 'monospace', fontSize: 13,
      }}
      onMouseDown={e => { e.stopPropagation(); useOasisStore.getState().bringPanelToFront('parzival') }}
    >
      {/* ─── HEADER ────────────────────────────────────────────────── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: `1px solid ${panelColor}30`, cursor: 'grab', userSelect: 'none',
          background: `linear-gradient(135deg, ${panelColor}15, transparent)`,
        }}
      >
        <span style={{ fontSize: 18 }}>🧿</span>
        <span style={{ color: panelColor, fontWeight: 700, letterSpacing: 1 }}>PARZIVAL</span>
        <span style={{ padding: '2px 8px', borderRadius: 6, background: `${panelColor}20`, color: panelColor, fontSize: 11 }}>
          {modeInfo.icon} {modeInfo.label}
        </span>

        {online && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)' }}>
              <div style={{ width: `${hpPercent}%`, height: '100%', background: hpColor, borderRadius: 3, transition: 'width 0.5s' }} />
            </div>
            <span style={{ fontSize: 10, color: hpColor }}>{brain?.hp}/{brain?.maxHp}</span>
          </div>
        )}

        <div style={{ width: 8, height: 8, borderRadius: '50%', background: online ? '#22c55e' : '#ef4444', boxShadow: `0 0 6px ${online ? '#22c55e' : '#ef4444'}` }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
      </div>

      {/* ─── TAB BAR ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '6px 0', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? `${panelColor}15` : 'transparent',
              borderBottom: activeTab === tab.id ? `2px solid ${panelColor}` : '2px solid transparent',
              color: activeTab === tab.id ? panelColor : '#666',
              fontSize: 12, fontFamily: 'monospace', transition: 'all 0.2s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── TAB CONTENT ───────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* ═══ CHAT TAB ═══ */}
        {activeTab === 'chat' && (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{online ? '🧿' : '💀'}</div>
                  <div>{online ? 'Talk to Parzival' : 'Parzival is offline'}</div>
                  {!online && <div style={{ fontSize: 11, marginTop: 4, color: '#666' }}>cd c:/ae_parzival && pnpm dev</div>}
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: msg.role === 'user' ? 'rgba(255,255,255,0.05)' : `${panelColor}10`,
                  borderLeft: msg.role === 'parzival' ? `3px solid ${panelColor}60` : 'none',
                }}>
                  <div style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
                    {msg.role === 'user' ? '👤 You' : `🧿 Parzival`}
                  </div>
                  <div style={{ color: '#ddd', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{msg.content}</div>
                </div>
              ))}
              {isStreaming && <div style={{ textAlign: 'center', color: panelColor, padding: 8 }}><span className="animate-pulse">● thinking...</span></div>}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 8 }}>
              <textarea
                ref={inputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
                disabled={isStreaming || !online}
                placeholder={online ? 'Talk to Parzival...' : 'Offline'}
                rows={1}
                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 12px', color: '#ddd', fontSize: 13, fontFamily: 'monospace', resize: 'none', outline: 'none' }}
              />
              <button
                onClick={isStreaming ? () => abortRef.current?.abort() : handleSubmit}
                disabled={!online && !isStreaming}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: isStreaming ? '#ef444440' : `${panelColor}30`, color: isStreaming ? '#ef4444' : panelColor, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}
              >{isStreaming ? '■' : '→'}</button>
            </div>
          </>
        )}

        {/* ═══ MINDCRAFT TAB ═══ */}
        {activeTab === 'mindcraft' && (() => {
          // Sort missions
          const sorted = [...missions].sort((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[sortKey]
            const bv = (b as unknown as Record<string, unknown>)[sortKey]
            let cmp = 0
            if (av == null && bv == null) cmp = 0
            else if (av == null) cmp = 1
            else if (bv == null) cmp = -1
            else if (sortKey === 'createdAt' || sortKey === 'endedAt') {
              cmp = new Date(av as string).getTime() - new Date(bv as string).getTime()
            } else if (typeof av === 'string' && typeof bv === 'string') {
              cmp = av.localeCompare(bv)
            } else {
              cmp = (Number(av) || 0) - (Number(bv) || 0)
            }
            return sortDir === 'asc' ? cmp : -cmp
          })
          const wipMissions = sorted.filter(m => m.status === 'wip')
          const todoMissions = sorted.filter(m => m.status === 'todo')
          const doneMissions = sorted.filter(m => m.status === 'done' || m.status === 'failed')

          const toggleSort = (key: string) => {
            if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
            else { setSortKey(key); setSortDir('asc') }
          }

          const thStyle = (key?: string): React.CSSProperties => ({
            padding: '4px 4px', fontSize: 10, color: sortKey === key ? panelColor : '#666',
            cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: sortKey === key ? 700 : 400,
            textAlign: 'left',
          })
          const thR = (key?: string): React.CSSProperties => ({ ...thStyle(key), textAlign: 'right' })

          const arrow = (key: string) => sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''

          const tdStyle: React.CSSProperties = { padding: '3px 4px', fontSize: 11, color: '#999', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
          const tdR: React.CSSProperties = { ...tdStyle, textAlign: 'right' }

          const matColors = ['#666', '#0ea5e9', '#14b8a6', '#f59e0b']
          const matLabels = ['Raw', 'Form', 'Anlz', 'Rdy']

          const fmtDate = (d: string | null) => {
            if (!d) return '-'
            const dt = new Date(d)
            return `${dt.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`
          }

          const renderSection = (title: string, titleColor: string, list: Mission[]) => {
            if (list.length === 0) return null
            return (
              <>
                <tr><td colSpan={13} style={{ padding: '4px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: titleColor, background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {title} ({list.length})
                </td></tr>
                {list.map(m => {
                  const isLoading = missionLoading === m.id
                  const isExpanded = expandedMission === m.id
                  const pri = m.priority != null ? m.priority.toFixed(1) : '-'
                  const sc = m.score != null ? m.score.toFixed(1) : '-'
                  const valorColor = m.valor >= 1.5 ? '#22c55e' : m.valor < 1.0 ? '#ef4444' : '#999'
                  return (
                    <React.Fragment key={m.id}>
                      <tr
                        onClick={() => setExpandedMission(isExpanded ? null : m.id)}
                        style={{ cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.03)', background: isExpanded ? 'rgba(255,255,255,0.03)' : m.status === 'wip' ? 'rgba(234,179,8,0.04)' : 'transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                        onMouseLeave={e => (e.currentTarget.style.background = isExpanded ? 'rgba(255,255,255,0.03)' : m.status === 'wip' ? 'rgba(234,179,8,0.04)' : 'transparent')}
                      >
                        <td style={{ ...tdStyle, color: '#555' }}>{m.id}</td>
                        <td style={{ ...tdStyle, color: '#888' }}>{m.queuePosition ?? '-'}</td>
                        <td style={{ ...tdStyle, color: '#ddd', fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</td>
                        <td style={{ ...tdStyle, color: matColors[m.maturityLevel] ?? '#666' }}>{matLabels[m.maturityLevel] ?? '?'}</td>
                        <td style={tdR}>{m.urgency}</td>
                        <td style={tdR}>{m.easiness}</td>
                        <td style={tdR}>{m.impact}</td>
                        <td style={{ ...tdR, fontWeight: 500 }}>{pri}</td>
                        <td style={{ ...tdR, color: valorColor }}>{m.valor.toFixed(1)}</td>
                        <td style={{ ...tdR, color: '#22c55e' }}>{sc}</td>
                        <td style={{ ...tdStyle, color: m.assignedTo === 'carbondev' ? '#60a5fa' : m.assignedTo === 'parzival' ? '#a855f7' : '#555' }}>
                          {m.assignedTo === 'carbondev' ? '👤' : m.assignedTo === 'parzival' ? '🧿' : '-'}
                        </td>
                        <td style={{ ...tdStyle, color: '#555' }}>{fmtDate(m.createdAt)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                            {m.status === 'todo' && m.maturityLevel < 3 && (
                              <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'mature') }} disabled={isLoading}
                                style={{ padding: '1px 4px', borderRadius: 3, border: 'none', background: '#22d3ee15', color: '#22d3ee', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
                                {isLoading ? '..' : '📋'}
                              </button>
                            )}
                            {m.status === 'todo' && (
                              <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'feedback', { action: 'bump' }) }} disabled={isLoading}
                                style={{ padding: '1px 4px', borderRadius: 3, border: 'none', background: '#22c55e15', color: '#22c55e', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
                                ⬆
                              </button>
                            )}
                            {m.status === 'todo' && m.maturityLevel >= 2 && (
                              <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'execute') }} disabled={isLoading}
                                style={{ padding: '1px 4px', borderRadius: 3, border: 'none', background: '#fb923c15', color: '#fb923c', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
                                🔥
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <td colSpan={13} style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <div>
                                <div style={{ fontSize: 10, color: panelColor, marginBottom: 4, fontWeight: 600 }}>📋 Description</div>
                                <div style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.4, maxHeight: 150, overflowY: 'auto' }}>
                                  {m.description || '(none)'}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: panelColor, marginBottom: 4, fontWeight: 600 }}>🔧 Tech Spec</div>
                                <div style={{ fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.4, fontFamily: 'monospace', maxHeight: 150, overflowY: 'auto' }}>
                                  {m.technicalSpec || '(none)'}
                                </div>
                              </div>
                            </div>
                            {m.history && (() => {
                              try {
                                const entries = JSON.parse(m.history) as Array<{ timestamp: string; actor: string; action: string; comment?: string }>
                                if (!entries.length) return null
                                return (
                                  <div style={{ marginTop: 8, maxHeight: 120, overflowY: 'auto', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                                    <div style={{ fontSize: 10, color: panelColor, marginBottom: 4, fontWeight: 600 }}>📜 History</div>
                                    {entries.map((e, i) => (
                                      <div key={i} style={{ fontSize: 10, color: '#777', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <span style={{ color: e.actor === 'carbondev' ? '#60a5fa' : '#a855f7' }}>{e.actor === 'carbondev' ? '👤' : '🧿'}</span>
                                        {' '}<span style={{ color: '#888' }}>{e.action}</span>
                                        {e.comment && <span style={{ color: '#999' }}> — {e.comment}</span>}
                                        <span style={{ color: '#555', marginLeft: 6 }}>{new Date(e.timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                                      </div>
                                    ))}
                                  </div>
                                )
                              } catch { return null }
                            })()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </>
            )
          }

          return (
            <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
              {!online && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>💀 Offline</div>}
              {online && missions.length === 0 && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>No missions yet</div>}
              {online && missions.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle('id'), width: 28 }} onClick={() => toggleSort('id')}>ID{arrow('id')}</th>
                      <th style={{ ...thStyle('queuePosition'), width: 24 }} onClick={() => toggleSort('queuePosition')}>#Q{arrow('queuePosition')}</th>
                      <th style={{ ...thStyle('name'), width: 'auto' }}>Name</th>
                      <th style={{ ...thStyle('maturityLevel'), width: 36 }} onClick={() => toggleSort('maturityLevel')}>Mat{arrow('maturityLevel')}</th>
                      <th style={{ ...thR('urgency'), width: 24 }} onClick={() => toggleSort('urgency')}>U{arrow('urgency')}</th>
                      <th style={{ ...thR('easiness'), width: 24 }} onClick={() => toggleSort('easiness')}>E{arrow('easiness')}</th>
                      <th style={{ ...thR('impact'), width: 24 }} onClick={() => toggleSort('impact')}>I{arrow('impact')}</th>
                      <th style={{ ...thR('priority'), width: 32 }} onClick={() => toggleSort('priority')}>Pri{arrow('priority')}</th>
                      <th style={{ ...thR('valor'), width: 26 }} onClick={() => toggleSort('valor')}>V{arrow('valor')}</th>
                      <th style={{ ...thR('score'), width: 32 }} onClick={() => toggleSort('score')}>Sc{arrow('score')}</th>
                      <th style={{ ...thStyle('assignedTo'), width: 24 }} onClick={() => toggleSort('assignedTo')}>As{arrow('assignedTo')}</th>
                      <th style={{ ...thR('createdAt'), width: 50 }} onClick={() => toggleSort('createdAt')}>Crtd{arrow('createdAt')}</th>
                      <th style={{ ...thR(), width: 52 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderSection('🔥 Work In Progress', '#eab308', wipMissions)}
                    {renderSection('📋 Todo', '#60a5fa', todoMissions)}
                    {renderSection('✅ Done', '#22c55e', doneMissions)}
                  </tbody>
                </table>
              )}
            </div>
          )
        })()}

        {/* ═══ MINDCRAFT2 TAB ═══ */}
        {activeTab === 'mindcraft2' && (
          <Mindcraft2 online={online} panelColor={panelColor} />
        )}

        {/* ═══ CONSOLE TAB ═══ */}
        {activeTab === 'console' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px', background: 'rgba(0,0,0,0.3)' }}>
            {thoughts.length === 0 && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>📡 Waiting for events...</div>}
            {thoughts.map((t, i) => (
              <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', gap: 6 }}>
                <span style={{ color: '#555', fontSize: 9, minWidth: 50 }}>
                  {new Date(t.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span style={{ color: panelColor, fontSize: 10, minWidth: 70 }}>{t.type}</span>
                <span style={{ color: '#888', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.data.substring(0, 120)}</span>
              </div>
            ))}
            <div ref={consoleEndRef} />
          </div>
        )}

        {/* ═══ CEHQ TAB ═══ */}
        {activeTab === 'cehq' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {!online && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>💀 Offline</div>}
            {contextModules.length === 0 && online && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>No context modules registered</div>}
            {contextModules.map(mod => {
              const isExpanded = expandedModule === `${mod.moduleName}-${mod.modeName}`
              return (
                <div key={`${mod.moduleName}-${mod.modeName}`} style={{
                  marginBottom: 8, borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${mod.enabled ? panelColor + '30' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <div
                    style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    onClick={() => setExpandedModule(isExpanded ? null : `${mod.moduleName}-${mod.modeName}`)}
                  >
                    <span style={{ fontSize: 14 }}>{isExpanded ? '▼' : '▶'}</span>
                    <span style={{ color: '#ddd', fontWeight: 600, flex: 1 }}>{mod.moduleName}</span>
                    <span style={{ fontSize: 10, color: '#888' }}>→ {mod.modeName}</span>
                    {mod.id > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleModule(mod.id, !mod.enabled) }}
                        style={{
                          padding: '2px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace',
                          background: mod.enabled ? '#22c55e20' : '#ef444420',
                          color: mod.enabled ? '#22c55e' : '#ef4444',
                        }}
                      >
                        {mod.enabled ? 'ON' : 'OFF'}
                      </button>
                    )}
                    {mod.content && <span style={{ fontSize: 9, color: '#666' }}>{mod.content.length} chars</span>}
                  </div>
                  {isExpanded && mod.content && (
                    <div style={{
                      padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)',
                      fontSize: 11, color: '#999', whiteSpace: 'pre-wrap', lineHeight: 1.4,
                      maxHeight: 200, overflowY: 'auto',
                    }}>
                      {mod.content}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── RESIZE HANDLE ─────────────────────────────────────────── */}
      <div
        onMouseDown={handleResizeStart}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'se-resize', background: `linear-gradient(135deg, transparent 50%, ${panelColor}30 50%)`, borderRadius: '0 0 12px 0' }}
      />
    </div>,
    document.body
  )
}
