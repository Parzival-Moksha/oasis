import {
  type TokenUsagePayload,
  hasTokenUsage,
  normalizeTokenUsagePayload,
} from '@/lib/token-usage'

export interface AnorakSessionEvent {
  type: 'session'
  sessionId: string
}

export interface AnorakStatusEvent {
  type: 'status'
  content: string
}

export interface AnorakTextEvent {
  type: 'text'
  content: string
}

export interface AnorakThinkingEvent {
  type: 'thinking'
  content: string
}

export interface AnorakThinkingStartEvent {
  type: 'thinking_start'
}

export interface AnorakToolStartEvent {
  type: 'tool_start'
  name: string
  icon: string
  id: string
}

export interface AnorakToolEvent {
  type: 'tool'
  name: string
  icon: string
  id: string
  input: Record<string, unknown>
  display: string
}

export interface AnorakToolResultEvent {
  type: 'tool_result'
  name: string
  preview: string
  isError: boolean
  length: number
  fullResult?: string
  toolUseId?: string
}

export interface AnorakProgressEvent extends TokenUsagePayload {
  type: 'progress'
  stopReason?: string
}

export interface AnorakResultEvent extends TokenUsagePayload {
  type: 'result'
  durationMs: number
  numTurns?: number
  stopReason?: string
}

export interface AnorakErrorEvent {
  type: 'error'
  content: string
}

export interface AnorakStderrEvent {
  type: 'stderr'
  content: string
}

export interface AnorakDoneEvent extends TokenUsagePayload {
  type: 'done'
  success: boolean
  exitCode?: number
}

export interface AnorakMediaEvent {
  type: 'media'
  mediaType: 'image' | 'audio' | 'video'
  url: string
  prompt?: string
}

export type AnorakEvent =
  | AnorakSessionEvent
  | AnorakStatusEvent
  | AnorakTextEvent
  | AnorakThinkingEvent
  | AnorakThinkingStartEvent
  | AnorakToolStartEvent
  | AnorakToolEvent
  | AnorakToolResultEvent
  | AnorakProgressEvent
  | AnorakResultEvent
  | AnorakErrorEvent
  | AnorakStderrEvent
  | AnorakDoneEvent
  | AnorakMediaEvent

export interface StreamBlock {
  id: string
  kind: 'text' | 'thinking' | 'tool' | 'tool_result' | 'error' | 'status' | 'user' | 'media'
  content: string
  toolName?: string
  toolIcon?: string
  toolInput?: Record<string, unknown>
  toolDisplay?: string
  toolUseId?: string
  isError?: boolean
  isExpanded?: boolean
  mediaType?: 'image' | 'audio' | 'video'
  mediaUrl?: string
  mediaPrompt?: string
}

export interface Turn {
  id: string
  userPrompt: string
  blocks: StreamBlock[]
  isStreaming: boolean
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  timestamp: number
}

export interface SessionEntry {
  id: string
  label: string
  timestamp: string
  turnCount: number
  fileSize: number
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  tools?: { name: string; input?: string }[]
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
}

export async function* parseAnorakSSE(response: Response): AsyncGenerator<AnorakEvent> {
  if (!response.body) {
    yield { type: 'error', content: 'No response body' }
    return
  }

  const reader = response.body.getReader()
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
        yield JSON.parse(trimmed.slice(6)) as AnorakEvent
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }
}

export const TOOL_ICONS_MAP: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Bash: '⚡',
  Grep: '🔍',
  Glob: '📂',
  Agent: '🤖',
  TodoWrite: '📋',
  WebFetch: '🌐',
  WebSearch: '🔎',
  Task: '📋',
  Skill: '🎯',
  generate_image: '🎨',
  generate_voice: '🔊',
  generate_video: '🎬',
  get_mission: '📋',
  get_missions_queue: '📋',
  create_mission: '📋',
  mature_mission: '📋',
  report_review: '📋',
  report_test: '📋',
}

export function fmtTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) {
    if (value < 10_000) return `${(value / 1000).toFixed(1)}K`
    return `${Math.round(value / 1000)}K`
  }
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  return `${Math.round(value / 1_000_000)}M`
}

export function recordTokenUsage(source: string, inputTokens: number, outputTokens: number): void
export function recordTokenUsage(source: string, usage: Partial<TokenUsagePayload>): void
export function recordTokenUsage(
  source: string,
  inputOrUsage: number | Partial<TokenUsagePayload>,
  outputTokens = 0,
) {
  const usage = typeof inputOrUsage === 'number'
    ? normalizeTokenUsagePayload({
        inputTokens: inputOrUsage,
        outputTokens,
        sessionId: '',
        provider: 'unknown',
        model: 'unknown',
      })
    : normalizeTokenUsagePayload({
        sessionId: '',
        provider: 'unknown',
        model: 'unknown',
        ...inputOrUsage,
      })

  if (!hasTokenUsage(usage)) return

  try {
    fetch('/api/token-burn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, ...usage }),
    }).catch(() => {
      // Fire-and-forget only.
    })
  } catch {
    // Ignore SSR/offline cases.
  }
}

export const MODELS = [
  { id: 'opus', label: 'Opus', color: '#f59e0b' },
  { id: 'sonnet', label: 'Sonnet', color: '#38bdf8' },
  { id: 'haiku', label: 'Haiku', color: '#22c55e' },
]
