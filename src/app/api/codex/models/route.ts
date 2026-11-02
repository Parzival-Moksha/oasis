import { NextResponse } from 'next/server'

import { resolveCodexModelSettings } from '@/lib/codex-models'
import type { NextRequest } from 'next/server'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied

  return NextResponse.json(await resolveCodexModelSettings())
}
