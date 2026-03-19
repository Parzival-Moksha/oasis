// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// D3VCR4F7 — Gamified Productivity Terminal
// PUNYA = MINUTES × VALOR × PRIORITY
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatTime, formatTimestamp, formatTimeCompact, formatDateShort, isoToDatetimeLocal, datetimeLocalToIso } from '@/lib/devcraft/helpers'
import { playNotification, playSound, sendBrowserNotification, requestNotificationPermission, getNotificationSettings, saveNotificationSettings, type SoundType } from '@/lib/devcraft/notifications'

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface Mission {
  id: number
  name: string
  status: 'todo' | 'wip' | 'done' | 'archived'
  queuePosition: number | null
  urgency: number
  easiness: number
  impact: number
  priority: number
  valor: number | null
  score: number | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  horizon: 'fixed' | 'open' | null
  targetSeconds: number | null
  isPaused: boolean
  pausedAt: string | null
  totalPausedMs: number
  actualSeconds: number | null
  notes: string | null
  isIRL: boolean
}

interface NoteEntry {
  timestamp: string
  message: string
  type: 'note' | 'system'
  elapsed?: number
  valor?: number
  score?: number
}

interface DayMission { id: number; name: string; score: number }
interface DayData { date: string; score: number; missions: DayMission[] }
interface DevStats { today: number; week: number; allTime: number; weeklyData: DayData[] }

// ═══════════════════════════════════════════════════════════════════════════════
// Matrix Rain
// ═══════════════════════════════════════════════════════════════════════════════

function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = container.offsetWidth
      canvas.height = container.offsetHeight
    }
    resize()

    const readableWords = [
      'SC0R3', 'V4L0R', 'FL0W', 'F0CUS', 'GR1ND', 'SH1P', 'C0D3',
      'BU1LD', 'CR34T3', 'D3PLOY', 'PUSH', 'M3RG3', 'SPR1NT', 'C0MM1T',
      'D3BUG', 'R3F4CT0R', 'STR34K', 'D3VCR4F7', 'V3L0C1TY', 'FR33D0M',
    ]

    const randomChars = 'アイウエオカキクケコサシスセソ01234567890@#$%^&*+-=<>?░▒▓█'
    const charArray = randomChars.split('')
    const fontSize = 28
    const columns = Math.floor(canvas.width / fontSize)

    interface Drop { y: number; word: string | null; wordProgress: number }
    const drops: Drop[] = []
    for (let i = 0; i < columns; i++) {
      drops[i] = { y: Math.random() * -100, word: null, wordProgress: 0 }
    }

    function draw() {
      if (!ctx || !canvas) return
      ctx.fillStyle = 'rgba(0, 0, 0, 0.03)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i]
        const x = i * fontSize
        const y = drop.y * fontSize

        if (!drop.word && Math.random() > 0.985) {
          drop.word = readableWords[Math.floor(Math.random() * readableWords.length)]
          drop.wordProgress = 0
        }

        let charToShow: string
        if (drop.word && drop.wordProgress < drop.word.length) {
          charToShow = drop.word[drop.wordProgress]
          ctx.fillStyle = drop.wordProgress === 0 ? '#aaffcc' : '#44ff77'
          drop.wordProgress++
        } else {
          charToShow = charArray[Math.floor(Math.random() * charArray.length)]
          ctx.fillStyle = '#22dd55'
          if (drop.word) { drop.word = null; drop.wordProgress = 0 }
        }

        ctx.fillText(charToShow, x, y)
        if (y > canvas.height && Math.random() > 0.98) {
          drop.y = 0; drop.word = null; drop.wordProgress = 0
        }
        drop.y++
      }
    }

    const interval = setInterval(draw, 45)
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    return () => { clearInterval(interval); resizeObserver.disconnect() }
  }, [])

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-20" />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Components
// ═══════════════════════════════════════════════════════════════════════════════

function ProgressBar({ elapsed, target, isOvertime }: { elapsed: number; target: number; isOvertime: boolean }) {
  const progress = Math.min(100, (elapsed / target) * 100)
  const overtime = isOvertime ? ((elapsed - target) / target) * 100 : 0
  const fmt = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`
  }
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className={isOvertime ? 'text-[#ff0040]' : 'text-[#00ff41]'}>{fmt(elapsed)}</span>
        <span className="text-[#666]">/</span>
        <span className="text-[#ff9900]">{fmt(target)}</span>
      </div>
      <div className="h-5 w-full bg-black/50 border border-[#333] relative overflow-hidden">
        <div className="absolute left-0 top-0 h-full transition-all duration-1000"
          style={{ width: `${Math.min(100, progress)}%`, background: isOvertime ? '#ff0040' : '#00ff41', boxShadow: isOvertime ? '0 0 10px #ff0040' : '0 0 10px #00ff41' }} />
        {isOvertime && (
          <div className="absolute right-0 top-0 h-full animate-pulse"
            style={{ width: `${Math.min(100, overtime)}%`, background: 'repeating-linear-gradient(45deg, #ff0040, #ff0040 5px, #ff4040 5px, #ff4040 10px)' }} />
        )}
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white mix-blend-difference">
          {Math.round(progress)}%{isOvertime && ` (+${Math.round(overtime)}%)`}
        </div>
      </div>
    </div>
  )
}

function PriorityBar({ u, e, i }: { u: number; e: number; i: number }) {
  const total = u + e + i
  const uPct = Math.round((u / total) * 100)
  const ePct = Math.round((e / total) * 100)
  const iPct = 100 - uPct - ePct
  return (
    <div className="h-5 w-full flex text-[10px] font-mono font-bold">
      <div className="h-full flex items-center justify-center" style={{ width: `${uPct}%`, background: '#ff4040' }}>{uPct > 12 && `${uPct}%`}</div>
      <div className="h-full flex items-center justify-center" style={{ width: `${ePct}%`, background: '#ff9900' }}>{ePct > 12 && `${ePct}%`}</div>
      <div className="h-full flex items-center justify-center" style={{ width: `${iPct}%`, background: '#00cccc' }}>{iPct > 12 && `${iPct}%`}</div>
    </div>
  )
}

function IntegerSelector({ value, onChange, min = 1, max = 10, color }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; color: string
}) {
  const [flash, setFlash] = useState(false)
  const change = (v: number) => { onChange(Math.max(min, Math.min(max, v))); setFlash(true); setTimeout(() => setFlash(false), 200) }
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => change(value - 1)}
        className="w-6 h-6 flex items-center justify-center text-xs text-[#666] hover:text-white bg-black/50 hover:bg-[#333] hover:shadow-[0_0_8px_rgba(0,255,65,0.3)] transition-all hover:scale-110">
        ◀
      </button>
      <input
        type="number"
        value={value}
        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) change(v) }}
        className="w-10 text-center text-base font-mono font-bold bg-transparent border-b border-[#333] focus:border-current focus:outline-none"
        style={{ color, MozAppearance: 'textfield' }}
        min={min} max={max}
      />
      <button onClick={() => change(value + 1)}
        className="w-6 h-6 flex items-center justify-center text-xs text-[#666] hover:text-white bg-black/50 hover:bg-[#333] hover:shadow-[0_0_8px_rgba(0,255,65,0.3)] transition-all hover:scale-110">
        ▶
      </button>
    </div>
  )
}

function AutoGrowTextarea({ value, onChange, onCtrlEnter, placeholder, className }: {
  value: string; onChange: (v: string) => void; onCtrlEnter: () => void; placeholder?: string; className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = Math.max(64, Math.min(200, ref.current.scrollHeight)) + 'px' }
  }, [value])
  return (
    <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); onCtrlEnter() } }}
      placeholder={placeholder} className={className} style={{ resize: 'none', minHeight: '64px' }} />
  )
}

function ScoreTooltip({ minutes, valor, priority, score, children }: {
  minutes: number; valor: number; priority: number; score: number; children: React.ReactNode
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative inline-block" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-black border border-[#00ff41] px-3 py-2 whitespace-nowrap z-50 pointer-events-none"
          style={{ boxShadow: '0 0 15px #00ff4130' }}>
          <div className="text-xs font-mono text-[#888] mb-1">SCORE FORMULA</div>
          <div className="text-sm font-mono text-[#00ff41]">
            {minutes.toFixed(1)} min × {valor.toFixed(1)} valor × {priority.toFixed(2)} priority
          </div>
          <div className="text-base font-mono font-bold text-[#00ff41] mt-1">= {score.toFixed(1)}</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settings Gear
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsGear({ fontSize, onFontSizeChange, bgEnabled, onBgToggle, panelOpacity, onOpacityChange }: {
  fontSize: number; onFontSizeChange: (s: number) => void
  bgEnabled: boolean; onBgToggle: () => void
  panelOpacity: number; onOpacityChange: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [notifSound, setNotifSound] = useState<SoundType>(() => getNotificationSettings().sound)
  const [notifVolume, setNotifVolume] = useState(() => getNotificationSettings().volume)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className={`text-sm px-1.5 py-0.5 font-mono transition-all ${open ? 'text-[#00ff41]' : 'text-[#555] hover:text-[#888]'}`}>
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-black border border-[#333] p-3 z-50 w-56"
          style={{ boxShadow: '0 0 20px #00000080' }}>
          <div className="text-xs font-mono text-[#666] mb-2">SETTINGS</div>

          <div className="space-y-3">
            <div>
              <div className="text-xs font-mono text-[#555] mb-1">Font Size</div>
              <div className="flex items-center gap-2">
                <input type="range" min="9" max="16" value={fontSize} onChange={e => onFontSizeChange(Number(e.target.value))}
                  className="flex-1" />
                <span className="text-xs font-mono text-[#666] w-5">{fontSize}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#555]">Matrix Rain</span>
              <button onClick={onBgToggle}
                className={`text-xs font-mono px-2 py-0.5 border ${bgEnabled ? 'border-[#00ff41] text-[#00ff41]' : 'border-[#333] text-[#555]'}`}>
                {bgEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div>
              <div className="text-xs font-mono text-[#555] mb-1">Panel Opacity</div>
              <input type="range" min="0" max="100" value={panelOpacity} onChange={e => onOpacityChange(Number(e.target.value))}
                className="w-full" />
            </div>

            <div className="border-t border-[#222] pt-2">
              <div className="text-xs font-mono text-[#555] mb-1">Notification Sound</div>
              <div className="flex gap-1 mb-2">
                {(['alert', 'chime', 'alarm', 'ping'] as SoundType[]).map(s => (
                  <button key={s} onClick={() => { setNotifSound(s); saveNotificationSettings(s, notifVolume); playSound(s, notifVolume) }}
                    className={`flex-1 py-1 text-[10px] font-mono border ${notifSound === s ? 'border-[#00ff41] text-[#00ff41]' : 'border-[#333] text-[#555]'}`}>
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="text-xs font-mono text-[#555] mb-1">Volume</div>
              <input type="range" min="0" max="100" value={notifVolume}
                onChange={e => { setNotifVolume(Number(e.target.value)); saveNotificationSettings(notifSound, Number(e.target.value)) }}
                className="w-full" />
            </div>
            <div className="text-[8px] font-mono text-[#1a1a1a] hover:text-[#333] transition-colors mt-3 text-center cursor-default select-none" title="scoremaxxing = thrivemaxxing">
              ॐ
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stats Panel
// ═══════════════════════════════════════════════════════════════════════════════

function StatsPanel({ stats, loading, ...settingsProps }: {
  stats: DevStats | null; loading: boolean
  fontSize: number; onFontSizeChange: (s: number) => void
  bgEnabled: boolean; onBgToggle: () => void
  panelOpacity: number; onOpacityChange: (v: number) => void
}) {
  const items = [
    { label: 'TODAY', value: stats?.today, color: '#00ff41' },
    { label: '7 DAY', value: stats?.week, color: '#00ffff' },
    { label: 'ALL', value: stats?.allTime, color: '#ff00ff' },
  ]
  return (
    <div className="flex flex-col justify-center gap-0 h-full">
      {items.map(({ label, value, color }) => (
        <div key={label} className="flex items-center justify-between gap-3 px-3 py-0.5">
          <span className="text-xs text-[#888] font-mono font-bold uppercase">{label}</span>
          <span className="text-xl font-mono font-bold" style={{ color, textShadow: `0 0 10px ${color}` }}>
            {loading ? '-' : (value?.toFixed(1) || '0')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Weekly Chart
// ═══════════════════════════════════════════════════════════════════════════════

function WeeklyChart({ data }: { data: DayData[] }) {
  const [hoveredDay, setHoveredDay] = useState<{ day: DayData; screenX: number; screenY: number } | null>(null)

  if (!data || data.length === 0) {
    return <div className="bg-black/40 h-12 flex items-center justify-center text-[#333] text-xs font-mono mb-2">NO DATA</div>
  }

  const maxScore = Math.max(...data.map(d => d.score), 1)
  const h = 110, w = 400, pad = 4

  const points = data.map((day, i) => {
    const x = pad + (i * (w - pad * 2) / (data.length - 1))
    const y = h - pad - ((day.score / maxScore) * (h - pad * 2))
    return { x, y, day }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const handleMouseMove = (e: React.MouseEvent, point: typeof points[0]) => {
    setHoveredDay({
      day: point.day,
      screenX: Math.max(10, Math.min(window.innerWidth - 300, e.clientX + 10)),
      screenY: Math.max(10, Math.min(window.innerHeight - 200, e.clientY + 15)),
    })
  }

  return (
    <div className="bg-black/40 mb-2 relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" style={{ maxHeight: 80 }}>
        <path d={pathD} fill="none" stroke="#00ff41" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 2px #00ff41)' }} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hoveredDay?.day === p.day ? 5 : 2.5}
            fill="#00ff41" className="cursor-pointer transition-all"
            onMouseEnter={(e) => handleMouseMove(e, p)} onMouseMove={(e) => handleMouseMove(e, p)}
            onMouseLeave={() => setHoveredDay(null)} />
        ))}
      </svg>
      {hoveredDay && (
        <div className="fixed z-50 bg-black border border-[#00ff41] p-2 min-w-[200px] max-w-[280px] pointer-events-none"
          style={{
            left: hoveredDay.screenX,
            top: hoveredDay.screenY,
            boxShadow: '0 0 20px #00ff4130'
          }}>
          <div className="text-xs font-mono text-[#666] mb-1">{hoveredDay.day.date}</div>
          <div className="text-sm font-mono text-[#00ff41] font-bold mb-2">Score: {hoveredDay.day.score.toFixed(1)}</div>
          {hoveredDay.day.missions.length > 0 ? (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {hoveredDay.day.missions.map(m => (
                <div key={m.id} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-[#00ff41] w-8">{m.score.toFixed(1)}</span>
                  <span className="text-[#888] truncate flex-1">{m.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] font-mono text-[#444]">No missions</div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Switch Confirm Popup
// ═══════════════════════════════════════════════════════════════════════════════

function SwitchConfirmPopup({ currentMission, newMission, onDone, onPause, onCancel }: {
  currentMission: Mission; newMission: Mission; onDone: () => void; onPause: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50">
      <div className="border border-[#ffcc00] bg-black p-5 w-[380px]" style={{ boxShadow: '0 0 30px #ffcc0030' }}>
        <h2 className="text-[#ffcc00] font-mono text-base uppercase mb-3">MISSION SWITCH</h2>
        <div className="mb-4">
          <div className="text-sm font-mono text-[#888] mb-1">CURRENT WIP:</div>
          <div className="text-base font-mono text-[#00ff41] truncate">{currentMission.name}</div>
        </div>
        <div className="mb-4">
          <div className="text-sm font-mono text-[#888] mb-1">SWITCHING TO:</div>
          <div className="text-base font-mono text-[#00ffff] truncate">{newMission.name}</div>
        </div>
        <div className="text-sm font-mono text-[#666] mb-4">What do you want to do with the current mission?</div>
        <div className="flex gap-2">
          <button onClick={onDone} className="flex-1 py-2 border border-[#00ff41] text-[#00ff41] font-mono text-sm hover:bg-[#00ff41]/10">[DONE]</button>
          <button onClick={onPause} className="flex-1 py-2 border border-[#ffcc00] text-[#ffcc00] font-mono text-sm hover:bg-[#ffcc00]/10">[PAUSE]</button>
          <button onClick={onCancel} className="flex-1 py-2 border border-[#ff0040] text-[#ff0040] font-mono text-sm hover:bg-[#ff0040]/10">[CANCEL]</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mission Popup — View/Edit any mission
// ═══════════════════════════════════════════════════════════════════════════════

function MissionPopup({ mission, onClose, onEngage, onUpdate, onDeleteNoteEntry, onIRLComplete }: {
  mission: Mission; onClose: () => void; onEngage: () => void
  onUpdate: (updates: Partial<Mission>) => void
  onDeleteNoteEntry: (idx: number) => void
  onIRLComplete: (minutes: number, valor: number) => void
}) {
  const [noteText, setNoteText] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState(mission.name)
  const [irlMinutes, setIrlMinutes] = useState(30)
  const [irlValor, setIrlValor] = useState(1.0)

  const notes: NoteEntry[] = mission.notes ? (typeof mission.notes === 'string' ? JSON.parse(mission.notes) : mission.notes) : []
  const isDone = mission.status === 'done'

  const handleNameSave = () => {
    if (tempName.trim() && tempName !== mission.name) onUpdate({ name: tempName.trim() })
    setEditingName(false)
  }

  const handleAddNote = () => {
    if (!noteText.trim()) return
    const existing: NoteEntry[] = mission.notes ? JSON.parse(mission.notes) : []
    const newNotes = [...existing, { timestamp: new Date().toISOString(), message: noteText.trim(), type: 'note' as const }]
    onUpdate({ notes: JSON.stringify(newNotes) })
    setNoteText('')
  }

  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50" onClick={onClose}>
      <div className="border border-[#00ff41] bg-black w-[85vw] max-w-[1400px] h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 40px #00ff4120' }}>

        {/* Header */}
        <div className="bg-[#111] px-4 py-3 border-b border-[#222] flex items-center gap-3">
          {editingName ? (
            <input type="text" value={tempName} onChange={e => setTempName(e.target.value)}
              onBlur={handleNameSave} onKeyDown={e => e.key === 'Enter' && handleNameSave()}
              className="flex-1 bg-black border border-[#00ff41] px-2 py-1 text-base font-mono text-[#00ff41] focus:outline-none" autoFocus />
          ) : (
            <h2 className="flex-1 text-base font-mono text-[#00ff41] truncate cursor-pointer hover:underline"
              style={{ textShadow: '0 0 10px #00ff41' }}
              onClick={() => { setTempName(mission.name); setEditingName(true) }}>
              {mission.name}
            </h2>
          )}
          <span className="text-xs font-mono text-[#555]">#{mission.id}</span>
          <span className={`text-xs font-mono px-2 py-0.5 ${
            mission.status === 'wip' ? 'bg-[#ffcc00]/20 text-[#ffcc00]' :
            mission.status === 'done' ? 'bg-[#00ff41]/20 text-[#00ff41]' :
            'bg-[#444]/20 text-[#888]'
          }`}>{mission.status.toUpperCase()}</span>
          <button onClick={onClose} className="text-[#666] hover:text-white text-lg">×</button>
        </div>

        {/* Content — 2 columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left — Settings */}
          <div className="w-[280px] shrink-0 border-r border-[#222] p-3 overflow-y-auto">
            {/* Priority */}
            <div className="mb-4">
              <div className="text-sm font-mono text-[#00ff41] mb-2">PRIORITY</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-[#ff4040]">Urgency</span>
                  <IntegerSelector value={mission.urgency} onChange={v => onUpdate({ urgency: v })} color="#ff4040" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-[#ff9900]">Easiness</span>
                  <IntegerSelector value={mission.easiness} onChange={v => onUpdate({ easiness: v })} color="#ff9900" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-[#00cccc]">Impact</span>
                  <IntegerSelector value={mission.impact} onChange={v => onUpdate({ impact: v })} color="#00cccc" />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#222]">
                <span className="text-xs font-mono text-[#666]">U×E×I÷125</span>
                <span className="text-base font-mono font-bold text-[#00ff41]">{mission.priority.toFixed(2)}</span>
              </div>
              <div className="mt-2"><PriorityBar u={mission.urgency} e={mission.easiness} i={mission.impact} /></div>
            </div>

            {/* Horizon */}
            <div className="mb-3">
              <div className="text-sm font-mono text-[#888] mb-1">BEEP FREQUENCY</div>
              <div className="flex gap-1">
                <button onClick={() => onUpdate({ horizon: 'open' })}
                  className={`flex-1 py-1.5 text-xs font-mono border ${mission.horizon === 'open' ? 'border-[#00ff41] text-[#00ff41] bg-[#00ff41]/10' : 'border-[#333] text-[#666]'}`}>NO BEEPS</button>
                <button onClick={() => onUpdate({ horizon: 'fixed' })}
                  className={`flex-1 py-1.5 text-xs font-mono border ${mission.horizon === 'fixed' ? 'border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10' : 'border-[#333] text-[#666]'}`}>BEEP EVERY</button>
              </div>
              {mission.horizon === 'fixed' && (
                <div className="mt-1 flex items-center gap-1">
                  <IntegerSelector value={Math.floor((mission.targetSeconds || 1800) / 60)} min={1} max={240}
                    onChange={v => onUpdate({ targetSeconds: v * 60 })} color="#ff9900" />
                  <span className="text-xs font-mono text-[#666]">min</span>
                </div>
              )}
            </div>

            {/* Score if done */}
            {isDone && mission.score !== null && (
              <div className="mb-3 p-2 bg-[#00ff41]/10 border border-[#00ff41]/30">
                <div className="text-xs font-mono text-[#666]">☸ PUNYA</div>
                <div className="text-xl font-mono font-bold text-[#00ff41]">{mission.score.toFixed(1)}</div>
              </div>
            )}

            {/* Status */}
            <div className="mb-3">
              <div className="text-sm font-mono text-[#888] mb-1">STATUS</div>
              <select value={mission.status} onChange={e => onUpdate({ status: e.target.value as Mission['status'] })}
                className="w-full bg-black border border-[#333] px-2 py-1.5 text-sm font-mono text-[#00ff41] focus:border-[#00ff41] focus:outline-none">
                <option value="todo">TODO</option><option value="wip">WIP</option>
                <option value="done">DONE</option><option value="archived">ARCHIVED</option>
              </select>
            </div>

            {isDone && (
              <div className="mb-3">
                <div className="text-sm font-mono text-[#888] mb-1 cursor-help" title="Self-score: How focused and effective was your work? 1.0 = adequate, 2.0 = exceptional">VALOR</div>
                <input type="number" min="0" max="2" step="0.1" value={mission.valor ?? 1}
                  onChange={e => onUpdate({ valor: parseFloat(e.target.value) || 1 })}
                  className="w-full bg-black border border-[#333] px-2 py-1.5 text-sm font-mono text-[#00ff41] focus:border-[#00ff41] focus:outline-none" />
              </div>
            )}

            <div className="mb-3">
              <div className="text-sm font-mono text-[#888] mb-1">CREATED</div>
              <input type="datetime-local" value={isoToDatetimeLocal(mission.createdAt)}
                onChange={e => onUpdate({ createdAt: datetimeLocalToIso(e.target.value) || undefined } as Partial<Mission>)}
                className="w-full bg-black border border-[#333] px-2 py-1 text-xs font-mono text-[#999] focus:border-[#00ff41] focus:outline-none" />
            </div>

            {isDone && (
              <div className="mb-3">
                <div className="text-sm font-mono text-[#888] mb-1">ENDED</div>
                <input type="datetime-local" value={isoToDatetimeLocal(mission.endedAt)}
                  onChange={e => onUpdate({ endedAt: datetimeLocalToIso(e.target.value) })}
                  className="w-full bg-black border border-[#333] px-2 py-1 text-xs font-mono text-[#999] focus:border-[#00ff41] focus:outline-none" />
              </div>
            )}
          </div>

          {/* Right — Notes Timeline */}
          <div className="flex-1 flex flex-col p-3 min-w-0">
            <div className="flex-1 min-h-0 flex flex-col mb-3">
              <div className="text-sm font-mono text-[#666] mb-2">NOTES ({notes.length})</div>
              <div className="flex-1 overflow-y-auto bg-black/30 p-2 space-y-2">
                {notes.length === 0 ? (
                  <div className="text-[#444] text-sm font-mono text-center py-6">No notes yet</div>
                ) : notes.map((entry, idx) => (
                  <div key={idx} className={`text-sm font-mono p-2 rounded group relative ${
                    entry.type === 'system' ? 'bg-[#222]' : 'bg-blue-900/30 border-l-2 border-blue-500'
                  }`}>
                    <div className="flex items-center gap-2 text-xs text-[#666] mb-1">
                      <span className={entry.type === 'system' ? 'text-gray-500' : 'text-blue-400'}>
                        {entry.type === 'system' ? '⚙' : '📝'}
                      </span>
                      <span className="ml-auto">{formatTimestamp(entry.timestamp)}</span>
                      {entry.type === 'note' && (
                        <button onClick={() => onDeleteNoteEntry(idx)}
                          className="text-[#ff0040] opacity-0 group-hover:opacity-100 hover:text-[#ff4040] text-xs" title="Delete">🗑</button>
                      )}
                    </div>
                    {entry.message && <div className="text-[#bbb]">{entry.message}</div>}
                    {entry.score !== undefined && <div className="text-[#00ff41] text-xs mt-1">Score: {entry.score?.toFixed(1)}</div>}
                  </div>
                ))}
              </div>
            </div>

            {!isDone && (
              <div>
                <AutoGrowTextarea value={noteText} onChange={setNoteText} onCtrlEnter={handleAddNote}
                  placeholder="Add note... (Ctrl+Enter to save)"
                  className="w-full bg-black border border-[#333] p-2 text-sm font-mono text-[#999] focus:border-[#00ff41] focus:outline-none mb-2" />
                <button onClick={handleAddNote} disabled={!noteText.trim()}
                  className="w-full py-2 border border-[#00ff41] text-[#00ff41] font-mono text-sm hover:bg-[#00ff41]/10 disabled:opacity-30">
                  SAVE NOTE
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {mission.status === 'todo' && (
          <div className="border-t border-[#222] p-3 bg-[#111]">
            {mission.isIRL ? (
              <div className="space-y-3">
                <div className="text-xs font-mono text-amber-400 mb-2">IRL MISSION — ENTER TIME SPENT</div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-[#666]">MINS</span>
                    <input type="number" min="1" value={irlMinutes} onChange={e => setIrlMinutes(parseInt(e.target.value) || 1)}
                      className="w-20 bg-black border border-[#333] px-2 py-1 text-sm font-mono text-[#ff9900] focus:outline-none focus:border-[#ff9900]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-[#666] cursor-help border-b border-dashed border-[#444]"
                      title="Self-score: How focused and effective was your work? 1.0 = adequate, 2.0 = exceptional">VALOR</span>
                    <input type="range" min="0" max="2" step="0.1" value={irlValor} onChange={e => setIrlValor(parseFloat(e.target.value))}
                      className="w-20" />
                    <span className="text-sm font-mono text-[#00ff41] w-8">{irlValor.toFixed(1)}</span>
                  </div>
                </div>
                <button onClick={() => onIRLComplete(irlMinutes, irlValor)}
                  className="w-full py-3 border-2 border-amber-400 text-amber-400 font-mono text-base font-bold hover:bg-amber-400/20"
                  style={{ textShadow: '0 0 10px #f59e0b' }}>[DONE]</button>
              </div>
            ) : (
              <button onClick={onEngage}
                className="w-full py-3 border-2 border-[#00ff41] text-[#00ff41] font-mono text-base font-bold hover:bg-[#00ff41]/20"
                style={{ textShadow: '0 0 10px #00ff41' }}>[ENGAGE]</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Active Mission Panel — Timer, Controls, Notes
// ═══════════════════════════════════════════════════════════════════════════════

function ActiveMissionPanel({ mission, elapsed, onPause, onResume, valor, onValorChange,
  note, onNoteChange, onSaveNote, onComplete, onCancel, onShelve, onNext, hasNextInQueue,
  onUpdateMission, timerExpired, onDeleteNoteEntry, onAdjustTime, onExtendTime, onKeepGoing
}: {
  mission: Mission | null; elapsed: number; onPause: () => void; onResume: () => void
  valor: number; onValorChange: (v: number) => void
  note: string; onNoteChange: (n: string) => void; onSaveNote: () => void
  onComplete: () => void; onCancel: () => void; onShelve: () => void
  onNext: () => void; hasNextInQueue: boolean
  onUpdateMission: (updates: Partial<Mission>) => void
  timerExpired: boolean
  onDeleteNoteEntry: (idx: number) => void
  onAdjustTime: (deltaMs: number) => void
  onExtendTime: (seconds: number) => void
  onKeepGoing: () => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [tempName, setTempName] = useState('')
  const [showNotes, setShowNotes] = useState(true)
  const [showCancelPopup, setShowCancelPopup] = useState(false)

  if (!mission) {
    return (
      <div className="h-full bg-black/50 flex flex-col items-center justify-center">
        <div className="text-5xl font-mono text-[#333] mb-3">--:--:--</div>
        <div className="text-[#555] text-sm font-mono">Select a mission from the queue</div>
      </div>
    )
  }

  const displayTime = mission.horizon === 'fixed' && mission.targetSeconds
    ? Math.max(0, mission.targetSeconds - elapsed) : elapsed
  const isOvertime = !!(mission.horizon === 'fixed' && mission.targetSeconds && elapsed > mission.targetSeconds)
  const projectedScore = (elapsed / 60) * valor * mission.priority

  const notes: NoteEntry[] = mission.notes ? (typeof mission.notes === 'string' ? JSON.parse(mission.notes) : mission.notes) : []

  const handleNameSave = () => {
    if (tempName.trim() && tempName !== mission.name) onUpdateMission({ name: tempName.trim() })
    setEditingName(false)
  }

  return (
    <div className="h-full flex flex-col bg-black/50 overflow-hidden">
      {/* Header */}
      <div className="bg-[#111] px-4 py-2 border-b border-[#222]">
        {editingName ? (
          <input type="text" value={tempName} onChange={e => setTempName(e.target.value)}
            onBlur={handleNameSave} onKeyDown={e => e.key === 'Enter' && handleNameSave()}
            className="w-full bg-black border border-[#00ff41] px-2 py-1 text-base font-mono text-[#00ff41] focus:outline-none" autoFocus />
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-base text-[#00ff41] truncate flex-1 cursor-pointer hover:underline"
              style={{ textShadow: '0 0 10px #00ff41' }}
              onClick={() => { setTempName(mission.name); setEditingName(true) }}>
              {mission.name}
            </h3>
            <span className="text-xs font-mono text-[#555]">#{mission.id}</span>
          </div>
        )}
      </div>

      {/* Main — Priority + Notes */}
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[220px] border-r border-[#222] p-3 overflow-y-auto">
          <div className="mb-4">
            <div className="space-y-2">
              {[
                { label: 'Urgency', color: '#ff4040', field: 'urgency' as const },
                { label: 'Easiness', color: '#ff9900', field: 'easiness' as const },
                { label: 'Impact', color: '#00cccc', field: 'impact' as const },
              ].map(({ label, color, field }) => (
                <div key={field} className="flex items-center justify-between">
                  <span className="text-sm font-mono" style={{ color }}>{label}</span>
                  <IntegerSelector value={mission[field]} onChange={v => onUpdateMission({ [field]: v })} color={color} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#222]">
              <span className="text-xs font-mono text-[#666]">U×E×I÷125</span>
              <span className="text-base font-mono font-bold text-[#00ff41]">{mission.priority.toFixed(2)}</span>
            </div>
            <div className="mt-2"><PriorityBar u={mission.urgency} e={mission.easiness} i={mission.impact} /></div>
          </div>

          <div className="mb-3">
            <div className="text-sm font-mono text-[#888] mb-1">BEEP FREQUENCY</div>
            <div className="flex gap-1">
              <button onClick={() => onUpdateMission({ horizon: 'open' })}
                className={`flex-1 py-1.5 text-xs font-mono border ${mission.horizon === 'open' ? 'border-[#00ff41] text-[#00ff41] bg-[#00ff41]/10' : 'border-[#333] text-[#666]'}`}>NO BEEPS</button>
              <button onClick={() => onUpdateMission({ horizon: 'fixed' })}
                className={`flex-1 py-1.5 text-xs font-mono border ${mission.horizon === 'fixed' ? 'border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10' : 'border-[#333] text-[#666]'}`}>BEEP EVERY</button>
            </div>
            {mission.horizon === 'fixed' && (
              <div className="mt-1 flex items-center gap-1">
                <IntegerSelector value={Math.floor((mission.targetSeconds || 1800) / 60)} min={1} max={240}
                  onChange={v => onUpdateMission({ targetSeconds: v * 60 })} color="#ff9900" />
                <span className="text-xs font-mono text-[#666]">min</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="flex-1 flex flex-col p-3 min-w-0">
          <div className="flex-1 min-h-0 flex flex-col">
            <button onClick={() => setShowNotes(!showNotes)} className="flex items-center gap-1 text-sm font-mono text-[#666] mb-2">
              <span className={`transition-transform ${showNotes ? 'rotate-90' : ''}`}>▶</span>
              NOTES ({notes.length})
            </button>
            {showNotes && (
              <div className="flex-1 overflow-y-auto bg-black/30 p-2 space-y-2">
                {notes.length === 0 ? (
                  <div className="text-[#444] text-sm font-mono text-center py-6">No notes yet</div>
                ) : notes.map((entry, idx) => (
                  <div key={idx} className={`text-sm font-mono p-2 rounded group relative ${
                    entry.type === 'system' ? 'bg-[#222]' : 'bg-blue-900/30 border-l-2 border-blue-500'
                  }`}>
                    <div className="flex items-center gap-2 text-xs text-[#666] mb-1">
                      <span className={entry.type === 'system' ? 'text-gray-500' : 'text-blue-400'}>
                        {entry.type === 'system' ? '⚙' : '📝'}
                      </span>
                      <span className="ml-auto">{formatTimestamp(entry.timestamp)}</span>
                      {entry.type === 'note' && (
                        <button onClick={() => onDeleteNoteEntry(idx)}
                          className="text-[#ff0040] opacity-0 group-hover:opacity-100 hover:text-[#ff4040] text-xs">🗑</button>
                      )}
                    </div>
                    {entry.message && <div className="text-[#bbb]">{entry.message}</div>}
                    {entry.score !== undefined && <div className="text-[#00ff41] text-xs mt-1">Score: {entry.score?.toFixed(1)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="flex gap-2">
              <AutoGrowTextarea value={note} onChange={onNoteChange} onCtrlEnter={onSaveNote}
                placeholder="Add note... (Ctrl+Enter to save)"
                className="flex-1 bg-black border border-[#333] p-2 text-sm font-mono text-[#999] focus:border-[#00ff41] focus:outline-none" />
              <button onClick={onSaveNote} disabled={!note.trim()}
                className="px-3 border border-[#00ff41] text-[#00ff41] font-mono text-xs hover:bg-[#00ff41]/10 disabled:opacity-30">SAVE</button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom — Timer + Controls */}
      <div className="border-t border-[#222] p-3 bg-[#111]">
        {/* TIME'S UP state */}
        {timerExpired ? (
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-mono tracking-wider text-[#ff0040] animate-pulse" style={{ textShadow: '0 0 15px #ff0040' }}>
                TIME&apos;S UP
              </div>
              <div className="text-xl font-mono text-[#ff0040]/70">
                +{formatTime(elapsed - (mission.targetSeconds || 0))}
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => onExtendTime(300)} className="px-2 py-1.5 border border-[#ff9900] text-[#ff9900] font-mono text-xs hover:bg-[#ff9900]/10 transition-all hover:shadow-[0_0_8px_#ff990040]">[+5m]</button>
              <button onClick={() => onExtendTime(600)} className="px-2 py-1.5 border border-[#ff9900] text-[#ff9900] font-mono text-xs hover:bg-[#ff9900]/10 transition-all hover:shadow-[0_0_8px_#ff990040]">[+10m]</button>
              <button onClick={() => onExtendTime(1800)} className="px-2 py-1.5 border border-[#ff9900] text-[#ff9900] font-mono text-xs hover:bg-[#ff9900]/10 transition-all hover:shadow-[0_0_8px_#ff990040]">[+30m]</button>
            </div>
            <button onClick={onKeepGoing} className="px-3 py-1.5 border border-[#00cccc] text-[#00cccc] font-mono text-xs hover:bg-[#00cccc]/10 transition-all hover:shadow-[0_0_8px_#00cccc40]">[KEEP GOING]</button>
            <div className="flex-1" />
            <ScoreTooltip minutes={elapsed / 60} valor={valor} priority={mission.priority} score={projectedScore}>
              <span className="text-xl font-mono font-bold text-[#00ff41] cursor-help">{projectedScore.toFixed(1)}</span>
            </ScoreTooltip>
            <button onClick={onComplete} className="px-5 py-1.5 border-2 border-[#00ff41] text-[#00ff41] font-mono text-sm bg-[#00ff41]/20 hover:bg-[#00ff41]/30 transition-all hover:shadow-[0_0_12px_#00ff4140]">[DONE]</button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {/* Timer */}
            <div className={`text-3xl font-mono tracking-wider ${isOvertime ? 'text-[#ff0040] animate-pulse' : mission.isPaused ? 'text-[#ffcc00]' : 'text-[#00ff41]'}`}
              style={{ textShadow: `0 0 10px ${isOvertime ? '#ff0040' : mission.isPaused ? '#ffcc00' : '#00ff41'}` }}>
              {formatTime(displayTime)}
            </div>
            {mission.isPaused && <span className="text-xs font-mono text-[#ffcc00]">⏸</span>}

            {/* Time nudge — hides first when bar gets narrow */}
            <div className="flex gap-1 shrink-[2]" style={{ minWidth: 0, overflow: 'hidden' }}>
              <button onClick={() => onAdjustTime(-1800)} className="px-1.5 py-0.5 border border-[#ff4444]/50 text-[#ff4444] font-mono text-xs hover:bg-[#ff4444]/10 shrink-0">-30m</button>
              <button onClick={() => onAdjustTime(-300)} className="px-1.5 py-0.5 border border-[#ff4444]/50 text-[#ff4444] font-mono text-xs hover:bg-[#ff4444]/10 shrink-0">-5m</button>
              <button onClick={() => onAdjustTime(300)} className="px-1.5 py-0.5 border border-[#00ff41]/50 text-[#00ff41] font-mono text-xs hover:bg-[#00ff41]/10 shrink-0">+5m</button>
              <button onClick={() => onAdjustTime(1800)} className="px-1.5 py-0.5 border border-[#00ff41]/50 text-[#00ff41] font-mono text-xs hover:bg-[#00ff41]/10 shrink-0">+30m</button>
            </div>

            {/* Progress for fixed */}
            {mission.horizon === 'fixed' && mission.targetSeconds && (
              <div className="w-32"><ProgressBar elapsed={elapsed} target={mission.targetSeconds} isOvertime={isOvertime} /></div>
            )}

            {/* Valor */}
            <div className="flex items-center gap-2 relative group/valor">
              <span className="text-sm font-mono text-[#666] cursor-help border-b border-dashed border-[#444]">VALOR</span>
              <div className="absolute bottom-full left-0 mb-2 bg-black border border-[#00ff41] px-3 py-2 w-56 z-50 pointer-events-none opacity-0 group-hover/valor:opacity-100 transition-opacity"
                style={{ boxShadow: '0 0 15px #00ff4130' }}>
                <div className="text-xs font-mono text-[#888] mb-1">SELF-SCORE (0.0 - 2.0)</div>
                <div className="text-xs font-mono text-[#666] leading-relaxed">
                  How focused, effective, and useful was your work? Higher if you&apos;re proud of yourself. Lower if you could&apos;ve been better.
                </div>
                <div className="text-xs font-mono text-[#444] mt-1">1.0 = adequate | 2.0 = exceptional</div>
              </div>
              <input type="range" min="0" max="2" step="0.1" value={valor} onChange={e => onValorChange(parseFloat(e.target.value))}
                className="w-20" />
              <span className="text-base font-mono text-[#00ff41] w-8">{valor.toFixed(1)}</span>
            </div>

            {/* Score with tooltip */}
            <ScoreTooltip minutes={elapsed / 60} valor={valor} priority={mission.priority} score={projectedScore}>
              <div className="flex items-center gap-2 cursor-help">
                <span className="text-sm font-mono text-[#666]">☸ PUNYA</span>
                <span className="text-xl font-mono font-bold text-[#00ff41]">{projectedScore.toFixed(1)}</span>
                {mission.horizon === 'fixed' && mission.targetSeconds && (
                  <span className="text-sm font-mono text-[#666]">/ {((mission.targetSeconds / 60) * valor * mission.priority).toFixed(1)}</span>
                )}
              </div>
            </ScoreTooltip>

            {/* Actions */}
            <div className="flex-1 flex justify-end gap-2">
              <button onClick={mission.isPaused ? onResume : onPause}
                className={`px-4 py-2 border font-mono text-sm ${mission.isPaused ? 'border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41]/10' : 'border-[#ffcc00] text-[#ffcc00] hover:bg-[#ffcc00]/10'}`}>
                {mission.isPaused ? '[RESUME]' : '[PAUSE]'}
              </button>
              <button onClick={onComplete} className="px-5 py-2 border border-[#00ff41] text-[#00ff41] font-mono text-sm hover:bg-[#00ff41]/10">[DONE]</button>
              {hasNextInQueue && (
                <button onClick={onNext} className="px-4 py-2 border border-[#00cccc] text-[#00cccc] font-mono text-sm hover:bg-[#00cccc]/10"
                  title="Complete and start next">[NEXT]</button>
              )}
              <button onClick={() => setShowCancelPopup(true)}
                className="px-3 py-2 border border-[#00cccc]/50 text-[#00cccc] font-mono text-sm hover:bg-[#00cccc]/10">[X]</button>
            </div>
          </div>
        )}
      </div>

      {/* Shelve popup */}
      {showCancelPopup && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#111] border border-[#333] p-6 max-w-sm">
            <div className="text-lg font-mono text-[#00cccc] mb-4">SHELVE MISSION?</div>
            <div className="text-sm font-mono text-[#888] mb-6">You have {formatTime(elapsed)} tracked.</div>
            <div className="flex gap-3">
              <button onClick={() => { onShelve(); setShowCancelPopup(false) }}
                className="flex-1 py-2 border border-[#00cccc] text-[#00cccc] font-mono text-sm hover:bg-[#00cccc]/10">
                SHELVE<div className="text-xs text-[#666] mt-1">Save time, back to todo</div>
              </button>
              <button onClick={() => { onCancel(); setShowCancelPopup(false) }}
                className="flex-1 py-2 border border-[#ff0040] text-[#ff0040] font-mono text-sm hover:bg-[#ff0040]/10">
                DISCARD<div className="text-xs text-[#666] mt-1">Erase time, back to todo</div>
              </button>
            </div>
            <button onClick={() => setShowCancelPopup(false)}
              className="w-full mt-3 py-2 border border-[#333] text-[#666] font-mono text-sm hover:bg-[#222]">NEVERMIND</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mission List — Queue / Todo / Done
// ═══════════════════════════════════════════════════════════════════════════════

function DevMissionList({ missions, activeMissionId, onMissionClick, onReorder, onRemoveFromQueue, onEngage, onAddToQueue, fontSize }: {
  missions: Mission[]; activeMissionId: number | null
  onMissionClick: (m: Mission) => void; onReorder: (reordered: Mission[]) => void
  onRemoveFromQueue: (id: number) => void; onEngage: (m: Mission) => void
  onAddToQueue: (id: number) => void; fontSize: number
}) {
  const [sectionSplit, setSectionSplit] = useState<[number, number]>(() => {
    if (typeof window === 'undefined') return [40, 45]
    const saved = localStorage.getItem('devcraft-section-split')
    if (saved) try { return JSON.parse(saved) } catch { /* */ }
    return [40, 45]
  })
  const [vResizing, setVResizing] = useState<0 | 1 | false>(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [collapsed, setCollapsed] = useState<{ queue: boolean; todo: boolean; done: boolean }>(() => {
    if (typeof window === 'undefined') return { queue: false, todo: false, done: false }
    const saved = localStorage.getItem('devcraft-collapsed')
    if (saved) try { return JSON.parse(saved) } catch { /* */ }
    return { queue: false, todo: false, done: false }
  })
  useEffect(() => { localStorage.setItem('devcraft-collapsed', JSON.stringify(collapsed)) }, [collapsed])
  useEffect(() => { localStorage.setItem('devcraft-section-split', JSON.stringify(sectionSplit)) }, [sectionSplit])

  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  // Mission buckets
  const current = missions.filter(m => m.status === 'wip')
  const queued = missions.filter(m => m.status === 'todo' && m.queuePosition !== null)
    .sort((a, b) => (a.queuePosition ?? 9999) - (b.queuePosition ?? 9999))
  const todo = missions.filter(m => m.status === 'todo' && m.queuePosition === null)
  const done = missions.filter(m => m.status === 'done')
    .sort((a, b) => new Date(b.endedAt || b.createdAt).getTime() - new Date(a.endedAt || a.createdAt).getTime())
    .slice(0, 30)

  // Vertical resize
  useEffect(() => {
    if (vResizing === false) return
    const container = containerRef.current
    if (!container) return
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const pct = ((e.clientY - rect.top) / rect.height) * 100
      setSectionSplit(prev => {
        if (vResizing === 0) {
          const queuePct = Math.max(10, Math.min(70, pct))
          const todoPct = Math.max(10, Math.min(80 - queuePct, prev[1]))
          return [queuePct, todoPct]
        } else {
          const todoEnd = Math.max(prev[0] + 10, Math.min(90, pct))
          return [prev[0], Math.max(10, todoEnd - prev[0])]
        }
      })
    }
    const handleMouseUp = () => setVResizing(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
  }, [vResizing])

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    // Ghost image with green tint
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '0.5'
    setTimeout(() => { el.style.opacity = '' }, 0)
  }
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIdx === null) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDropTarget(e.clientY > rect.top + rect.height / 2 ? idx + 0.5 : idx - 0.5)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragIdx === null || dropTarget === null) return
    const insertIdx = Math.ceil(dropTarget)
    if (dragIdx === insertIdx || dragIdx === insertIdx - 1) { setDragIdx(null); setDropTarget(null); return }
    const reordered = [...queued]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(insertIdx > dragIdx ? insertIdx - 1 : insertIdx, 0, moved)
    onReorder(reordered.map((m, i) => ({ ...m, queuePosition: i + 1 })))
    setDragIdx(null); setDropTarget(null)
  }

  const donePct = Math.max(0, 100 - sectionSplit[0] - sectionSplit[1])

  const renderRow = (m: Mission, opts: { showQueue?: boolean; showEngage?: boolean; showAddQueue?: boolean; showScore?: boolean; showRemove?: boolean; isDraggable?: boolean; idx?: number }) => {
    const isActive = m.id === activeMissionId
    const showDragGap = opts.isDraggable && opts.idx !== undefined && dropTarget !== null && Math.ceil(dropTarget) === opts.idx && dragIdx !== opts.idx && dragIdx !== (opts.idx ?? 0) - 1

    return (
      <div key={m.id}>
        {showDragGap && (
          <div className="h-6 border-2 border-dashed border-[#00ff41] bg-[#00ff41]/10 flex items-center justify-center text-[#00ff41] font-mono transition-all"
            style={{ fontSize: fontSize - 2, boxShadow: '0 0 10px rgba(0,255,65,0.2)' }}>
            ▼ DROP HERE ▼
          </div>
        )}
        <div
          draggable={opts.isDraggable}
          onDragStart={opts.isDraggable && opts.idx !== undefined ? e => handleDragStart(e, opts.idx!) : undefined}
          onDragOver={opts.isDraggable && opts.idx !== undefined ? e => handleDragOver(e, opts.idx!) : undefined}
          onDragEnd={opts.isDraggable ? () => { setDragIdx(null); setDropTarget(null) } : undefined}
          className={`flex items-center gap-1 py-0.5 px-1.5 cursor-pointer group transition-all font-mono ${
            opts.isDraggable && dragIdx === opts.idx ? 'opacity-20 scale-[0.97]' : ''
          } ${opts.isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
          } ${isActive ? 'bg-[#00ff41]/20 border-l-2 border-[#00ff41]' : 'hover:bg-[#111]'}`}
          style={{ fontSize }}
        >
          <span className="text-[#666] shrink-0" style={{ width: fontSize * 2.5 }}>{m.id}</span>
          {opts.showQueue && <span className="text-[#444] shrink-0" style={{ width: fontSize * 1.5 }}>{(opts.idx ?? 0) + 1}</span>}
          {opts.showEngage && (
            isActive ? (
              <span className="shrink-0 relative flex items-center justify-center w-4 h-4">
                <span className="absolute inline-flex h-3 w-3 rounded-full bg-[#00ff41] opacity-40 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#00ff41]" style={{ boxShadow: '0 0 8px #00ff41, 0 0 16px #00ff4160' }} />
              </span>
            ) : (
              <button onClick={e => { e.stopPropagation(); onEngage(m) }}
                className="shrink-0 text-[#00ff41] opacity-0 group-hover:opacity-100 hover:scale-125 transition-all">
                ▶
              </button>
            )
          )}
          {opts.showAddQueue && (
            <button onClick={e => { e.stopPropagation(); onAddToQueue(m.id) }}
              className="text-[#00ff41] opacity-0 group-hover:opacity-100 shrink-0">+Q</button>
          )}
          {m.isIRL && <span className="shrink-0 text-amber-400" title="IRL">🏠</span>}
          <span onClick={() => onMissionClick(m)}
            className={`flex-1 truncate hover:underline ${isActive ? 'text-[#00ff41]' : 'text-[#eee]'}`}>
            {m.name}
          </span>
          <span className="text-[#555] shrink-0" style={{ width: fontSize * 2.5 }} title={`Priority: ${m.priority.toFixed(2)}`}>
            {m.priority.toFixed(1)}
          </span>
          <span className={`shrink-0 text-right ${opts.showScore ? 'text-[#555]' : 'text-[#444]'}`} style={{ width: fontSize * 3 }}>
            {opts.showScore ? formatTimeCompact(m.actualSeconds || 0) : (m.horizon === 'fixed' && m.targetSeconds ? formatTimeCompact(m.targetSeconds) : '-')}
          </span>
          {opts.showScore ? (
            <span className="text-[#00ff41] shrink-0 text-right" style={{ width: fontSize * 2.5 }}>{m.score?.toFixed(0) || '-'}</span>
          ) : (
            <span className="text-[#333] shrink-0 text-right" style={{ width: fontSize * 2.5 }}>{formatDateShort(m.createdAt)}</span>
          )}
          {opts.showRemove && (
            <button onClick={e => { e.stopPropagation(); onRemoveFromQueue(m.id) }}
              className="text-[#ff0040] opacity-0 group-hover:opacity-100 hover:text-[#ff4040] shrink-0">×</button>
          )}
        </div>
      </div>
    )
  }

  const sectionHeader = (label: string, count: number, section: 'queue' | 'todo' | 'done', color: string) => (
    <div onClick={() => setCollapsed(prev => ({ ...prev, [section]: !prev[section] }))}
      className="px-2 py-1 font-mono flex items-center justify-between shrink-0 cursor-pointer hover:bg-[#111] select-none"
      style={{ fontSize: fontSize - 1, color }}>
      <span>{collapsed[section] ? '▸' : '▾'} {label} ({count})</span>
    </div>
  )

  return (
    <div ref={containerRef} className={`h-full flex flex-col overflow-hidden ${vResizing !== false ? 'cursor-row-resize select-none' : ''}`}>
      {/* CURRENT — active WIP mission */}
      {current.length > 0 && (
        <div className="shrink-0 border-b border-[#00ff41]/30">
          <div className="px-2 py-1 font-mono flex items-center gap-1" style={{ fontSize: fontSize - 1, color: '#00ff41' }}>
            <span className="animate-pulse">●</span> CURRENT ({current.length})
          </div>
          {current.map(m => renderRow(m, { showEngage: true }))}
        </div>
      )}

      <div style={{ height: collapsed.queue ? 'auto' : `${sectionSplit[0]}%` }} className={`flex flex-col min-h-0 ${collapsed.queue ? 'shrink-0' : ''}`}>
        {sectionHeader('QUEUE', queued.length, 'queue', '#00ff41')}
        {!collapsed.queue && (
          <div className="flex-1 overflow-y-auto" onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
            {queued.length === 0
              ? <div className="text-center text-[#333] py-4 font-mono" style={{ fontSize }}>EMPTY</div>
              : queued.map((m, idx) => renderRow(m, { showQueue: true, showEngage: true, showRemove: true, isDraggable: true, idx }))
            }
          </div>
        )}
      </div>

      {!collapsed.queue && !collapsed.todo && (
        <div className="h-2 cursor-row-resize shrink-0 flex items-center justify-center group" onMouseDown={e => { e.preventDefault(); setVResizing(0) }}>
          <div className="w-full h-px bg-[#333] group-hover:bg-[#00ff41]/60 group-active:bg-[#00ff41] transition-colors" />
        </div>
      )}

      <div style={{ height: collapsed.todo ? 'auto' : `${sectionSplit[1]}%` }} className={`flex flex-col min-h-0 ${collapsed.todo ? 'shrink-0' : ''}`}>
        {sectionHeader('TODO', todo.length, 'todo', '#888')}
        {!collapsed.todo && (
          <div className="flex-1 overflow-y-auto">
            {todo.length === 0
              ? <div className="text-center text-[#333] py-4 font-mono" style={{ fontSize }}>-</div>
              : todo.map(m => renderRow(m, { showAddQueue: true, showEngage: true }))
            }
          </div>
        )}
      </div>

      {!collapsed.todo && !collapsed.done && (
        <div className="h-2 cursor-row-resize shrink-0 flex items-center justify-center group" onMouseDown={e => { e.preventDefault(); setVResizing(1) }}>
          <div className="w-full h-px bg-[#333] group-hover:bg-[#00ff41]/60 group-active:bg-[#00ff41] transition-colors" />
        </div>
      )}

      <div style={{ height: collapsed.done ? 'auto' : `${donePct}%` }} className={`flex flex-col min-h-0 ${collapsed.done ? 'shrink-0' : ''}`}>
        {sectionHeader('DONE', done.length, 'done', '#555')}
        {!collapsed.done && (
          <div className="flex-1 overflow-y-auto">{done.map(m => renderRow(m, { showScore: true }))}</div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Modal
// ═══════════════════════════════════════════════════════════════════════════════

function CreateModal({ isOpen, onClose, onCreated, onStartImmediately }: { isOpen: boolean; onClose: () => void; onCreated: () => void; onStartImmediately?: (id: number) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState(5)
  const [easiness, setEasiness] = useState(5)
  const [impact, setImpact] = useState(5)
  const [horizon, setHorizon] = useState<'open' | 'fixed'>('open')
  const [targetMinutes, setTargetMinutes] = useState(30)
  const [isIRL, setIsIRL] = useState(false)
  const [creating, setCreating] = useState(false)

  const priority = (urgency * easiness * impact) / 125

  if (!isOpen) return null

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    try {
      const notes = description.trim()
        ? JSON.stringify([{ timestamp: new Date().toISOString(), message: description.trim(), type: 'note' }])
        : null

      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), urgency, easiness, impact, horizon,
          targetSeconds: horizon === 'fixed' ? targetMinutes * 60 : null,
          isIRL, notes,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setName(''); setDescription(''); setUrgency(5); setEasiness(5); setImpact(5)
        setHorizon('open'); setTargetMinutes(30); setIsIRL(false)
        onCreated(); onClose()
        return created
      }
    } finally { setCreating(false) }
    return null
  }

  const handleCreateAndStart = async () => {
    const created = await handleCreate()
    if (created?.id && onStartImmediately) {
      onStartImmediately(created.id)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50" onClick={onClose}>
      <div className="border border-[#00ff41] bg-black p-5 w-[440px] max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 40px #00ff4120' }}>
        <h2 className="text-[#00ff41] font-mono text-base uppercase mb-4">NEW MISSION</h2>

        <input type="text" placeholder="Mission name..." value={name} onChange={e => setName(e.target.value)}
          className="w-full bg-black border border-[#333] p-2.5 text-base font-mono text-[#00ff41] focus:border-[#00ff41] focus:outline-none mb-3" autoFocus />

        <textarea placeholder="Description (becomes first note)..." value={description} onChange={e => setDescription(e.target.value)}
          className="w-full bg-black border border-[#333] p-2.5 text-sm font-mono text-[#999] focus:border-[#00ff41] focus:outline-none mb-4 h-24 resize-none" />

        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Urgency', color: '#ff4040', value: urgency, set: setUrgency },
            { label: 'Easiness', color: '#ff9900', value: easiness, set: setEasiness },
            { label: 'Impact', color: '#00cccc', value: impact, set: setImpact },
          ].map(({ label, color, value, set }) => (
            <div key={label}>
              <div className="text-sm font-mono mb-1" style={{ color }}>{label}</div>
              <IntegerSelector value={value} onChange={set} color={color} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-3 text-sm font-mono">
          <span className="text-[#666]">U×E×I÷125</span>
          <span className="text-[#00ff41] font-bold">{priority.toFixed(2)}</span>
        </div>
        <PriorityBar u={urgency} e={easiness} i={impact} />

        <div className="mt-4 mb-4">
          <div className="text-sm font-mono text-[#888] mb-1">BEEP FREQUENCY</div>
          <div className="flex gap-2 items-center">
            <button onClick={() => setHorizon('open')}
              className={`px-4 py-1.5 text-sm font-mono border ${horizon === 'open' ? 'border-[#00ff41] text-[#00ff41]' : 'border-[#333] text-[#666]'}`}>NO BEEPS</button>
            <button onClick={() => setHorizon('fixed')}
              className={`px-4 py-1.5 text-sm font-mono border ${horizon === 'fixed' ? 'border-[#ff9900] text-[#ff9900]' : 'border-[#333] text-[#666]'}`}>BEEP EVERY</button>
            {horizon === 'fixed' && (
              <div className="flex items-center gap-1">
                <IntegerSelector value={targetMinutes} min={1} max={240} onChange={setTargetMinutes} color="#ff9900" />
                <span className="text-sm font-mono text-[#666]">min</span>
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-sm font-mono text-[#888] mb-1">MODE</div>
          <div className="flex gap-1">
            <button onClick={() => setIsIRL(false)}
              className={`flex-1 py-1.5 text-sm font-mono border ${!isIRL ? 'border-cyan-400 text-cyan-400 bg-cyan-400/10' : 'border-[#333] text-[#666]'}`}>ONLINE</button>
            <button onClick={() => setIsIRL(true)}
              className={`flex-1 py-1.5 text-sm font-mono border ${isIRL ? 'border-amber-400 text-amber-400 bg-amber-400/10' : 'border-[#333] text-[#666]'}`}>IRL</button>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleCreate} disabled={creating || !name.trim()}
            className="flex-1 py-2.5 border border-[#00ff41] text-[#00ff41] font-mono text-sm hover:bg-[#00ff41]/10 disabled:opacity-50">
            {creating ? '[...]' : '[CREATE]'}
          </button>
          <button onClick={handleCreateAndStart} disabled={creating || !name.trim()}
            className="flex-1 py-2.5 border border-[#ff9900] text-[#ff9900] font-mono text-sm hover:bg-[#ff9900]/10 disabled:opacity-50"
            style={{ boxShadow: '0 0 8px rgba(255,153,0,0.15)' }}>
            {creating ? '[...]' : '[▶ START]'}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 border border-[#444] text-[#444] font-mono text-sm hover:border-[#666]">[X]</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function Devcraft({ onClose }: { onClose?: () => void } = {}) {
  const [mounted, setMounted] = useState(false)
  const [missions, setMissions] = useState<Mission[]>([])
  const [stats, setStats] = useState<DevStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const [activeMission, setActiveMission] = useState<Mission | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [valor, setValor] = useState(1.0)
  const [note, setNote] = useState('')
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const [popupMission, setPopupMission] = useState<Mission | null>(null)
  const [switchConfirm, setSwitchConfirm] = useState<{ current: Mission; next: Mission } | null>(null)

  const [timerExpired, setTimerExpired] = useState(false)
  const hasNotifiedRef = useRef(false)

  const [leftPanelWidth, setLeftPanelWidth] = useState(260)
  const [resizing, setResizing] = useState(false)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === 'undefined') return 11
    return Number(localStorage.getItem('devcraft-fontsize')) || 11
  })
  useEffect(() => { localStorage.setItem('devcraft-fontsize', String(fontSize)) }, [fontSize])

  const [panelOpacity, setPanelOpacity] = useState(() => {
    if (typeof window === 'undefined') return 85
    const saved = localStorage.getItem('devcraft-panel-opacity')
    return saved !== null ? Number(saved) : 85
  })
  const [bgEnabled, setBgEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('devcraft-bg-enabled') !== 'false'
  })
  useEffect(() => { localStorage.setItem('devcraft-panel-opacity', String(panelOpacity)) }, [panelOpacity])
  useEffect(() => { localStorage.setItem('devcraft-bg-enabled', String(bgEnabled)) }, [bgEnabled])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only mount gate
  useEffect(() => { setMounted(true) }, [])

  const fetchMissions = useCallback(async () => {
    try {
      const res = await fetch('/api/missions')
      if (!res.ok) return
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.missions || [])
      setMissions(list)

      const wip = list.find((m: Mission) => m.status === 'wip')
      if (wip && !activeMission) {
        setActiveMission(wip)
        setNote('')
        if (wip.startedAt) {
          const accumulated = wip.actualSeconds || 0
          const currentSessionMs = Date.now() - new Date(wip.startedAt).getTime() - (wip.totalPausedMs || 0)
          setElapsed(accumulated + Math.max(0, Math.floor(currentSessionMs / 1000)))
        }
      }
    } catch (e) { console.error(e) }
  }, [activeMission])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) setStats(await res.json())
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    if (!mounted) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch callbacks
    Promise.all([fetchMissions(), fetchStats()]).finally(() => setLoading(false))
    const interval = setInterval(() => { fetchMissions(); fetchStats() }, 30000)
    return () => clearInterval(interval)
  }, [mounted, fetchMissions, fetchStats])

  // Timer tick — syncs React state with wall clock (external system)
  useEffect(() => {
    if (activeMission && !activeMission.isPaused && activeMission.startedAt) {
      const calcElapsed = () => {
        const accumulated = activeMission.actualSeconds || 0
        const startTime = new Date(activeMission.startedAt!).getTime()
        const pausedMs = activeMission.totalPausedMs || 0
        return accumulated + Math.floor((Date.now() - startTime - pausedMs) / 1000)
      }
      setElapsed(calcElapsed()) // eslint-disable-line react-hooks/set-state-in-effect -- initial sync with clock
      timerRef.current = setInterval(() => setElapsed(calcElapsed()), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current); timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [activeMission, activeMission?.isPaused, activeMission?.startedAt, activeMission?.totalPausedMs, activeMission?.actualSeconds])

  // Timer expiry — auto-pause + notification
  useEffect(() => {
    if (activeMission?.horizon === 'fixed' && activeMission.targetSeconds) {
      const isExpired = elapsed >= activeMission.targetSeconds
      if (isExpired && !timerExpired) {
        setTimerExpired(true) // eslint-disable-line react-hooks/set-state-in-effect -- derived from elapsed
        if (!hasNotifiedRef.current && !activeMission.isPaused) {
          hasNotifiedRef.current = true
          // Auto-pause
          fetch(`/api/missions/${activeMission.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPaused: true, pausedAt: new Date().toISOString() }),
          })
          setActiveMission(p => p ? { ...p, isPaused: true, pausedAt: new Date().toISOString() } : null)
          // Notifications
          playNotification()
          sendBrowserNotification("D3VCR4F7 — Time's up!", activeMission.name)
        }
      } else if (!isExpired) {
        setTimerExpired(false)
      }
    } else {
      setTimerExpired(false)
    }
  }, [elapsed, activeMission, timerExpired])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on mission switch
  useEffect(() => { hasNotifiedRef.current = false; setTimerExpired(false) }, [activeMission?.id])

  // Resize
  useEffect(() => {
    if (!resizing) return
    const move = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const maxW = window.innerWidth * 0.6
      setLeftPanelWidth(Math.max(140, Math.min(maxW, resizeRef.current.startWidth + e.clientX - resizeRef.current.startX)))
    }
    const up = () => { setResizing(false); resizeRef.current = null }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
  }, [resizing])

  // ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popupMission) setPopupMission(null)
        else if (showCreate) setShowCreate(false)
        else if (switchConfirm) setSwitchConfirm(null)
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [popupMission, showCreate, switchConfirm])

  // Handlers

  const handleEngage = async (mission: Mission) => {
    requestNotificationPermission()
    if (activeMission && activeMission.id !== mission.id) {
      setSwitchConfirm({ current: activeMission, next: mission })
      setPopupMission(null)
      return
    }
    await startMission(mission.id)
    setPopupMission(null)
  }

  const startMission = async (id: number) => {
    const res = await fetch(`/api/missions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'wip', startedAt: new Date().toISOString(), isPaused: false, totalPausedMs: 0 }),
    })
    if (res.ok) {
      const mission = await res.json()
      setActiveMission(mission)
      setElapsed(mission.actualSeconds || 0)
      setValor(1.0); setNote('')
      hasNotifiedRef.current = false
      fetchMissions()
    }
  }

  const handlePause = async () => {
    if (!activeMission) return
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPaused: true, pausedAt: new Date().toISOString() }),
    })
    setActiveMission(p => p ? { ...p, isPaused: true, pausedAt: new Date().toISOString() } : null)
  }

  const handleResume = async () => {
    if (!activeMission?.pausedAt) return
    const pauseDuration = Date.now() - new Date(activeMission.pausedAt).getTime()
    const newTotal = (activeMission.totalPausedMs || 0) + pauseDuration
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPaused: false, pausedAt: null, totalPausedMs: newTotal }),
    })
    setActiveMission(p => p ? { ...p, isPaused: false, pausedAt: null, totalPausedMs: newTotal } : null)
  }

  const handleAdjustTime = async (deltaSecs: number) => {
    if (!activeMission) return
    // Adjust actualSeconds (accumulated base) — works regardless of pause state
    const newActual = Math.max(0, (activeMission.actualSeconds || 0) + deltaSecs)
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actualSeconds: newActual }),
    })
    setActiveMission(p => p ? { ...p, actualSeconds: newActual } : null)
  }

  const handleExtendTime = async (extraSeconds: number) => {
    if (!activeMission) return
    const newTarget = (activeMission.targetSeconds || 0) + extraSeconds
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSeconds: newTarget, isPaused: false, pausedAt: null }),
    })
    // Resume after extending
    if (activeMission.pausedAt) {
      const pauseDuration = Date.now() - new Date(activeMission.pausedAt).getTime()
      const newPausedTotal = (activeMission.totalPausedMs || 0) + pauseDuration
      await fetch(`/api/missions/${activeMission.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalPausedMs: newPausedTotal }),
      })
      setActiveMission(p => p ? { ...p, targetSeconds: newTarget, isPaused: false, pausedAt: null, totalPausedMs: newPausedTotal } : null)
    } else {
      setActiveMission(p => p ? { ...p, targetSeconds: newTarget } : null)
    }
    setTimerExpired(false)
    hasNotifiedRef.current = false
  }

  const handleKeepGoing = async () => {
    if (!activeMission) return
    // Switch to open horizon + resume
    const updates: Record<string, unknown> = { horizon: 'open', targetSeconds: null, isPaused: false, pausedAt: null }
    if (activeMission.pausedAt) {
      const pauseDuration = Date.now() - new Date(activeMission.pausedAt).getTime()
      updates.totalPausedMs = (activeMission.totalPausedMs || 0) + pauseDuration
    }
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setActiveMission(p => p ? { ...p, ...updates } as Mission : null)
    setTimerExpired(false)
    hasNotifiedRef.current = false
  }

  const saveNoteEntry = async (missionId: number, entry: NoteEntry, currentNotes: string | null) => {
    const existing: NoteEntry[] = currentNotes ? JSON.parse(currentNotes) : []
    const newNotes = [...existing, entry]
    const res = await fetch(`/api/missions/${missionId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: JSON.stringify(newNotes) }),
    })
    if (res.ok) return JSON.stringify(newNotes)
    return currentNotes
  }

  const deleteNoteEntry = async (missionId: number, entryIdx: number, currentNotes: string | null) => {
    if (!currentNotes) return currentNotes
    const existing: NoteEntry[] = JSON.parse(currentNotes)
    const newNotes = existing.filter((_, idx) => idx !== entryIdx)
    const res = await fetch(`/api/missions/${missionId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: JSON.stringify(newNotes) }),
    })
    if (res.ok) {
      const str = JSON.stringify(newNotes)
      if (activeMission?.id === missionId) setActiveMission(p => p ? { ...p, notes: str } : null)
      if (popupMission?.id === missionId) setPopupMission(p => p ? { ...p, notes: str } : null)
      return str
    }
    return currentNotes
  }

  const handleSaveNote = async () => {
    if (!note.trim() || !activeMission) return
    const newNotes = await saveNoteEntry(activeMission.id, {
      timestamp: new Date().toISOString(), message: note.trim(), type: 'note'
    }, activeMission.notes)
    setActiveMission(p => p ? { ...p, notes: newNotes } : null)
    setNote('')
  }

  const handleComplete = async () => {
    if (!activeMission) return
    const score = (elapsed / 60) * valor * activeMission.priority
    const existing: NoteEntry[] = activeMission.notes ? JSON.parse(activeMission.notes) : []
    const newEntries: NoteEntry[] = []
    if (note.trim()) newEntries.push({ timestamp: new Date().toISOString(), message: note.trim(), type: 'note' })
    newEntries.push({ timestamp: new Date().toISOString(), message: 'Completed', type: 'system', elapsed, valor, score })
    const newNotes = [...existing, ...newEntries]

    try {
      const response = await fetch(`/api/missions/${activeMission.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'done', endedAt: new Date().toISOString(), actualSeconds: elapsed,
          valor, score, notes: JSON.stringify(newNotes), isPaused: false
        }),
      })
      if (!response.ok) { console.error('Failed to complete mission'); return }
      setActiveMission(null); setElapsed(0); setValor(1.0); setNote('')
      setTimerExpired(false); hasNotifiedRef.current = false
      fetchMissions(); fetchStats()
    } catch (error) { console.error('Network error:', error) }
  }

  const handleCancel = async () => {
    if (!activeMission) return
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo', startedAt: null, endedAt: null, isPaused: false, totalPausedMs: 0, actualSeconds: null }),
    })
    setActiveMission(null); setElapsed(0); setValor(1.0); setNote('')
    fetchMissions()
  }

  const handleShelve = async () => {
    if (!activeMission) return
    const sessionSeconds = activeMission.startedAt
      ? Math.floor((Date.now() - new Date(activeMission.startedAt).getTime() - (activeMission.totalPausedMs || 0)) / 1000) : 0
    const newActualSeconds = (activeMission.actualSeconds || 0) + sessionSeconds
    const entry: NoteEntry = { timestamp: new Date().toISOString(), message: `Shelved after ${Math.floor(sessionSeconds / 60)}m ${sessionSeconds % 60}s`, type: 'system', elapsed: sessionSeconds }
    const existing: NoteEntry[] = activeMission.notes ? JSON.parse(activeMission.notes) : []
    const newNotes = [...existing, entry]
    await fetch(`/api/missions/${activeMission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'todo', startedAt: null, isPaused: false, totalPausedMs: 0, actualSeconds: newActualSeconds, notes: JSON.stringify(newNotes) }),
    })
    setActiveMission(null); setElapsed(0); setValor(1.0); setNote('')
    fetchMissions()
  }

  const handleNext = async () => {
    if (!activeMission) return
    await handleComplete()
    const devQueue = missions
      .filter(m => m.status === 'todo' && m.queuePosition !== null && m.id !== activeMission.id)
      .sort((a, b) => (a.queuePosition ?? 9999) - (b.queuePosition ?? 9999))
    if (devQueue.length > 0) await startMission(devQueue[0].id)
  }

  const handleUpdateMission = async (updates: Partial<Mission>, mission?: Mission) => {
    const m = mission || activeMission
    if (!m) return
    const newU = updates.urgency ?? m.urgency
    const newE = updates.easiness ?? m.easiness
    const newI = updates.impact ?? m.impact
    const fullUpdates = { ...updates, priority: (newU * newE * newI) / 125 }
    await fetch(`/api/missions/${m.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullUpdates),
    })
    if (m.id === activeMission?.id) setActiveMission(p => p ? { ...p, ...fullUpdates } : null)
    if (popupMission?.id === m.id) setPopupMission(p => p ? { ...p, ...fullUpdates } : null)
    fetchMissions()
  }

  const handleReorder = async (reorderedMissions: Mission[]) => {
    setMissions(prev => {
      const others = prev.filter(m => !reorderedMissions.find(r => r.id === m.id))
      return [...others, ...reorderedMissions]
    })
    await Promise.all(reorderedMissions.map(m =>
      fetch(`/api/missions/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queuePosition: m.queuePosition }) })
    ))
  }

  const handleAddToQueue = async (id: number) => {
    const queued = missions.filter(m => m.status === 'todo' && m.queuePosition !== null)
    const maxPos = queued.length > 0 ? Math.max(...queued.map(m => m.queuePosition || 0)) : 0
    await fetch(`/api/missions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queuePosition: maxPos + 1 }),
    })
    fetchMissions()
  }

  const handleRemoveFromQueue = async (id: number) => {
    await fetch(`/api/missions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queuePosition: null }),
    })
    fetchMissions()
  }

  const handleIRLComplete = async (mission: Mission, minutes: number, valorInput: number) => {
    const elapsedSecs = minutes * 60
    const score = minutes * valorInput * mission.priority
    const entry: NoteEntry = { timestamp: new Date().toISOString(), message: `IRL completed — ${minutes} min`, type: 'system', elapsed: elapsedSecs, valor: valorInput, score }
    const existing: NoteEntry[] = mission.notes ? JSON.parse(mission.notes) : []
    const newNotes = [...existing, entry]
    await fetch(`/api/missions/${mission.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'done', startedAt: new Date(Date.now() - elapsedSecs * 1000).toISOString(),
        endedAt: new Date().toISOString(), actualSeconds: elapsedSecs,
        valor: valorInput, score, notes: JSON.stringify(newNotes), isPaused: false
      }),
    })
    setPopupMission(null); fetchMissions(); fetchStats()
  }

  // ESC to close
  useEffect(() => {
    if (!onClose) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  if (!mounted) return <div className="h-full bg-black" />

  return (
    <div className="h-full relative overflow-hidden" style={{ backgroundColor: `rgba(0,0,0,${panelOpacity / 100})` }}>
      {bgEnabled && <MatrixRain />}

      {/* Top-right controls: settings + minimize + close */}
      {onClose && (
        <div className="absolute top-1 right-2 z-30 flex items-center gap-1">
          <SettingsGear fontSize={fontSize} onFontSizeChange={setFontSize}
            bgEnabled={bgEnabled} onBgToggle={() => setBgEnabled(!bgEnabled)}
            panelOpacity={panelOpacity} onOpacityChange={setPanelOpacity} />
          <button onClick={onClose} className="text-[#888] hover:text-[#ff9900] font-mono text-sm px-1.5 py-0.5 border border-[#333] hover:border-[#ff9900] rounded" title="Minimize">─</button>
          <button onClick={onClose} className="text-[#888] hover:text-[#ff5555] font-mono text-sm px-1.5 py-0.5 border border-[#333] hover:border-[#ff5555] rounded" title="Close (ESC)">✕</button>
        </div>
      )}

      <div className={`relative z-10 h-full flex overflow-hidden ${resizing ? 'cursor-col-resize select-none' : ''}`}>
        {/* Left — Mission Lists */}
        <div className="flex flex-col" style={{ width: leftPanelWidth, backgroundColor: `rgba(0,0,0,${Math.max(0.3, panelOpacity / 100)})`, backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between px-2 py-1 gap-2 shrink-0 border-b border-[#222]">
            <span className="text-[#00ff41] font-mono text-sm font-bold" style={{ textShadow: '0 0 10px #00ff41' }}>D3VCR4F7</span>
            <button onClick={() => setShowCreate(true)}
              className="text-xs font-mono px-2 py-0.5 border border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41]/10">[+]</button>
          </div>
          <div className="flex-1 min-h-0">
            <DevMissionList missions={missions} activeMissionId={activeMission?.id || null}
              onMissionClick={m => setPopupMission(m)} onReorder={handleReorder}
              onRemoveFromQueue={handleRemoveFromQueue} onEngage={handleEngage}
              onAddToQueue={handleAddToQueue} fontSize={fontSize} />
          </div>
        </div>

        {/* Resize handle */}
        <div className="w-1 cursor-col-resize hover:bg-[#00ff41]/30 active:bg-[#00ff41]/50 transition-colors"
          onMouseDown={e => { e.preventDefault(); setResizing(true); resizeRef.current = { startX: e.clientX, startWidth: leftPanelWidth } }} />

        {/* Center — Stats + Active Mission */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ backgroundColor: `rgba(0,0,0,${Math.max(0.3, panelOpacity / 100)})`, backdropFilter: 'blur(8px)' }}>
          <div className="shrink-0 px-2 py-1 border-b border-[#222] flex gap-2" style={{ minHeight: 120 }}>
            <div className="shrink-0" style={{ width: 130 }}>
              <StatsPanel stats={stats} loading={loading} fontSize={fontSize} onFontSizeChange={setFontSize}
                bgEnabled={bgEnabled} onBgToggle={() => setBgEnabled(!bgEnabled)}
                panelOpacity={panelOpacity} onOpacityChange={setPanelOpacity} />
            </div>
            <div className="flex-1 min-w-0">
              <WeeklyChart data={stats?.weeklyData || []} />
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <ActiveMissionPanel mission={activeMission} elapsed={elapsed}
              onPause={handlePause} onResume={handleResume}
              valor={valor} onValorChange={setValor}
              note={note} onNoteChange={setNote} onSaveNote={handleSaveNote}
              onComplete={handleComplete} onCancel={handleCancel} onShelve={handleShelve}
              onNext={handleNext}
              hasNextInQueue={missions.filter(m => m.status === 'todo' && m.queuePosition !== null && m.id !== activeMission?.id).length > 0}
              onUpdateMission={handleUpdateMission} timerExpired={timerExpired}
              onDeleteNoteEntry={(idx) => activeMission && deleteNoteEntry(activeMission.id, idx, activeMission.notes)}
              onAdjustTime={handleAdjustTime} onExtendTime={handleExtendTime} onKeepGoing={handleKeepGoing} />
          </div>
        </div>

        {/* Modals */}
        <CreateModal isOpen={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchMissions}
          onStartImmediately={async (id) => {
            await fetchMissions()
            const m = missions.find(m => m.id === id) || (await fetch(`/api/missions`).then(r => r.json()).then((all: Mission[]) => all.find(m => m.id === id)))
            if (m) handleEngage(m)
          }} />

        {popupMission && (
          <MissionPopup mission={popupMission} onClose={() => setPopupMission(null)}
            onEngage={() => handleEngage(popupMission)}
            onUpdate={(updates) => handleUpdateMission(updates, popupMission)}
            onDeleteNoteEntry={(idx) => deleteNoteEntry(popupMission.id, idx, popupMission.notes)}
            onIRLComplete={(mins, val) => handleIRLComplete(popupMission, mins, val)} />
        )}

        {switchConfirm && (
          <SwitchConfirmPopup currentMission={switchConfirm.current} newMission={switchConfirm.next}
            onDone={async () => { await handleComplete(); await startMission(switchConfirm.next.id); setSwitchConfirm(null) }}
            onPause={async () => { await handlePause(); await startMission(switchConfirm.next.id); setSwitchConfirm(null) }}
            onCancel={() => setSwitchConfirm(null)} />
        )}
      </div>
    </div>
  )
}
