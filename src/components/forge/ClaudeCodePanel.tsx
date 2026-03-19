'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CLAUDE CODE PANEL — 2D overlay for full Claude Code sessions
// ─═̷─═̷─ॐ─═̷─═̷─ Player 1 speaks → Claude Code executes → Oasis transforms ─═̷─═̷─ॐ─═̷─═̷─
//
// Full Claude Code session rendered as a rich streaming UI.
// Multi-turn via --resume. Session survives page refresh.
// Tool calls, thinking blocks, diffs, cost tracking — everything visible.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { SettingsContext } from '../scene-lib'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES — Claude Code SSE event shapes
// ═══════════════════════════════════════════════════════════════════════════

interface CCSessionEvent { type: 'session'; sessionId: string }
interface CCStatusEvent { type: 'status'; content: string }
interface CCTextEvent { type: 'text'; content: string }
interface CCThinkingEvent { type: 'thinking'; content: string }
interface CCThinkingStartEvent { type: 'thinking_start' }
interface CCToolStartEvent { type: 'tool_start'; name: string; icon: string; id: string }
interface CCToolEvent { type: 'tool'; name: string; icon: string; id: string; input: Record<string, unknown>; display: string }
interface CCToolResultEvent { type: 'tool_result'; name: string; preview: string; isError: boolean; length: number; fullResult?: string; toolUseId?: string }
interface CCProgressEvent { type: 'progress'; inputTokens: number; outputTokens: number; stopReason?: string }
interface CCResultEvent { type: 'result'; costUsd: number; durationMs: number; sessionId: string }
interface CCErrorEvent { type: 'error'; content: string }
interface CCStderrEvent { type: 'stderr'; content: string }
interface CCDoneEvent { type: 'done'; success: boolean; sessionId: string; costUsd?: number; inputTokens?: number; outputTokens?: number }

type CCEvent =
  | CCSessionEvent | CCStatusEvent | CCTextEvent
  | CCThinkingEvent | CCThinkingStartEvent
  | CCToolStartEvent | CCToolEvent | CCToolResultEvent
  | CCProgressEvent | CCResultEvent
  | CCErrorEvent | CCStderrEvent | CCDoneEvent

// A single block in the conversation stream
interface StreamBlock {
  id: string
  kind: 'text' | 'thinking' | 'tool' | 'tool_result' | 'error' | 'status' | 'user'
  content: string
  // Tool-specific
  toolName?: string
  toolIcon?: string
  toolInput?: Record<string, unknown>
  toolDisplay?: string
  toolUseId?: string  // links tool calls to their results
  isError?: boolean
  isExpanded?: boolean
}

// A single turn (user prompt + Claude Code response)
interface Turn {
  id: string
  userPrompt: string
  blocks: StreamBlock[]
  isStreaming: boolean
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  timestamp: number
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE PARSER — generic async generator
// ═══════════════════════════════════════════════════════════════════════════

async function* parseCCSSE(response: Response): AsyncGenerator<CCEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'data: [DONE]') return
      if (!trimmed.startsWith('data: ')) continue
      try {
        yield JSON.parse(trimmed.slice(6)) as CCEvent
      } catch { /* skip malformed */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLAPSIBLE BLOCK — for thinking + tool results
// ═══════════════════════════════════════════════════════════════════════════

function CollapsibleBlock({
  label,
  icon,
  content,
  defaultOpen = false,
  accentColor = 'rgba(56,189,248,0.5)',
  isError = false,
}: {
  label: string
  icon: string
  content: string
  defaultOpen?: boolean
  accentColor?: string
  isError?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const borderColor = isError ? 'rgba(239,68,68,0.4)' : accentColor

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{
        border: `1px solid ${borderColor}`,
        background: isError ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono cursor-pointer hover:bg-white/5 transition-colors select-none"
      >
        <span className="text-[9px] transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span>{icon}</span>
        <span className="truncate" style={{ color: isError ? '#ef4444' : '#94a3b8' }}>{label}</span>
        {content.length > 200 && (
          <span className="ml-auto text-[9px] text-gray-600">{content.length} chars</span>
        )}
      </button>
      {open && (
        <div
          className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-all border-t max-h-[300px] overflow-y-auto"
          style={{
            borderColor,
            color: isError ? '#fca5a5' : '#cbd5e1',
            background: 'rgba(0,0,0,0.3)',
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 transparent',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CALL CARD — shows tool name, icon, args preview
// ═══════════════════════════════════════════════════════════════════════════

function ToolCallCard({
  name,
  icon,
  display,
  input,
  result,
}: {
  name: string
  icon: string
  display: string
  input?: Record<string, unknown>
  result?: { preview: string; isError: boolean; length: number; fullResult?: string }
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = input && Object.keys(input).length > 0
  const isFileOp = ['Read', 'Edit', 'Write'].includes(name)
  const filePath = input?.file_path as string | undefined

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: `1px solid ${result ? (result.isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') : 'rgba(56,189,248,0.3)'}`,
      background: result ? (result.isError ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)') : 'rgba(56,189,248,0.05)',
    }}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono transition-colors select-none ${hasDetails ? 'cursor-pointer hover:bg-white/5' : ''}`}
      >
        <span>{icon}</span>
        <span className="font-bold" style={{
          color: result ? (result.isError ? '#ef4444' : '#22c55e') : '#38bdf8',
        }}>{name}</span>
        {isFileOp && filePath && (
          <span className="text-gray-400 truncate max-w-[200px]">{String(filePath).split(/[/\\]/).slice(-2).join('/')}</span>
        )}
        {!isFileOp && (
          <span className="text-gray-500 truncate max-w-[200px]">{display.replace(`${name}: `, '')}</span>
        )}
        {result && !result.isError && <span className="ml-auto text-green-500">✓</span>}
        {result && result.isError && <span className="ml-auto text-red-400 text-[10px]">✗</span>}
        {!result && (
          <span className="ml-auto w-3 h-3 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
        )}
        {hasDetails && (
          <span className="text-[9px] text-gray-600 ml-1">{expanded ? '▼' : '▶'}</span>
        )}
      </button>

      {/* Expanded input */}
      {expanded && hasDetails && (
        <div className="px-3 py-2 text-[10px] font-mono text-gray-400 border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap"
          style={{ background: 'rgba(0,0,0,0.3)', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}
        >
          {name === 'Edit' && input?.old_string && input?.new_string ? (
            <>
              <div className="text-red-400/70 mb-1">- {String(input.old_string)}</div>
              <div className="text-green-400/70">+ {String(input.new_string)}</div>
            </>
          ) : name === 'Bash' && input?.command ? (
            <span className="text-amber-300">$ {String(input.command)}</span>
          ) : (
            JSON.stringify(input, null, 2)
          )}
        </div>
      )}

      {/* Tool result */}
      {expanded && result && result.preview && (
        <div
          className="px-3 py-2 text-[10px] font-mono border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap"
          style={{
            color: result.isError ? '#fca5a5' : '#94a3b8',
            background: 'rgba(0,0,0,0.2)',
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 transparent',
          }}
        >
          {result.fullResult || result.preview}
          {result.length > 2000 && !result.fullResult && (
            <span className="text-gray-600"> ... ({result.length} chars total)</span>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL SELECTOR — dropdown for model choice
// ═══════════════════════════════════════════════════════════════════════════

const MODELS = [
  { id: 'opus', label: 'Opus', color: '#a855f7' },
  { id: 'sonnet', label: 'Sonnet', color: '#38bdf8' },
  { id: 'haiku', label: 'Haiku', color: '#22c55e' },
]

// ═══════════════════════════════════════════════════════════════════════════
// ARIEL PANEL — Main component
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_POS = { x: 60, y: 60 }
const MIN_WIDTH = 420
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 650

const SESSION_KEY = 'oasis-claude-code-session'
const POS_KEY = 'oasis-claude-code-pos'
const SIZE_KEY = 'oasis-claude-code-size'

export function ClaudeCodePanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { settings } = useContext(SettingsContext)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(SESSION_KEY) || '' } catch { return '' }
  })
  const [model, setModel] = useState('opus')
  const [totalCost, setTotalCost] = useState(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ─═̷─ Drag state ─═̷─
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    try {
      const saved = localStorage.getItem(POS_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_POS
    } catch { return DEFAULT_POS }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  // ─═̷─ Resize state ─═̷─
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    try {
      const saved = localStorage.getItem(SIZE_KEY)
      return saved ? JSON.parse(saved) : { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT }
    } catch { return { w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT } }
  })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  // ─═̷─ Drag handlers ─═̷─
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea, select, input')) return
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
    setSize({ w: newW, h: newH })
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: newW, h: newH }))
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

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  // Focus input
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100)
  }, [isOpen])

  // ─═̷─═̷─ INVOKE ARIEL ─═̷─═̷─
  const invoke = useCallback(async () => {
    if (!input.trim() || isStreaming) return
    const userPrompt = input.trim()
    setInput('')

    const turnId = `turn-${Date.now()}`
    const newTurn: Turn = {
      id: turnId,
      userPrompt,
      blocks: [],
      isStreaming: true,
      timestamp: Date.now(),
    }

    setTurns(prev => [...prev, newTurn])
    setIsStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    // Accumulate blocks for this turn
    let blocks: StreamBlock[] = []
    let currentTextBlock: StreamBlock | null = null
    let currentThinkingBlock: StreamBlock | null = null
    // Map tool IDs to their block + result
    const toolBlocks = new Map<string, { block: StreamBlock; result?: CCToolResultEvent }>()
    let turnCost = 0
    let turnInputTokens = 0
    let turnOutputTokens = 0

    function updateTurn() {
      setTurns(prev => prev.map(t =>
        t.id === turnId ? {
          ...t,
          blocks: [...blocks],
          costUsd: turnCost,
          inputTokens: turnInputTokens,
          outputTokens: turnOutputTokens,
        } : t
      ))
    }

    try {
      const res = await fetch('/api/claude-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          sessionId: sessionId || undefined,
          model,
        }),
        signal: abort.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        blocks.push({ id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'error', content: `Error ${res.status}: ${errText}` })
        updateTurn()
        setIsStreaming(false)
        return
      }

      for await (const event of parseCCSSE(res)) {
        if (abort.signal.aborted) break

        switch (event.type) {
          case 'session': {
            setSessionId(event.sessionId)
            localStorage.setItem(SESSION_KEY, event.sessionId)
            break
          }
          case 'status': {
            blocks.push({ id: `status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'status', content: event.content })
            break
          }
          case 'text': {
            if (!currentTextBlock) {
              currentTextBlock = { id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'text', content: '' }
              blocks.push(currentTextBlock)
            }
            currentTextBlock.content += event.content
            break
          }
          case 'thinking_start': {
            currentTextBlock = null // end any text block
            currentThinkingBlock = { id: `think-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'thinking', content: '' }
            blocks.push(currentThinkingBlock)
            break
          }
          case 'thinking': {
            if (!currentThinkingBlock) {
              currentThinkingBlock = { id: `think-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'thinking', content: '' }
              blocks.push(currentThinkingBlock)
            }
            // Replace, not append — server sends full thinking content each time
            currentThinkingBlock.content = event.content
            break
          }
          case 'tool_start': {
            currentTextBlock = null
            currentThinkingBlock = null
            const toolBlock: StreamBlock = {
              id: event.id || `tool-${Date.now()}`,
              kind: 'tool',
              content: '',
              toolName: event.name,
              toolIcon: event.icon,
            }
            blocks.push(toolBlock)
            toolBlocks.set(toolBlock.id, { block: toolBlock })
            break
          }
          case 'tool': {
            // End text/thinking blocks — tool call starts a new phase
            currentTextBlock = null
            currentThinkingBlock = null
            // Complete tool call — check if we already have it from tool_start
            const existing = toolBlocks.get(event.id)
            if (existing) {
              existing.block.toolDisplay = event.display
              existing.block.toolInput = event.input
              existing.block.content = event.display
            } else {
              // New tool (no tool_start preceded it — normal for new API)
              const toolBlock: StreamBlock = {
                id: event.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'tool',
                content: event.display,
                toolName: event.name,
                toolIcon: event.icon,
                toolDisplay: event.display,
                toolInput: event.input,
                toolUseId: event.id,
              }
              blocks.push(toolBlock)
              toolBlocks.set(toolBlock.id, { block: toolBlock })
            }
            break
          }
          case 'tool_result': {
            // Reset text/thinking — new assistant response follows tool results
            currentTextBlock = null
            currentThinkingBlock = null
            const resultBlock: StreamBlock = {
              id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'tool_result',
              content: event.fullResult || event.preview,
              toolName: event.name,
              toolUseId: event.toolUseId,
              isError: event.isError,
            }
            blocks.push(resultBlock)
            break
          }
          case 'progress': {
            turnInputTokens = event.inputTokens
            turnOutputTokens = event.outputTokens
            break
          }
          case 'result': {
            turnCost = event.costUsd
            break
          }
          case 'error': {
            blocks.push({ id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'error', content: event.content })
            break
          }
          case 'stderr': {
            // Only show meaningful stderr
            if (event.content && !event.content.includes('keepalive')) {
              blocks.push({ id: `stderr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'status', content: event.content })
            }
            break
          }
          case 'done': {
            if (event.sessionId) {
              setSessionId(event.sessionId)
              localStorage.setItem(SESSION_KEY, event.sessionId)
            }
            if (event.costUsd) turnCost = event.costUsd
            if (event.inputTokens) turnInputTokens = event.inputTokens
            if (event.outputTokens) turnOutputTokens = event.outputTokens
            break
          }
        }

        updateTurn()
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        blocks.push({ id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'error', content: (err as Error).message })
        updateTurn()
      }
    } finally {
      setTurns(prev => prev.map(t =>
        t.id === turnId ? { ...t, isStreaming: false, costUsd: turnCost, inputTokens: turnInputTokens, outputTokens: turnOutputTokens } : t
      ))
      setTotalCost(prev => prev + turnCost)
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, sessionId, model])

  // Cancel
  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  // New session
  const newSession = useCallback(() => {
    if (isStreaming) return
    setSessionId('')
    setTurns([])
    setTotalCost(0)
    localStorage.removeItem(SESSION_KEY)
  }, [isStreaming])

  if (!isOpen || typeof document === 'undefined') return null

  const modelColor = MODELS.find(m => m.id === model)?.color || '#a855f7'

  // ─═̷─═̷─ RENDER ─═̷─═̷─
  return createPortal(
    <div
      data-menu-portal="claude-code-panel"
      className="fixed z-[9999] rounded-xl flex flex-col overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        backgroundColor: `rgba(8, 10, 15, ${Math.min(0.98, (settings.uiOpacity || 0.85) + 0.1)})`,
        border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        boxShadow: isStreaming
          ? `0 0 40px rgba(56,189,248,0.2), inset 0 0 60px rgba(56,189,248,0.03)`
          : '0 8px 40px rgba(0,0,0,0.8)',
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
            ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(0,0,0,0) 100%)'
            : 'rgba(20,20,30,0.5)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-base ${isStreaming ? 'animate-pulse' : ''}`}>💻</span>
          <span className="text-sky-400 font-bold text-sm tracking-wide">Claude Code</span>
          {sessionId && (
            <span className="text-[9px] text-gray-600 font-mono" title={sessionId}>
              {sessionId.slice(0, 8)}...
            </span>
          )}
          {isStreaming && (
            <span className="text-[10px] text-sky-300 animate-pulse font-mono">
              ● executing
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Model selector */}
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={isStreaming}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: modelColor }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          {/* Cost indicator */}
          {totalCost > 0 && (
            <span className="text-[9px] text-gray-500 font-mono" title="Total session cost">
              ${totalCost.toFixed(3)}
            </span>
          )}

          {/* New session */}
          <button
            onClick={newSession}
            disabled={isStreaming}
            className="text-[10px] text-gray-500 hover:text-sky-400 px-1.5 py-0.5 rounded border border-gray-800 hover:border-sky-500/30 transition-all cursor-pointer disabled:opacity-30"
            title="New session"
          >
            +new
          </button>

          {/* Stop */}
          {isStreaming && (
            <button
              onClick={cancel}
              className="px-2 py-0.5 rounded text-[10px] font-mono text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all cursor-pointer"
            >
              stop
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors text-lg leading-none cursor-pointer"
          >
            ×
          </button>
        </div>
      </div>

      {/* ═══ STREAM ═══ */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2 space-y-4 min-h-0"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
      >
        {/* Empty state */}
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-4xl mb-3" style={{ animation: 'ccFloat 3s ease-in-out infinite' }}>💻</span>
            <p className="text-sm mb-1 text-sky-400/80">Claude Code</p>
            <p className="text-[11px] text-gray-500 text-center px-6 leading-relaxed">
              Full Claude Code agent inside the Oasis.<br />
              Read, edit, write, bash, grep — anything.<br />
              You ARE inside the app you&apos;re editing.
            </p>
            <div className="mt-4 space-y-1.5 text-[10px] text-gray-600 font-mono">
              <p className="text-sky-500/50">try:</p>
              <p className="cursor-pointer hover:text-sky-400 transition-colors" onClick={() => setInput('read CLAUDE.md and give me the tldr')}>
                &quot;read CLAUDE.md and give me the tldr&quot;
              </p>
              <p className="cursor-pointer hover:text-sky-400 transition-colors" onClick={() => setInput('run pnpm build and show me if there are any errors')}>
                &quot;run pnpm build and show me any errors&quot;
              </p>
              <p className="cursor-pointer hover:text-sky-400 transition-colors" onClick={() => setInput('what files have been modified? show me git status')}>
                &quot;what files have been modified? git status&quot;
              </p>
            </div>
            {sessionId && (
              <p className="mt-4 text-[9px] text-gray-700 font-mono">
                Previous session: {sessionId.slice(0, 12)}... (will resume)
              </p>
            )}
          </div>
        )}

        {/* Turns */}
        {turns.map(turn => (
          <div key={turn.id} className="space-y-2">
            {/* User prompt */}
            <div className="flex justify-end">
              <div
                className="max-w-[85%] px-3 py-2 rounded-lg text-xs text-gray-200 whitespace-pre-wrap"
                style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.2)' }}
              >
                {turn.userPrompt}
              </div>
            </div>

            {/* Stream blocks */}
            <div className="space-y-1.5 pl-1">
              {turn.blocks.map(block => {
                switch (block.kind) {
                  case 'text':
                    return (
                      <div key={block.id} className="text-[12px] text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">
                        {block.content}
                      </div>
                    )
                  case 'thinking':
                    return (
                      <CollapsibleBlock
                        key={block.id}
                        label={`thinking (${block.content.length} chars)`}
                        icon="🧠"
                        content={block.content}
                        accentColor="rgba(168,85,247,0.4)"
                      />
                    )
                  case 'tool': {
                    // Find matching tool_result by toolUseId or by sequential order
                    const toolIdx = turn.blocks.indexOf(block)
                    const resultBlock = turn.blocks.find((b, i) =>
                      b.kind === 'tool_result' && i > toolIdx &&
                      (b.toolUseId && block.toolUseId
                        ? b.toolUseId === block.toolUseId
                        : !turn.blocks.slice(toolIdx + 1, i).some(x => x.kind === 'tool'))
                    )
                    return (
                      <ToolCallCard
                        key={block.id}
                        name={block.toolName || 'tool'}
                        icon={block.toolIcon || '🔧'}
                        display={block.toolDisplay || block.content}
                        input={block.toolInput}
                        result={resultBlock ? {
                          preview: resultBlock.content.substring(0, 500),
                          isError: !!resultBlock.isError,
                          length: resultBlock.content.length,
                          fullResult: resultBlock.content.length <= 2000 ? resultBlock.content : undefined,
                        } : undefined}
                      />
                    )
                  }
                  case 'tool_result':
                    // Rendered inline with tool card — skip standalone render
                    return null
                  case 'error':
                    return (
                      <div key={block.id} className="text-[11px] text-red-400 font-mono px-2 py-1.5 rounded-lg"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        {block.content}
                      </div>
                    )
                  case 'status':
                    return (
                      <div key={block.id} className="text-[10px] text-gray-600 font-mono italic">
                        {block.content}
                      </div>
                    )
                  default:
                    return null
                }
              })}

              {/* Streaming indicator */}
              {turn.isStreaming && (
                <div className="flex items-center gap-2 text-[10px] text-sky-400/60 font-mono py-1">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                  working...
                </div>
              )}

              {/* Turn metadata */}
              {!turn.isStreaming && (turn.costUsd || turn.inputTokens) && (
                <div className="flex items-center gap-3 text-[9px] text-gray-600 font-mono pt-1 border-t border-white/5">
                  {turn.costUsd !== undefined && turn.costUsd > 0 && <span>${turn.costUsd.toFixed(4)}</span>}
                  {turn.inputTokens !== undefined && turn.inputTokens > 0 && (
                    <span>{Math.round(turn.inputTokens / 1000)}K in / {Math.round((turn.outputTokens || 0) / 1000)}K out</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ═══ INPUT ═══ */}
      <div className="px-3 py-2 border-t border-white/10">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                invoke()
              }
            }}
            placeholder={isStreaming ? 'Working...' : 'Command Claude Code...'}
            rows={1}
            className="flex-1 px-3 py-2 rounded-lg text-white text-xs outline-none placeholder-gray-600 resize-none font-mono"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.3)' : 'rgba(56,189,248,0.12)'}`,
              minHeight: '36px',
              maxHeight: '120px',
            }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : invoke}
            disabled={!isStreaming && !input.trim()}
            className="px-3 py-2 rounded-lg text-xs font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 self-end"
            style={{
              background: isStreaming
                ? 'rgba(239,68,68,0.4)'
                : 'linear-gradient(135deg, rgba(56,189,248,0.4) 0%, rgba(96,165,250,0.4) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.5)' : 'rgba(56,189,248,0.3)'}`,
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
          background: 'linear-gradient(135deg, transparent 50%, rgba(56,189,248,0.3) 50%)',
          borderRadius: '0 0 12px 0',
        }}
      />

      {/* ═══ ANIMATIONS ═══ */}
      <style>{`
        @keyframes ccFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-5px) rotate(2deg); }
          75% { transform: translateY(-3px) rotate(-2deg); }
        }
      `}</style>
    </div>,
    document.body
  )
}
