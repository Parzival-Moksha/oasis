'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MINDCRAFT 2 — Mission Control Center
// ─═̷─═̷─ॐ─═̷─═̷─ Ported from b8_parzival/synapse ─═̷─═̷─ॐ─═̷─═̷─
//
// Faithful port of old Mindcraft with:
//   - Resizable columns (localStorage persistent)
//   - Multi-key sorting with direction toggle
//   - Status grouping (WIP → TODO → DONE)
//   - Expandable rows (description, tech spec, history)
//   - Filter bar (assigned, status, maturity)
//   - Action buttons (mature, bump, execute)
//
// Trimmed: scope, dharma (Sankalpa not active), curator queue,
//          modal CRUD (use API directly for now)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useEffect, useCallback, useRef } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

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

type SortKey = 'id' | 'queuePosition' | 'priority' | 'urgency' | 'easiness' | 'impact' | 'score' | 'maturityLevel' | 'assignedTo' | 'valor' | 'createdAt' | 'endedAt'
type SortDirection = 'asc' | 'desc'
type ColumnKey = 'id' | 'queue' | 'name' | 'desc' | 'maturity' | 'assigned' | 'u' | 'e' | 'i' | 'pri' | 'valor' | 'score' | 'created' | 'ended' | 'actions'

interface ColumnConfig {
  key: ColumnKey
  label: string
  minWidth: number
  defaultWidth: number
  align: 'left' | 'right'
  sortKey?: SortKey
}

interface HistoryEntry {
  timestamp: string
  actor: string
  action: string
  comment?: string
  message?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// COLUMN CONFIG — the bones of the table
// ═══════════════════════════════════════════════════════════════════════════

const COLUMNS: ColumnConfig[] = [
  { key: 'id', label: 'ID', minWidth: 20, defaultWidth: 32, align: 'left', sortKey: 'id' },
  { key: 'queue', label: '#', minWidth: 16, defaultWidth: 24, align: 'left', sortKey: 'queuePosition' },
  { key: 'name', label: 'Name', minWidth: 60, defaultWidth: 160, align: 'left' },
  { key: 'desc', label: 'Description', minWidth: 40, defaultWidth: 200, align: 'left' },
  { key: 'maturity', label: 'Mat', minWidth: 20, defaultWidth: 40, align: 'left', sortKey: 'maturityLevel' },
  { key: 'assigned', label: 'As', minWidth: 16, defaultWidth: 28, align: 'left', sortKey: 'assignedTo' },
  { key: 'u', label: 'U', minWidth: 14, defaultWidth: 22, align: 'right', sortKey: 'urgency' },
  { key: 'e', label: 'E', minWidth: 14, defaultWidth: 22, align: 'right', sortKey: 'easiness' },
  { key: 'i', label: 'I', minWidth: 14, defaultWidth: 22, align: 'right', sortKey: 'impact' },
  { key: 'pri', label: 'Pri', minWidth: 18, defaultWidth: 32, align: 'right', sortKey: 'priority' },
  { key: 'valor', label: 'V', minWidth: 16, defaultWidth: 26, align: 'right', sortKey: 'valor' },
  { key: 'score', label: 'Sc', minWidth: 18, defaultWidth: 34, align: 'right', sortKey: 'score' },
  { key: 'created', label: 'Crtd', minWidth: 28, defaultWidth: 52, align: 'right', sortKey: 'createdAt' },
  { key: 'ended', label: 'End', minWidth: 28, defaultWidth: 52, align: 'right', sortKey: 'endedAt' },
  { key: 'actions', label: '', minWidth: 56, defaultWidth: 56, align: 'right' },
]

const COLUMN_WIDTHS_KEY = 'mindcraft2-column-widths'
const FILTERS_KEY = 'mindcraft2-filters'

const getDefaultWidths = (): Record<ColumnKey, number> => {
  const widths: Record<string, number> = {}
  for (const col of COLUMNS) widths[col.key] = col.defaultWidth
  return widths as Record<ColumnKey, number>
}

// Maturity progression colors (dark→light like moon phases)
const MATURITY_COLORS = ['#666', '#0ea5e9', '#14b8a6', '#f59e0b']
const MATURITY_LABELS = ['🌑 para', '🌘 pashyanti', '🌗 madhyama', '🌕 vaikhari']
const MATURITY_SHORT = ['para', 'pash', 'madh', 'vaik']

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDateCompact(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`
}

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}

const parzivalFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(`/api/parzival/proxy/${path}`, options)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

// ═══════════════════════════════════════════════════════════════════════════
// SANKALPA EXPANSION — the expanded row view
// ═══════════════════════════════════════════════════════════════════════════

function SankalpaExpansion({ mission, onRefetch, panelColor }: { mission: Mission; onRefetch: () => void; panelColor: string }) {
  const [showDesc, setShowDesc] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  let historyEntries: HistoryEntry[] = []
  if (mission.history) {
    try { historyEntries = JSON.parse(mission.history) } catch { /* skip */ }
  }

  const handleRefine = async () => {
    if (!replyText.trim()) return
    setSending(true)
    try {
      await parzivalFetch(`missions/${mission.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mature: false, notes: replyText.trim() }),
      })
      setReplyText('')
      onRefetch()
    } catch { /* swallow */ }
    setSending(false)
  }

  const handleBump = async () => {
    setSending(true)
    try {
      await parzivalFetch(`missions/${mission.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mature: true, notes: replyText.trim() || undefined }),
      })
      setReplyText('')
      onRefetch()
    } catch { /* swallow */ }
    setSending(false)
  }

  const s = {
    container: { padding: '12px 16px' } as React.CSSProperties,
    sectionTitle: { fontSize: 10, color: panelColor, marginBottom: 4, fontWeight: 600, cursor: 'pointer', userSelect: 'none' as const },
    content: { fontSize: 11, color: '#999', whiteSpace: 'pre-wrap' as const, lineHeight: 1.4, maxHeight: 150, overflowY: 'auto' as const },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
    threadContainer: { marginTop: 10, maxHeight: 200, overflowY: 'auto' as const, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' } as React.CSSProperties,
    replyBox: { marginTop: 8, display: 'flex', gap: 6 } as React.CSSProperties,
    textarea: { flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '6px 8px', color: '#ddd', fontSize: 11, fontFamily: 'monospace', resize: 'none' as const, outline: 'none' } as React.CSSProperties,
    btn: (color: string) => ({ padding: '4px 10px', borderRadius: 4, border: 'none', background: `${color}20`, color, cursor: 'pointer', fontSize: 10, fontFamily: 'monospace', fontWeight: 600 } as React.CSSProperties),
  }

  const actionIcons: Record<string, string> = {
    created: '🌱', comment: '💬', refine: '✨', bump: '⬆️',
    mature: '📋', execute: '🔥', complete: '✅', reject: '❌',
  }

  return (
    <div style={s.container}>
      {/* Descriptions */}
      <div style={s.sectionTitle} onClick={() => setShowDesc(!showDesc)}>
        {showDesc ? '▼' : '▶'} Descriptions
      </div>
      {showDesc && (
        <div style={s.grid}>
          <div>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>📋 Carbon (description)</div>
            <div style={s.content}>{mission.description || '(none)'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>🔧 Silicon (tech spec)</div>
            <div style={{ ...s.content, fontFamily: 'monospace' }}>{mission.technicalSpec || '(none)'}</div>
          </div>
        </div>
      )}

      {/* History Thread */}
      {historyEntries.length > 0 && (
        <div style={s.threadContainer}>
          <div style={{ fontSize: 10, color: panelColor, marginBottom: 6, fontWeight: 600 }}>📜 Conversation</div>
          {historyEntries.map((entry, i) => {
            const isDev = entry.actor === 'carbondev'
            const text = entry.message || entry.comment || entry.action
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: isDev ? 'row' : 'row-reverse',
                marginBottom: 4, gap: 6,
              }}>
                <div style={{
                  maxWidth: '80%', padding: '4px 8px', borderRadius: 8,
                  background: isDev ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)',
                  border: `1px solid ${isDev ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)'}`,
                  borderTopLeftRadius: isDev ? 2 : 8,
                  borderTopRightRadius: isDev ? 8 : 2,
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

      {/* Reply Box */}
      {mission.status === 'todo' && (
        <div style={s.replyBox}>
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Comment..."
            rows={2}
            style={s.textarea}
            disabled={sending}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={handleRefine} disabled={sending || !replyText.trim()} style={s.btn('#a855f7')}>✨ Refine</button>
            <button onClick={handleBump} disabled={sending} style={s.btn('#22c55e')}>⬆️ Bump</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT2 COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface Mindcraft2Props {
  online: boolean
  panelColor: string
}

interface Filters {
  assigned: string
  status: string
  maturity: string
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE MISSION MODAL
// ═══════════════════════════════════════════════════════════════════════════

function CreateMissionModal({ onClose, onCreated, panelColor }: { onClose: () => void; onCreated: () => void; panelColor: string }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      await parzivalFetch('missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      })
      onCreated()
      onClose()
    } catch { /* swallow */ }
    setCreating(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#0a0a0a', border: `1px solid ${panelColor}40`, borderRadius: 8, padding: 16, width: 400, maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ color: panelColor, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>+ New Mission</div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Mission name..."
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px', color: '#ddd', fontSize: 12, fontFamily: 'monospace', outline: 'none', marginBottom: 8 }}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          rows={3}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px', color: '#ddd', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical', marginBottom: 10 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: 'rgba(255,255,255,0.05)', color: '#888', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}>Cancel</button>
          <button onClick={handleCreate} disabled={!name.trim() || creating} style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: `${panelColor}20`, color: panelColor, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
            {creating ? '...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Mindcraft2({ online, panelColor }: Mindcraft2Props) {
  // Mission state
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(false)

  // Sort state (multi-key)
  const [sortKeys, setSortKeys] = useState<SortKey[]>(['queuePosition', 'priority'])
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Filter state
  const [filters, setFilters] = useState<Filters>(() => loadStored(FILTERS_KEY, { assigned: 'all', status: 'all', maturity: 'all' }))

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(() => loadStored(COLUMN_WIDTHS_KEY, getDefaultWidths()))
  const [resizing, setResizing] = useState<{ key: ColumnKey; startX: number; startWidth: number } | null>(null)

  // Expansion
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Loading per-action
  const [actionLoading, setActionLoading] = useState<number | null>(null)

  // Done section lazy load
  const [doneLimit, setDoneLimit] = useState(20)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)

  // ─── Fetch missions ──────────────────────────────────────────────────
  const fetchMissions = useCallback(async () => {
    if (!online) return
    setLoading(true)
    try {
      const data = await parzivalFetch('missions')
      if (Array.isArray(data)) setMissions(data)
    } catch { /* offline */ }
    setLoading(false)
  }, [online])

  useEffect(() => { fetchMissions() }, [fetchMissions])

  // ─── Persist filters ─────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
  }, [filters])

  // ─── Resize handlers ─────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent, key: ColumnKey) => {
    e.preventDefault()
    e.stopPropagation()
    const col = COLUMNS.find(c => c.key === key)!
    setResizing({ key, startX: e.clientX, startWidth: columnWidths[key] ?? col.defaultWidth })
  }, [columnWidths])

  useEffect(() => {
    if (!resizing) return
    const handleMove = (e: MouseEvent) => {
      const col = COLUMNS.find(c => c.key === resizing.key)!
      const delta = e.clientX - resizing.startX
      const newWidth = Math.max(col.minWidth, resizing.startWidth + delta)
      setColumnWidths(prev => {
        // Description absorbs the delta
        const descDelta = newWidth - (prev[resizing.key] ?? col.defaultWidth)
        const newDescWidth = Math.max(40, (prev.desc ?? 200) - descDelta)
        const updated = { ...prev, [resizing.key]: newWidth, desc: newDescWidth }
        return updated
      })
    }
    const handleUp = () => {
      setColumnWidths(prev => {
        localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(prev))
        return prev
      })
      setResizing(null)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [resizing])

  // ─── Sort toggle ──────────────────────────────────────────────────────
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKeys[0] === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortDirection('asc')
      setSortKeys(prev => [key, ...prev.filter(k => k !== key)])
    }
  }, [sortKeys])

  const getSortArrow = (key: SortKey): string => {
    if (sortKeys[0] !== key) return ''
    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  // ─── Mission actions ──────────────────────────────────────────────────
  const missionAction = useCallback(async (id: number, action: string, body?: object) => {
    setActionLoading(id)
    try {
      await parzivalFetch(`missions/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      await fetchMissions()
    } catch { /* swallow */ }
    setActionLoading(null)
  }, [fetchMissions])

  // ─── Filter + Sort missions ───────────────────────────────────────────
  const filteredMissions = missions.filter(m => {
    if (filters.assigned !== 'all') {
      if (filters.assigned === 'none' && m.assignedTo != null) return false
      if (filters.assigned !== 'none' && m.assignedTo !== filters.assigned) return false
    }
    if (filters.status !== 'all' && m.status !== filters.status) return false
    if (filters.maturity !== 'all' && m.maturityLevel !== parseInt(filters.maturity)) return false
    return true
  })

  const sortedMissions = [...filteredMissions].sort((a, b) => {
    for (let si = 0; si < sortKeys.length; si++) {
      const key = sortKeys[si]
      const dir = si === 0 ? sortDirection : 'asc' // Only primary key uses direction

      const av = (a as unknown as Record<string, unknown>)[key]
      const bv = (b as unknown as Record<string, unknown>)[key]

      let cmp = 0
      if (av == null && bv == null) cmp = 0
      else if (av == null) cmp = 1
      else if (bv == null) cmp = -1
      else if (key === 'createdAt' || key === 'endedAt') {
        cmp = new Date(av as string).getTime() - new Date(bv as string).getTime()
      } else if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv)
      } else {
        cmp = (Number(av) || 0) - (Number(bv) || 0)
      }

      if (dir === 'desc') cmp = -cmp
      if (cmp !== 0) return cmp
    }
    return 0
  })

  // Group by status
  const wipMissions = sortedMissions.filter(m => m.status === 'wip')
  const todoMissions = sortedMissions.filter(m => m.status === 'todo')
  const doneMissions = sortedMissions.filter(m => m.status === 'done' || m.status === 'cancelled' || m.status === 'failed')
  const visibleDone = doneMissions.slice(0, doneLimit)
  const hasMoreDone = doneMissions.length > doneLimit

  // ─── Styles ──────────────────────────────────────────────────────────
  const S = {
    th: (col: ColumnConfig): React.CSSProperties => ({
      width: columnWidths[col.key] ?? col.defaultWidth,
      padding: '4px 6px',
      fontSize: 10,
      color: sortKeys[0] === col.sortKey ? panelColor : '#666',
      fontWeight: sortKeys[0] === col.sortKey ? 700 : 400,
      textAlign: col.align,
      cursor: col.sortKey ? 'pointer' : 'default',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      position: 'relative' as const,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    }),
    td: (col: ColumnConfig): React.CSSProperties => ({
      width: columnWidths[col.key] ?? col.defaultWidth,
      padding: '3px 6px',
      fontSize: 11,
      color: '#999',
      textAlign: col.align,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    resizeHandle: {
      position: 'absolute' as const,
      right: 0,
      top: 0,
      bottom: 0,
      width: 4,
      cursor: 'col-resize',
      background: 'transparent',
    } as React.CSSProperties,
    sectionHeader: (color: string): React.CSSProperties => ({
      padding: '4px 8px',
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: 1,
      color,
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }),
    filterBar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 8px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      flexWrap: 'wrap' as const,
    } as React.CSSProperties,
    select: {
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4,
      padding: '2px 6px',
      color: '#ccc',
      fontSize: 10,
      fontFamily: 'monospace',
      outline: 'none',
    } as React.CSSProperties,
    actionBtn: (color: string) => ({
      padding: '1px 4px',
      borderRadius: 3,
      border: 'none',
      background: `${color}15`,
      color,
      cursor: 'pointer',
      fontSize: 9,
      fontFamily: 'monospace',
    } as React.CSSProperties),
  }

  // ─── Render mission row ──────────────────────────────────────────────
  const renderRow = (m: Mission) => {
    const isExpanded = expandedId === m.id
    const isLoading = actionLoading === m.id
    const pri = m.priority != null ? m.priority.toFixed(1) : '-'
    const sc = m.score != null ? m.score.toFixed(1) : '-'
    const valorColor = m.valor >= 1.5 ? '#22c55e' : m.valor < 1.0 ? '#ef4444' : '#999'

    return (
      <React.Fragment key={m.id}>
        <tr
          onClick={() => setExpandedId(isExpanded ? null : m.id)}
          style={{
            cursor: 'pointer',
            borderTop: '1px solid rgba(255,255,255,0.03)',
            background: isExpanded ? 'rgba(255,255,255,0.03)' : m.status === 'wip' ? 'rgba(234,179,8,0.05)' : 'transparent',
          }}
          onMouseEnter={e => { if (!isExpanded && m.status !== 'wip') e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          onMouseLeave={e => { e.currentTarget.style.background = isExpanded ? 'rgba(255,255,255,0.03)' : m.status === 'wip' ? 'rgba(234,179,8,0.05)' : 'transparent' }}
        >
          <td style={{ ...S.td(COLUMNS[0]), color: '#555' }}>{m.id}</td>
          <td style={{ ...S.td(COLUMNS[1]), color: '#888' }}>{m.queuePosition ?? '-'}</td>
          <td style={{ ...S.td(COLUMNS[2]), color: '#ddd', fontWeight: 600 }}>{m.name}</td>
          <td style={{ ...S.td(COLUMNS[3]), color: '#666' }}>{m.description ? m.description.substring(0, 60) : '-'}</td>
          <td style={{ ...S.td(COLUMNS[4]), color: MATURITY_COLORS[m.maturityLevel] ?? '#666' }}>
            {MATURITY_SHORT[m.maturityLevel] ?? '?'}
          </td>
          <td style={{ ...S.td(COLUMNS[5]), color: m.assignedTo === 'carbondev' ? '#60a5fa' : m.assignedTo === 'parzival' ? '#a855f7' : '#555' }}>
            {m.assignedTo === 'carbondev' ? '👤' : m.assignedTo === 'parzival' ? '🧿' : '-'}
          </td>
          <td style={S.td(COLUMNS[6])}>{m.urgency}</td>
          <td style={S.td(COLUMNS[7])}>{m.easiness}</td>
          <td style={S.td(COLUMNS[8])}>{m.impact}</td>
          <td style={{ ...S.td(COLUMNS[9]), fontWeight: 500 }}>{pri}</td>
          <td style={{ ...S.td(COLUMNS[10]), color: valorColor }}>{m.valor != null ? m.valor.toFixed(1) : '-'}</td>
          <td style={{ ...S.td(COLUMNS[11]), color: '#22c55e' }}>{sc}</td>
          <td style={{ ...S.td(COLUMNS[12]), color: '#666' }}>{formatDateCompact(m.createdAt)}</td>
          <td style={{ ...S.td(COLUMNS[13]), color: '#666' }}>{formatDateCompact(m.endedAt)}</td>
          <td style={{ ...S.td(COLUMNS[14]) }}>
            <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              {m.status === 'todo' && m.maturityLevel < 3 && (
                <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'mature') }} disabled={isLoading} style={S.actionBtn('#22d3ee')}>
                  {isLoading ? '..' : '📋'}
                </button>
              )}
              {m.status === 'todo' && (
                <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'feedback', { mature: true }) }} disabled={isLoading} style={S.actionBtn('#22c55e')}>
                  ⬆
                </button>
              )}
              {m.status === 'todo' && m.maturityLevel >= 2 && (
                <button onClick={e => { e.stopPropagation(); missionAction(m.id, 'execute') }} disabled={isLoading} style={S.actionBtn('#fb923c')}>
                  🔥
                </button>
              )}
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
            <td colSpan={COLUMNS.length}>
              <SankalpaExpansion mission={m} onRefetch={fetchMissions} panelColor={panelColor} />
            </td>
          </tr>
        )}
      </React.Fragment>
    )
  }

  // ─── Render section ──────────────────────────────────────────────────
  const renderSection = (title: string, color: string, list: Mission[]) => {
    if (list.length === 0) return null
    return (
      <React.Fragment key={title}>
        <tr><td colSpan={COLUMNS.length} style={S.sectionHeader(color)}>{title} ({list.length})</td></tr>
        {list.map(renderRow)}
      </React.Fragment>
    )
  }

  if (!online) return <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>💀 Offline</div>

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: resizing ? 'col-resize' : 'default', userSelect: resizing ? 'none' : 'auto' }}>
      {/* Header bar */}
      <div style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: 14 }}>🎯</span>
        <span style={{ color: panelColor, fontWeight: 700, fontSize: 12 }}>Mindcraft</span>
        <button
          onClick={() => setShowCreate(true)}
          style={{ marginLeft: 'auto', padding: '1px 8px', borderRadius: 4, border: 'none', background: `${panelColor}15`, color: panelColor, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}
        >+ New</button>
        <span style={{ color: '#555', fontSize: 10 }}>
          {filteredMissions.length}/{missions.length}
        </span>
        {loading && <span style={{ color: panelColor, fontSize: 10 }}>⟳</span>}
      </div>

      {/* Filter bar */}
      <div style={S.filterBar}>
        <span style={{ color: '#555', fontSize: 10 }}>🔍</span>

        <span style={{ color: '#666', fontSize: 9 }}>As:</span>
        <select value={filters.assigned} onChange={e => setFilters(p => ({ ...p, assigned: e.target.value }))} style={S.select}>
          <option value="all">all</option>
          <option value="dev">👤 dev</option>
          <option value="parzival">🧿 Z</option>
          <option value="none">∅</option>
        </select>

        <span style={{ color: '#666', fontSize: 9 }}>St:</span>
        <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} style={S.select}>
          <option value="all">all</option>
          <option value="todo">📋 todo</option>
          <option value="wip">🔥 wip</option>
          <option value="done">✅ done</option>
        </select>

        <span style={{ color: '#666', fontSize: 9 }}>Mat:</span>
        <select value={filters.maturity} onChange={e => setFilters(p => ({ ...p, maturity: e.target.value }))} style={S.select}>
          <option value="all">all</option>
          <option value="0">🌑 para</option>
          <option value="1">🌘 pash</option>
          <option value="2">🌗 madh</option>
          <option value="3">🌕 vaik</option>
        </select>

        {(filters.assigned !== 'all' || filters.status !== 'all' || filters.maturity !== 'all') && (
          <button
            onClick={() => setFilters({ assigned: 'all', status: 'all', maturity: 'all' })}
            style={{ ...S.actionBtn('#ef4444'), marginLeft: 4 }}
          >✕ Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        {missions.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>No missions yet</div>
        )}
        {missions.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    style={S.th(col)}
                    onClick={() => col.sortKey && toggleSort(col.sortKey)}
                  >
                    {col.label}{col.sortKey ? getSortArrow(col.sortKey) : ''}
                    {/* Resize handle */}
                    {col.key !== 'actions' && (
                      <div
                        style={{
                          ...S.resizeHandle,
                          background: resizing?.key === col.key ? `${panelColor}80` : 'transparent',
                        }}
                        onMouseDown={e => handleResizeStart(e, col.key)}
                        onMouseEnter={e => { if (!resizing) (e.currentTarget.style.background = `${panelColor}40`) }}
                        onMouseLeave={e => { if (!resizing) (e.currentTarget.style.background = 'transparent') }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderSection('🔥 Work In Progress', '#eab308', wipMissions)}
              {renderSection('📋 Todo', '#60a5fa', todoMissions)}
              {renderSection('✅ Done', '#22c55e', visibleDone)}
              {hasMoreDone && (
                <tr>
                  <td colSpan={COLUMNS.length} style={{ padding: 8, textAlign: 'center' }}>
                    <button
                      onClick={() => setDoneLimit(l => l + 20)}
                      style={{ ...S.actionBtn(panelColor), padding: '4px 12px' }}
                    >
                      Load more ({doneMissions.length - doneLimit} remaining)
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateMissionModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchMissions}
          panelColor={panelColor}
        />
      )}
    </div>
  )
}
