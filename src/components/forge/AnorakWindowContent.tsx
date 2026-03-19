'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK WINDOW CONTENT — Claude Code agent for in-world 3D windows
// ─═̷─═̷─ॐ─═̷─═̷─ Same SSE streaming, no drag/resize/portal chrome ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useRef, useEffect, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TYPES — Anorak SSE event shapes (shared with AnorakPanel)
// ═══════════════════════════════════════════════════════════════════════════

interface AnorakEvent {
  type: string
  content?: string
  sessionId?: string
  name?: string
  icon?: string
  id?: string
  input?: Record<string, unknown>
  display?: string
  preview?: string
  isError?: boolean
  length?: number
  fullResult?: string
  toolUseId?: string
  inputTokens?: number
  outputTokens?: number
  stopReason?: string
  costUsd?: number
  durationMs?: number
  success?: boolean
}

interface StreamBlock {
  id: string
  kind: 'text' | 'thinking' | 'tool' | 'tool_result' | 'error' | 'status' | 'user'
  content: string
  toolName?: string
  toolIcon?: string
  toolInput?: Record<string, unknown>
  toolDisplay?: string
  toolUseId?: string
  isError?: boolean
}

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
// SSE PARSER
// ═══════════════════════════════════════════════════════════════════════════

async function* parseSSE(response: Response): AsyncGenerator<AnorakEvent> {
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
      try { yield JSON.parse(trimmed.slice(6)) as AnorakEvent } catch { /* skip */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CALL CARD — compact for 3D windows
// ═══════════════════════════════════════════════════════════════════════════

function ToolCard({ name, icon, display, result }: {
  name: string; icon: string; display: string
  result?: { preview: string; isError: boolean }
}) {
  return (
    <div className="rounded overflow-hidden text-[10px] font-mono" style={{
      border: `1px solid ${result ? (result.isError ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') : 'rgba(56,189,248,0.3)'}`,
      background: result ? (result.isError ? 'rgba(239,68,68,0.05)' : 'rgba(34,197,94,0.05)') : 'rgba(56,189,248,0.05)',
    }}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span>{icon}</span>
        <span className="font-bold" style={{
          color: result ? (result.isError ? '#ef4444' : '#22c55e') : '#38bdf8',
        }}>{name}</span>
        <span className="text-gray-500 truncate flex-1">{display.replace(`${name}: `, '')}</span>
        {result && !result.isError && <span className="text-green-500">✓</span>}
        {result && result.isError && <span className="text-red-400">✗</span>}
        {!result && <span className="w-2.5 h-2.5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ANORAK WINDOW CONTENT — the core streaming UI
// ═══════════════════════════════════════════════════════════════════════════

const MODELS = [
  { id: 'opus', label: 'Opus', color: '#a855f7' },
  { id: 'sonnet', label: 'Sonnet', color: '#38bdf8' },
  { id: 'haiku', label: 'Haiku', color: '#22c55e' },
]

export function AnorakWindowContent({ windowId, initialSessionId }: {
  windowId: string
  initialSessionId?: string
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState(initialSessionId || '')
  const [model, setModel] = useState('opus')
  const [totalCost, setTotalCost] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  // ─═̷─═̷─ INVOKE ─═̷─═̷─
  const invoke = useCallback(async () => {
    if (!input.trim() || isStreaming) return
    const userPrompt = input.trim()
    setInput('')

    const turnId = `turn-${Date.now()}`
    const newTurn: Turn = {
      id: turnId, userPrompt, blocks: [], isStreaming: true, timestamp: Date.now(),
    }
    setTurns(prev => [...prev, newTurn])
    setIsStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    let blocks: StreamBlock[] = []
    let currentTextBlock: StreamBlock | null = null
    let currentThinkingBlock: StreamBlock | null = null
    const toolBlocks = new Map<string, { block: StreamBlock }>()
    let turnCost = 0, turnInputTokens = 0, turnOutputTokens = 0

    function updateTurn() {
      setTurns(prev => prev.map(t =>
        t.id === turnId ? { ...t, blocks: [...blocks], costUsd: turnCost, inputTokens: turnInputTokens, outputTokens: turnOutputTokens } : t
      ))
    }

    try {
      const res = await fetch('/api/claude-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt, sessionId: sessionId || undefined, model }),
        signal: abort.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error')
        blocks.push({ id: `err-${Date.now()}`, kind: 'error', content: `Error ${res.status}: ${errText}` })
        updateTurn()
        setIsStreaming(false)
        return
      }

      for await (const event of parseSSE(res)) {
        if (abort.signal.aborted) break
        const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

        switch (event.type) {
          case 'session':
            if (event.sessionId) setSessionId(event.sessionId)
            break
          case 'text':
            if (!currentTextBlock) {
              currentTextBlock = { id: `text-${uid()}`, kind: 'text', content: '' }
              blocks.push(currentTextBlock)
            }
            currentTextBlock.content += event.content || ''
            break
          case 'thinking_start':
            currentTextBlock = null
            currentThinkingBlock = { id: `think-${uid()}`, kind: 'thinking', content: '' }
            blocks.push(currentThinkingBlock)
            break
          case 'thinking':
            if (!currentThinkingBlock) {
              currentThinkingBlock = { id: `think-${uid()}`, kind: 'thinking', content: '' }
              blocks.push(currentThinkingBlock)
            }
            currentThinkingBlock.content = event.content || ''
            break
          case 'tool_start':
            currentTextBlock = null
            currentThinkingBlock = null
            {
              const tb: StreamBlock = { id: event.id || `tool-${uid()}`, kind: 'tool', content: '', toolName: event.name, toolIcon: event.icon }
              blocks.push(tb)
              toolBlocks.set(tb.id, { block: tb })
            }
            break
          case 'tool':
            currentTextBlock = null
            currentThinkingBlock = null
            {
              const existing = toolBlocks.get(event.id || '')
              if (existing) {
                existing.block.toolDisplay = event.display
                existing.block.toolInput = event.input
                existing.block.content = event.display || ''
              } else {
                const tb: StreamBlock = { id: event.id || `tool-${uid()}`, kind: 'tool', content: event.display || '', toolName: event.name, toolIcon: event.icon, toolDisplay: event.display, toolInput: event.input, toolUseId: event.id }
                blocks.push(tb)
                toolBlocks.set(tb.id, { block: tb })
              }
            }
            break
          case 'tool_result':
            currentTextBlock = null
            currentThinkingBlock = null
            blocks.push({ id: `result-${uid()}`, kind: 'tool_result', content: event.fullResult || event.preview || '', toolName: event.name, toolUseId: event.toolUseId, isError: event.isError })
            break
          case 'progress':
            turnInputTokens = event.inputTokens || 0
            turnOutputTokens = event.outputTokens || 0
            break
          case 'result':
            turnCost = event.costUsd || 0
            break
          case 'error':
            blocks.push({ id: `err-${uid()}`, kind: 'error', content: event.content || 'Unknown error' })
            break
          case 'done':
            if (event.sessionId) setSessionId(event.sessionId)
            if (event.costUsd) turnCost = event.costUsd
            if (event.inputTokens) turnInputTokens = event.inputTokens
            if (event.outputTokens) turnOutputTokens = event.outputTokens
            break
        }
        updateTurn()
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        blocks.push({ id: `err-${Date.now()}`, kind: 'error', content: (err as Error).message })
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

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const modelColor = MODELS.find(m => m.id === model)?.color || '#a855f7'

  return (
    <div
      className="flex flex-col w-full h-full rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'rgba(8, 10, 15, 0.95)',
        border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        boxShadow: isStreaming
          ? '0 0 40px rgba(56,189,248,0.2), inset 0 0 60px rgba(56,189,248,0.03)'
          : '0 8px 40px rgba(0,0,0,0.8)',
      }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 select-none"
        style={{ background: isStreaming ? 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, transparent 100%)' : 'rgba(20,20,30,0.5)' }}
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isStreaming ? 'animate-pulse' : ''}`}>💻</span>
          <span className="text-sky-400 font-bold text-xs tracking-wide">Anorak</span>
          {sessionId && <span className="text-[8px] text-gray-600 font-mono">{sessionId.slice(0, 8)}</span>}
          {isStreaming && <span className="text-[9px] text-sky-300 animate-pulse font-mono">● working</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select value={model} onChange={e => setModel(e.target.value)} disabled={isStreaming}
            className="text-[9px] font-mono px-1 py-0.5 rounded bg-black/60 border border-white/10 cursor-pointer disabled:opacity-50 outline-none"
            style={{ color: modelColor }}
          >
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {totalCost > 0 && <span className="text-[8px] text-gray-500 font-mono">${totalCost.toFixed(3)}</span>}
          {isStreaming && (
            <button onClick={cancel}
              className="px-1.5 py-0.5 rounded text-[9px] font-mono text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer">
              stop
            </button>
          )}
        </div>
      </div>

      {/* ═══ STREAM ═══ */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e293b transparent' }}
      >
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className="text-3xl mb-2" style={{ animation: 'anorak3dFloat 3s ease-in-out infinite' }}>💻</span>
            <p className="text-xs text-sky-400/80">Anorak</p>
            <p className="text-[10px] text-gray-500 text-center px-4 mt-1">
              Claude Code agent in 3D.<br/>Hit Enter to focus. Type to command.
            </p>
          </div>
        )}

        {turns.map(turn => (
          <div key={turn.id} className="space-y-1.5">
            {/* User prompt */}
            <div className="flex justify-end">
              <div className="max-w-[85%] px-2.5 py-1.5 rounded-lg text-[11px] text-gray-200 whitespace-pre-wrap"
                style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.2)' }}
              >
                {turn.userPrompt}
              </div>
            </div>

            {/* Blocks */}
            <div className="space-y-1 pl-1">
              {turn.blocks.map(block => {
                switch (block.kind) {
                  case 'text':
                    return <div key={block.id} className="text-[11px] text-gray-300 whitespace-pre-wrap leading-relaxed font-mono">{block.content}</div>
                  case 'thinking':
                    return (
                      <div key={block.id} className="text-[9px] text-purple-400/60 font-mono italic truncate" title={block.content}>
                        🧠 thinking ({block.content.length} chars)
                      </div>
                    )
                  case 'tool': {
                    const toolIdx = turn.blocks.indexOf(block)
                    const resultBlock = turn.blocks.find((b, i) =>
                      b.kind === 'tool_result' && i > toolIdx &&
                      (b.toolUseId && block.toolUseId ? b.toolUseId === block.toolUseId : !turn.blocks.slice(toolIdx + 1, i).some(x => x.kind === 'tool'))
                    )
                    return <ToolCard key={block.id} name={block.toolName || 'tool'} icon={block.toolIcon || '🔧'} display={block.toolDisplay || block.content}
                      result={resultBlock ? { preview: resultBlock.content.substring(0, 300), isError: !!resultBlock.isError } : undefined} />
                  }
                  case 'tool_result': return null
                  case 'error':
                    return <div key={block.id} className="text-[10px] text-red-400 font-mono px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>{block.content}</div>
                  case 'status':
                    return <div key={block.id} className="text-[9px] text-gray-600 font-mono italic">{block.content}</div>
                  default: return null
                }
              })}
              {turn.isStreaming && (
                <div className="flex items-center gap-1.5 text-[9px] text-sky-400/60 font-mono py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  working...
                </div>
              )}
              {!turn.isStreaming && (turn.costUsd || turn.inputTokens) && (
                <div className="flex items-center gap-2 text-[8px] text-gray-600 font-mono pt-0.5 border-t border-white/5">
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
      <div className="px-2 py-1.5 border-t border-white/10">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); invoke() }
            }}
            onFocus={e => e.stopPropagation()}
            placeholder={isStreaming ? 'Working...' : 'Command Anorak...'}
            rows={1}
            className="flex-1 px-2 py-1.5 rounded text-white text-[11px] outline-none placeholder-gray-600 resize-none font-mono"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${isStreaming ? 'rgba(56,189,248,0.3)' : 'rgba(56,189,248,0.12)'}`, minHeight: '30px', maxHeight: '80px' }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : invoke}
            disabled={!isStreaming && !input.trim()}
            className="px-2 py-1.5 rounded text-[11px] font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 self-end"
            style={{
              background: isStreaming ? 'rgba(239,68,68,0.4)' : 'linear-gradient(135deg, rgba(56,189,248,0.4) 0%, rgba(96,165,250,0.4) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.5)' : 'rgba(56,189,248,0.3)'}`,
            }}
          >
            {isStreaming ? '■' : '▸'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes anorak3dFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  )
}
