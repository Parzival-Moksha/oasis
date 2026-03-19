// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THOUGHT STREAM — Stashed for Merlin integration
// Draggable consciousness stream terminal with text concatenation, auto-scroll,
// particle effects, font size control, filtering, and opacity slider.
// Originally lived in Scene.tsx — extracted during the Cortex lobotomy.
// Will be reactivated when Merlin becomes a full coding agent.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES — self-contained, no external deps
// ═══════════════════════════════════════════════════════════════════════════════

export interface ThoughtStreamEvent {
  source: 'llm' | 'stderr' | 'stdout'
  lobe: string
  chunk: string
  timestamp: number
  text?: string
  linkLogId?: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOBE COLORS + ICONS
// ═══════════════════════════════════════════════════════════════════════════════

const STREAM_LOBE_COLORS: Record<string, string> = {
  prefrontal: '#ff9500',
  coder: '#facc15',
  reviewer: '#ff4444',
  tester: '#00bfff',
  hacker: '#00ff41',
  'dlpf-conv': '#fbbf24',
  'dlpf-curator': '#a78bfa',
  system: '#6b7280',
  unknown: '#9ca3af',
}

const STREAM_LOBE_ICONS: Record<string, string> = {
  prefrontal: '\u{1F9E0}',
  coder: '\u{1F525}',
  reviewer: '\u{1F50D}',
  tester: '\u2696\uFE0F',
  hacker: '\u{1F489}',
  'dlpf-conv': '\u{1F4BB}',
  'dlpf-curator': '\u{1F6F8}',
  system: '\u2699\uFE0F',
  unknown: '\u{1F52E}',
}

const getStreamLobeColor = (lobe: string): string => STREAM_LOBE_COLORS[lobe] ?? STREAM_LOBE_COLORS.unknown
const getStreamLobeIcon = (lobe: string): string => STREAM_LOBE_ICONS[lobe] ?? STREAM_LOBE_ICONS.unknown

// ═══════════════════════════════════════════════════════════════════════════════
// SCROLL + VISUAL CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const STREAM_SCROLL_DURATION = 600
const STREAM_GLOW_DURATION = 1000
const STREAM_PARTICLE_COUNT = 12
const AUTOSCROLL_ESCAPE_THRESHOLD = 150
const AUTOSCROLL_RECAPTURE_THRESHOLD = 50

interface StreamParticle {
  id: number
  x: number
  y: number
  size: number
  color: string
  delay: number
  type: 'shimmer' | 'matrix' | 'spark'
}

function generateStreamParticles(count: number = STREAM_PARTICLE_COUNT): StreamParticle[] {
  const colors = ['#ff9500', '#facc15', '#00ff41', '#00bfff', '#ff4444', '#ffffff', '#a855f7']
  const types: StreamParticle['type'][] = ['shimmer', 'matrix', 'spark']
  return Array.from({ length: count }, (_, i) => ({
    id: Date.now() + i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: i * 30,
    type: types[Math.floor(Math.random() * types.length)],
  }))
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

function smoothScrollToBottom(element: HTMLElement, duration: number = STREAM_SCROLL_DURATION): () => void {
  const startPosition = element.scrollTop
  const targetPosition = element.scrollHeight - element.clientHeight
  const distance = targetPosition - startPosition

  if (Math.abs(distance) < 10) {
    element.scrollTop = targetPosition
    return () => {}
  }

  let startTime: number | null = null
  let animationId: number | null = null
  let cancelled = false

  function animate(currentTime: number) {
    if (cancelled) return
    if (startTime === null) startTime = currentTime
    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)
    element.scrollTop = startPosition + (distance * easeInOutSine(progress))
    if (progress < 1) animationId = requestAnimationFrame(animate)
  }

  animationId = requestAnimationFrame(animate)
  return () => { cancelled = true; if (animationId !== null) cancelAnimationFrame(animationId) }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPACITY SLIDER
// ═══════════════════════════════════════════════════════════════════════════════

export function OpacitySlider({ value, onChange, label }: {
  value: number
  onChange: (v: number) => void
  label?: string
}) {
  const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation()
  }

  return (
    <div
      className="flex items-center gap-1.5"
      title={`Opacity: ${Math.round(value * 100)}%`}
      onMouseDown={stopPropagation}
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
    >
      {label && <span className="text-gray-500 text-[9px]">{label}</span>}
      <input
        type="range"
        min="10"
        max="100"
        value={value * 100}
        onChange={(e) => onChange(parseInt(e.target.value) / 100)}
        onMouseDown={stopPropagation}
        onPointerDown={stopPropagation}
        className="w-[70px] h-1 appearance-none bg-gray-700 rounded cursor-pointer accent-purple-500"
        style={{
          background: `linear-gradient(to right, rgba(168,85,247,0.8) 0%, rgba(168,85,247,0.8) ${value * 100}%, #374151 ${value * 100}%, #374151 100%)`,
        }}
      />
      <span className="text-gray-500 text-[9px] w-6">{Math.round(value * 100)}%</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTER TOGGLE
// ═══════════════════════════════════════════════════════════════════════════════

interface StreamFilterSettings {
  llm: boolean
  tools: boolean
  system: boolean
}

const DEFAULT_STREAM_FILTERS: StreamFilterSettings = { llm: true, tools: true, system: true }

function StreamFilterToggle({ label, enabled, color, onToggle }: {
  label: string; enabled: boolean; color: string; onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${enabled ? 'opacity-100' : 'opacity-40 line-through'}`}
      style={{
        backgroundColor: enabled ? `${color}20` : 'transparent',
        color: enabled ? color : '#6b7280',
        border: `1px solid ${enabled ? color : '#374151'}`,
      }}
    >
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// THOUGHT ITEM RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

function StreamThoughtItem({ event, index }: { event: ThoughtStreamEvent; index: number }) {
  const lobeColor = getStreamLobeColor(event.lobe)
  const lobeIcon = getStreamLobeIcon(event.lobe)
  const isStderr = event.source === 'stderr' || event.source === 'stdout'

  return (
    <div
      className={`py-0.5 font-mono text-sm whitespace-pre-wrap break-words ${isStderr ? 'opacity-70' : ''}`}
      style={{
        color: isStderr ? '#9ca3af' : lobeColor,
        animation: `streamThoughtPop 0.35s ease-out forwards`,
        animationDelay: `${Math.min(index * 0.03, 0.3)}s`,
      }}
    >
      <span className="mr-1 opacity-60">{isStderr ? '\u2699\uFE0F' : lobeIcon}</span>
      {event.chunk}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN POPUP
// ═══════════════════════════════════════════════════════════════════════════════

const STREAM_FONT_SIZES = [10, 12, 14, 16, 18] as const
type StreamFontSize = typeof STREAM_FONT_SIZES[number]

interface ThoughtStreamPopupProps {
  thoughtEvents: ThoughtStreamEvent[]
  activeLobe: string | null
  loopRunning: boolean
  isOpen: boolean
  onClose: () => void
  opacity?: number
  onOpacityChange?: (v: number) => void
  isGlobalLive?: boolean
}

export function ThoughtStreamPopup({ thoughtEvents, activeLobe, loopRunning, isOpen, onClose, opacity = 0.9, onOpacityChange, isGlobalLive = true }: ThoughtStreamPopupProps) {
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [size, setSize] = useState({ width: 450, height: 400 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [filters, setFilters] = useState<StreamFilterSettings>(DEFAULT_STREAM_FILTERS)
  const [autoScroll, setAutoScroll] = useState(true)
  const [isGlowing, setIsGlowing] = useState(false)
  const [particles, setParticles] = useState<StreamParticle[]>([])
  const [concatenatedEvents, setConcatenatedEvents] = useState<ThoughtStreamEvent[]>([])
  const [fontSize, setFontSize] = useState<StreamFontSize>(12)

  const dragStart = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ width: 0, height: 0, x: 0, y: 0 })
  const streamRef = useRef<HTMLDivElement>(null)
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const isProgrammaticScrollRef = useRef(false)

  useEffect(() => {
    if (!isGlobalLive) setAutoScroll(false)
  }, [isGlobalLive])

  // Text concatenation — merge consecutive LLM chunks from same lobe
  useEffect(() => {
    if (thoughtEvents.length === 0) { setConcatenatedEvents([]); return }
    const result: ThoughtStreamEvent[] = []
    let currentEvent: ThoughtStreamEvent | null = null
    for (const event of thoughtEvents) {
      if (currentEvent && event.source === 'llm' && currentEvent.source === 'llm' && currentEvent.lobe === event.lobe) {
        const appended: ThoughtStreamEvent = { ...currentEvent, chunk: currentEvent.chunk + event.chunk, timestamp: event.timestamp }
        currentEvent = appended
        result[result.length - 1] = appended
      } else {
        currentEvent = event
        result.push(event)
      }
    }
    setConcatenatedEvents(result)
  }, [thoughtEvents])

  const triggerVisualEffects = useCallback(() => {
    setIsGlowing(true)
    setTimeout(() => setIsGlowing(false), STREAM_GLOW_DURATION)
    setParticles(generateStreamParticles())
    setTimeout(() => setParticles([]), 2000)
  }, [])

  useEffect(() => {
    if (thoughtEvents.length > 0 && thoughtEvents[thoughtEvents.length - 1].source === 'llm') {
      triggerVisualEffects()
    }
  }, [thoughtEvents.length, triggerVisualEffects])

  // Premium auto-scroll
  useEffect(() => {
    if (!autoScroll || !streamRef.current) return
    scrollCancelRef.current?.()
    isProgrammaticScrollRef.current = true
    const container = streamRef.current
    const target = container.scrollHeight - container.clientHeight
    const dist = target - container.scrollTop
    if (dist < 500) {
      container.scrollTop = target
      setTimeout(() => { isProgrammaticScrollRef.current = false }, 50)
    } else {
      scrollCancelRef.current = smoothScrollToBottom(container)
      setTimeout(() => { isProgrammaticScrollRef.current = false }, STREAM_SCROLL_DURATION + 100)
    }
    return () => { scrollCancelRef.current?.() }
  }, [concatenatedEvents, autoScroll])

  const handleScroll = useCallback(() => {
    if (!streamRef.current || isProgrammaticScrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = streamRef.current
    const dist = scrollHeight - scrollTop - clientHeight
    if (autoScroll && dist > AUTOSCROLL_ESCAPE_THRESHOLD) setAutoScroll(false)
    if (!autoScroll && dist < AUTOSCROLL_RECAPTURE_THRESHOLD) setAutoScroll(true)
  }, [autoScroll])

  const toggleAutoScroll = useCallback(() => {
    const v = !autoScroll
    setAutoScroll(v)
    if (v && streamRef.current) { scrollCancelRef.current?.(); scrollCancelRef.current = smoothScrollToBottom(streamRef.current) }
  }, [autoScroll])

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle, button')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    e.preventDefault()
  }, [position])
  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    setPosition({ x: Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragStart.current.x)), y: Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragStart.current.y)) })
  }, [isDragging, size])
  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    resizeStart.current = { width: size.width, height: size.height, x: e.clientX, y: e.clientY }
    e.preventDefault(); e.stopPropagation()
  }, [size])
  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    setSize({ width: Math.max(350, resizeStart.current.width + (e.clientX - resizeStart.current.x)), height: Math.max(250, resizeStart.current.height + (e.clientY - resizeStart.current.y)) })
  }, [isResizing])
  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (isDragging) { document.addEventListener('mousemove', handleDrag); document.addEventListener('mouseup', handleDragEnd) }
    if (isResizing) { document.addEventListener('mousemove', handleResize); document.addEventListener('mouseup', handleResizeEnd) }
    return () => { document.removeEventListener('mousemove', handleDrag); document.removeEventListener('mouseup', handleDragEnd); document.removeEventListener('mousemove', handleResize); document.removeEventListener('mouseup', handleResizeEnd) }
  }, [isDragging, isResizing, handleDrag, handleDragEnd, handleResize, handleResizeEnd])

  const filteredEvents = useMemo(() => concatenatedEvents.filter(e => {
    if (e.source === 'llm') return filters.llm
    if (e.source === 'stderr' || e.source === 'stdout') return filters.tools
    return filters.system
  }), [concatenatedEvents, filters])

  if (!isOpen) return null

  return createPortal(
    <div
      data-menu-portal="thought-stream"
      className="fixed z-[9999] rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        left: position.x, top: position.y, width: size.width, height: size.height,
        backgroundColor: `rgba(0, 0, 0, ${opacity})`,
        border: `1px solid ${isGlowing ? 'rgba(255, 149, 0, 0.6)' : loopRunning ? 'rgba(168, 85, 247, 0.5)' : 'rgba(100, 100, 100, 0.3)'}`,
        boxShadow: isGlowing ? 'inset 0 0 0 2px rgba(255, 149, 0, 0.6), inset 0 0 40px rgba(255, 149, 0, 0.25), 0 0 60px rgba(255, 149, 0, 0.35)' : loopRunning ? '0 0 30px rgba(168, 85, 247, 0.3)' : '0 0 20px rgba(0, 0, 0, 0.5)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 pointer-events-none z-30 opacity-[0.03]" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)' }} />
      {particles.length > 0 && (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden rounded-xl">
          {particles.map((p) => (<div key={p.id} className="absolute rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}px`, height: `${p.size}px`, backgroundColor: p.color, boxShadow: `0 0 ${p.size * 2}px ${p.color}`, animation: `streamParticle${p.type} 1.5s ease-out forwards`, animationDelay: `${p.delay}ms` }} />))}
        </div>
      )}
      <div className="px-3 py-2 border-b border-gray-700/50 flex items-center justify-between cursor-move select-none flex-shrink-0 z-40" onMouseDown={handleDragStart} style={{ background: loopRunning ? 'linear-gradient(135deg, rgba(255, 149, 0, 0.15) 0%, rgba(0,0,0,0) 100%)' : 'rgba(30, 30, 30, 0.5)' }}>
        <div className="flex items-center gap-2">
          <span className={`text-lg ${loopRunning ? 'animate-pulse' : ''}`}>{'\u{1F9E0}'}</span>
          <span className="text-orange-400 font-bold text-sm">Stream</span>
          <span className="text-gray-600 text-xs">({filteredEvents.length})</span>
          {loopRunning && <span className="text-green-400 text-xs animate-pulse">{'\u{1F534}'} LIVE</span>}
          {activeLobe && (<span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: getStreamLobeColor(activeLobe), backgroundColor: `${getStreamLobeColor(activeLobe)}20` }}>{getStreamLobeIcon(activeLobe)} {activeLobe}</span>)}
        </div>
        <div className="flex items-center gap-1.5">
          <StreamFilterToggle label="LLM" enabled={filters.llm} color="#ff9500" onToggle={() => setFilters(f => ({ ...f, llm: !f.llm }))} />
          <StreamFilterToggle label="Tools" enabled={filters.tools} color="#6b7280" onToggle={() => setFilters(f => ({ ...f, tools: !f.tools }))} />
          <button onClick={toggleAutoScroll} className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${autoScroll ? 'bg-green-500/20 text-green-400 border border-green-500 animate-pulse' : 'bg-gray-700 text-gray-500 border border-gray-600'}`}>{autoScroll ? '\u2B07\uFE0F Auto' : '\u23F8\uFE0F'}</button>
          <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-gray-800/50 border border-gray-700" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} title="Font size">
            <span className="text-gray-500 text-[8px] mr-0.5">Aa</span>
            {STREAM_FONT_SIZES.map((s) => (<button key={s} onClick={() => setFontSize(s)} className={`w-5 h-5 text-[9px] rounded transition-all ${fontSize === s ? 'bg-orange-500/30 text-orange-400 border border-orange-500/50' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'}`}>{s}</button>))}
          </div>
          {onOpacityChange && <OpacitySlider value={opacity} onChange={onOpacityChange} />}
          <button onClick={() => setConcatenatedEvents([])} className="text-gray-500 hover:text-red-400 text-xs transition-colors" title="Clear">{'\u{1F5D1}\uFE0F'}</button>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">{'\u00D7'}</button>
        </div>
      </div>
      <div ref={streamRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 min-h-0 font-mono flex flex-col z-10" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent', fontSize: `${fontSize}px` }}>
        {filteredEvents.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
            <div className="text-5xl mb-3" style={{ animation: 'streamFloat 3s ease-in-out infinite' }}>{'\u{1F9E0}'}</div>
            <p className="text-sm mb-1 animate-pulse">Waiting for thoughts...</p>
            <p className="text-xs text-gray-700">Stream will appear here</p>
          </div>
        ) : (
          <div className="mt-auto">
            {filteredEvents.map((event, i) => (<StreamThoughtItem key={`${event.timestamp}-${i}`} event={event} index={i} />))}
            {loopRunning && <span className="inline-block w-2 h-4 bg-orange-400 animate-pulse mt-1" />}
          </div>
        )}
      </div>
      {!autoScroll && filteredEvents.length > 0 && (
        <button onClick={toggleAutoScroll} className="absolute bottom-6 right-6 z-40 px-3 py-1.5 rounded-full font-bold text-xs text-white shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5" style={{ background: 'linear-gradient(135deg, #00bfff 0%, #a855f7 50%, #00bfff 100%)', backgroundSize: '200% 200%', animation: 'streamGradient 3s ease infinite', boxShadow: '0 4px 20px rgba(168, 85, 247, 0.4)' }}>
          <span>{'\u2B07\uFE0F'}</span><span>Jump to Live</span>
        </button>
      )}
      <div className="resize-handle absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex-shrink-0 z-40" onMouseDown={handleResizeStart} style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255, 149, 0, 0.3) 50%)' }} />
      <style>{`
        @keyframes streamThoughtPop { 0% { opacity: 0; transform: translateY(20px); filter: blur(1px); } 100% { opacity: 1; transform: translateY(0); filter: blur(0); } }
        @keyframes streamFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes streamParticleshimmer { 0% { opacity: 0; transform: translateY(0) scale(0); } 15% { opacity: 1; transform: translateY(-15px) scale(1.2); } 100% { opacity: 0; transform: translateY(-60px) scale(0.3); } }
        @keyframes streamParticlematrix { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-80px) scale(0.5); } }
        @keyframes streamParticlespark { 0% { opacity: 1; transform: scale(0); } 30% { opacity: 1; transform: scale(2); } 100% { opacity: 0; transform: scale(0.5); } }
        @keyframes streamGradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      `}</style>
    </div>,
    document.body
  )
}
