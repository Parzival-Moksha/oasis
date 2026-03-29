// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// TOKEN BURN API — Aggregated token usage tracking
// POST: Record token usage (fire-and-forget from client)
// GET:  Query aggregated stats by source and time window
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * Hourly bucket key: '2026-03-28T14'
 */
function hourBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13)
}

/**
 * POST /api/token-burn
 * Body: { source: string, inputTokens: number, outputTokens: number }
 * Upserts into the hourly bucket for the given source.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { source, inputTokens, outputTokens } = body

    if (!source || typeof source !== 'string') {
      return NextResponse.json({ error: 'source required' }, { status: 400 })
    }

    const inTok = Math.max(0, Math.round(Number(inputTokens) || 0))
    const outTok = Math.max(0, Math.round(Number(outputTokens) || 0))

    if (inTok === 0 && outTok === 0) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const window = hourBucket()

    await prisma.tokenBurn.upsert({
      where: { source_window: { source, window } },
      create: { source, window, inputTokens: inTok, outputTokens: outTok },
      update: {
        inputTokens: { increment: inTok },
        outputTokens: { increment: outTok },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[token-burn] POST error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

/**
 * GET /api/token-burn?source=anorak&range=daily|weekly|alltime
 * Returns aggregated { source, inputTokens, outputTokens } per source.
 * If no source, returns all sources aggregated.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source')
    const range = searchParams.get('range') || 'alltime'

    // Compute time boundary
    let since: Date | undefined
    const now = new Date()
    if (range === 'hourly') {
      since = new Date(now.getTime() - 60 * 60 * 1000)
    } else if (range === 'daily') {
      since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    } else if (range === 'weekly') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }
    // 'alltime' = no filter

    // Build where clause
    const where: Record<string, unknown> = {}
    if (source) where.source = source
    if (since) where.createdAt = { gte: since }

    // Aggregate
    const result = await prisma.tokenBurn.groupBy({
      by: ['source'],
      where,
      _sum: { inputTokens: true, outputTokens: true },
    })

    const totals = result.map(r => ({
      source: r.source,
      inputTokens: r._sum.inputTokens || 0,
      outputTokens: r._sum.outputTokens || 0,
    }))

    // Grand total across all sources
    const grandInput = totals.reduce((s, t) => s + t.inputTokens, 0)
    const grandOutput = totals.reduce((s, t) => s + t.outputTokens, 0)

    return NextResponse.json({
      range,
      totals,
      grand: { inputTokens: grandInput, outputTokens: grandOutput },
    })
  } catch (err) {
    console.error('[token-burn] GET error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
