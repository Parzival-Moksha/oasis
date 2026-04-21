import 'server-only'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// OPENCLAW SESSION POINTER STORE — metadata only, NOT a transcript mirror
// ─═̷─═̷─ॐ─═̷─═̷─
//
// Phase-1 stub + Phase-2-ready pointer store. OpenClaw owns session data —
// the authoritative transcripts live in ~/.openclaw/agents/<agentId>/sessions/
// and are fetched via the Gateway JSON-RPC methods sessions.list / sessions.get /
// sessions.preview over ws://127.0.0.1:18789.
//
// This module ONLY stores lightweight summaries:
//   - local drafts created before they're promoted to real OpenClaw sessions
//   - cached previews from sessions.preview so the 3D panel renders instantly
//
// DO NOT add full message storage back here. That's OpenClaw's job.
// When Phase 2 lands, listOpenclawCachedSessions becomes a Gateway call.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface OpenclawCachedSessionSummary {
  id: string
  title: string
  preview: string
  source: 'draft' | 'gateway' | 'cache'
  createdAt: number
  updatedAt: number
  messageCount: number
}

type OpenclawSessionCache = Record<string, OpenclawCachedSessionSummary>

const CACHE_PATH = join(process.cwd(), 'prisma', 'data', 'openclaw-session-cache.json')

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSummary(raw: unknown, sessionId: string): OpenclawCachedSessionSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  // Support legacy on-disk format that wrapped summary in { summary, messages }.
  const summaryRecord = (record.summary && typeof record.summary === 'object')
    ? record.summary as Record<string, unknown>
    : record
  const source = sanitizeString(summaryRecord.source)
  const normalizedSource = source === 'gateway' || source === 'cache' ? source : 'draft'
  const createdAt = typeof summaryRecord.createdAt === 'number' && Number.isFinite(summaryRecord.createdAt) ? summaryRecord.createdAt : Date.now()
  const updatedAt = typeof summaryRecord.updatedAt === 'number' && Number.isFinite(summaryRecord.updatedAt) ? summaryRecord.updatedAt : createdAt
  const title = sanitizeString(summaryRecord.title) || 'OpenClaw session'
  const preview = sanitizeString(summaryRecord.preview)
  const messageCount = typeof summaryRecord.messageCount === 'number' && Number.isFinite(summaryRecord.messageCount) ? summaryRecord.messageCount : 0

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
      const summary = normalizeSummary(value, sessionId)
      if (!summary) continue
      entries[sessionId] = summary
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

export interface ListOpenclawCachedSessionsOptions {
  limit?: number
  offset?: number
}

export async function listOpenclawCachedSessions(opts: ListOpenclawCachedSessionsOptions = {}): Promise<OpenclawCachedSessionSummary[]> {
  const cache = await readCache()
  const sorted = Object.values(cache).sort((a, b) => b.updatedAt - a.updatedAt)
  const offset = Math.max(0, opts.offset ?? 0)
  const limit = opts.limit && opts.limit > 0 ? opts.limit : sorted.length
  return sorted.slice(offset, offset + limit)
}

export async function getOpenclawCachedSession(sessionId: string): Promise<OpenclawCachedSessionSummary | null> {
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

  cache[sessionId] = summary
  await writeCache(cache)
  return summary
}

// Phase-2 hook: when Gateway wiring lands, call this with data from sessions.preview
// to cache lightweight summaries for instant panel render. Full messages come
// on demand from sessions.get — we never store them here.
export async function upsertOpenclawSessionSummary(summary: OpenclawCachedSessionSummary): Promise<OpenclawCachedSessionSummary> {
  const cache = await readCache()
  cache[summary.id] = summary
  await writeCache(cache)
  return cache[summary.id]
}
