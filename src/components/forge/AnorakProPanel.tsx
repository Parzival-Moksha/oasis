'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO PANEL — 2D overlay for the autonomous dev pipeline
// ─═̷─═̷─ॐ─═̷─═̷─ Curator, Coder, Reviewer, Tester in one view ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import React, { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'
import { useOasisStore } from '../../store/oasisStore'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 80, y: 80 }
const MIN_WIDTH = 480
const MIN_HEIGHT = 450
const DEFAULT_WIDTH = 600
const DEFAULT_HEIGHT = 700

const POS_KEY = 'oasis-anorak-pro-pos'
const SIZE_KEY = 'oasis-anorak-pro-size'
const TAB_KEY = 'oasis-anorak-pro-tab'
const SETTINGS_KEY = 'oasis-anorak-pro-settings'
const CONFIG_KEY = 'oasis-anorak-pro-config'

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PRO CONFIG — persisted to localStorage, flows to API calls
// ═══════════════════════════════════════════════════════════════════════════

export interface CustomContextModule {
  name: string
  content: string
  enabled: boolean
}

export interface AnorakProConfig {
  models: { curator: string; coder: string; reviewer: string; tester: string }
  reviewerThreshold: number
  batchSize: number
  recapLength: number
  autoCurate: boolean
  autoCode: boolean
  contextModules: { rl: boolean; queued: boolean; allTodo: boolean }
  customModules: CustomContextModule[]
}

const DEFAULT_CONFIG: AnorakProConfig = {
  models: { curator: 'sonnet', coder: 'opus', reviewer: 'sonnet', tester: 'sonnet' },
  reviewerThreshold: 90,
  batchSize: 1,
  recapLength: 100,
  autoCurate: false,
  autoCode: false,
  contextModules: { rl: true, queued: true, allTodo: false },
  customModules: [],
}

function loadConfig(): AnorakProConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
    if (!saved) return DEFAULT_CONFIG
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      models: { ...DEFAULT_CONFIG.models, ...saved.models },
      contextModules: { ...DEFAULT_CONFIG.contextModules, ...saved.contextModules },
    }
  } catch { return DEFAULT_CONFIG }
}

function saveConfig(c: AnorakProConfig) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)) } catch {}
}

type Tab = 'stream' | 'mindcraft' | 'curator-log' | 'cehq'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'stream', label: 'Stream', icon: '⚡' },
  { id: 'mindcraft', label: 'Mindcraft', icon: '📋' },
  { id: 'curator-log', label: 'Curator Log', icon: '📜' },
  { id: 'cehq', label: 'CEHQ', icon: '⚙' },
]

const LOBE_COLORS: Record<string, string> = {
  'anorak-pro': '#14b8a6',
  curator: '#f59e0b',
  coder: '#ef4444',
  reviewer: '#3b82f6',
  tester: '#22c55e',
  carbondev: '#60a5fa',
}

interface PanelSettings {
  bgColor: string
  opacity: number
  blur: number
}

const DEFAULT_SETTINGS: PanelSettings = { bgColor: '#080a0f', opacity: 0.92, blur: 0 }

// ═══════════════════════════════════════════════════════════════════════════
// STREAM TAB — unified chat/stream view with all lobe colors
// ═══════════════════════════════════════════════════════════════════════════

interface StreamEntry {
  id: number
  type: 'text' | 'status' | 'tool' | 'tool_result' | 'error' | 'stderr' | 'thinking'
  content: string
  lobe: string
  timestamp: number
}

const StreamTab = React.memo(function StreamTab({ entries }: { entries: StreamEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const visible = entries.slice(-200)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries.length])

  if (visible.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm font-mono">
        No activity yet. Curate or execute a mission to see the stream.
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
      {visible.map(e => (
        <div key={e.id} style={{ color: e.type === 'error' ? '#ef4444' : e.type === 'stderr' ? '#555' : (LOBE_COLORS[e.lobe] || '#888') }}>
          <span style={{ opacity: 0.5, marginRight: 6 }}>{e.lobe}</span>
          {e.type === 'tool' && <span style={{ color: '#888' }}>[{e.content}] </span>}
          {e.type === 'status' && <span style={{ fontStyle: 'italic' }}>{e.content}</span>}
          {e.type === 'text' && e.content}
          {e.type === 'error' && <span>ERROR: {e.content}</span>}
          {e.type === 'stderr' && <span style={{ opacity: 0.6 }}>{e.content}</span>}
          {e.type === 'thinking' && <span style={{ opacity: 0.4, fontStyle: 'italic' }}>{e.content.substring(0, 200)}</span>}
          {e.type === 'tool_result' && <span style={{ opacity: 0.5 }}>{e.content.substring(0, 150)}</span>}
        </div>
      ))}
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT TAB — mission list with 4 segments
// ═══════════════════════════════════════════════════════════════════════════

const MATURITY_COLORS = ['#666', '#0ea5e9', '#14b8a6', '#f59e0b']
const MATURITY_LABELS = ['\u{1F311} para', '\u{1F318} pashyanti', '\u{1F317} madhyama', '\u{1F315} vaikhari']

const DHARMA_ABBR: Record<string, { label: string; color: string }> = {
  view: { label: 'VW', color: '#60a5fa' },
  intention: { label: 'IN', color: '#f59e0b' },
  speech: { label: 'SP', color: '#a78bfa' },
  action: { label: 'AC', color: '#ef4444' },
  livelihood: { label: 'LH', color: '#22c55e' },
  effort: { label: 'EF', color: '#f97316' },
  mindfulness: { label: 'MF', color: '#14b8a6' },
  concentration: { label: 'CN', color: '#ec4899' },
}

function DharmaTags({ dharma }: { dharma: string | null }) {
  if (!dharma) return null
  const paths = dharma.split(',').map(s => s.trim()).filter(Boolean)
  return (
    <span className="inline-flex gap-0.5">
      {paths.map(p => {
        const d = DHARMA_ABBR[p]
        return d ? (
          <span key={p} style={{ color: d.color, fontSize: 8, border: `1px solid ${d.color}33`, borderRadius: 2, padding: '0 2px' }} title={`Right ${p.charAt(0).toUpperCase() + p.slice(1)}`}>
            {d.label}
          </span>
        ) : null
      })}
    </span>
  )
}

interface MindcraftMission {
  id: number; name: string; maturityLevel: number; status: string
  priority: number | null; flawlessPercent: number | null
  reviewerScore: number | null; testerScore: number | null
  valor: number | null; assignedTo: string | null; dharmaPath: string | null
  executionPhase: string | null; executionRound: number
  carbonDescription: string | null; siliconDescription: string | null
  description: string | null; history: string | null
}

// ── Feedback Popup ──────────────────────────────────────────
function FeedbackPopup({ mission, onClose, onSubmit }: {
  mission: MindcraftMission
  onClose: () => void
  onSubmit: (data: { missionId: number; mature: boolean; verdict: string; rating: number; carbondevMsg?: string }) => void
}) {
  const [verdict, setVerdict] = useState<'accept' | 'modify' | 'rewrite'>('accept')
  const [rating, setRating] = useState(7)
  const [msg, setMsg] = useState('')
  const [startTime] = useState(Date.now())

  const history = (() => { try { return JSON.parse(mission.history || '[]') } catch { return [] } })()
  const lastCurator = [...history].reverse().find((e: Record<string, unknown>) => e.actor === 'curator')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#111', border: '1px solid rgba(20,184,166,0.3)', borderRadius: 12, padding: 20, maxWidth: 500, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span style={{ color: MATURITY_COLORS[mission.maturityLevel] }} className="text-xs">{MATURITY_LABELS[mission.maturityLevel]}</span>
            <span className="text-white font-bold ml-2">#{mission.id} {mission.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg cursor-pointer">×</button>
        </div>

        {/* Carbon description */}
        {mission.carbonDescription && (
          <div className="mb-3 p-2 rounded bg-black/40 border border-white/5 text-xs text-gray-300" style={{ fontStyle: 'italic' }}>
            {mission.carbonDescription}
          </div>
        )}

        {/* Curator message */}
        {lastCurator && (
          <div className="mb-3">
            <div className="text-[10px] text-amber-400 uppercase tracking-widest mb-1">Curator says</div>
            <div className="text-xs text-gray-400 p-2 rounded bg-amber-500/5 border border-amber-500/10">
              {(lastCurator as Record<string, string>).curatorMsg || '(no message)'}
            </div>
            {(lastCurator as Record<string, string>).silicondevMsg && (
              <div className="mt-1">
                <div className="text-[10px] text-teal-400 uppercase tracking-widest mb-1">SiliconDev predicts</div>
                <div className="text-xs text-gray-500 p-2 rounded bg-teal-500/5 border border-teal-500/10">
                  {(lastCurator as Record<string, string>).silicondevMsg}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Flawless */}
        {mission.flawlessPercent != null && (
          <div className="text-xs text-gray-500 mb-3">Flawless: {mission.flawlessPercent}%</div>
        )}

        {/* Feedback form */}
        <div className="space-y-3">
          {/* Verdict */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase mb-1">SiliconDev accuracy</div>
            <div className="flex gap-2">
              {(['accept', 'modify', 'rewrite'] as const).map(v => (
                <button key={v} onClick={() => setVerdict(v)}
                  className="text-[10px] px-3 py-1 rounded cursor-pointer transition-all"
                  style={{
                    background: verdict === v ? (v === 'accept' ? 'rgba(34,197,94,0.2)' : v === 'modify' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${verdict === v ? (v === 'accept' ? 'rgba(34,197,94,0.5)' : v === 'modify' ? 'rgba(245,158,11,0.5)' : 'rgba(239,68,68,0.5)') : 'rgba(255,255,255,0.1)'}`,
                    color: verdict === v ? '#fff' : '#888',
                  }}>
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Rating */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase mb-1">Rating: {rating}/10</div>
            <input type="range" min={0} max={10} value={rating} onChange={e => setRating(parseInt(e.target.value))}
              className="w-full accent-teal-500" />
          </div>

          {/* Message */}
          {verdict !== 'accept' && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase mb-1">Your message</div>
              <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3}
                className="w-full bg-black/60 border border-white/10 rounded p-2 text-xs text-gray-300 outline-none resize-none"
                placeholder="What should curator know for next round?" />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-white/5">
            <button onClick={async () => {
              const carbonSeconds = Math.round((Date.now() - startTime) / 1000)
              await fetch('/api/anorak/pro/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ missionId: mission.id, mature: true, verdict, rating, carbondevMsg: msg || undefined, carbonSeconds }),
              }).catch(() => {})
              onSubmit({ missionId: mission.id, mature: true, verdict, rating, carbondevMsg: msg || undefined })
            }}
              className="flex-1 text-xs py-1.5 rounded cursor-pointer bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all">
              ⬆ BUMP
            </button>
            <button onClick={async () => {
              const carbonSeconds = Math.round((Date.now() - startTime) / 1000)
              await fetch('/api/anorak/pro/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ missionId: mission.id, mature: false, verdict, rating, carbondevMsg: msg || undefined, carbonSeconds }),
              }).catch(() => {})
              onSubmit({ missionId: mission.id, mature: false, verdict, rating, carbondevMsg: msg || undefined })
            }}
              className="flex-1 text-xs py-1.5 rounded cursor-pointer bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-all">
              ↻ REFINE
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MindcraftTab({
  onCurate,
  onExecute,
  isAgentRunning,
}: {
  onCurate: (id: number) => void
  onExecute: (id: number) => void
  isAgentRunning: boolean
}) {
  const [missions, setMissions] = useState<MindcraftMission[]>([])
  const [loading, setLoading] = useState(true)
  const [feedbackMission, setFeedbackMission] = useState<MindcraftMission | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchMissions = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetch('/api/missions', { signal: abortRef.current.signal })
      if (!res.ok) return
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.data ?? [])
      // Show all anorak-related missions
      setMissions(list.filter((m: MindcraftMission) =>
        m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro' ||
        m.assignedTo === 'carbondev' // show carbondev missions that have anorak history too
      ))
    } catch (err) { if ((err as Error).name !== 'AbortError') { /* offline */ } }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMissions() }, [fetchMissions])
  useEffect(() => {
    const interval = setInterval(fetchMissions, 10000)
    return () => { abortRef.current?.abort(); clearInterval(interval) }
  }, [fetchMissions])

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading...</div>

  const currentActivity = missions.filter(m => m.executionPhase != null)
  const awaitingFeedback = missions.filter(m => m.assignedTo === 'carbondev' && m.maturityLevel < 3 && m.status !== 'done')
  const curatorQueue = missions.filter(m => m.maturityLevel < 3 && m.status !== 'done' && (m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro'))
  const curated = missions.filter(m => m.maturityLevel >= 3 && m.status !== 'done')
  const done = missions.filter(m => m.status === 'done')

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3 text-xs font-mono">
      {/* Section A: Current Activity + Interrupted missions */}
      <div>
        <div className="text-[10px] text-teal-400 uppercase tracking-widest mb-1">Current Activity</div>
        {currentActivity.length === 0 && !isAgentRunning ? (
          <div className="text-gray-600 text-[11px] py-1">No active agent</div>
        ) : currentActivity.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-2 rounded" style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)' }}>
            {isAgentRunning ? (
              <span className="animate-pulse text-teal-400">●</span>
            ) : (
              <span className="text-amber-400">⚠</span>
            )}
            <span className="text-white">#{m.id}</span>
            <span className="text-gray-300 truncate flex-1">{m.name}</span>
            <span className="text-teal-400/70">{m.executionPhase} (r{m.executionRound})</span>
            {!isAgentRunning && (
              <>
                <button onClick={() => onExecute(m.id)}
                  className="text-[9px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 cursor-pointer">RESUME</button>
                <button onClick={async () => {
                  await fetch(`/api/missions/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ executionPhase: null, status: 'todo' }) })
                  fetchMissions()
                }}
                  className="text-[9px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 cursor-pointer">ABORT</button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Section A.5: Awaiting Your Feedback */}
      {awaitingFeedback.length > 0 && (
        <div>
          <div className="text-[10px] text-blue-400 uppercase tracking-widest mb-1">Awaiting Your Feedback ({awaitingFeedback.length})</div>
          {awaitingFeedback.map(m => (
            <div key={m.id} className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-blue-500/10 border border-blue-500/10"
              onClick={() => setFeedbackMission(m)}>
              <span className="text-gray-500 w-6">#{m.id}</span>
              <span style={{ color: MATURITY_COLORS[m.maturityLevel] }} className="text-[10px] w-16">{MATURITY_LABELS[m.maturityLevel]}</span>
              <span className="text-gray-300 truncate flex-1">{m.name}</span>
              {m.flawlessPercent != null && <span className="text-gray-500">{m.flawlessPercent}%</span>}
              <span className="text-[9px] text-blue-400">REVIEW →</span>
            </div>
          ))}
        </div>
      )}

      {/* Section B: Curator Queue */}
      <div>
        <div className="text-[10px] text-amber-400 uppercase tracking-widest mb-1">Curator Queue ({curatorQueue.length})</div>
        {curatorQueue.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-1 border-b border-white/5">
            <span className="text-gray-500 w-6">#{m.id}</span>
            <span style={{ color: MATURITY_COLORS[m.maturityLevel] }} className="text-[10px] w-16">{MATURITY_LABELS[m.maturityLevel]}</span>
            <span className="text-gray-300 truncate flex-1">{m.name}</span>
            <DharmaTags dharma={m.dharmaPath} />
            {m.flawlessPercent != null && <span className="text-gray-500">{m.flawlessPercent}%</span>}
            <button
              onClick={() => onCurate(m.id)}
              disabled={isAgentRunning}
              className="text-[9px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-30 cursor-pointer"
            >
              CURATE
            </button>
          </div>
        ))}
        {curatorQueue.length === 0 && <div className="text-gray-600 text-[11px] py-1">Queue empty</div>}
      </div>

      {/* Section C: Curated / Ready */}
      <div>
        <div className="text-[10px] text-green-400 uppercase tracking-widest mb-1">Ready for Execution ({curated.length})</div>
        {curated.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-1 border-b border-white/5">
            <span className="text-gray-500 w-6">#{m.id}</span>
            <span style={{ color: '#f59e0b' }} className="text-[10px]">{MATURITY_LABELS[3]}</span>
            <span className="text-gray-300 truncate flex-1">{m.name}</span>
            <button
              onClick={() => onExecute(m.id)}
              disabled={isAgentRunning}
              className="text-[9px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 cursor-pointer"
            >
              CODE
            </button>
          </div>
        ))}
        {curated.length === 0 && <div className="text-gray-600 text-[11px] py-1">No vaikhari missions</div>}
      </div>

      {/* Section D: Done */}
      <div>
        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Done ({done.length})</div>
        {done.slice(0, 20).map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-1 border-b border-white/5 text-gray-500">
            <span className="w-6">#{m.id}</span>
            <span className="truncate flex-1">{m.name}</span>
            <DharmaTags dharma={m.dharmaPath} />
            {m.reviewerScore != null && <span className="text-blue-400/50">R{m.reviewerScore}</span>}
            {m.testerScore != null && <span className="text-green-400/50">T{m.testerScore}</span>}
            {m.valor != null && <span className="text-amber-400/50">V{m.valor}</span>}
          </div>
        ))}
      </div>

      {/* Feedback popup */}
      {feedbackMission && (
        <FeedbackPopup
          mission={feedbackMission}
          onClose={() => { setFeedbackMission(null); fetchMissions() }}
          onSubmit={() => { setFeedbackMission(null); fetchMissions() }}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR LOG TAB
// ═══════════════════════════════════════════════════════════════════════════

function CuratorLogTab() {
  const [logs, setLogs] = useState<Array<{ id: number; status: string; startedAt: string; durationMs: number | null; missionsProcessed: number; missionsEnriched: number; tokensIn: number; tokensOut: number; error: string | null }>>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const fetchLogs = async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      try {
        const res = await fetch('/api/anorak/pro/curator-logs', { signal: abortRef.current.signal })
        if (res.ok) setLogs(await res.json())
      } catch (err) { if ((err as Error).name !== 'AbortError') { /* offline */ } }
    }
    fetchLogs()
    const interval = setInterval(fetchLogs, 15000)
    return () => { abortRef.current?.abort(); clearInterval(interval) }
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
      {logs.length === 0 ? (
        <div className="text-gray-600 text-center py-8">
          No curator invocations yet.<br />
          Curate a mission to see logs here.
        </div>
      ) : logs.map(log => (
        <div key={log.id} className="flex items-center gap-2 py-1 border-b border-white/5">
          <span className={log.status === 'completed' ? 'text-green-400' : log.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>
            {log.status === 'completed' ? '✓' : log.status === 'failed' ? '✗' : '●'}
          </span>
          <span className="text-gray-400">{new Date(log.startedAt).toLocaleTimeString()}</span>
          <span className="text-gray-500">{log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '...'}</span>
          <span className="text-gray-300">{log.missionsProcessed} processed, {log.missionsEnriched} enriched</span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CEHQ TAB — Context Engineering HQ
// ═══════════════════════════════════════════════════════════════════════════

function LobeEditor({ lobe }: { lobe: string }) {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const ac = new AbortController()
    setLoading(true)
    fetch(`/api/anorak/pro/lobeprompt?lobe=${lobe}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.content) { setContent(data.content); setDirty(false) } })
      .catch(e => { if (e.name !== 'AbortError') { /* offline */ } })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [expanded, lobe])

  const handleSave = async () => {
    setSaved(false)
    try {
      const res = await fetch('/api/anorak/pro/lobeprompt', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lobe, content }),
      })
      if (res.ok) { setSaved(true); setDirty(false); setTimeout(() => setSaved(false), 2000) }
    } catch { /* offline */ }
  }

  return (
    <div className="mt-1">
      <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-gray-600 hover:text-gray-400 cursor-pointer">
        {expanded ? '▼' : '▶'} .claude/agents/{lobe}.md {dirty && <span className="text-amber-400 ml-1">●</span>}
      </button>
      {expanded && (
        <div className="mt-1">
          {loading ? (
            <div className="text-gray-600 text-[10px] py-2">Loading...</div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setDirty(true) }}
                className="w-full h-40 bg-black/60 border border-white/10 rounded p-2 text-gray-300 text-[10px] leading-relaxed resize-y outline-none focus:border-teal-500/30"
                spellCheck={false}
              />
              <div className="flex items-center gap-2 mt-1">
                <button onClick={handleSave} disabled={!dirty}
                  className="text-[9px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 disabled:opacity-30 cursor-pointer">
                  Save
                </button>
                <span className="text-[9px] text-gray-600">{content.length} chars</span>
                {saved && <span className="text-[9px] text-green-400">Saved ✓</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CEHQTab({ config, onUpdate }: { config: AnorakProConfig; onUpdate: (p: Partial<AnorakProConfig>) => void }) {
  const inputCls = "w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-gray-300 outline-none"
  const selectCls = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-gray-300 outline-none"

  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
      <div className="text-teal-400 text-[10px] uppercase tracking-widest mb-3">Context Engineering HQ</div>

      <div className="space-y-3">
        {/* Per-lobe model selection + lobeprompt editing */}
        {(['curator', 'coder', 'reviewer', 'tester'] as const).map(lobe => (
          <div key={lobe} className="border border-white/5 rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span style={{ color: LOBE_COLORS[lobe] }} className="font-bold capitalize">{lobe}</span>
              <select
                value={config.models[lobe]}
                onChange={e => onUpdate({ models: { ...config.models, [lobe]: e.target.value } })}
                className={selectCls}
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </div>
            <LobeEditor lobe={lobe} />
          </div>
        ))}

        {/* Context modules */}
        <div className="border border-white/5 rounded p-2">
          <div className="text-gray-400 font-bold text-[11px] mb-1">Context Modules</div>
          <div className="space-y-1 text-[10px]">
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" checked={config.contextModules.rl} onChange={e => onUpdate({ contextModules: { ...config.contextModules, rl: e.target.checked } })} className="accent-teal-500" /> RL Signal (curator-rl.md)
            </label>
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" checked={config.contextModules.queued} onChange={e => onUpdate({ contextModules: { ...config.contextModules, queued: e.target.checked } })} className="accent-teal-500" /> Queued Missions
            </label>
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" checked={config.contextModules.allTodo} onChange={e => onUpdate({ contextModules: { ...config.contextModules, allTodo: e.target.checked } })} className="accent-teal-500" /> All TODO Missions
            </label>
          </div>
        </div>

        {/* Custom context modules */}
        <div className="border border-white/5 rounded p-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-gray-400 font-bold text-[11px]">Custom Modules</div>
            <button onClick={() => {
              if ((config.customModules?.length ?? 0) >= 20) return
              const name = `Module ${(config.customModules?.length ?? 0) + 1}`
              onUpdate({ customModules: [...(config.customModules || []), { name, content: '', enabled: true }] })
            }} disabled={(config.customModules?.length ?? 0) >= 20}
              className="text-[9px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 disabled:opacity-30 cursor-pointer">+ Add</button>
          </div>
          <div className="space-y-2">
            {(config.customModules || []).map((mod, i) => (
              <div key={i} className="border border-white/5 rounded p-1.5">
                <div className="flex items-center gap-2 mb-1">
                  <input type="checkbox" checked={mod.enabled}
                    onChange={e => {
                      const updated = [...config.customModules]
                      updated[i] = { ...updated[i], enabled: e.target.checked }
                      onUpdate({ customModules: updated })
                    }} className="accent-teal-500" />
                  <input type="text" value={mod.name}
                    onChange={e => {
                      const updated = [...config.customModules]
                      updated[i] = { ...updated[i], name: e.target.value }
                      onUpdate({ customModules: updated })
                    }}
                    className="flex-1 bg-transparent border-b border-white/10 text-gray-300 text-[10px] outline-none focus:border-teal-500/30" />
                  <button onClick={() => {
                    const updated = config.customModules.filter((_, j) => j !== i)
                    onUpdate({ customModules: updated })
                  }} className="text-red-400/50 hover:text-red-400 text-[10px] cursor-pointer">✕</button>
                </div>
                <textarea value={mod.content}
                  onChange={e => {
                    const updated = [...config.customModules]
                    updated[i] = { ...updated[i], content: e.target.value }
                    onUpdate({ customModules: updated })
                  }}
                  placeholder="Free-text context injected into agent prompts..."
                  maxLength={10000}
                  className="w-full h-16 bg-black/40 border border-white/5 rounded p-1.5 text-gray-400 text-[10px] resize-y outline-none focus:border-teal-500/30"
                  spellCheck={false} />
              </div>
            ))}
            {(config.customModules || []).length === 0 && (
              <div className="text-gray-600 text-[10px] py-1">No custom modules. Add one to inject context into agent prompts.</div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="border border-white/5 rounded p-2">
          <div className="text-gray-400 font-bold text-[11px] mb-2">Controls</div>
          <div className="space-y-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Reviewer threshold</span>
              <input type="number" value={config.reviewerThreshold} min={50} max={100}
                onChange={e => onUpdate({ reviewerThreshold: Math.min(100, Math.max(50, parseInt(e.target.value) || 90)) })}
                className={inputCls} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Batch size</span>
              <input type="number" value={config.batchSize} min={1} max={5}
                onChange={e => onUpdate({ batchSize: Math.min(5, Math.max(1, parseInt(e.target.value) || 1)) })}
                className={inputCls} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Recap length (tokens)</span>
              <input type="number" value={config.recapLength} min={50} max={500} step={50}
                onChange={e => onUpdate({ recapLength: Math.min(500, Math.max(50, parseInt(e.target.value) || 100)) })}
                className={inputCls} />
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-amber-400">Auto-curate</span>
              <input type="checkbox" checked={config.autoCurate}
                onChange={e => onUpdate({ autoCurate: e.target.checked })}
                className="accent-amber-500" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-red-400">Auto-code</span>
              <input type="checkbox" checked={config.autoCode}
                onChange={e => onUpdate({ autoCode: e.target.checked })}
                className="accent-red-500" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════

function SettingsDropdown({ settings, onChange }: { settings: PanelSettings; onChange: (s: PanelSettings) => void }) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg p-3 shadow-xl w-56">
      <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">Panel Settings</div>

      <div className="space-y-2 text-[10px]">
        <div>
          <div className="text-gray-500 mb-1">Background Color</div>
          <input
            type="color"
            value={settings.bgColor}
            onChange={e => onChange({ ...settings, bgColor: e.target.value })}
            className="w-full h-6 rounded cursor-pointer bg-transparent border border-white/10"
          />
        </div>
        <div>
          <div className="text-gray-500 mb-1">Opacity ({(settings.opacity * 100).toFixed(0)}%)</div>
          <input
            type="range" min={0} max={1} step={0.05}
            value={settings.opacity}
            onChange={e => onChange({ ...settings, opacity: parseFloat(e.target.value) })}
            className="w-full accent-teal-500"
          />
        </div>
        <div>
          <div className="text-gray-500 mb-1">Blur ({settings.blur}px)</div>
          <input
            type="range" min={0} max={20} step={1}
            value={settings.blur}
            onChange={e => onChange({ ...settings, blur: parseInt(e.target.value) })}
            className="w-full accent-teal-500"
          />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK PRO PANEL — main component
// ═══════════════════════════════════════════════════════════════════════════

export function AnorakProPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings: _sceneSettings } = useContext(SettingsContext)
  const panelZIndex = useOasisStore(s => s.getPanelZIndex('anorak-pro', 9998))

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'stream'
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'stream' } catch { return 'stream' }
  })

  const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })
  const [showSettings, setShowSettings] = useState(false)

  // Anorak Pro config (flows to API calls)
  const [config, setConfig] = useState<AnorakProConfig>(loadConfig)
  const updateConfig = useCallback((partial: Partial<AnorakProConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...partial }
      saveConfig(next)
      return next
    })
  }, [])

  // Stream entries
  const [streamEntries, setStreamEntries] = useState<StreamEntry[]>([])
  const entryIdRef = useRef(0)
  const [isAgentRunning, setIsAgentRunning] = useState(false)

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try { const s = localStorage.getItem(POS_KEY); return s ? JSON.parse(s) : DEFAULT_POS } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try { const s = localStorage.getItem(SIZE_KEY); return s ? JSON.parse(s) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return
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

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
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
    if (isDragging) { document.addEventListener('mousemove', handleDrag); document.addEventListener('mouseup', handleDragEnd) }
    if (isResizing) { document.addEventListener('mousemove', handleResize); document.addEventListener('mouseup', handleResizeEnd) }
    return () => {
      document.removeEventListener('mousemove', handleDrag); document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('mousemove', handleResize); document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd, isResizing, handleResize, handleResizeEnd])

  // Save settings to localStorage
  const updateSettings = useCallback((s: PanelSettings) => {
    setPanelSettings(s)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  }, [])

  // Save active tab
  useEffect(() => { localStorage.setItem(TAB_KEY, activeTab) }, [activeTab])

  // ─═̷─ SSE consumer for curate/execute streams ─═̷─
  const abortRef = useRef<AbortController | null>(null)

  const consumeSSE = useCallback(async (url: string, body: Record<string, unknown>) => {
    // Abort any in-flight SSE stream before starting a new one
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsAgentRunning(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        setStreamEntries(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: `HTTP ${res.status}`, lobe: 'system', timestamp: Date.now() }])
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const event = JSON.parse(payload)
            const lobe = event.lobe || 'system'
            const type = event.type || 'text'
            const content = event.content || event.preview || event.name || ''
            if (type === 'done') continue
            if (content) {
              setStreamEntries(prev => [...prev, { id: entryIdRef.current++, type, content, lobe, timestamp: Date.now() }])
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setStreamEntries(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: `${e}`, lobe: 'system', timestamp: Date.now() }])
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsAgentRunning(false)
    }
  }, [])

  const handleCurate = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/curate', {
      missionIds: [missionId],
      model: config.models.curator,
      batchSize: config.batchSize,
    })
  }, [consumeSSE, config.models.curator, config.batchSize])

  const handleExecute = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/execute', {
      missionId,
      coderModel: config.models.coder,
      reviewerModel: config.models.reviewer,
      testerModel: config.models.tester,
      reviewerThreshold: config.reviewerThreshold,
      recapLength: config.recapLength,
    })
  }, [consumeSSE, config])

  // ─═̷─ Auto-curate: poll for immature anorak missions when toggle is ON ─═̷─
  const autoCurateRef = useRef(false)
  autoCurateRef.current = config.autoCurate
  const isRunningRef = useRef(false)
  isRunningRef.current = isAgentRunning

  useEffect(() => {
    if (!config.autoCurate) return

    const checkAndCurate = async () => {
      if (!autoCurateRef.current || isRunningRef.current) return
      try {
        const res = await fetch('/api/missions?assignedTo=anorak')
        if (!res.ok) return
        const missions = await res.json()
        const immature = (Array.isArray(missions) ? missions : missions.data ?? [])
          .filter((m: { maturityLevel: number; status: string }) => m.maturityLevel < 3 && m.status !== 'done')
          .sort((a: { priority: number | null }, b: { priority: number | null }) => (b.priority ?? 0) - (a.priority ?? 0))
        if (immature.length > 0 && autoCurateRef.current && !isRunningRef.current) {
          handleCurate(immature[0].id)
        }
      } catch { /* offline */ }
    }

    // Check immediately + every 10s
    checkAndCurate()
    const interval = setInterval(checkAndCurate, 10000)
    return () => clearInterval(interval)
  }, [config.autoCurate, isAgentRunning, handleCurate])

  if (!isOpen || typeof document === 'undefined') return null

  // Compute background with settings
  const bgRgb = panelSettings.bgColor.match(/[0-9a-f]{2}/gi)?.map(h => parseInt(h, 16)) || [8, 10, 15]
  const bgStyle = panelSettings.blur > 0 && panelSettings.opacity < 1
    ? { backgroundColor: `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${panelSettings.opacity})`, backdropFilter: `blur(${panelSettings.blur}px)` }
    : { backgroundColor: `rgba(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]},${panelSettings.opacity})` }

  return createPortal(
    <div
      data-menu-portal="anorak-pro-panel"
      className="fixed rounded-xl flex flex-col overflow-hidden"
      style={{
        zIndex: panelZIndex,
        left: position.x, top: position.y,
        width: size.w, height: size.h,
        ...bgStyle,
        border: `1px solid ${isAgentRunning ? 'rgba(20,184,166,0.6)' : 'rgba(20,184,166,0.2)'}`,
        boxShadow: isAgentRunning
          ? '0 0 40px rgba(20,184,166,0.2), inset 0 0 60px rgba(20,184,166,0.03)'
          : '0 8px 40px rgba(0,0,0,0.8)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={e => { e.stopPropagation(); useOasisStore.getState().bringPanelToFront('anorak-pro') }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        style={{ background: isAgentRunning ? 'linear-gradient(135deg, rgba(20,184,166,0.1) 0%, rgba(0,0,0,0) 100%)' : 'rgba(20,20,30,0.5)' }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-base ${isAgentRunning ? 'animate-pulse' : ''}`}>🔮</span>
          <span className="text-teal-400 font-bold text-sm tracking-wide">Anorak Pro</span>
          {isAgentRunning && <span className="text-[10px] text-teal-300 animate-pulse font-mono">● running</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(p => !p)}
              className="text-[10px] text-gray-500 hover:text-teal-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-teal-500/30 transition-all cursor-pointer"
            >
              ⚙
            </button>
            {showSettings && <SettingsDropdown settings={panelSettings} onChange={updateSettings} />}
          </div>

          {/* Close */}
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer">×</button>
        </div>
      </div>

      {/* ═══ TABS ═══ */}
      <div className="flex border-b border-white/5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-1.5 text-[10px] font-mono tracking-wide transition-all cursor-pointer"
            style={{
              color: activeTab === tab.id ? '#14b8a6' : '#666',
              borderBottom: activeTab === tab.id ? '2px solid #14b8a6' : '2px solid transparent',
              background: activeTab === tab.id ? 'rgba(20,184,166,0.05)' : 'transparent',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      {activeTab === 'stream' && <StreamTab entries={streamEntries} />}
      {activeTab === 'mindcraft' && <MindcraftTab onCurate={handleCurate} onExecute={handleExecute} isAgentRunning={isAgentRunning} />}
      {activeTab === 'curator-log' && <CuratorLogTab />}
      {activeTab === 'cehq' && <CEHQTab config={config} onUpdate={updateConfig} />}

      {/* ═══ RESIZE HANDLE ═══ */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(20,184,166,0.3) 50%)' }}
      />
    </div>,
    document.body
  )
}
