// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// ANORAK ENGINE — Shared types, SSE parser, constants for Claude Code UI
// ─═̷─═̷─ॐ─═̷─═̷─ Single source of truth for 2D panel + 3D window ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

// ═══════════════════════════════════════════════════════════════════════════
// TYPES — Anorak SSE event shapes
// ═══════════════════════════════════════════════════════════════════════════

export interface AnorakSessionEvent { type: 'session'; sessionId: string }
export interface AnorakStatusEvent { type: 'status'; content: string }
export interface AnorakTextEvent { type: 'text'; content: string }
export interface AnorakThinkingEvent { type: 'thinking'; content: string }
export interface AnorakThinkingStartEvent { type: 'thinking_start' }
export interface AnorakToolStartEvent { type: 'tool_start'; name: string; icon: string; id: string }
export interface AnorakToolEvent { type: 'tool'; name: string; icon: string; id: string; input: Record<string, unknown>; display: string }
export interface AnorakToolResultEvent { type: 'tool_result'; name: string; preview: string; isError: boolean; length: number; fullResult?: string; toolUseId?: string }
export interface AnorakProgressEvent { type: 'progress'; inputTokens: number; outputTokens: number; stopReason?: string }
export interface AnorakResultEvent { type: 'result'; costUsd: number; durationMs: number; sessionId: string }
export interface AnorakErrorEvent { type: 'error'; content: string }
export interface AnorakStderrEvent { type: 'stderr'; content: string }
export interface AnorakDoneEvent { type: 'done'; success: boolean; sessionId: string; costUsd?: number; inputTokens?: number; outputTokens?: number }

export type AnorakEvent =
  | AnorakSessionEvent | AnorakStatusEvent | AnorakTextEvent
  | AnorakThinkingEvent | AnorakThinkingStartEvent
  | AnorakToolStartEvent | AnorakToolEvent | AnorakToolResultEvent
  | AnorakProgressEvent | AnorakResultEvent
  | AnorakErrorEvent | AnorakStderrEvent | AnorakDoneEvent

// A single block in the conversation stream
export interface StreamBlock {
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

// A single turn (user prompt + Anorak response)
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

// Session entry from /api/claude-code/sessions
export interface SessionEntry {
  id: string
  label: string
  timestamp: string
  turnCount: number
  fileSize: number
}

// History message from session replay
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  tools?: { name: string; input?: string }[]
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
}

// ═══════════════════════════════════════════════════════════════════════════
// SSE PARSER — generic async generator
// ═══════════════════════════════════════════════════════════════════════════

export async function* parseAnorakSSE(response: Response): AsyncGenerator<AnorakEvent> {
  if (!response.body) { yield { type: 'error', content: 'No response body' }; return }
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
      } catch { /* skip malformed */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL ICONS — shared between live stream and session history
// ═══════════════════════════════════════════════════════════════════════════

export const TOOL_ICONS_MAP: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Bash: '⚡',
  Grep: '🔍', Glob: '📂', Agent: '🤖', TodoWrite: '📋',
  WebFetch: '🌐', WebSearch: '🔎', Task: '📋', Skill: '🎯',
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN FORMATTER — exact under 1K, rounded above
// ═══════════════════════════════════════════════════════════════════════════

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}K`
  return `${Math.round(n / 1000)}K`
}

// ═══════════════════════════════════════════════════════════════════════════
// MODELS — available Claude models
// ═══════════════════════════════════════════════════════════════════════════

export const MODELS = [
  { id: 'opus', label: 'Opus', color: '#f59e0b' },
  { id: 'sonnet', label: 'Sonnet', color: '#38bdf8' },
  { id: 'haiku', label: 'Haiku', color: '#22c55e' },
]
