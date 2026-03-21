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
  assignedTo: string | null
  technicalSpec: string | null
  history: string | null
}

interface ContextModule {
  id: number
  moduleName: string
  modeName: string
  enabled: boolean
  content: string | null
}

type TabId = 'chat' | 'mindcraft' | 'console' | 'cehq'

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
  const { settings } = useContext(SettingsContext)

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
      evtSource = new EventSource('http://localhost:4517/api/thoughts/stream')
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
        zIndex: 9999, display: 'flex', flexDirection: 'column',
        borderRadius: 12, overflow: 'hidden',
        background: `rgba(10, 10, 20, ${uiOpacity})`,
        border: `1px solid ${online ? panelColor + '40' : 'rgba(255,255,255,0.1)'}`,
        boxShadow: online ? `0 0 30px ${panelColor}20, 0 8px 32px rgba(0,0,0,0.6)` : '0 8px 32px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(12px)', fontFamily: 'monospace', fontSize: 13,
      }}
      onMouseDown={e => e.stopPropagation()}
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
        {activeTab === 'mindcraft' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {!online && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>💀 Offline</div>}
            {online && missions.length === 0 && <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>No missions yet</div>}
            {missions.map(m => {
              const isLoading = missionLoading === m.id
              return (
                <div key={m.id} style={{
                  padding: '10px 12px', marginBottom: 8, borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${m.status === 'wip' ? '#eab30840' : m.status === 'done' ? '#22c55e40' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#888' }}>#{m.id}</span>
                    <span style={{ color: '#ddd', fontWeight: 600, flex: 1 }}>{m.name}</span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: m.status === 'done' ? '#22c55e20' : m.status === 'wip' ? '#eab30820' : '#ffffff08', color: m.status === 'done' ? '#22c55e' : m.status === 'wip' ? '#eab308' : '#888' }}>
                      {m.status}
                    </span>
                  </div>

                  {m.description && <div style={{ fontSize: 11, color: '#999', marginBottom: 6, lineHeight: 1.4 }}>{m.description.substring(0, 150)}{m.description.length > 150 ? '...' : ''}</div>}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                    <span style={{ color: '#888' }}>{MATURITY_LABELS[m.maturityLevel] ?? '?'}</span>
                    <span style={{ color: '#666' }}>U:{m.urgency} E:{m.easiness} I:{m.impact}</span>
                    {m.assignedTo && <span style={{ color: '#666' }}>→ {m.assignedTo}</span>}
                    <div style={{ flex: 1 }} />

                    {m.status === 'todo' && m.maturityLevel < 3 && (
                      <button onClick={() => missionAction(m.id, 'mature')} disabled={isLoading}
                        style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #22d3ee30', background: '#22d3ee10', color: '#22d3ee', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
                        {isLoading ? '...' : '📋 Mature'}
                      </button>
                    )}
                    {m.status === 'todo' && (
                      <button onClick={() => missionAction(m.id, 'feedback', { action: 'bump' })} disabled={isLoading}
                        style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #22c55e30', background: '#22c55e10', color: '#22c55e', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
                        ⬆ Bump
                      </button>
                    )}
                    {m.status === 'todo' && m.maturityLevel >= 2 && (
                      <button onClick={() => missionAction(m.id, 'execute')} disabled={isLoading}
                        style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #fb923c30', background: '#fb923c10', color: '#fb923c', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
                        🔥 Execute
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
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
