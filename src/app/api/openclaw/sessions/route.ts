import { NextRequest, NextResponse } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'
import {
  createOpenclawDraftSession,
  getOpenclawCachedSession,
  listOpenclawCachedSessions,
  type OpenclawCachedSessionSummary,
  upsertOpenclawSessionSummary,
} from '@/lib/openclaw-session-cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface OpenclawMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  state?: 'streaming' | 'done' | 'failed'
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  toolState?: 'running' | 'done' | 'failed'
  toolDurationMs?: number
  toolInputSummary?: string
}

interface GatewaySessionsListResponse {
  sessions?: unknown[]
}

interface GatewayChatHistoryResponse {
  sessionKey?: string
  sessionId?: string
  messages?: unknown[]
}

interface HydratedSessionSummary {
  summary: OpenclawCachedSessionSummary
  messages: OpenclawMessage[]
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function summarizeText(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function summarizeJson(value: unknown, maxLength = 120): string {
  if (value == null) return 'no args'
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return 'no args'
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw
}

function normalizeCompactText(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
}

function summarizeToolInput(toolName: string, value: unknown, maxLength = 120): string {
  const summary = summarizeJson(value, maxLength)
  if (!summary || summary === 'no args') return summary
  const normalizedSummary = normalizeCompactText(summary.replace(/^"|"$/g, ''))
  const normalizedToolName = normalizeCompactText(toolName)
  return normalizedSummary === normalizedToolName ? '' : summary
}

function humanizeSessionKey(sessionKey: string): string {
  if (!sessionKey) return 'OpenClaw session'
  const tail = sessionKey.split(':').pop() || sessionKey
  if (tail === 'main') return 'Main'
  if (tail.startsWith('draft-')) return 'OpenClaw session'
  return tail
}

function cleanHistoryText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const withoutSenderMeta = normalized.replace(
    /^Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/m,
    '',
  )
  return withoutSenderMeta
    .replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2}[^\]]*\]\s*/, '')
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isWrappedMetadataText(text: string): boolean {
  return /^Sender \(untrusted metadata\):/i.test(text.trim())
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return cleanHistoryText(content)
  if (!Array.isArray(content)) return ''

  const textParts = content
    .map(block => {
      if (typeof block === 'string') return block
      const blockRecord = asRecord(block)
      const blockType = stringField(blockRecord, 'type')
      if (blockType && !['text', 'output_text'].includes(blockType)) return ''
      return stringField(blockRecord, 'text', 'content')
    })
    .filter(Boolean)

  return cleanHistoryText(textParts.join('\n').trim())
}

function normalizeHistoryEntry(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw)
  if (stringField(record, 'type') === 'message') {
    const nested = asRecord(record.message)
    return {
      ...nested,
      id: stringField(record, 'id') || stringField(nested, 'id'),
      timestamp: record.timestamp ?? nested.timestamp,
      toolCallId: nested.toolCallId ?? nested.tool_call_id,
      toolName: nested.toolName ?? nested.tool_name,
      details: nested.details,
      isError: nested.isError,
    }
  }
  return record
}

function normalizeGatewaySessionSummary(
  raw: unknown,
  cached: OpenclawCachedSessionSummary | null,
): OpenclawCachedSessionSummary | null {
  const record = asRecord(raw)
  const id = stringField(record, 'key', 'sessionKey', 'id')
  if (!id) return null

  const updatedAt = parseTimestamp(record.updatedAt ?? record.lastActivityAt ?? cached?.updatedAt ?? Date.now())
  const createdAt = parseTimestamp(record.createdAt ?? cached?.createdAt ?? updatedAt)
  const rawDerivedTitle = stringField(record, 'derivedTitle')
  const rawPreferredTitle = stringField(record, 'displayName', 'label', 'subject')
  const rawCachedTitle = cached?.title || ''
  const derivedTitle = isWrappedMetadataText(rawDerivedTitle) ? '' : cleanHistoryText(rawDerivedTitle)
  const preferredTitle = isWrappedMetadataText(rawPreferredTitle) ? '' : cleanHistoryText(rawPreferredTitle)
  const cachedTitle = isWrappedMetadataText(rawCachedTitle) ? '' : cleanHistoryText(rawCachedTitle)
  const cleanedTitle = summarizeText(
    preferredTitle || derivedTitle,
    44,
  )
  const title = cleanedTitle || summarizeText(cachedTitle, 44) || humanizeSessionKey(id)
  const preview = summarizeText(
    cleanHistoryText(stringField(record, 'lastMessagePreview', 'preview') || cached?.preview || ''),
  )
  const messageCount = numberField(record, 'messageCount', 'count') ?? cached?.messageCount ?? 0

  return {
    id,
    title,
    preview,
    source: 'gateway',
    createdAt,
    updatedAt,
    messageCount,
  }
}

function parseGatewayHistory(messages: unknown[]): OpenclawMessage[] {
  const parsed: OpenclawMessage[] = []
  const toolIndexByCallId = new Map<string, number>()

  const upsertToolResult = (callId: string, nextMessage: OpenclawMessage) => {
    const existingIndex = toolIndexByCallId.get(callId)
    if (typeof existingIndex === 'number' && parsed[existingIndex]) {
      parsed[existingIndex] = {
        ...parsed[existingIndex],
        ...nextMessage,
        toolInput: parsed[existingIndex].toolInput ?? nextMessage.toolInput,
      }
      return
    }
    parsed.push(nextMessage)
    toolIndexByCallId.set(callId, parsed.length - 1)
  }

  for (const raw of messages) {
    const entry = normalizeHistoryEntry(raw)
    const role = stringField(entry, 'role').toLowerCase()
    const timestamp = parseTimestamp(entry.timestamp)
    const entryId = stringField(entry, 'id') || `history-${timestamp}-${parsed.length}`

    if (role === 'user' || role === 'assistant' || role === 'system') {
      const content = Array.isArray(entry.content) ? entry.content : entry.content
      const text = extractTextFromContent(content)
      if (text) {
        parsed.push({
          id: entryId,
          role: role as OpenclawMessage['role'],
          content: text,
          timestamp,
          state: 'done',
        })
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          const blockRecord = asRecord(block)
          const blockType = stringField(blockRecord, 'type').toLowerCase()
          if (!['toolcall', 'tool_call', 'function_call', 'tooluse', 'tool_use'].includes(blockType)) continue

          const callId = stringField(blockRecord, 'id', 'callId', 'toolCallId', 'tool_call_id') || `${entryId}-tool-${parsed.length}`
          const toolName = stringField(blockRecord, 'name', 'toolName', 'tool')
          const toolInput = blockRecord.arguments ?? blockRecord.args ?? blockRecord.input ?? {}
          const toolMessage: OpenclawMessage = {
            id: callId,
            role: 'tool',
            content: '',
            timestamp,
            toolName: toolName || 'tool',
            toolInput,
            toolState: 'running',
            toolInputSummary: summarizeToolInput(toolName || 'tool', toolInput),
          }

          parsed.push(toolMessage)
          toolIndexByCallId.set(callId, parsed.length - 1)
        }
      }
      continue
    }

    if (['toolresult', 'tool_result', 'tool', 'function'].includes(role)) {
      const callId = stringField(entry, 'toolCallId', 'tool_call_id', 'id') || `tool-result-${timestamp}-${parsed.length}`
      const toolName = stringField(entry, 'toolName', 'tool_name', 'name') || 'tool'
      const toolOutput = 'details' in entry ? entry.details : entry.output ?? extractTextFromContent(entry.content)
      const isError = Boolean(entry.isError)
      const toolMessage: OpenclawMessage = {
        id: callId,
        role: 'tool',
        content: '',
        timestamp,
        toolName,
        toolOutput,
        toolState: isError ? 'failed' : 'done',
        toolDurationMs: numberField(asRecord(entry.details), 'durationMs', 'elapsedMs'),
        toolInputSummary: '',
      }
      upsertToolResult(callId, toolMessage)
      continue
    }
  }

  return parsed
}

async function hydrateSessionSummaryFromHistory(
  client: Awaited<ReturnType<typeof ensureGatewayReady>>,
  session: OpenclawCachedSessionSummary,
): Promise<HydratedSessionSummary | null> {
  try {
    const historyPayload = await client.callMethod<GatewayChatHistoryResponse>('chat.history', {
      sessionKey: session.id,
      limit: 200,
    })
    const parsedMessages = parseGatewayHistory(Array.isArray(historyPayload.messages) ? historyPayload.messages : [])
    if (parsedMessages.length === 0) return { summary: session, messages: parsedMessages }

    const latestVisible = [...parsedMessages]
      .reverse()
      .find(entry => (entry.role === 'assistant' || entry.role === 'user') && entry.content.trim())

    return {
      summary: {
        ...session,
        preview: summarizeText(latestVisible?.content || session.preview || ''),
        updatedAt: parsedMessages[parsedMessages.length - 1]?.timestamp || session.updatedAt,
        messageCount: parsedMessages.filter(entry => entry.role === 'user' || entry.role === 'assistant').length,
      },
      messages: parsedMessages,
    }
  } catch {
    return null
  }
}

async function ensureGatewayReady() {
  const client = getOasisGatewayClient()
  await client.ensureReady()
  return client
}

async function listGatewaySessions(limit = 120): Promise<OpenclawCachedSessionSummary[]> {
  const client = await ensureGatewayReady()
  const cachedSessions = await listOpenclawCachedSessions()
  const cachedById = new Map(cachedSessions.map(session => [session.id, session]))
  const payload = await client.callMethod<GatewaySessionsListResponse>('sessions.list', {
    limit,
    includeDerivedTitles: true,
    includeLastMessage: true,
    includeGlobal: true,
    includeUnknown: true,
  })

  let gatewaySessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
    .map(raw => normalizeGatewaySessionSummary(raw, cachedById.get(stringField(asRecord(raw), 'key', 'sessionKey', 'id')) ?? null))
    .filter((value): value is OpenclawCachedSessionSummary => Boolean(value))

  const sessionsNeedingHydration = gatewaySessions
    .filter(session => session.messageCount <= 0 || !session.preview)
    .slice(0, 8)

  if (sessionsNeedingHydration.length > 0) {
    const hydrated = await Promise.allSettled(
      sessionsNeedingHydration.map(session => hydrateSessionSummaryFromHistory(client, session)),
    )
    const hydratedById = new Map<string, OpenclawCachedSessionSummary>()
    for (const result of hydrated) {
      if (result.status !== 'fulfilled' || !result.value) continue
      hydratedById.set(result.value.summary.id, result.value.summary)
    }
    gatewaySessions = gatewaySessions.map(session => hydratedById.get(session.id) || session)
  }

  for (const session of gatewaySessions) {
    await upsertOpenclawSessionSummary(session)
  }

  const drafts = cachedSessions.filter(session => session.source === 'draft' && !gatewaySessions.some(entry => entry.id === session.id))

  return [...gatewaySessions, ...drafts].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function GET(request: NextRequest) {
  const sessionId = sanitizeString(request.nextUrl.searchParams.get('sessionId'))
  if (sessionId) {
    const cachedSession = await getOpenclawCachedSession(sessionId)
    try {
      const client = await ensureGatewayReady()
      const [historyPayload, listPayload] = await Promise.all([
        client.callMethod<GatewayChatHistoryResponse>('chat.history', {
          sessionKey: sessionId,
          limit: 200,
        }),
        client.callMethod<GatewaySessionsListResponse>('sessions.list', {
          limit: 200,
          search: sessionId,
          includeDerivedTitles: true,
          includeLastMessage: true,
          includeGlobal: true,
          includeUnknown: true,
        }).catch(() => ({ sessions: [] })),
      ])

      const gatewaySummary = (Array.isArray(listPayload.sessions) ? listPayload.sessions : [])
        .map(raw => normalizeGatewaySessionSummary(raw, cachedSession))
        .find(entry => entry?.id === sessionId) ?? cachedSession
      const parsedMessages = parseGatewayHistory(Array.isArray(historyPayload.messages) ? historyPayload.messages : [])
      const latestVisible = [...parsedMessages]
        .reverse()
        .find(entry => (entry.role === 'assistant' || entry.role === 'user') && entry.content.trim())
      const hydratedSummary = gatewaySummary ? {
        ...gatewaySummary,
        preview: summarizeText(latestVisible?.content || gatewaySummary.preview || ''),
        updatedAt: parsedMessages[parsedMessages.length - 1]?.timestamp || gatewaySummary.updatedAt,
        messageCount: parsedMessages.filter(entry => entry.role === 'user' || entry.role === 'assistant').length,
      } : gatewaySummary

      if (hydratedSummary) {
        await upsertOpenclawSessionSummary(hydratedSummary)
      }

      return NextResponse.json({
        session: hydratedSummary,
        messages: parsedMessages,
      })
    } catch {
      if (!cachedSession) {
        return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
      }
      if (cachedSession.source === 'draft') {
        return NextResponse.json({
          session: cachedSession,
          messages: [],
        })
      }
      return NextResponse.json({
        session: cachedSession,
        messages: [],
      }, { status: 503 })
    }
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'))
  const offsetParam = Number(request.nextUrl.searchParams.get('offset'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0

  try {
    const sessions = await listGatewaySessions(limit ? Math.max(limit + offset, 120) : 120)
    const sliced = typeof limit === 'number' ? sessions.slice(offset, offset + limit) : sessions.slice(offset)
    return NextResponse.json({ sessions: sliced })
  } catch {
    const sessions = await listOpenclawCachedSessions({
      limit,
      offset,
    })
    return NextResponse.json({
      sessions,
    })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const session = await createOpenclawDraftSession(typeof body?.title === 'string' ? body.title : undefined)
  return NextResponse.json({
    ok: true,
    session,
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const id = sanitizeString(body.id)
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 })
  }

  const createdAt = typeof body.createdAt === 'number' && Number.isFinite(body.createdAt) ? body.createdAt : Date.now()
  const updatedAt = typeof body.updatedAt === 'number' && Number.isFinite(body.updatedAt) ? body.updatedAt : Date.now()
  const messageCount = typeof body.messageCount === 'number' && Number.isFinite(body.messageCount) ? body.messageCount : 0
  const source = sanitizeString(body.source) === 'gateway' || sanitizeString(body.source) === 'cache'
    ? sanitizeString(body.source) as 'gateway' | 'cache'
    : 'draft'

  const session = await upsertOpenclawSessionSummary({
    id,
    title: sanitizeString(body.title) || 'OpenClaw session',
    preview: sanitizeString(body.preview),
    source,
    createdAt,
    updatedAt,
    messageCount,
  })

  return NextResponse.json({
    ok: true,
    session,
  })
}
