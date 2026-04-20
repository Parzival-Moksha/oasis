import 'server-only'

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface OpenclawCachedAttachment {
  type: 'image' | 'video' | 'audio' | 'file'
  name?: string
  url?: string
}

export interface OpenclawCachedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  attachments?: OpenclawCachedAttachment[]
}

export interface OpenclawCachedSessionSummary {
  id: string
  title: string
  preview: string
  source: 'draft' | 'gateway' | 'cache'
  createdAt: number
  updatedAt: number
  messageCount: number
}

interface OpenclawSessionCacheEntry {
  summary: OpenclawCachedSessionSummary
  messages: OpenclawCachedMessage[]
}

type OpenclawSessionCache = Record<string, OpenclawSessionCacheEntry>

const CACHE_PATH = join(process.cwd(), 'prisma', 'data', 'openclaw-session-cache.json')

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAttachment(raw: unknown): OpenclawCachedAttachment | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const type = sanitizeString(record.type)
  if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'file') return null

  return {
    type,
    ...(sanitizeString(record.name) ? { name: sanitizeString(record.name) } : {}),
    ...(sanitizeString(record.url) ? { url: sanitizeString(record.url) } : {}),
  }
}

function normalizeMessage(raw: unknown): OpenclawCachedMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const role = sanitizeString(record.role)
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null

  const id = sanitizeString(record.id)
  const content = sanitizeString(record.content)
  const timestamp = typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
    ? record.timestamp
    : Date.now()

  if (!id) return null

  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map(normalizeAttachment).filter((entry): entry is OpenclawCachedAttachment => Boolean(entry))
    : undefined

  return {
    id,
    role,
    content,
    timestamp,
    ...(attachments && attachments.length ? { attachments } : {}),
  }
}

function normalizeSummary(raw: unknown, sessionId: string): OpenclawCachedSessionSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const source = sanitizeString(record.source)
  const normalizedSource = source === 'gateway' || source === 'cache' ? source : 'draft'
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now()
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt
  const title = sanitizeString(record.title) || 'OpenClaw session'
  const preview = sanitizeString(record.preview)
  const messageCount = typeof record.messageCount === 'number' && Number.isFinite(record.messageCount) ? record.messageCount : 0

  return {
    id: sessionId,
    title,
    preview,
    source: normalizedSource,
    createdAt,
    updatedAt,
    messageCount,
  }
}

async function readCache(): Promise<OpenclawSessionCache> {
  if (!existsSync(CACHE_PATH)) return {}

  try {
    const raw = await readFile(CACHE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}

    const entries: OpenclawSessionCache = {}
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const messages = Array.isArray(record.messages)
        ? record.messages.map(normalizeMessage).filter((entry): entry is OpenclawCachedMessage => Boolean(entry))
        : []
      const summary = normalizeSummary(record.summary, sessionId)
      if (!summary) continue
      entries[sessionId] = {
        summary: {
          ...summary,
          preview: summary.preview || messages[messages.length - 1]?.content.slice(0, 120) || '',
          messageCount: Math.max(summary.messageCount, messages.length),
          updatedAt: Math.max(summary.updatedAt, messages[messages.length - 1]?.timestamp || summary.updatedAt),
        },
        messages,
      }
    }

    return entries
  } catch {
    return {}
  }
}

async function writeCache(cache: OpenclawSessionCache) {
  await mkdir(join(process.cwd(), 'prisma', 'data'), { recursive: true })
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`)
}

export async function listOpenclawCachedSessions(): Promise<OpenclawCachedSessionSummary[]> {
  const cache = await readCache()
  return Object.values(cache)
    .map(entry => entry.summary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getOpenclawCachedSession(sessionId: string): Promise<OpenclawSessionCacheEntry | null> {
  const safeSessionId = sanitizeString(sessionId)
  if (!safeSessionId) return null
  const cache = await readCache()
  return cache[safeSessionId] || null
}

export async function createOpenclawDraftSession(title?: string): Promise<OpenclawCachedSessionSummary> {
  const cache = await readCache()
  const now = Date.now()
  const sessionId = `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const summary: OpenclawCachedSessionSummary = {
    id: sessionId,
    title: sanitizeString(title) || 'New OpenClaw session',
    preview: '',
    source: 'draft',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }

  cache[sessionId] = {
    summary,
    messages: [],
  }
  await writeCache(cache)
  return summary
}

export async function upsertOpenclawCachedSession(entry: OpenclawSessionCacheEntry): Promise<OpenclawSessionCacheEntry> {
  const cache = await readCache()
  const messages = [...entry.messages].sort((a, b) => a.timestamp - b.timestamp)
  const latestTimestamp = messages[messages.length - 1]?.timestamp || entry.summary.updatedAt || entry.summary.createdAt || Date.now()
  const summary: OpenclawCachedSessionSummary = {
    ...entry.summary,
    preview: entry.summary.preview || messages[messages.length - 1]?.content.slice(0, 120) || '',
    messageCount: messages.length,
    updatedAt: latestTimestamp,
  }

  cache[summary.id] = {
    summary,
    messages,
  }

  await writeCache(cache)
  return cache[summary.id]
}
