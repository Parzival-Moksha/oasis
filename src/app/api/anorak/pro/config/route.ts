import { NextRequest, NextResponse } from 'next/server'

import {
  readStoredAnorakProContextConfig,
  writeStoredAnorakProContextConfig,
} from '@/lib/anorak-pro-config'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied

  return NextResponse.json(await readStoredAnorakProContextConfig())
}

export async function PUT(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const config = await writeStoredAnorakProContextConfig({
    customModules: body.customModules,
    lobeModules: body.lobeModules,
    topMissionCount: body.topMissionCount,
    moduleValues: body.moduleValues,
  })

  return NextResponse.json({ ok: true, ...config })
}
