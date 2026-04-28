import type { TokenUsagePayload } from '@/lib/token-usage'

export interface CodexUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

export interface CodexSessionEvent {
  type: 'session'
  sessionId: string
}

export interface CodexStatusEvent {
  type: 'status'
  content: string
}

export interface CodexTextEvent {
  type: 'text'
  content: string
}

export interface CodexThinkingEvent {
  type: 'thinking'
  content: string
}

export interface CodexToolEvent {
  type: 'tool'
  id: string
  name: string
  icon: string
  input?: Record<string, unknown>
  display: string
}

export interface CodexToolResultEvent {
  type: 'tool_result'
  name: string
  toolUseId?: string
  preview: string
  isError: boolean
  length: number
  fullResult?: string
}

export interface CodexResultEvent extends TokenUsagePayload {
  type: 'result'
  cachedInputTokens: number
}

export interface CodexErrorEvent {
  type: 'error'
  content: string
}

export interface CodexDoneEvent extends TokenUsagePayload {
  type: 'done'
  success: boolean
  cachedInputTokens: number
}

export type CodexEvent =
  | CodexSessionEvent
  | CodexStatusEvent
  | CodexTextEvent
  | CodexThinkingEvent
  | CodexToolEvent
  | CodexToolResultEvent
  | CodexResultEvent
  | CodexErrorEvent
  | CodexDoneEvent

export interface CodexStreamBlock {
  id: string
  kind: 'text' | 'thinking' | 'tool' | 'tool_result' | 'error' | 'status'
  content: string
  toolName?: string
  toolIcon?: string
  toolInput?: Record<string, unknown>
  toolDisplay?: string
  toolUseId?: string
  isError?: boolean
}

export interface CodexTurn extends CodexUsage {
  id: string
  userPrompt: string
  blocks: CodexStreamBlock[]
  isStreaming: boolean
  timestamp: number
}

export async function* parseCodexSSE(response: Response): AsyncGenerator<CodexEvent> {
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
      if (!trimmed.startsWith('data: ')) continue
      if (trimmed === 'data: [DONE]') return

      try {
        yield JSON.parse(trimmed.slice(6)) as CodexEvent
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }
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

export function getFreshInputTokens(usage: Pick<CodexUsage, 'inputTokens' | 'cachedInputTokens'>): number {
  return Math.max(0, usage.inputTokens - usage.cachedInputTokens)
}
