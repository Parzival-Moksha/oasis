// /api/village/work — the Mindcraft work counter (the owner's vow: three hours a day in the Oasis).
//   GET   today and the week of the vow: seconds, XP, each day hit / missed / open / ahead, the mission
//         being worked on. For the HUD, for Anorak, for the Telegram pings.
//   POST  { tab, seq, seconds, release? }  a page reports active seconds since its last report (one tab counts
//         at a time; `release` when the page closes)
//         { mission: "file.md" }  start working on a mission · { mission: null }  stop: back to "in the Oasis"
// Local requests only, like /api/academy. The book is data/work-vow.local.json.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { reportWorkBeat, switchWorkMission, workVowSnapshot } from '@/lib/work-vow-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    return NextResponse.json(await workVowSnapshot())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { tab?: unknown; seq?: unknown; seconds?: unknown; mission?: unknown; release?: unknown; back?: unknown } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  try {
    if ('mission' in body) {
      if (body.mission !== null && typeof body.mission !== 'string') return NextResponse.json({ error: 'mission is a file name or null' }, { status: 400 })
      const result = await switchWorkMission(body.mission)
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (typeof body.tab !== 'string' || !body.tab || body.tab.length > 80 || typeof body.seq !== 'number' || typeof body.seconds !== 'number') {
      return NextResponse.json({ error: 'tab, seq and seconds are required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, ...(await reportWorkBeat({ tab: body.tab, seq: body.seq, seconds: body.seconds, release: body.release === true, back: body.back === true })) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
