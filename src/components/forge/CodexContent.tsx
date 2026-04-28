'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useAgentVoiceInput } from '@/hooks/useAgentVoiceInput'
import { useAutoresizeTextarea } from '@/hooks/useAutoresizeTextarea'
import { useOasisStore } from '@/store/oasisStore'
import {
  getClientAgentSessionCache,
  saveClientAgentSessionCache,
} from '@/lib/agent-session-cache-client'
import {
  getFreshInputTokens,
  type CodexStreamBlock,
  type CodexToolResultEvent,
  type CodexTurn,
  type CodexUsage,
  parseCodexSSE,
} from '@/lib/codex-engine'
import {
  CollapsibleBlock,
  ToolCallCard,
  isScreenshotToolDisplay,
  renderMarkdown,
} from '@/lib/anorak-renderers'

import { AgentVoiceInputButton } from './AgentVoiceInputButton'

const SESSION_KEY = 'oasis-codex-session'
const MAX_CACHED_TURNS = 20
const MAX_CACHED_BLOCK_CHARS = 6000

interface CodexSessionCachePayload {
  turns?: CodexTurn[]
  latestUsage?: CodexUsage
}

interface CodexSessionFileDetailResponse {
  record?: CodexSessionCachePayload
}

function joinCodexPrompt(base: string, addition: string): string {
  if (!addition) return base
  if (!base) return addition
  return `${base} ${addition}`.trim()
}

function emptyUsage(): CodexUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  }
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Codex session'
  return normalized.length > 72 ? `${normalized.slice(0, 69).trim()}...` : normalized
}

function cacheableBlock(block: CodexStreamBlock): CodexStreamBlock {
  const content = block.content.length > MAX_CACHED_BLOCK_CHARS
    ? `${block.content.slice(0, MAX_CACHED_BLOCK_CHARS - 20)}\n... [truncated]`
    : block.content
  return { ...block, content }
}

function cacheableTurns(turns: CodexTurn[]): CodexTurn[] {
  return turns.slice(-MAX_CACHED_TURNS).map(turn => ({
    ...turn,
    isStreaming: false,
    blocks: turn.blocks.map(cacheableBlock),
  }))
}

function readCachedTurns(payload: CodexSessionCachePayload | unknown): CodexTurn[] {
  const record = payload && typeof payload === 'object' ? payload as CodexSessionCachePayload : null
  return Array.isArray(record?.turns) ? record.turns.filter(turn => turn && typeof turn.id === 'string') : []
}

function hydrationScore(turns: CodexTurn[]): number {
  return turns.length * 1000 + turns.reduce((sum, turn) => sum + turn.blocks.length, 0)
}

async function loadCodexSessionFilePayload(sessionId: string): Promise<CodexSessionCachePayload | null> {
  const response = await fetch(`/api/codex/sessions?id=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  if (!response.ok) return null
  const data = await response.json().catch(() => ({})) as CodexSessionFileDetailResponse
  return data.record || null
}

function lastTurnUsage(turns: CodexTurn[]): CodexUsage {
  const last = [...turns].reverse().find(turn =>
    turn.inputTokens > 0 || turn.cachedInputTokens > 0 || turn.outputTokens > 0
  )
  return last ? {
    inputTokens: last.inputTokens,
    cachedInputTokens: last.cachedInputTokens,
    outputTokens: last.outputTokens,
  } : emptyUsage()
}

function UsageDisplay({
  usage,
  className = '',
}: {
  usage: CodexUsage
  className?: string
}) {
  const hasUsage = usage.inputTokens > 0 || usage.cachedInputTokens > 0 || usage.outputTokens > 0
  if (!hasUsage) return null
  const freshInputTokens = getFreshInputTokens(usage)

  return (
    <div className={`flex items-center gap-3 text-[9px] font-mono ${className}`}>
      <span style={{ color: '#34d399' }}>fresh {freshInputTokens.toLocaleString()}</span>
      {usage.cachedInputTokens > 0 && <span style={{ color: '#6ee7b7' }}>cached {usage.cachedInputTokens.toLocaleString()}</span>}
      <span style={{ color: '#fbbf24' }}>out {usage.outputTokens.toLocaleString()}</span>
    </div>
  )
}

export interface CodexContentProps {
  compact?: boolean
  initialSessionId?: string
  windowId?: string
  isFocused?: boolean
  model?: string
  onSessionChange?: (sessionId: string) => void
  onStreamingChange?: (streaming: boolean) => void
  onLatestUsageChange?: (usage: CodexUsage) => void
}

export function CodexContent({
  compact = false,
  initialSessionId,
  windowId,
  isFocused,
  model,
  onSessionChange,
  onStreamingChange,
  onLatestUsageChange,
}: CodexContentProps) {
  const [turns, setTurns] = useState<CodexTurn[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string>(() => {
    if (initialSessionId) return initialSessionId
    if (typeof window === 'undefined' || windowId) return ''
    try {
      return localStorage.getItem(SESSION_KEY) || ''
    } catch {
      return ''
    }
  })
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hydratedSessionIdRef = useRef<string | null>(null)

  const voiceInput = useAgentVoiceInput({
    enabled: true,
    transcribeEndpoint: '/api/voice/transcribe',
    onTranscript: transcript => setInput(current => joinCodexPrompt(current, transcript)),
    focusTargetRef: inputRef,
    enablePlayerLipSync: true,
  })

  useAutoresizeTextarea(inputRef, input, { minPx: 30, maxPx: 140 })

  const isDuplicateSession = useOasisStore(s => {
    if (!windowId || !sessionId) return false
    return s.placedAgentWindows.some(win =>
      win.id !== windowId
      && win.agentType === 'codex'
      && win.sessionId === sessionId,
    )
  })
  const audioTargetAvatarId = useOasisStore(s => {
    if (!windowId) return null
    return s.placedAgentAvatars.find(avatar => avatar.linkedWindowId === windowId)?.id || null
  })
  const activeWorldId = useOasisStore(s => s.activeWorldId)
  const activeWorldName = useOasisStore(s => s.worldRegistry.find(world => world.id === s.activeWorldId)?.name || '')

  useEffect(() => {
    onStreamingChange?.(isStreaming)
  }, [isStreaming, onStreamingChange])

  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [turns, autoScroll])

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return

    const onScroll = () => {
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 60
      setAutoScroll(atBottom)
    }

    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (isFocused) {
      const timeout = window.setTimeout(() => inputRef.current?.focus(), 300)
      return () => window.clearTimeout(timeout)
    }
  }, [isFocused])

  useEffect(() => {
    if (!sessionId || hydratedSessionIdRef.current === sessionId) return
    hydratedSessionIdRef.current = sessionId
    let cancelled = false

    const hydrateSession = async () => {
      const [record, filePayload] = await Promise.all([
        getClientAgentSessionCache<CodexSessionCachePayload>('codex', sessionId),
        loadCodexSessionFilePayload(sessionId),
      ])
      if (cancelled) return

      const cachedTurns = readCachedTurns(record?.payload)
      const fileTurns = readCachedTurns(filePayload)
      const useFileTurns = fileTurns.length > 0 && hydrationScore(fileTurns) > hydrationScore(cachedTurns)
      const hydratedTurns = useFileTurns ? fileTurns : cachedTurns
      const hydratedUsage = useFileTurns ? filePayload?.latestUsage : record?.payload?.latestUsage
      if (hydratedTurns.length === 0) return

      setTurns(current => current.length > 0 ? current : hydratedTurns)
      onLatestUsageChange?.(hydratedUsage || lastTurnUsage(hydratedTurns))
    }

    void hydrateSession()
    return () => {
      cancelled = true
    }
  }, [onLatestUsageChange, sessionId])

  const invoke = useCallback(async () => {
    if (!input.trim() || isStreaming) return

    const userPrompt = input.trim()
    const previousTurns = turns
    setInput('')

    const turnId = `codex-turn-${Date.now()}`
    const newTurn: CodexTurn = {
      id: turnId,
      userPrompt,
      blocks: [],
      isStreaming: true,
      timestamp: Date.now(),
      ...emptyUsage(),
    }

    setTurns(prev => [...prev, newTurn])
    setIsStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    let blocks: CodexStreamBlock[] = []
    let currentTextBlock: CodexStreamBlock | null = null
    let currentThinkingBlock: CodexStreamBlock | null = null
    const toolBlocks = new Map<string, { block: CodexStreamBlock; result?: CodexToolResultEvent }>()
    let turnUsage = emptyUsage()
    let activeSessionId = sessionId

    const updateTurn = () => {
      setTurns(prev => prev.map(turn =>
        turn.id === turnId
          ? {
              ...turn,
              blocks: [...blocks],
              ...turnUsage,
            }
          : turn,
      ))
    }

    try {
      const response = await fetch('/api/codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          sessionId: sessionId || undefined,
          model: model || undefined,
          oasisContext: {
            surface: windowId ? 'agent-window-3d' : 'codex-panel',
            windowId: windowId || undefined,
            linkedAvatarId: audioTargetAvatarId || undefined,
            activeWorldId,
            activeWorldName: activeWorldName || undefined,
          },
        }),
        signal: abort.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error')
        blocks.push({
          id: `codex-err-${Date.now()}`,
          kind: 'error',
          content: `Error ${response.status}: ${errorText}`,
        })
        updateTurn()
        setIsStreaming(false)
        return
      }

      for await (const event of parseCodexSSE(response)) {
        if (abort.signal.aborted) break

        switch (event.type) {
          case 'session': {
            activeSessionId = event.sessionId
            setSessionId(event.sessionId)
            onSessionChange?.(event.sessionId)
            if (!windowId) localStorage.setItem(SESSION_KEY, event.sessionId)
            break
          }
          case 'status': {
            blocks.push({
              id: `codex-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'status',
              content: event.content,
            })
            break
          }
          case 'text': {
            if (!currentTextBlock) {
              currentTextBlock = {
                id: `codex-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'text',
                content: '',
              }
              blocks.push(currentTextBlock)
            }
            currentTextBlock.content += event.content
            break
          }
          case 'thinking': {
            currentTextBlock = null
            if (!currentThinkingBlock) {
              currentThinkingBlock = {
                id: `codex-thinking-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'thinking',
                content: '',
              }
              blocks.push(currentThinkingBlock)
            }
            currentThinkingBlock.content = event.content
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
              const toolBlock: CodexStreamBlock = {
                id: event.id,
                kind: 'tool',
                content: event.display,
                toolName: event.name,
                toolIcon: event.icon,
                toolDisplay: event.display,
                toolInput: event.input,
                toolUseId: event.id,
              }
              blocks.push(toolBlock)
              toolBlocks.set(event.id, { block: toolBlock })
            }
            break
          }
          case 'tool_result': {
            currentTextBlock = null
            currentThinkingBlock = null
            blocks.push({
              id: `codex-result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'tool_result',
              content: event.fullResult || event.preview,
              toolName: event.name,
              toolUseId: event.toolUseId,
              isError: event.isError,
            })
            break
          }
          case 'result': {
            turnUsage = {
              inputTokens: event.inputTokens,
              cachedInputTokens: event.cachedInputTokens,
              outputTokens: event.outputTokens,
            }
            onLatestUsageChange?.(turnUsage)
            break
          }
          case 'error': {
            blocks.push({
              id: `codex-error-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'error',
              content: event.content,
            })
            break
          }
          case 'done': {
            if (event.sessionId) {
              activeSessionId = event.sessionId
              setSessionId(event.sessionId)
              onSessionChange?.(event.sessionId)
              if (!windowId) localStorage.setItem(SESSION_KEY, event.sessionId)
            }
            turnUsage = {
              inputTokens: event.inputTokens ?? turnUsage.inputTokens,
              cachedInputTokens: event.cachedInputTokens ?? turnUsage.cachedInputTokens,
              outputTokens: event.outputTokens ?? turnUsage.outputTokens,
            }
            onLatestUsageChange?.(turnUsage)
            break
          }
        }

        updateTurn()
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        blocks.push({
          id: `codex-error-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'error',
          content: error instanceof Error ? error.message : 'Codex request failed',
        })
        updateTurn()
      }
    } finally {
      const completedTurn: CodexTurn = {
        ...newTurn,
        blocks: [...blocks],
        isStreaming: false,
        ...turnUsage,
      }
      const nextTurns = [...previousTurns, completedTurn]
      setTurns(prev => prev.map(turn =>
        turn.id === turnId
          ? {
              ...completedTurn,
              isStreaming: false,
            }
          : turn,
      ))
      setIsStreaming(false)
      abortRef.current = null

      if (activeSessionId) {
        void saveClientAgentSessionCache<CodexSessionCachePayload>('codex', {
          sessionId: activeSessionId,
          title: titleFromPrompt(nextTurns[0]?.userPrompt || userPrompt),
          model: model || undefined,
          payload: {
            turns: cacheableTurns(nextTurns),
            latestUsage: turnUsage,
          },
          messageCount: nextTurns.length,
          source: windowId ? 'oasis-codex-window' : 'oasis-codex-panel',
          lastActiveAt: Date.now(),
        }).catch(() => {})
      }
    }
  }, [activeWorldId, activeWorldName, audioTargetAvatarId, input, isStreaming, model, onLatestUsageChange, onSessionChange, sessionId, turns, windowId])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const textSize = compact ? 'text-[11px]' : 'text-[12px]'
  const metaSize = compact ? 'text-[8px]' : 'text-[9px]'
  const promptSize = compact ? 'text-[11px]' : 'text-xs'
  const inputSize = compact ? 'text-[11px]' : 'text-xs'
  const statusSize = compact ? 'text-[9px]' : 'text-[10px]'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {isDuplicateSession && (
        <div
          className="px-3 py-1.5 text-[9px] font-mono text-amber-300 flex items-center gap-1.5"
          style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}
        >
          <span>⚠️</span>
          <span>Another Codex window shares this session. Concurrent prompts can scramble the thread.</span>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className={`flex-1 overflow-y-auto px-3 py-2 ${compact ? 'space-y-3' : 'space-y-4'} min-h-0 relative`}
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#14532d transparent' }}
      >
        {turns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <span className={compact ? 'text-3xl mb-2' : 'text-4xl mb-3'} style={{ animation: 'codexFloat 3s ease-in-out infinite' }}>⌘</span>
            <p className={`${compact ? 'text-xs' : 'text-sm'} mb-1 text-emerald-300/80`}>Codex</p>
            <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-gray-500 text-center px-6 leading-relaxed`}>
              {compact ? (
                <>OpenAI Codex in 3D.<br />Hit Enter to focus. Type to code.</>
              ) : (
                <>
                  Codex inside the Oasis.<br />
                  Run commands, edit files, inspect the repo, and keep a local thread going.
                </>
              )}
            </p>
            {!compact && (
              <div className="mt-4 space-y-1.5 text-[10px] text-gray-600 font-mono">
                <p className="text-emerald-500/50">try:</p>
                <p className="cursor-pointer hover:text-emerald-300 transition-colors" onClick={() => setInput('read AGENTS.md and summarize the repo rules')}>
                  &quot;read AGENTS.md and summarize the repo rules&quot;
                </p>
                <p className="cursor-pointer hover:text-emerald-300 transition-colors" onClick={() => setInput('inspect src/components/Scene.tsx and tell me the riskiest integration points')}>
                  &quot;inspect src/components/Scene.tsx and tell me the riskiest integration points&quot;
                </p>
                <p className="cursor-pointer hover:text-emerald-300 transition-colors" onClick={() => setInput('run pnpm tsc --noEmit and report the errors')}>
                  &quot;run pnpm tsc --noEmit and report the errors&quot;
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

        {turns.map(turn => (
          <div key={turn.id} className={compact ? 'space-y-1.5' : 'space-y-2'}>
            <div className="flex justify-end">
              <div
                className={`max-w-[85%] ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} rounded-lg ${promptSize} text-gray-200 whitespace-pre-wrap`}
                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.24)' }}
              >
                {turn.userPrompt}
              </div>
            </div>

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
                        label={`reasoning (${block.content.length} chars)`}
                        icon="🧠"
                        content={block.content}
                        accentColor="rgba(16,185,129,0.35)"
                        compact={compact}
                      />
                    )
                  case 'tool': {
                    const toolIndex = turn.blocks.indexOf(block)
                    const isScreenshotToolBlock = isScreenshotToolDisplay(block.toolName || '', block.toolDisplay || block.content)
                    const isMediaToolBlock = /generate[_\s-](?:image|voice|video)/i.test(`${block.toolName || ''} ${block.toolDisplay || block.content}`)
                    const resultBlock = turn.blocks.find((candidate, index) =>
                      candidate.kind === 'tool_result'
                      && index > toolIndex
                      && (candidate.toolUseId && block.toolUseId
                        ? candidate.toolUseId === block.toolUseId
                        : !turn.blocks.slice(toolIndex + 1, index).some(entry => entry.kind === 'tool'))
                    )

                    return (
                      <ToolCallCard
                        key={block.id}
                        name={block.toolName || 'tool'}
                        icon={block.toolIcon || '🔧'}
                        display={block.toolDisplay || block.content}
                        input={block.toolInput}
                        result={resultBlock ? {
                          preview: resultBlock.content.slice(0, 500),
                          isError: !!resultBlock.isError,
                          length: resultBlock.content.length,
                          fullResult: isScreenshotToolBlock || isMediaToolBlock || resultBlock.content.length <= 2000 ? resultBlock.content : undefined,
                        } : undefined}
                        audioTargetAvatarId={audioTargetAvatarId}
                        autoPlayAudio={true}
                        compact={compact}
                      />
                    )
                  }
                  case 'tool_result':
                    return null
                  case 'error':
                    return (
                      <div
                        key={block.id}
                        className={`${statusSize} text-red-400 font-mono px-2 py-1.5 rounded-lg`}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        {block.content}
                      </div>
                    )
                  case 'status':
                    return (
                      <div key={block.id} className={`${statusSize} text-gray-600 font-mono italic`}>
                        {block.content}
                      </div>
                    )
                  default:
                    return null
                }
              })}

              {turn.isStreaming && (
                compact ? (
                  <div className="flex items-center gap-1.5 text-[9px] text-emerald-400/70 font-mono py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    working...
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-[10px] text-emerald-400/70 font-mono py-2">
                    <div className="flex items-center gap-[3px]">
                      {[0, 1, 2, 3, 4].map(index => (
                        <span
                          key={index}
                          className="w-[3px] rounded-full bg-emerald-400"
                          style={{
                            animation: 'codexWave 1.2s ease-in-out infinite',
                            animationDelay: `${index * 0.1}s`,
                            height: '12px',
                          }}
                        />
                      ))}
                    </div>
                    <span>codex is working...</span>
                  </div>
                )
              )}

              {!turn.isStreaming && (turn.inputTokens || turn.cachedInputTokens || turn.outputTokens) && (
                <div className="pt-1 border-t border-white/5">
                  <UsageDisplay usage={turn} className={metaSize} />
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />

        {!autoScroll && turns.length > 0 && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
              }
            }}
            className={`sticky bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full ${compact ? 'text-[9px]' : 'text-[10px]'} font-mono font-bold cursor-pointer z-10 transition-all hover:scale-105`}
            style={{
              background: 'rgba(8,10,15,0.9)',
              border: '1px solid rgba(16,185,129,0.4)',
              color: '#34d399',
              boxShadow: '0 2px 12px rgba(16,185,129,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            ↓ auto-scroll
          </button>
        )}
      </div>

      <div className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} border-t border-white/10`}>
        {voiceInput.error && (
          <div className="mb-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] font-mono text-amber-100">
            {voiceInput.error}
          </div>
        )}
        <div className={`flex ${compact ? 'gap-1.5' : 'gap-2'} items-end`}>
          <AgentVoiceInputButton
            controller={voiceInput}
            disabled={isStreaming}
            className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded${compact ? '' : '-lg'} ${inputSize} font-mono border border-emerald-500/20 text-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed`}
            titleReady="Record from your mic, transcribe locally, and drop it into the Codex prompt."
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') return
              if (compact) event.stopPropagation()
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void invoke()
              }
            }}
            onFocus={compact ? event => event.stopPropagation() : undefined}
            placeholder={isStreaming ? (compact ? 'Working...' : 'Codex is working...') : 'Command Codex...'}
            rows={1}
            className={`flex-1 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded${compact ? '' : '-lg'} text-white ${inputSize} outline-none placeholder-gray-600 resize-none font-mono`}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: `1px solid ${isStreaming ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.12)'}`,
              minHeight: compact ? '30px' : '36px',
            }}
            disabled={isStreaming}
          />
          <button
            onClick={isStreaming ? cancel : () => void invoke()}
            disabled={!isStreaming && !input.trim()}
            className={`${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded${compact ? '' : '-lg'} ${inputSize} font-bold text-white cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 self-end`}
            style={{
              background: isStreaming
                ? 'rgba(239,68,68,0.4)'
                : 'linear-gradient(135deg, rgba(16,185,129,0.4) 0%, rgba(5,150,105,0.4) 100%)',
              border: `1px solid ${isStreaming ? 'rgba(239,68,68,0.5)' : 'rgba(16,185,129,0.3)'}`,
            }}
          >
            {isStreaming ? '■' : '▸'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes codexFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-5px) rotate(2deg); }
          75% { transform: translateY(-3px) rotate(-2deg); }
        }
        @keyframes codexWave {
          0%, 100% { transform: scaleY(0.4); opacity: 0.4; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
