'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PARZIVAL MISSIONS — Curator-managed missions from akasha.db
// Shows in DevCraft alongside local missions. Supports maturation UI.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useEffect, useCallback, useRef } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface ParzivalMission {
  id: number
  name: string
  description: string | null
  status: string
  maturityLevel: number
  urgency: number
  easiness: number
  impact: number
  priority: number | null
  valor: number
  score: number | null
  assignedTo: string | null
  technicalSpec: string | null
  flawlessPercent: number | null
  reviewerScore: number | null
  testerScore: number | null
  history: string | null
  createdAt: string
}

interface HistoryEntry {
  timestamp?: string
  actor?: string
  action?: string
  curatorMsg?: string
  silicondevMsg?: string
  silicondevConfidence?: number
  flawlessPercent?: number
  fromLevel?: number
  toLevel?: number
  verdict?: string
  rating?: number
  carbondevMsg?: string
  mature?: boolean
  carbonSeconds?: number
  comment?: string
}

const MATURITY_COLORS = ['#666', '#0ea5e9', '#14b8a6', '#f59e0b']
const MATURITY_LABELS = ['🌑 para', '🌘 pashyanti', '🌗 madhyama', '🌕 vaikhari']

function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR THREAD — chat bubbles for maturation ping-pong
// ═══════════════════════════════════════════════════════════════════════════

function CuratorThread({ entries, fontSize }: { entries: HistoryEntry[]; fontSize: number }) {
  const relevant = entries.filter(e => e.actor === 'curator' || e.actor === 'carbondev')
  if (relevant.length === 0) return null

  return (
    <div style={{ maxHeight: 300, overflowY: 'auto', padding: '8px 0' }}>
      {relevant.map((entry, i) => {
        const isCurator = entry.actor === 'curator'
        const isDev = entry.actor === 'carbondev'

        if (isCurator) {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              {/* Curator message */}
              <div style={{
                padding: '6px 10px', borderRadius: 8, borderTopLeftRadius: 2,
                background: 'rgba(0,255,65,0.06)', border: '1px solid rgba(0,255,65,0.15)',
                fontSize: fontSize - 1, color: '#ccc', lineHeight: 1.4, maxWidth: '90%',
              }}>
                <div style={{ fontSize: fontSize - 2, color: '#00ff41', marginBottom: 3, fontWeight: 600 }}>
                  {'📋'} CURATOR {entry.flawlessPercent != null && <span style={{ color: '#888', fontWeight: 400 }}>| flawless: {entry.flawlessPercent}%</span>}
                </div>
                {entry.curatorMsg || entry.comment || entry.action}
              </div>
              {/* SiliconDev prediction */}
              {entry.silicondevMsg && (
                <div style={{
                  padding: '6px 10px', borderRadius: 8, borderTopLeftRadius: 2,
                  background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
                  fontSize: fontSize - 1, color: '#bbb', lineHeight: 1.4, maxWidth: '90%',
                  marginTop: 4,
                }}>
                  <div style={{ fontSize: fontSize - 2, color: '#a855f7', marginBottom: 3, fontWeight: 600 }}>
                    {'🤖'} SILICONDEV {entry.silicondevConfidence != null && <span style={{ color: '#888', fontWeight: 400 }}>| conf: {(entry.silicondevConfidence * 100).toFixed(0)}%</span>}
                  </div>
                  {entry.silicondevMsg}
                </div>
              )}
            </div>
          )
        }

        if (isDev) {
          return (
            <div key={i} style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                padding: '6px 10px', borderRadius: 8, borderTopRightRadius: 2,
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)',
                fontSize: fontSize - 1, color: '#ccc', lineHeight: 1.4, maxWidth: '85%',
              }}>
                <div style={{ fontSize: fontSize - 2, color: '#60a5fa', marginBottom: 3 }}>
                  {'👤'} CARBONDEV
                  {entry.verdict && <span style={{ marginLeft: 6, color: entry.verdict === 'accept' ? '#22c55e' : '#f59e0b' }}>[{entry.verdict.toUpperCase()}]</span>}
                  {entry.rating != null && <span style={{ marginLeft: 6, color: '#888' }}>rating: {entry.rating}/10</span>}
                  {entry.mature != null && <span style={{ marginLeft: 6, color: entry.mature ? '#22c55e' : '#ef4444' }}>{entry.mature ? 'MATURE' : 'REFINE'}</span>}
                  {entry.carbonSeconds != null && <span style={{ marginLeft: 6, color: '#555' }}>{entry.carbonSeconds}s</span>}
                </div>
                {entry.carbondevMsg || entry.comment || ''}
              </div>
            </div>
          )
        }

        return null
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SILICONDEV FEEDBACK CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

function SiliconDevFeedback({ missionId, onSubmit, fontSize }: {
  missionId: number
  onSubmit: () => void
  fontSize: number
}) {
  const [rating, setRating] = useState(5)
  const [verdict, setVerdict] = useState<'accept' | 'modify' | 'rewrite'>('accept')
  const [carbondevMsg, setCarbondevMsg] = useState('')
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef(Date.now())

  const handleSubmit = async (mature: boolean) => {
    setSubmitting(true)
    const carbonSeconds = Math.floor((Date.now() - timerRef.current) / 1000)
    try {
      await fetch(`/api/parzival/proxy/missions/${missionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mature,
          verdict,
          rating,
          carbondevMsg: verdict !== 'accept' ? carbondevMsg : undefined,
          carbonSeconds,
          notes: !mature && notes.trim() ? notes.trim() : undefined,
        }),
      })
      onSubmit()
    } catch (e) { console.error('Feedback failed:', e) }
    setSubmitting(false)
  }

  const btnStyle = (color: string, active?: boolean) => ({
    padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: fontSize - 1, fontWeight: 600,
    background: active ? `${color}30` : `${color}10`,
    color,
    outline: active ? `1px solid ${color}` : 'none',
  } as React.CSSProperties)

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Rating slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: fontSize - 2, color: '#888' }}>SiliconDev rating:</span>
        <input type="range" min={0} max={10} value={rating} onChange={e => setRating(parseInt(e.target.value))}
          style={{ flex: 1, accentColor: '#a855f7' }} />
        <span style={{ fontSize: fontSize - 1, color: '#a855f7', fontWeight: 700, minWidth: 30, textAlign: 'right' }}>{rating}/10</span>
      </div>

      {/* Verdict buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button onClick={() => setVerdict('accept')} style={btnStyle('#22c55e', verdict === 'accept')}>ACCEPT</button>
        <button onClick={() => setVerdict('modify')} style={btnStyle('#f59e0b', verdict === 'modify')}>MODIFY</button>
        <button onClick={() => setVerdict('rewrite')} style={btnStyle('#ef4444', verdict === 'rewrite')}>REWRITE</button>
      </div>

      {/* CarbonDev message (for modify/rewrite) */}
      {verdict !== 'accept' && (
        <textarea
          value={carbondevMsg}
          onChange={e => setCarbondevMsg(e.target.value)}
          placeholder={verdict === 'modify' ? 'Edit the silicondev prediction...' : 'Write your response from scratch...'}
          rows={3}
          style={{
            width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, padding: '6px 8px', color: '#ddd', fontSize: fontSize - 1,
            fontFamily: 'monospace', resize: 'vertical', outline: 'none', marginBottom: 6,
          }}
        />
      )}

      {/* Mature / Refine buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => handleSubmit(true)} disabled={submitting} style={{ ...btnStyle('#22c55e'), flex: 1, padding: '6px 0' }}>
          {submitting ? '...' : '⬆️ MATURE'}
        </button>
        <button onClick={() => {
          if (!showNotes && !notes && !carbondevMsg) {
            setShowNotes(true)
            return
          }
          handleSubmit(false)
        }} disabled={submitting} style={{ ...btnStyle('#ef4444'), flex: 1, padding: '6px 0' }}>
          {submitting ? '...' : '↻ REFINE'}
        </button>
      </div>

      {/* Refine notes */}
      {showNotes && (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes for curator on what to improve..."
          rows={2}
          autoFocus
          style={{
            width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 6, padding: '6px 8px', color: '#ddd', fontSize: fontSize - 1,
            fontFamily: 'monospace', resize: 'vertical', outline: 'none', marginTop: 6,
          }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MISSION DETAIL POPUP
// ═══════════════════════════════════════════════════════════════════════════

function MissionDetail({ mission, onClose, onRefetch, fontSize }: {
  mission: ParzivalMission
  onClose: () => void
  onRefetch: () => void
  fontSize: number
}) {
  const entries = parseHistory(mission.history)
  const isAssignedToDev = mission.assignedTo === 'carbondev'
  const awaitingFeedback = isAssignedToDev && entries.some(e => e.actor === 'curator')

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#0a0a0a', border: '1px solid #333', borderRadius: 8,
        width: '90%', maxWidth: 700, maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid #222',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ color: MATURITY_COLORS[mission.maturityLevel], fontSize: fontSize + 2 }}>
              {MATURITY_LABELS[mission.maturityLevel] ?? '?'}
            </span>
            <span style={{ color: '#ddd', fontSize: fontSize + 1, fontWeight: 700, marginLeft: 10 }}>
              #{mission.id} {mission.name}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18,
          }}>{'✕'}</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {/* Carbon / Silicon descriptions side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: fontSize - 2, color: '#00ff41', marginBottom: 4, fontWeight: 600 }}>{'📋'} Carbon Description</div>
              <div style={{ fontSize: fontSize - 1, color: '#999', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                {mission.description || '(none)'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: fontSize - 2, color: '#60a5fa', marginBottom: 4, fontWeight: 600 }}>{'🔧'} Silicon Description</div>
              <div style={{ fontSize: fontSize - 1, color: '#999', lineHeight: 1.4, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {mission.technicalSpec || '(none)'}
              </div>
            </div>
          </div>

          {/* Scores bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: fontSize - 1, color: '#666' }}>
            <span>U{mission.urgency} E{mission.easiness} I{mission.impact}</span>
            <span>Pri: {mission.priority?.toFixed(2) ?? '?'}</span>
            {mission.flawlessPercent != null && <span style={{ color: '#f59e0b' }}>Flawless: {mission.flawlessPercent}%</span>}
            {mission.reviewerScore != null && <span>Rev: {mission.reviewerScore}/100</span>}
            {mission.testerScore != null && <span>Test: {mission.testerScore}%</span>}
          </div>

          {/* Curator Thread */}
          <div style={{ fontSize: fontSize - 2, color: '#00ff41', marginBottom: 4, fontWeight: 600 }}>
            {'📜'} Curator Thread
          </div>
          <CuratorThread entries={entries} fontSize={fontSize} />

          {/* Feedback controls (only when assigned to dev and there's a curator message to respond to) */}
          {awaitingFeedback && (
            <SiliconDevFeedback missionId={mission.id} onSubmit={onRefetch} fontSize={fontSize} />
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — Parzival missions list
// ═══════════════════════════════════════════════════════════════════════════

interface ParzivalMissionsProps {
  fontSize: number
  collapsed: boolean
  onToggleCollapse: () => void
}

export function ParzivalMissions({ fontSize, collapsed, onToggleCollapse }: ParzivalMissionsProps) {
  const [missions, setMissions] = useState<ParzivalMission[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedMission, setSelectedMission] = useState<ParzivalMission | null>(null)
  const [online, setOnline] = useState(false)

  const fetchMissions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/parzival/proxy/missions?assignedTo=carbondev')
      if (!res.ok) { setOnline(false); return }
      setOnline(true)
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.data ?? [])
      setMissions(list)
    } catch { setOnline(false) }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchMissions()
    const interval = setInterval(fetchMissions, 15000)
    return () => clearInterval(interval)
  }, [fetchMissions])

  // Sync selectedMission with fresh data when missions update
  useEffect(() => {
    if (selectedMission) {
      const fresh = missions.find(m => m.id === selectedMission.id)
      if (fresh) setSelectedMission(fresh)
      else setSelectedMission(null)
    }
  }, [missions]) // eslint-disable-line react-hooks/exhaustive-deps — selectedMission is intentionally stale

  const handleRefetch = () => {
    setSelectedMission(null)
    fetchMissions()
  }

  if (!online && missions.length === 0) return null // Don't show section if parzival is offline

  const todoMissions = missions.filter(m => m.status === 'todo')
  const wipMissions = missions.filter(m => m.status === 'wip')

  return (
    <>
      <div
        onClick={onToggleCollapse}
        className="px-2 py-1 font-mono flex items-center justify-between shrink-0 cursor-pointer hover:bg-[#111] select-none"
        style={{ fontSize: fontSize - 1, color: '#a855f7', borderTop: '1px solid rgba(139,92,246,0.2)' }}>
        <span>
          {collapsed ? '▸' : '▾'} {'🧿'} PARZIVAL ({todoMissions.length + wipMissions.length})
          {loading && <span style={{ marginLeft: 6, color: '#555' }}>{'⟳'}</span>}
          {!online && <span style={{ marginLeft: 6, color: '#ef4444', fontSize: fontSize - 2 }}>offline</span>}
        </span>
      </div>

      {!collapsed && (
        <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
          {[...wipMissions, ...todoMissions].map(m => {
            const isAssignedToDev = m.assignedTo === 'carbondev'
            const matColor = MATURITY_COLORS[m.maturityLevel] ?? '#666'

            return (
              <div
                key={m.id}
                onClick={() => setSelectedMission(m)}
                className="px-2 py-1 font-mono cursor-pointer hover:bg-[rgba(139,92,246,0.05)] flex items-center gap-2"
                style={{ fontSize: fontSize - 1, borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                {/* Maturity dot */}
                <span style={{ color: matColor, fontSize: fontSize - 2 }}>{'●'}</span>
                {/* Badge */}
                <span style={{ color: '#a855f7', fontSize: fontSize - 3 }}>{'🧿'}</span>
                {/* Name */}
                <span style={{ color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}
                </span>
                {/* Status */}
                {m.status === 'wip' && <span style={{ color: '#eab308', fontSize: fontSize - 2 }}>{'🔥'}</span>}
                {/* Assignment indicator */}
                <span style={{
                  fontSize: fontSize - 3, color: isAssignedToDev ? '#22c55e' : '#666',
                  padding: '1px 4px', borderRadius: 3,
                  background: isAssignedToDev ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
                }}>
                  {isAssignedToDev ? 'YOUR TURN' : 'Z'}
                </span>
                {/* Flawless */}
                {m.flawlessPercent != null && (
                  <span style={{ fontSize: fontSize - 2, color: '#f59e0b' }}>{m.flawlessPercent}%</span>
                )}
              </div>
            )
          })}
          {todoMissions.length === 0 && wipMissions.length === 0 && (
            <div className="text-center py-3 font-mono" style={{ fontSize, color: '#333' }}>
              No missions assigned to you
            </div>
          )}
        </div>
      )}

      {/* Mission detail popup */}
      {selectedMission && (
        <MissionDetail
          mission={selectedMission}
          onClose={() => setSelectedMission(null)}
          onRefetch={handleRefetch}
          fontSize={fontSize}
        />
      )}
    </>
  )
}
