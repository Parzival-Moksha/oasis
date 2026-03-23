'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// MERLIN PANEL — The World-Builder Agent's Consciousness Stream
// ─═̷─═̷─ॐ─═̷─═̷─ Words → Tools → World ─═̷─═̷─ॐ─═̷─═̷─
//
// Chat-style interface that invokes POST /api/merlin with SSE streaming.
// Displays text thoughts, tool calls, results, and save confirmations.
// World updates arrive via polling after Merlin saves to Prisma/SQLite.
//
// Pattern: Chat + SSE streaming + tool call display.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useOasisStore } from '@/store/oasisStore'
import { SettingsContext } from '../scene-lib'
import { dispatch } from '@/lib/event-bus'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES — Merlin SSE event shapes
// ═══════════════════════════════════════════════════════════════════════════

interface MerlinTextEvent { type: 'text'; content: string }
interface MerlinToolEvent { type: 'tool'; name: string; args: Record<string, unknown> }
interface MerlinResultEvent { type: 'result'; name: string; ok: boolean; message: string }
interface MerlinSaveEvent { type: 'save'; savedAt: string }
interface MerlinDoneEvent { type: 'done'; worldId: string }
interface MerlinErrorEvent { type: 'error'; message: string }

type MerlinEvent =
  | MerlinTextEvent
  | MerlinToolEvent
  | MerlinResultEvent
  | MerlinSaveEvent
  | MerlinDoneEvent
  | MerlinErrorEvent

// Chat-level message (aggregated from events)
interface MerlinMessage {
  id: string
  role: 'user' | 'merlin'
  content: string
  events?: MerlinEvent[]
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL ICONS — visual shorthand for each Merlin tool
// ═══════════════════════════════════════════════════════════════════════════

const TOOL_ICONS: Record<string, string> = {
  add_catalog_object: '📦',
  remove_object: '🗑️',
  add_crafted_scene: '⚒️',
  add_light: '💡',
  set_sky: '🌅',
  set_ground: '🌿',
  set_behavior: '🎭',
  clear_world: '💀',
}

const TOOL_LABELS: Record<string, string> = {
  add_catalog_object: 'Place',
  remove_object: 'Remove',
  add_crafted_scene: 'Craft',
  add_light: 'Light',
  set_sky: 'Sky',
  set_ground: 'Ground',
  set_behavior: 'Animate',
  clear_world: 'Clear',
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE PARSER — reads the ReadableStream from /api/merlin
// ═══════════════════════════════════════════════════════════════════════════

async function* parseMerlinSSE(response: Response): AsyncGenerator<MerlinEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const json = trimmed.slice(6)
      try {
        yield JSON.parse(json) as MerlinEvent
      } catch {
        // malformed JSON chunk — skip
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim().startsWith('data: ')) {
    try {
      yield JSON.parse(buffer.trim().slice(6)) as MerlinEvent
    } catch { /* skip */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CALL RENDERER — compact card for each tool invocation
// ═══════════════════════════════════════════════════════════════════════════

function ToolCallCard({ event, result }: { event: MerlinToolEvent; result?: MerlinResultEvent }) {
  const icon = TOOL_ICONS[event.name] || '🔧'
  const label = TOOL_LABELS[event.name] || event.name
  const ok = result?.ok

  // Extract the most useful arg for display
  const summary = event.name === 'add_catalog_object'
    ? (event.args.catalogId as string) || ''
    : event.name === 'set_sky'
      ? (event.args.presetId as string) || ''
      : event.name === 'set_ground'
        ? (event.args.presetId as string) || ''
        : event.name === 'add_crafted_scene'
          ? (event.args.name as string) || ''
          : event.name === 'add_light'
            ? (event.args.type as string) || ''
            : ''

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all"
      style={{
        background: ok === true ? 'rgba(34,197,94,0.1)' : ok === false ? 'rgba(239,68,68,0.1)' : 'rgba(168,85,247,0.1)',
        border: `1px solid ${ok === true ? 'rgba(34,197,94,0.3)' : ok === false ? 'rgba(239,68,68,0.3)' : 'rgba(168,85,247,0.3)'}`,
      }}
    >
      <span className="text-sm">{icon}</span>
      <span style={{ color: ok === true ? '#22c55e' : ok === false ? '#ef4444' : '#a855f7' }}>
        {label}
      </span>
      {summary && (
        <span className="text-gray-400 truncate max-w-[140px]">{summary}</span>
      )}
      {ok === true && <span className="text-green-500 ml-auto">✓</span>}
      {ok === false && <span className="text-red-400 ml-auto text-[10px] truncate max-w-[120px]">{result?.message}</span>}
      {ok === undefined && (
        <span className="ml-auto w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MERLIN PANEL — Main component
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 16, y: 120 }
const MIN_WIDTH = 320
const MIN_HEIGHT = 300
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 520

export function MerlinPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings } = useContext(SettingsContext)
  const [messages, setMessages] = useState<MerlinMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolCount, setToolCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeWorldName = useOasisStore(s => s.worldRegistry.find((w: { id: string; name: string }) => w.id === s.activeWorldId)?.name || 'unknown')

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem('oasis-merlin-pos')
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  // ─═̷─ Resize state ─═̷─
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem('oasis-merlin-size')
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
  }, [position])

  const handleDrag = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    const newPos = { x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }
    setPosition(newPos)
    localStorage.setItem('oasis-merlin-pos', JSON.stringify(newPos))
  }, [isDragging])

  const handleDragEnd = useCallback(() => setIsDragging(false), [])

  // ─═̷─ Resize handlers ─═̷─
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }, [size])

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const newW = Math.max(MIN_WIDTH, resizeStart.current.w + (e.clientX - resizeStart.current.x))
    const newH = Math.max(MIN_HEIGHT, resizeStart.current.h + (e.clientY - resizeStart.current.y))
    const newSize = { w: newW, h: newH }
    setSize(newSize)
    localStorage.setItem('oasis-merlin-size', JSON.stringify(newSize))
  }, [isResizing])

  const handleResizeEnd = useCallback(() => setIsResizing(false), [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', handleDragEnd)
    }
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', handleDragEnd)
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isDragging, handleDrag, handleDragEnd, isResizing, handleResize, handleResizeEnd])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100)
  }, [isOpen])

  // ─═̷─═̷─ INVOKE MERLIN ─═̷─═̷─
  const invoke = useCallback(async () => {
    const worldId = useOasisStore.getState().activeWorldId
    if (!input.trim() || !worldId || isStreaming) return

    const userPrompt = input.trim()
    setInput('')
    setToolCount(0)

    // Add user message
    const userId = `user-${Date.now()}`
    setMessages(prev => [...prev, {
      id: userId,
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    }])

    // Add Merlin placeholder (will accumulate events)
    const merlinId = `merlin-${Date.now()}`
    const merlinMsg: MerlinMessage = {
      id: merlinId,
      role: 'merlin',
      content: '',
      events: [],
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, merlinMsg])
    setIsStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/merlin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId, prompt: userPrompt }),
        signal: abort.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: `Error ${res.status}: ${errText}` } : m
        ))
        setIsStreaming(false)
        return
      }

      let textAccumulator = ''
      let toolEvents: MerlinEvent[] = []
      let tools = 0

      for await (const event of parseMerlinSSE(res)) {
        if (abort.signal.aborted) break

        switch (event.type) {
          case 'text':
            textAccumulator += event.content
            break
          case 'tool':
            tools++
            setToolCount(tools)
            toolEvents = [...toolEvents, event]
            break
          case 'result':
            toolEvents = [...toolEvents, event]
            // Reload world after each Merlin tool result (objects appear in real-time)
            dispatch({ type: 'LOAD_WORLD' })
            break
          case 'error':
            textAccumulator += `\n⚠️ ${event.message}`
            break
          case 'done':
            // Reload world state from SQLite so Merlin's changes appear instantly
            dispatch({ type: 'LOAD_WORLD' })
            break
        }

        // Update the Merlin message in place
        const updatedEvents = [...toolEvents]
        const updatedText = textAccumulator
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: updatedText, events: updatedEvents } : m
        ))
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === merlinId ? { ...m, content: m.content + `\n⚠️ ${(err as Error).message}` } : m
        ))
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming])

  // Cancel streaming
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  if (!isOpen || typeof document === 'undefined') return null

  // ─═̷─═̷─ RENDER ─═̷─═̷─
  return createPortal(
    <div
      data-menu-portal="merlin-panel"
      className="fixed z-[9998] rounded-xl flex flex-col overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        backgroundColor: `rgba(0, 0, 0, ${settings.uiOpacity})`,
        border: `1px solid ${isStreaming ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.25)'}`,
        boxShadow: isStreaming
          ? '0 0 30px rgba(168,85,247,0.3), inset 0 0 40px rgba(168,85,247,0.05)'
          : '0 8px 32px rgba(0,0,0,0.6)',
        transition: 'box-shadow 0.5s, border-color 0.5s',
      }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
        style={{
          background: isStreaming
            ? 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(30,30,30,0.3)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-lg ${isStreaming ? 'animate-pulse' : ''}`}>🧙</span>
          <span className="text-purple-400 font-bold text-sm">Merlin</span>
          <span className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]" title={activeWorldName}>
            → {activeWorldName}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-purple-300 animate-pulse font-mono">
              ● building ({toolCount} tools)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isStreaming && (
            <button
              onClick={cancel}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer"
            >
              stop
            </button>
          )}
          <button
            onClick={() => { setMessages([]); setToolCount(0) }}
            className="text-gray-500 hover:text-red-400 text-xs transition-colors cursor-pointer"
            title="Clear history"
          >
            🗑️
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
      </div>

      {/* ═══ MESSAGES ═══ */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-4xl mb-3" style={{ animation: 'merlinFloat 3s ease-in-out infinite' }}>🧙</span>
            <p className="text-sm mb-1">I am Merlin.</p>
            <p className="text-xs text-gray-600 text-center px-4">
              Tell me what to build and I shall conjure it into existence.
            </p>
            <div className="mt-4 space-y-1 text-[10px] text-gray-600 font-mono">
              <p className="text-purple-500/60">try:</p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('build a medieval village with a central fountain')}>
                &quot;build a medieval village with a fountain&quot;
              </p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('create a cozy forest clearing with campfire and lanterns')}>
                &quot;forest clearing with campfire and lanterns&quot;
              </p>
              <p className="cursor-pointer hover:text-purple-400 transition-colors" onClick={() => setInput('set the sky to sunset and ground to grass, then place 10 random trees')}>
                &quot;sunset sky, grass, 10 random trees&quot;
              </p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              // User message
              <div className="flex justify-end">
                <div
                  className="max-w-[85%] px-3 py-2 rounded-lg text-xs text-gray-200"
                  style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.2)' }}
                >
                  {msg.content}
                </div>
              </div>
            ) : (
              // Merlin message
              <div className="space-y-1.5">
                {/* Text content */}
                {msg.content && (
                  <div className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
                    {msg.content}
                  </div>
                )}

                {/* Tool calls */}
                {msg.events && msg.events.length > 0 && (
                  <div className="space-y-1">
                    {/* Pair tool events with their immediately following results */}
                    {(() => {
                      const pairs: Array<{ tool: MerlinToolEvent; result?: MerlinResultEvent }> = []
                      for (let i = 0; i < msg.events!.length; i++) {
                        const e = msg.events![i]
                        if (e.type === 'tool') {
                          const next = msg.events![i + 1]
                          const result = next?.type === 'result' ? next as MerlinResultEvent : undefined
                          pairs.push({ tool: e as MerlinToolEvent, result })
                        }
                      }
                      return pairs.map((pair, i) => (
                        <ToolCallCard key={`tool-${i}`} event={pair.tool} result={pair.result} />
                      ))
                    })()}
                  </div>
                )}

                {/* Streaming indicator */}
                {isStreaming && msg === messages[messages.length - 1] && (
                  <div className="flex items-center gap-2 text-[10px] text-purple-400/60 font-mono">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    thinking...
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ═══ INPUT ═══ */}
      <div className="px-3 py-2 border-t border-white/10">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invoke() } }}
            maxLength={1000}
            placeholder={isStreaming ? 'Merlin is building...' : 'Tell Merlin what to build...'}
            className="flex-1 px-3 py-2 rounded-lg text-white text-xs outline-none placeholder-gray-600"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${isStreaming ? 'rgba(168,85,247,0.3)' : 'rgba(168,85,247,0.15)'}`,
            }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : invoke}
            disabled={!isStreaming && !input.trim()}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
            style={{
              background: isStreaming
                ? 'rgba(239,68,68,0.4)'
                : 'linear-gradient(135deg, rgba(168,85,247,0.5) 0%, rgba(139,92,246,0.5) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.5)' : 'rgba(168,85,247,0.4)'}`,
            }}
          >
            {isStreaming ? '■' : '▸'}
          </button>
        </div>
      </div>

      {/* ═══ RESIZE HANDLE ═══ */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          background: 'linear-gradient(135deg, transparent 50%, rgba(168,85,247,0.4) 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />

      {/* ═══ ANIMATIONS ═══ */}
      <style>{`
        @keyframes merlinFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>,
    document.body
  )
}
