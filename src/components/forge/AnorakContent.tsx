'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK CONTENT — Shared streaming UI for 2D panel and 3D windows
// ─═̷─═̷─ॐ─═̷─═̷─ One component, two contexts. No duplication. ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import {
  type AnorakToolResultEvent,
  type StreamBlock,
  type Turn,
  type SessionEntry,
  type HistoryMessage,
  parseAnorakSSE,
  TOOL_ICONS_MAP,
  fmtTokens,
} from '../../lib/anorak-engine'

// ═══════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════

export interface AnorakContentProps {
  /** Compact mode for 3D windows (smaller text, tighter spacing) */
  compact?: boolean
  /** Initial session ID to resume */
  initialSessionId?: string
  /** Window ID for 3D windows (used for duplicate session detection) */
  windowId?: string
  /** Whether the 3D window is focused (auto-focus textarea) */
  isFocused?: boolean
  /** Opacity override from settings (2D panel uses this) */
  opacity?: number
  /** Callback when session ID changes */
  onSessionChange?: (sessionId: string) => void
  /** Show session picker dropdown */
  showSessionControls?: boolean
  /** Controlled session picker visibility (from parent header button) */
  sessionPickerOpen?: boolean
  /** Callback when session picker visibility changes */
  onSessionPickerChange?: (open: boolean) => void
  /** Callback to set streaming state on parent (for border glow etc.) */
  onStreamingChange?: (streaming: boolean) => void
  /** Controlled model value from parent header selector */
  model?: string
  /** Callback to set model on parent (for header color) */
  onModelChange?: (model: string) => void
  /** Callback to set total cost on parent */
  onCostChange?: (cost: number) => void
  /** Callback to set live tokens on parent */
  onLiveTokensChange?: (tokens: { input: number; output: number }) => void
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION KEY — localStorage key for 2D panel session persistence
// ═══════════════════════════════════════════════════════════════════════════

const SESSION_KEY = 'oasis-anorak-session'

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
  compact = false,
}: {
  label: string
  icon: string
  content: string
  defaultOpen?: boolean
  accentColor?: string
  isError?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const borderColor = isError ? 'rgba(239,68,68,0.4)' : accentColor
  const textSize = compact ? 'text-[10px]' : 'text-[11px]'
  const labelSize = compact ? 'text-[8px]' : 'text-[9px]'

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
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${textSize} font-mono cursor-pointer hover:bg-white/5 transition-colors select-none`}
      >
        <span className={`${labelSize} transition-transform`} style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span>{icon}</span>
        <span className="truncate" style={{ color: isError ? '#ef4444' : '#94a3b8' }}>{label}</span>
        {content.length > 200 && (
          <span className={`ml-auto ${labelSize} text-gray-600`}>{content.length} chars</span>
        )}
      </button>
      {open && (
        <div
          className={`px-3 py-2 ${textSize} font-mono whitespace-pre-wrap break-all border-t max-h-[300px] overflow-y-auto`}
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
// TOOL CALL CARD — expandable with input details
// ═══════════════════════════════════════════════════════════════════════════

function ToolCallCard({
  name,
  icon,
  display,
  input,
  result,
  compact = false,
}: {
  name: string
  icon: string
  display: string
  input?: Record<string, unknown>
  result?: { preview: string; isError: boolean; length: number; fullResult?: string }
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = input && Object.keys(input).length > 0
  const isFileOp = ['Read', 'Edit', 'Write'].includes(name)
  const filePath = input?.file_path as string | undefined
  const textSize = compact ? 'text-[10px]' : 'text-[11px]'
  const detailSize = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: `1px solid ${result ? (result.isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') : 'rgba(56,189,248,0.3)'}`,
      background: result ? (result.isError ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)') : 'rgba(56,189,248,0.05)',
    }}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 ${textSize} font-mono transition-colors select-none ${hasDetails ? 'cursor-pointer hover:bg-white/5' : ''}`}
      >
        <span>{icon}</span>
        <span className="font-bold" style={{
          color: result ? (result.isError ? '#ef4444' : '#22c55e') : '#38bdf8',
        }}>{name}</span>
        {isFileOp && filePath && (
          <span className="text-gray-400 truncate flex-1 min-w-0">{String(filePath).split(/[/\\]/).slice(-2).join('/')}</span>
        )}
        {!isFileOp && (
          <span className="text-gray-500 truncate flex-1 min-w-0">{display.replace(`${name}: `, '')}</span>
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
        <div className={`px-3 py-2 ${detailSize} font-mono text-gray-400 border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap`}
          style={{ background: 'rgba(0,0,0,0.3)', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}
        >
          {name === 'Edit' && input?.old_string && input?.new_string ? (
            <>
              <div className="text-red-400/70 mb-1">- {String(input.old_string)}</div>
              <div className="text-green-400/70">+ {String(input.new_string)}</div>
            </>
          ) : name === 'Bash' && input?.command ? (
            <span className="text-amber-300">$ {String(input.command)}</span>
          ) : name === 'TodoWrite' && input?.todos ? (
            <div className="space-y-0.5">
              {(input.todos as Array<{ content: string; status: string }>).map((todo, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={
                    todo.status === 'completed' ? 'text-green-400'
                    : todo.status === 'in_progress' ? 'text-amber-400'
                    : 'text-gray-600'
                  }>
                    {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}
                  </span>
                  <span className={
                    todo.status === 'completed' ? 'text-green-400/70 line-through'
                    : todo.status === 'in_progress' ? 'text-amber-300'
                    : 'text-gray-400'
                  }>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          ) : name === 'Grep' && input?.pattern ? (
            <span className="text-cyan-300">/{String(input.pattern)}/ <span className="text-gray-500">in {String(input.path || '.')}</span></span>
          ) : name === 'Glob' && input?.pattern ? (
            <span className="text-cyan-300">{String(input.pattern)}</span>
          ) : name === 'Read' && input?.file_path ? (
            <span className="text-blue-300">{String(input.file_path)}{input.offset ? ` :${input.offset}` : ''}{input.limit ? `-${Number(input.offset || 0) + Number(input.limit)}` : ''}</span>
          ) : name === 'Write' && input?.file_path ? (
            <>
              <div className="text-blue-300 mb-1">{String(input.file_path)}</div>
              {input.content && <div className="text-green-400/50 max-h-[100px] overflow-hidden">{String(input.content).substring(0, 500)}</div>}
            </>
          ) : name === 'Agent' && input?.prompt ? (
            <>
              {input.description && <div className="text-purple-300 mb-1">{String(input.description)}</div>}
              <div className="text-gray-400">{String(input.prompt).substring(0, 300)}{String(input.prompt).length > 300 ? '...' : ''}</div>
            </>
          ) : (
            JSON.stringify(input, null, 2)
          )}
        </div>
      )}

      {/* Tool result */}
      {expanded && result && result.preview && (
        <div
          className={`px-3 py-2 ${detailSize} font-mono border-t border-white/5 max-h-[200px] overflow-y-auto whitespace-pre-wrap`}
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
// LIGHTWEIGHT MARKDOWN — no deps, handles Claude's common output patterns
// ═══════════════════════════════════════════════════════════════════════════

function renderInline(text: string): React.ReactNode {
  // Single-pass tokenizer: find the EARLIEST marker in the string and process it
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Find earliest marker position
    const codeIdx = remaining.indexOf('`')
    const boldIdx = remaining.indexOf('**')

    // No markers left — emit rest as plain text
    if (codeIdx === -1 && boldIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    // Determine which comes first (treating -1 as infinity)
    const codeFirst = codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx)
    const boldFirst = boldIdx !== -1 && (codeIdx === -1 || boldIdx < codeIdx)

    if (codeFirst) {
      // Find closing backtick
      const closeIdx = remaining.indexOf('`', codeIdx + 1)
      if (closeIdx === -1) {
        // No closing backtick — emit rest as plain text
        parts.push(<span key={key++}>{remaining}</span>)
        break
      }
      // Emit text before, then code span
      if (codeIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, codeIdx)}</span>)
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded text-sky-300" style={{ background: 'rgba(56,189,248,0.1)' }}>
          {remaining.slice(codeIdx + 1, closeIdx)}
        </code>
      )
      remaining = remaining.slice(closeIdx + 1)
    } else if (boldFirst) {
      // Find closing **
      const closeIdx = remaining.indexOf('**', boldIdx + 2)
      if (closeIdx === -1) {
        parts.push(<span key={key++}>{remaining}</span>)
        break
      }
      if (boldIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>)
      parts.push(<strong key={key++} className="text-white font-semibold">{remaining.slice(boldIdx + 2, closeIdx)}</strong>)
      remaining = remaining.slice(closeIdx + 2)
    } else {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
  }

  return <>{parts}</>
}

function renderMarkdownLine(line: string, idx: number): React.ReactNode {
  if (line.startsWith('### ')) return <div key={idx} className="text-sky-300 font-bold mt-2 mb-0.5">{line.slice(4)}</div>
  if (line.startsWith('## ')) return <div key={idx} className="text-sky-300 font-bold text-[13px] mt-2 mb-0.5">{line.slice(3)}</div>
  if (line.startsWith('# ')) return <div key={idx} className="text-sky-200 font-bold text-sm mt-3 mb-1">{line.slice(2)}</div>
  if (/^[-*] /.test(line)) return <div key={idx} className="pl-3">• {renderInline(line.slice(2))}</div>
  if (/^\d+\. /.test(line)) return <div key={idx} className="pl-3">{renderInline(line)}</div>
  if (/^---+$/.test(line.trim())) return <hr key={idx} className="border-white/10 my-2" />
  if (line.trim() === '') return <div key={idx} className="h-1" />
  return <div key={idx}>{renderInline(line)}</div>
}

function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n')
  const result: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        result.push(
          <div key={`code-${i}`} className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
            {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
            <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
            </pre>
          </div>
        )
        inCodeBlock = false
        codeLines = []
        codeLang = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Table detection: line starts with | and next line is separator (|---|)
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1].trim())) {
      // Collect all table lines
      const tableLines: string[] = [line]
      let j = i + 1
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        tableLines.push(lines[j])
        j++
      }
      // Parse header + rows (skip separator at index 1)
      const parseRow = (row: string) => row.split('|').slice(1, -1).map(c => c.trim())
      const headers = parseRow(tableLines[0])
      const rows = tableLines.slice(2).map(parseRow)
      result.push(
        <div key={`table-${i}`} className="my-1 overflow-x-auto rounded-lg" style={{ border: '1px solid rgba(56,189,248,0.15)', scrollbarWidth: 'thin' }}>
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr style={{ background: 'rgba(56,189,248,0.08)' }}>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2 py-1 text-left text-sky-300 font-bold border-b border-white/10">{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)' }}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 text-gray-400 border-b border-white/5">{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j - 1 // skip processed lines
      continue
    }

    result.push(renderMarkdownLine(line, i))
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    result.push(
      <div key="code-unclosed" className="rounded-lg overflow-hidden my-1" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(56,189,248,0.15)' }}>
        {codeLang && <div className="text-[9px] text-gray-600 px-2 py-0.5 border-b border-white/5">{codeLang}</div>}
        <pre className="px-2 py-1.5 text-[11px] overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <code className="text-emerald-300/80">{codeLines.join('\n')}</code>
        </pre>
      </div>
    )
  }

  return <>{result}</>
}

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK CONTENT — the shared streaming content component
// ═══════════════════════════════════════════════════════════════════════════

export function AnorakContent({
  compact = false,
  initialSessionId,
  windowId,
  isFocused,
  onSessionChange,
  showSessionControls = false,
  sessionPickerOpen,
  onSessionPickerChange,
  model: controlledModel,
  onStreamingChange,
  onModelChange,
  onCostChange,
  onLiveTokensChange,
}: AnorakContentProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string>(() => {
    if (initialSessionId) return initialSessionId
    if (typeof window === 'undefined') return ''
    // Only use localStorage for 2D panel (no windowId)
    if (!windowId) {
      try {
        // Migrate from old key
        const old = localStorage.getItem('oasis-claude-code-session')
        if (old && !localStorage.getItem(SESSION_KEY)) {
          localStorage.setItem(SESSION_KEY, old)
          localStorage.removeItem('oasis-claude-code-session')
          return old
        }
        return localStorage.getItem(SESSION_KEY) || ''
      } catch { return '' }
    }
    return ''
  })
  const [internalModel, setInternalModel] = useState('opus')
  const model = controlledModel || internalModel
  const [totalCost, setTotalCost] = useState(0)
  const [liveTokens, setLiveTokens] = useState({ input: 0, output: 0 })
  const [autoScroll, setAutoScroll] = useState(true)
  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([])
  const [internalShowPicker, setInternalShowPicker] = useState(false)
  const showSessionPicker = sessionPickerOpen ?? internalShowPicker
  const setShowSessionPicker = onSessionPickerChange ?? setInternalShowPicker
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Detect duplicate session — only relevant for 3D windows
  const isDuplicateSession = useOasisStore(s => {
    if (!windowId || !sessionId) return false
    return s.placedAgentWindows.some(w => w.id !== windowId && w.sessionId === sessionId)
  })

  // Notify parent of streaming state changes
  useEffect(() => { onStreamingChange?.(isStreaming) }, [isStreaming, onStreamingChange])
  useEffect(() => { onModelChange?.(internalModel) }, [internalModel, onModelChange])
  useEffect(() => { onCostChange?.(totalCost) }, [totalCost, onCostChange])
  useEffect(() => { onLiveTokensChange?.(liveTokens) }, [liveTokens, onLiveTokensChange])

  // Fetch sessions from API when picker is opened
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/claude-code/sessions')
      const data = await res.json()
      if (data.sessions) {
        setSessionHistory(data.sessions)
        setSessionsLoaded(true)
      }
    } catch (err) {
      console.error('[Anorak] Failed to fetch sessions:', err)
    }
  }, [])

  // Auto-fetch sessions when picker opens
  useEffect(() => {
    if (showSessionPicker && !sessionsLoaded) fetchSessions()
  }, [showSessionPicker, sessionsLoaded, fetchSessions])

  // Load conversation history for a session
  const loadSessionConversation = useCallback(async (sid: string) => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/claude-code/sessions?id=${encodeURIComponent(sid)}`)
      const data = await res.json()
      if (data.messages) {
        // Convert history messages into Turn objects
        const historyTurns: Turn[] = []
        let currentTurn: Turn | null = null

        for (const msg of data.messages as HistoryMessage[]) {
          if (msg.role === 'user') {
            currentTurn = {
              id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              userPrompt: msg.content,
              blocks: [],
              isStreaming: false,
              timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
            }
            historyTurns.push(currentTurn)
          } else if (msg.role === 'assistant' && currentTurn) {
            if (msg.content) {
              currentTurn.blocks.push({
                id: `hist-text-${Math.random().toString(36).slice(2, 8)}`,
                kind: 'text',
                content: msg.content,
              })
            }
            if (msg.tools) {
              for (const tool of msg.tools) {
                const toolId = `hist-tool-${Math.random().toString(36).slice(2, 8)}`
                const icon = TOOL_ICONS_MAP[tool.name] || '🔧'
                currentTurn.blocks.push({
                  id: toolId,
                  kind: 'tool',
                  content: tool.name,
                  toolName: tool.name,
                  toolIcon: icon,
                  toolDisplay: `${tool.name}: ${tool.input || ''}`,
                  toolUseId: toolId,
                })
                // Add synthetic tool_result so the card shows check not spinner
                currentTurn.blocks.push({
                  id: `hist-result-${Math.random().toString(36).slice(2, 8)}`,
                  kind: 'tool_result',
                  content: '',
                  toolName: tool.name,
                  toolUseId: toolId,
                  isError: false,
                })
              }
            }
            if (msg.costUsd) currentTurn.costUsd = msg.costUsd
            if (msg.inputTokens) currentTurn.inputTokens = msg.inputTokens
            if (msg.outputTokens) currentTurn.outputTokens = msg.outputTokens
          }
        }

        setTurns(historyTurns)
        setTotalCost(historyTurns.reduce((sum, t) => sum + (t.costUsd || 0), 0))
      }
    } catch (err) {
      console.error('[Anorak] Failed to load session history:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  // Auto-scroll on new content (only when enabled)
  useEffect(() => {
    if (autoScroll) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, autoScroll])

  // Detect manual scroll-up via passive listener (better for 3D performance)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      setAutoScroll(atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-focus textarea — for 2D panel on open, for 3D when focused
  useEffect(() => {
    if (isFocused) {
      const t = setTimeout(() => inputRef.current?.focus(), 300)
      return () => clearTimeout(t)
    }
  }, [isFocused])

  // ─═̷─═̷─ INVOKE ANORAK ─═̷─═̷─
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
    const toolBlocks = new Map<string, { block: StreamBlock; result?: AnorakToolResultEvent }>()
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

      for await (const event of parseAnorakSSE(res)) {
        if (abort.signal.aborted) break

        switch (event.type) {
          case 'session': {
            setSessionId(event.sessionId)
            onSessionChange?.(event.sessionId)
            if (!windowId) localStorage.setItem(SESSION_KEY, event.sessionId)
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
            currentTextBlock = null
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
            currentTextBlock = null
            currentThinkingBlock = null
            const existing = toolBlocks.get(event.id)
            if (existing) {
              existing.block.toolDisplay = event.display
              existing.block.toolInput = event.input
              existing.block.content = event.display
            } else {
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
            setLiveTokens({ input: event.inputTokens, output: event.outputTokens })
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
            if (event.content && !event.content.includes('keepalive')) {
              blocks.push({ id: `stderr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: 'status', content: event.content })
            }
            break
          }
          case 'done': {
            if (event.sessionId) {
              setSessionId(event.sessionId)
              onSessionChange?.(event.sessionId)
              if (!windowId) {
                localStorage.setItem(SESSION_KEY, event.sessionId)
                // Mark sessions list as stale so next open re-fetches
                setSessionsLoaded(false)
              }
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
      setLiveTokens({ input: 0, output: 0 })
      abortRef.current = null
    }
  }, [input, isStreaming, sessionId, model, windowId, onSessionChange])

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
    onSessionChange?.('')
    if (!windowId) localStorage.removeItem(SESSION_KEY)
  }, [isStreaming, windowId, onSessionChange])

  // Size classes based on compact mode
  const textSize = compact ? 'text-[11px]' : 'text-[12px]'
  const metaSize = compact ? 'text-[8px]' : 'text-[9px]'
  const promptSize = compact ? 'text-[11px]' : 'text-xs'
  const inputSize = compact ? 'text-[11px]' : 'text-xs'
  const statusSize = compact ? 'text-[9px]' : 'text-[10px]'
  const workingSize = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ═══ SESSION PICKER (only in showSessionControls mode) ═══ */}
      {showSessionControls && showSessionPicker && (
        <div
          className="border-b border-white/10 max-h-[200px] overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.4)', scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
        >
          {!sessionsLoaded ? (
            <p className="text-[10px] text-gray-500 px-3 py-2 text-center animate-pulse">Loading sessions...</p>
          ) : sessionHistory.length === 0 ? (
            <p className="text-[10px] text-gray-600 px-3 py-2 text-center">No previous sessions</p>
          ) : (
            <>
              <button
                onClick={fetchSessions}
                className="w-full text-[9px] text-gray-600 hover:text-sky-400 py-1 border-b border-white/5 cursor-pointer transition-colors"
              >
                ↻ refresh
              </button>
              {sessionHistory.map(s => {
                const isActive = s.id === sessionId
                const age = s.timestamp ? Date.now() - new Date(s.timestamp).getTime() : 0
                const ageStr = !age ? '' : age < 3600000 ? `${Math.round(age / 60000)}m`
                  : age < 86400000 ? `${Math.round(age / 3600000)}h`
                  : `${Math.round(age / 86400000)}d`
                return (
                  <button
                    key={s.id}
                    onClick={async () => {
                      setSessionId(s.id)
                      onSessionChange?.(s.id)
                      if (!windowId) localStorage.setItem(SESSION_KEY, s.id)
                      setShowSessionPicker(false)
                      await loadSessionConversation(s.id)
                    }}
                    disabled={isStreaming || loadingHistory}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[10px] font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                      isActive ? 'bg-sky-500/10 text-sky-400' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-sky-400' : 'bg-gray-700'}`} />
                    <span className="truncate flex-1">{s.label || s.id.slice(0, 12)}</span>
                    <span className="text-[9px] text-gray-600 flex-shrink-0">{s.turnCount}t</span>
                    {ageStr && <span className="text-[9px] text-gray-600 flex-shrink-0">{ageStr}</span>}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* Loading history overlay */}
      {loadingHistory && (
        <div className="flex items-center justify-center py-4 border-b border-white/10" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <span className="text-[10px] text-sky-400 font-mono animate-pulse">Loading conversation history...</span>
        </div>
      )}

      {/* ░▒▓ DUPLICATE SESSION WARNING ▓▒░ */}
      {isDuplicateSession && (
        <div className="px-3 py-1.5 text-[9px] font-mono text-amber-300 flex items-center gap-1.5"
          style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
          <span>⚠️</span>
          <span>Another window shares this session — concurrent use may corrupt context</span>
        </div>
      )}

      {/* ═══ STREAM ═══ */}
      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto px-3 py-2 ${compact ? 'space-y-3' : 'space-y-4'} min-h-0 relative`}
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
      >
        {/* Empty state */}
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className={compact ? 'text-3xl mb-2' : 'text-4xl mb-3'} style={{ animation: 'anorakFloat 3s ease-in-out infinite' }}>💻</span>
            <p className={`${compact ? 'text-xs' : 'text-sm'} mb-1 text-sky-400/80`}>Anorak</p>
            <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-gray-500 text-center px-6 leading-relaxed`}>
              {compact ? (
                <>Claude Code agent in 3D.<br/>Hit Enter to focus. Type to command.</>
              ) : (
                <>
                  Claude Code agent inside the Oasis.<br />
                  Read, edit, write, bash, grep — anything.<br />
                  You ARE inside the app you&apos;re editing.
                </>
              )}
            </p>
            {!compact && (
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
            )}
            {sessionId && (
              <p className="mt-4 text-[9px] text-gray-700 font-mono">
                Previous session: {sessionId.slice(0, 12)}... (will resume)
              </p>
            )}
          </div>
        )}

        {/* Turns */}
        {turns.map(turn => (
          <div key={turn.id} className={compact ? 'space-y-1.5' : 'space-y-2'}>
            {/* User prompt */}
            <div className="flex justify-end">
              <div
                className={`max-w-[85%] ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} rounded-lg ${promptSize} text-gray-200 whitespace-pre-wrap`}
                style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.2)' }}
              >
                {turn.userPrompt}
              </div>
            </div>

            {/* Stream blocks */}
            <div className={`${compact ? 'space-y-1' : 'space-y-1.5'} pl-1`}>
              {turn.blocks.map(block => {
                switch (block.kind) {
                  case 'text':
                    return (
                      <div key={block.id} className={`${textSize} text-gray-300 leading-relaxed font-mono`}>
                        {renderMarkdown(block.content)}
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
                        compact={compact}
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
                        compact={compact}
                      />
                    )
                  }
                  case 'tool_result':
                    // Rendered inline with tool card — skip standalone render
                    return null
                  case 'error':
                    return (
                      <div key={block.id} className={`${statusSize} text-red-400 font-mono px-2 py-1.5 rounded-lg`}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        {block.content}
                      </div>
                    )
                  case 'status':
                    return (
                      <div key={block.id} className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-gray-600 font-mono italic`}>
                        {block.content}
                      </div>
                    )
                  default:
                    return null
                }
              })}

              {/* Streaming indicator */}
              {turn.isStreaming && (
                compact ? (
                  <div className="flex items-center gap-1.5 text-[9px] text-sky-400/60 font-mono py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    working...
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-[10px] text-sky-400/60 font-mono py-2">
                    <div className="flex items-center gap-[3px]">
                      {[0, 1, 2, 3, 4].map(i => (
                        <span
                          key={i}
                          className="w-[3px] rounded-full bg-sky-400"
                          style={{
                            animation: 'anorakWave 1.2s ease-in-out infinite',
                            animationDelay: `${i * 0.1}s`,
                            height: '12px',
                          }}
                        />
                      ))}
                    </div>
                    <span>anorak is working...</span>
                  </div>
                )
              )}

              {/* Turn metadata */}
              {!turn.isStreaming && (turn.costUsd || turn.inputTokens) && (
                <div className={`flex items-center gap-3 ${metaSize} text-gray-600 font-mono pt-1 border-t border-white/5`}>
                  {turn.costUsd !== undefined && turn.costUsd > 0 && <span>${turn.costUsd.toFixed(4)}</span>}
                  {turn.inputTokens !== undefined && turn.inputTokens > 0 && (
                    <span>{fmtTokens(turn.inputTokens || 0)} in / {fmtTokens(turn.outputTokens || 0)} out</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />

        {/* Auto-scroll pill — appears when user scrolls up */}
        {!autoScroll && turns.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true)
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`sticky bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full ${compact ? 'text-[9px]' : 'text-[10px]'} font-mono font-bold cursor-pointer z-10 transition-all hover:scale-105`}
            style={{
              background: 'rgba(8,10,15,0.9)',
              border: '1px solid rgba(56,189,248,0.4)',
              color: '#38bdf8',
              boxShadow: '0 2px 12px rgba(56,189,248,0.2)',
              backdropFilter: 'blur(8px)',
            }}
          >
            ↓ auto-scroll
          </button>
        )}
      </div>

      {/* ═══ INPUT ═══ */}
      <div className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} border-t border-white/10`}>
        <div className={`flex ${compact ? 'gap-1.5' : 'gap-2'}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              // Let Escape bubble to the global handler (unfocus window + return camera)
              if (e.key === 'Escape') return
              if (compact) e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                invoke()
              }
            }}
            onFocus={compact ? (e => e.stopPropagation()) : undefined}
            placeholder={isStreaming ? (compact ? 'Working...' : 'Anorak is working...') : 'Command Anorak...'}
            rows={1}
            className={`flex-1 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded${compact ? '' : '-lg'} text-white ${inputSize} outline-none placeholder-gray-600 resize-none font-mono`}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.3)' : 'rgba(56,189,248,0.12)'}`,
              minHeight: compact ? '30px' : '36px',
              maxHeight: compact ? '80px' : '120px',
            }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : invoke}
            disabled={!isStreaming && !input.trim()}
            className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded${compact ? '' : '-lg'} ${inputSize} font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 self-end`}
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

      {/* ═══ ANIMATIONS ═══ */}
      <style>{`
        @keyframes anorakFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-5px) rotate(2deg); }
          75% { transform: translateY(-3px) rotate(-2deg); }
        }
        @keyframes anorakWave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.4; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
