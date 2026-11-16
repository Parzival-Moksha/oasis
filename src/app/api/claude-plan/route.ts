// GET /api/claude-plan — the Claude Code plan limits (/usage: the week, the week per model, the 5-hour session)
// and which account that CLI is logged into (lib/claude-plan-usage.ts). ?fresh=1 asks again instead of the
// minute-old answer. Local requests only: this is the owner's own login.

import { NextRequest, NextResponse } from 'next/server'

import { getPlanUsage } from '@/lib/claude-plan-usage'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json(await getPlanUsage(request.nextUrl.searchParams.get('fresh') === '1'))
}
