// /api/village/work — the Mindcraft work counter (the owner's vow: three hours a day in the Oasis).
//   GET   ?day=YYYY-MM-DD: that day's `summary` alone (time, XP, kept or not, per agent, per mission, top XP, agent hours).
//   GET   ?mindcraft=1: every day as lists of work units (the owner's, each agent's, the whole Oasis').
//   POST  { settings: { freeValor: 0.7 } }  valor for time with nothing in focus.
//   A day runs from 04:20 to 04:20 local.
//   GET   today and the week of the vow: seconds, XP, each day hit / missed / open / ahead, the mission
//         being worked on. For the HUD, for Anorak, for the Telegram pings.
//   POST  { tab, seq, seconds, release? }  a page reports active seconds since its last report (one tab counts
//         at a time; `release` when the page closes)
//         (a report may carry `focus: { agent: { key, name }, mission: "file.md" }`: what the owner had open)
//         { agentWork: [{ key, name, ts, kind: 'turn' | 'helper', ms }] }  finished agent turns and helpers
//         { mission: "file.md" }  start working on a mission · { mission: null }  stop: back to "in the Oasis"
// Local requests only, like /api/academy. The book is data/work-vow.local.json.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { reportAgentWork, reportWorkBeat, setWorkSettings, switchWorkMission, workDaySummary, workMindcraft, workVowSnapshot } from '@/lib/work-vow-server'
import type { AgentWorkReport } from '@/lib/village/work-vow'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    // ?day=2026-11-16: that day's summary alone.
    const day = new URL(request.url).searchParams.get('day')
    if (day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'day is YYYY-MM-DD' }, { status: 400 })
      return NextResponse.json({ summary: await workDaySummary(day) })
    }
    // ?mindcraft=1: every day in the book as lists (the owner's, each agent's, the whole Oasis').
    if (new URL(request.url).searchParams.get('mindcraft')) return NextResponse.json(await workMindcraft())
    return NextResponse.json(await workVowSnapshot())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { tab?: unknown; seq?: unknown; seconds?: unknown; mission?: unknown; release?: unknown; back?: unknown; focus?: { agent?: { key?: unknown; name?: unknown } | null; mission?: unknown } | null; agentWork?: unknown; settings?: { freeValor?: unknown } } | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  try {
    if (body.settings && typeof body.settings === 'object') {
      if (typeof body.settings.freeValor !== 'number' || !(body.settings.freeValor >= 0 && body.settings.freeValor <= 1)) return NextResponse.json({ error: 'freeValor is a number from 0 to 1' }, { status: 400 })
      return NextResponse.json({ ok: true, snapshot: await setWorkSettings({ freeValor: body.settings.freeValor }) })
    }
    if (Array.isArray(body.agentWork)) {
      const reports = (body.agentWork as Array<Partial<AgentWorkReport>>).filter((r): r is AgentWorkReport =>
        Boolean(r) && typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 120 && typeof r.ts === 'number' && typeof r.ms === 'number' && (r.kind === 'turn' || r.kind === 'helper'))
        .map(r => ({ key: r.key, name: String(r.name || r.key).slice(0, 80), ts: r.ts, kind: r.kind, ms: r.ms }))
      return NextResponse.json({ ok: true, ...(await reportAgentWork(reports)) })
    }
    if ('mission' in body) {
      if (body.mission !== null && typeof body.mission !== 'string') return NextResponse.json({ error: 'mission is a file name or null' }, { status: 400 })
      const result = await switchWorkMission(body.mission)
      return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (typeof body.tab !== 'string' || !body.tab || body.tab.length > 80 || typeof body.seq !== 'number' || typeof body.seconds !== 'number') {
      return NextResponse.json({ error: 'tab, seq and seconds are required' }, { status: 400 })
    }
    const agent = body.focus?.agent && typeof body.focus.agent.key === 'string' && body.focus.agent.key
      ? { key: body.focus.agent.key.slice(0, 120), name: String(body.focus.agent.name || body.focus.agent.key).slice(0, 80) }
      : null
    const focus = { agent, mission: typeof body.focus?.mission === 'string' ? body.focus.mission : null }
    return NextResponse.json({ ok: true, ...(await reportWorkBeat({ tab: body.tab, seq: body.seq, seconds: body.seconds, release: body.release === true, back: body.back === true, focus })) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
