import { NextRequest, NextResponse } from 'next/server'

import { readTokenBurnSummary, recordTokenBurn } from '@/lib/token-burn'
import { inferProviderFromSource, readTokenUsagePayload } from '@/lib/token-usage'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const source = typeof body?.source === 'string' ? body.source.trim() : ''

    if (!source) {
      return NextResponse.json({ error: 'source required' }, { status: 400 })
    }

    const usage = readTokenUsagePayload(body, {
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
      provider: inferProviderFromSource(source),
      model: typeof body?.model === 'string' ? body.model : 'unknown',
    })

    if (!usage) {
      return NextResponse.json({ error: 'token usage required' }, { status: 400 })
    }

    await recordTokenBurn({
      source,
      ...usage,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[token-burn] POST error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const source = searchParams.get('source') || undefined
    const range = searchParams.get('range') || 'alltime'

    const summary = await readTokenBurnSummary({ source, range })
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[token-burn] GET error:', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
