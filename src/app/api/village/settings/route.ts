// GET /api/village/settings: the places of this machine that the village page shows or hands to agents
// (src/lib/oasis-settings.ts). Loopback only.
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { missionsDir, oasisSetting } from '@/lib/oasis-settings'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  return NextResponse.json({
    anorakProCwd: oasisSetting('anorakProCwd'),
    missionsDir: missionsDir(),
    grillFile: oasisSetting('grillFile'),
  })
}
