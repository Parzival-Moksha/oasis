// GET /api/claude-usage — tokens Claude Code spent on this machine (today, 7 days, all time, by model),
// from its transcripts (lib/claude-usage-index.ts). Local requests only: this is the owner's own usage.

import { NextRequest, NextResponse } from 'next/server'

import { getUsageSummary } from '@/lib/claude-usage-index'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json(await getUsageSummary())
}
