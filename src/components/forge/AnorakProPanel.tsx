'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK PRO PANEL — 2D overlay for the autonomous dev pipeline
// ─═̷─═̷─ॐ─═̷─═̷─ Curator, Coder, Reviewer, Tester in one view ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
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

function StreamTab({ entries }: { entries: StreamEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm font-mono">
        No activity yet. Curate or execute a mission to see the stream.
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
      {entries.map(e => (
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
}

// ═══════════════════════════════════════════════════════════════════════════
// MINDCRAFT TAB — mission list with 4 segments
// ═══════════════════════════════════════════════════════════════════════════

const MATURITY_COLORS = ['#666', '#818cf8', '#a855f7', '#f59e0b']
const MATURITY_LABELS = ['\u{1F311} para', '\u{1F318} pashyanti', '\u{1F317} madhyama', '\u{1F315} vaikhari']

interface MindcraftMission {
  id: number; name: string; maturityLevel: number; status: string
  priority: number | null; flawlessPercent: number | null
  reviewerScore: number | null; testerScore: number | null
  valor: number | null; assignedTo: string | null; dharmaPath: string | null
  executionPhase: string | null
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

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch('/api/missions')
      if (!res.ok) return
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.data ?? [])
      // Show all anorak-related missions
      setMissions(list.filter((m: MindcraftMission) =>
        m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro' ||
        m.assignedTo === 'carbondev' // show carbondev missions that have anorak history too
      ))
    } catch { /* offline */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchMissions() }, [fetchMissions])
  useEffect(() => {
    const interval = setInterval(fetchMissions, 10000)
    return () => clearInterval(interval)
  }, [fetchMissions])

  if (loading) return <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading...</div>

  const currentActivity = missions.filter(m => m.executionPhase != null)
  const curatorQueue = missions.filter(m => m.maturityLevel < 3 && m.status !== 'done' && (m.assignedTo === 'anorak' || m.assignedTo === 'anorak-pro'))
  const curated = missions.filter(m => m.maturityLevel >= 3 && m.status !== 'done')
  const done = missions.filter(m => m.status === 'done')

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3 text-xs font-mono">
      {/* Section A: Current Activity */}
      <div>
        <div className="text-[10px] text-teal-400 uppercase tracking-widest mb-1">Current Activity</div>
        {currentActivity.length === 0 ? (
          <div className="text-gray-600 text-[11px] py-1">No active agent</div>
        ) : currentActivity.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-2 rounded" style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)' }}>
            <span className="animate-pulse text-teal-400">●</span>
            <span className="text-white">#{m.id}</span>
            <span className="text-gray-300 truncate flex-1">{m.name}</span>
            <span className="text-teal-400/70">{m.executionPhase} (r{m.executionPhase ? '...' : ''})</span>
          </div>
        ))}
      </div>

      {/* Section B: Curator Queue */}
      <div>
        <div className="text-[10px] text-amber-400 uppercase tracking-widest mb-1">Curator Queue ({curatorQueue.length})</div>
        {curatorQueue.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1 px-1 border-b border-white/5">
            <span className="text-gray-500 w-6">#{m.id}</span>
            <span style={{ color: MATURITY_COLORS[m.maturityLevel] }} className="text-[10px] w-16">{MATURITY_LABELS[m.maturityLevel]}</span>
            <span className="text-gray-300 truncate flex-1">{m.name}</span>
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
            {m.reviewerScore != null && <span className="text-blue-400/50">R{m.reviewerScore}</span>}
            {m.testerScore != null && <span className="text-green-400/50">T{m.testerScore}</span>}
            {m.valor != null && <span className="text-amber-400/50">V{m.valor}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATOR LOG TAB
// ═══════════════════════════════════════════════════════════════════════════

function CuratorLogTab() {
  const [logs, setLogs] = useState<Array<{ id: number; status: string; startedAt: string; durationMs: number | null; missionsProcessed: number; missionsEnriched: number }>>([])

  useEffect(() => {
    // TODO: fetch from API when curator log endpoint exists
    // For now, placeholder
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

function CEHQTab() {
  return (
    <div className="flex-1 overflow-y-auto p-3 text-xs font-mono">
      <div className="text-teal-400 text-[10px] uppercase tracking-widest mb-3">Context Engineering HQ</div>

      <div className="space-y-3">
        {/* Per-lobe model selection */}
        {['curator', 'coder', 'reviewer', 'tester'].map(lobe => (
          <div key={lobe} className="border border-white/5 rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span style={{ color: LOBE_COLORS[lobe] }} className="font-bold capitalize">{lobe}</span>
              <select
                defaultValue={lobe === 'coder' ? 'opus' : 'sonnet'}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 text-gray-300 outline-none"
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </div>
            <div className="text-gray-600 text-[10px]">
              Lobeprompt: .claude/agents/{lobe}.md
              <span className="text-gray-700 ml-2">(inline editing coming Phase 1.5)</span>
            </div>
          </div>
        ))}

        {/* Context modules */}
        <div className="border border-white/5 rounded p-2">
          <div className="text-gray-400 font-bold text-[11px] mb-1">Context Modules</div>
          <div className="space-y-1 text-[10px]">
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-teal-500" /> RL Signal (curator-rl.md)
            </label>
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" defaultChecked className="accent-teal-500" /> Queued Missions
            </label>
            <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
              <input type="checkbox" className="accent-teal-500" /> All TODO Missions
            </label>
          </div>
        </div>

        {/* Controls */}
        <div className="border border-white/5 rounded p-2">
          <div className="text-gray-400 font-bold text-[11px] mb-2">Controls</div>
          <div className="space-y-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Reviewer threshold</span>
              <input type="number" defaultValue={90} min={50} max={100} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-gray-300 outline-none" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Batch size</span>
              <input type="number" defaultValue={1} min={1} max={5} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-gray-300 outline-none" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Recap length (tokens)</span>
              <input type="number" defaultValue={100} min={50} max={500} step={50} className="w-14 text-center bg-black/60 border border-white/10 rounded px-1 py-0.5 text-gray-300 outline-none" />
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-amber-400">Auto-curate</span>
              <input type="checkbox" className="accent-amber-500" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-red-400">Auto-code</span>
              <input type="checkbox" className="accent-red-500" />
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

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'stream'
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'stream' } catch { return 'stream' }
  })

  const [panelSettings, setPanelSettings] = useState<PanelSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || DEFAULT_SETTINGS } catch { return DEFAULT_SETTINGS }
  })
  const [showSettings, setShowSettings] = useState(false)

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
  const consumeSSE = useCallback(async (url: string, body: Record<string, unknown>) => {
    setIsAgentRunning(true)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      setStreamEntries(prev => [...prev, { id: entryIdRef.current++, type: 'error', content: `${e}`, lobe: 'system', timestamp: Date.now() }])
    }
    setIsAgentRunning(false)
  }, [])

  const handleCurate = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/curate', { missionIds: [missionId] })
  }, [consumeSSE])

  const handleExecute = useCallback((missionId: number) => {
    setActiveTab('stream')
    consumeSSE('/api/anorak/pro/execute', { missionId })
  }, [consumeSSE])

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
        zIndex: useOasisStore.getState().getPanelZIndex('anorak-pro', 9998),
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
      {activeTab === 'cehq' && <CEHQTab />}

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
