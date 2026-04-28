import { createReadStream, type Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, normalize } from 'path'
import { createInterface } from 'readline'

import type { CodexStreamBlock, CodexTurn } from '@/lib/codex-engine'

type JsonObject = Record<string, unknown>

export interface CodexSessionFileSummary {
  sessionId: string
  filePath: string
  cwd?: string
  source?: string
  model?: string
  title?: string
  lastUserPrompt?: string
  lastMessage?: string
  lastMessageRole?: 'user' | 'assistant'
  lastMessageAt?: string
  lastMessageLine?: number
  messageCount: number
  startedAt: string
  updatedAt: string
}

export interface CodexSessionFileDetail extends CodexSessionFileSummary {
  turns: CodexTurn[]
}

interface SessionFileCandidate {
  filePath: string
  updatedAt: Date
}

const MAX_HISTORY_BLOCK_CHARS = 20000

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function stringField(record: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizePathForCompare(value: string): string {
  return normalize(value).replace(/\\/g, '/').toLowerCase()
}

function previewText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`
}

function historyText(value: string, maxLength = MAX_HISTORY_BLOCK_CHARS): string {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxLength) return normalized
  const omitted = normalized.length - maxLength
  return `${normalized.slice(0, maxLength).trim()}\n... [truncated ${omitted.toLocaleString()} chars]`
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(part => {
      const record = asRecord(part)
      return stringField(record, 'text', 'input_text', 'output_text')
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseTimestampMs(value: string, fallback: number): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function emptyTurnUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  }
}

function parseToolInput(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Keep raw arguments visible when they are not JSON.
  }
  return { arguments: value }
}

function userPromptFromWrappedInput(value: string): string {
  const marker = 'User request:\n'
  const markerIndex = value.lastIndexOf(marker)
  if (markerIndex >= 0) return value.slice(markerIndex + marker.length).trim()
  if (value.trimStart().startsWith('# AGENTS.md instructions')) return ''
  if (value.trimStart().startsWith('<environment_context>')) return ''
  return value.trim()
}

function defaultCodexSessionsRoot(): string {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  return join(codexHome, 'sessions')
}

async function collectJsonlFiles(root: string, out: SessionFileCandidate[]) {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(entries.map(async entry => {
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) {
      await collectJsonlFiles(filePath, out)
      return
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return

    try {
      const info = await stat(filePath)
      out.push({ filePath, updatedAt: info.mtime })
    } catch {
      // Ignore files that disappear during a scan.
    }
  }))
}

export async function parseCodexSessionFile(filePath: string): Promise<CodexSessionFileSummary | null> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return null

  let sessionId = ''
  let cwd = ''
  let source = ''
  let model = ''
  let startedAt = info.birthtime.toISOString()
  let title = ''
  let lastUserPrompt = ''
  let lastMessage = ''
  let lastMessageRole: 'user' | 'assistant' | undefined
  let lastMessageAt = info.mtime.toISOString()
  let lastMessageLine = 0
  let messageCount = 0
  let lineNumber = 0

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of lines) {
      lineNumber += 1
      const trimmed = line.trim()
      if (!trimmed) continue

      let parsed: JsonObject
      try {
        parsed = JSON.parse(trimmed) as JsonObject
      } catch {
        continue
      }

      const timestamp = stringField(parsed, 'timestamp')
      const type = stringField(parsed, 'type')
      const payload = asRecord(parsed.payload)

      if (type === 'session_meta') {
        sessionId = stringField(payload, 'id') || sessionId
        cwd = stringField(payload, 'cwd') || cwd
        source = stringField(payload, 'originator', 'source') || source
        startedAt = stringField(payload, 'timestamp') || timestamp || startedAt
        model = stringField(payload, 'model') || model
        continue
      }

      if (type === 'turn_context') {
        cwd = stringField(payload, 'cwd') || cwd
        model = stringField(payload, 'model') || model
        continue
      }

      if (type !== 'response_item') continue

      if (stringField(payload, 'type') === 'message') {
        const role = stringField(payload, 'role')
        if (role !== 'user' && role !== 'assistant') continue
        const text = extractMessageText(payload.content)
        if (!text) continue

        messageCount += 1
        lastMessage = previewText(text, 280)
        lastMessageRole = role
        lastMessageAt = timestamp || lastMessageAt
        lastMessageLine = lineNumber

        if (role === 'user') {
          const userPrompt = userPromptFromWrappedInput(text)
          if (userPrompt) {
            lastUserPrompt = previewText(userPrompt, 220)
            if (!title) title = previewText(userPrompt, 90)
          }
        }
      }
    }
  } catch {
    return null
  }

  if (!sessionId) return null

  return {
    sessionId,
    filePath,
    cwd: cwd || undefined,
    source: source || undefined,
    model: model || undefined,
    title: title || lastUserPrompt || undefined,
    lastUserPrompt: lastUserPrompt || undefined,
    lastMessage: lastMessage || undefined,
    lastMessageRole,
    lastMessageAt,
    lastMessageLine: lastMessageLine || undefined,
    messageCount,
    startedAt,
    updatedAt: info.mtime.toISOString(),
  }
}

export async function parseCodexSessionFileDetail(filePath: string): Promise<CodexSessionFileDetail | null> {
  const summary = await parseCodexSessionFile(filePath)
  if (!summary) return null

  const turns: CodexTurn[] = []
  let currentTurn: CodexTurn | null = null
  let lineNumber = 0

  const ensureTurn = (timestamp: string, label = 'Codex session context') => {
    if (currentTurn) return currentTurn
    currentTurn = {
      id: `codex-history-turn-${lineNumber || turns.length}`,
      userPrompt: label,
      blocks: [],
      isStreaming: false,
      timestamp: parseTimestampMs(timestamp, lineNumber),
      ...emptyTurnUsage(),
    }
    turns.push(currentTurn)
    return currentTurn
  }

  const pushBlock = (timestamp: string, block: CodexStreamBlock) => {
    ensureTurn(timestamp).blocks.push(block)
  }

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of lines) {
      lineNumber += 1
      const trimmed = line.trim()
      if (!trimmed) continue

      let parsed: JsonObject
      try {
        parsed = JSON.parse(trimmed) as JsonObject
      } catch {
        continue
      }

      const timestamp = stringField(parsed, 'timestamp')
      const payload = asRecord(parsed.payload)
      const entryType = stringField(parsed, 'type')

      if (entryType === 'event_msg') {
        const eventType = stringField(payload, 'type')
        const message = stringField(payload, 'message')
        if (eventType === 'error' && message) {
          pushBlock(timestamp, {
            id: `codex-history-error-${lineNumber}`,
            kind: 'error',
            content: historyText(message),
          })
        }
        continue
      }

      if (entryType !== 'response_item') continue

      const payloadType = stringField(payload, 'type')

      if (payloadType === 'message') {
        const role = stringField(payload, 'role')
        const text = extractMessageText(payload.content)
        if (!text) continue

        if (role === 'user') {
          const userPrompt = userPromptFromWrappedInput(text)
          if (!userPrompt) continue
          currentTurn = {
            id: `codex-history-turn-${lineNumber}`,
            userPrompt,
            blocks: [],
            isStreaming: false,
            timestamp: parseTimestampMs(timestamp, lineNumber),
            ...emptyTurnUsage(),
          }
          turns.push(currentTurn)
          continue
        }

        if (role === 'assistant') {
          pushBlock(timestamp, {
            id: `codex-history-text-${lineNumber}`,
            kind: 'text',
            content: historyText(text),
          })
        }
        continue
      }

      if (payloadType === 'function_call') {
        const callId = stringField(payload, 'call_id', 'id') || `tool-${lineNumber}`
        const name = stringField(payload, 'name') || 'tool'
        pushBlock(timestamp, {
          id: `codex-history-tool-${lineNumber}`,
          kind: 'tool',
          content: name,
          toolName: name,
          toolDisplay: name,
          toolInput: parseToolInput(payload.arguments),
          toolUseId: callId,
        })
        continue
      }

      if (payloadType === 'function_call_output') {
        const callId = stringField(payload, 'call_id', 'id') || undefined
        const output = stringField(payload, 'output', 'result', 'text')
        if (!output) continue
        pushBlock(timestamp, {
          id: `codex-history-result-${lineNumber}`,
          kind: 'tool_result',
          content: historyText(output),
          toolUseId: callId,
          isError: /^Exit code:\s*[1-9]/.test(output),
        })
        continue
      }

      if (payloadType === 'reasoning') {
        const reasoning = extractMessageText(payload.summary) || stringField(payload, 'summary', 'text', 'content')
        if (!reasoning) continue
        pushBlock(timestamp, {
          id: `codex-history-thinking-${lineNumber}`,
          kind: 'thinking',
          content: historyText(reasoning),
        })
      }
    }
  } catch {
    return null
  }

  return {
    ...summary,
    turns,
  }
}

export async function listCodexSessionFileSummaries(options: {
  limit?: number
  cwd?: string
  root?: string
} = {}): Promise<CodexSessionFileSummary[]> {
  const limit = Math.max(1, Math.min(100, options.limit || 50))
  const root = options.root || defaultCodexSessionsRoot()
  const cwd = options.cwd ? normalizePathForCompare(options.cwd) : ''
  const candidates: SessionFileCandidate[] = []

  await collectJsonlFiles(root, candidates)
  candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  const summaries: CodexSessionFileSummary[] = []
  const maxFilesToParse = Math.max(limit * 6, 60)

  for (const candidate of candidates.slice(0, maxFilesToParse)) {
    const summary = await parseCodexSessionFile(candidate.filePath)
    if (!summary) continue
    if (cwd && summary.cwd && normalizePathForCompare(summary.cwd) !== cwd) continue
    summaries.push(summary)
    if (summaries.length >= limit) break
  }

  return summaries
}

export async function readCodexSessionFileDetail(options: {
  sessionId: string
  cwd?: string
  root?: string
}): Promise<CodexSessionFileDetail | null> {
  const sessionId = options.sessionId.trim()
  if (!/^[a-z0-9_-]+$/i.test(sessionId)) return null

  const root = options.root || defaultCodexSessionsRoot()
  const cwd = options.cwd ? normalizePathForCompare(options.cwd) : ''
  const candidates: SessionFileCandidate[] = []

  await collectJsonlFiles(root, candidates)
  candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

  for (const candidate of candidates) {
    const summary = await parseCodexSessionFile(candidate.filePath)
    if (!summary || summary.sessionId !== sessionId) continue
    if (cwd && summary.cwd && normalizePathForCompare(summary.cwd) !== cwd) continue
    return parseCodexSessionFileDetail(candidate.filePath)
  }

  return null
}
