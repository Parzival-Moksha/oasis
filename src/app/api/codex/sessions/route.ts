import { NextRequest, NextResponse } from 'next/server'

import { getAgentSessionCache, listAgentSessionCaches } from '@/lib/agent-session-cache'
import { listCodexSessionFileSummaries, readCodexSessionFileDetail } from '@/lib/codex-session-files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  try {
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 50)
    const limit = Number.isFinite(limitParam) ? limitParam : 50
    const includeAllCwd = request.nextUrl.searchParams.get('allCwd') === '1'
    const cwd = includeAllCwd ? undefined : process.cwd()
    const sessionId = clean(request.nextUrl.searchParams.get('id') || request.nextUrl.searchParams.get('sessionId'))

    if (sessionId) {
      const [fileRecord, cached] = await Promise.all([
        readCodexSessionFileDetail({ sessionId, cwd }),
        getAgentSessionCache<Record<string, unknown>>({ agentType: 'codex', sessionId }),
      ])

      if (!fileRecord && !cached) {
        return NextResponse.json({ error: 'not found' }, { status: 404 })
      }

      return NextResponse.json({
        record: fileRecord
          ? {
              ...fileRecord,
              title: fileRecord.title || clean(cached?.title),
              model: fileRecord.model || clean(cached?.model),
              cacheSource: cached?.source,
              cachedMessageCount: cached?.messageCount,
              cachedAt: cached?.updatedAt,
            }
          : cached,
      })
    }

    const [fileRecords, cacheRecords] = await Promise.all([
      listCodexSessionFileSummaries({ limit, cwd }),
      listAgentSessionCaches<Record<string, unknown>>({ agentType: 'codex', limit: Math.max(limit, 100) }),
    ])

    const cacheBySessionId = new Map(cacheRecords.map(record => [record.sessionId, record]))
    const seen = new Set<string>()
    const records = fileRecords.map(record => {
      seen.add(record.sessionId)
      const cached = cacheBySessionId.get(record.sessionId)
      return {
        ...record,
        title: record.title || clean(cached?.title),
        model: record.model || clean(cached?.model),
        cacheSource: cached?.source,
        cachedMessageCount: cached?.messageCount,
        cachedAt: cached?.updatedAt,
      }
    })

    for (const cached of cacheRecords) {
      if (seen.has(cached.sessionId)) continue
      records.push({
        sessionId: cached.sessionId,
        filePath: '',
        title: cached.title || '',
        model: cached.model || '',
        messageCount: cached.messageCount,
        startedAt: cached.createdAt,
        updatedAt: cached.updatedAt,
        lastMessageAt: cached.lastActiveAt,
        cacheSource: cached.source,
        cachedMessageCount: cached.messageCount,
        cachedAt: cached.updatedAt,
      })
      if (records.length >= limit) break
    }

    records.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    return NextResponse.json({ records: records.slice(0, limit) })
  } catch (error) {
    console.error('[codex/sessions] GET error:', error)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
