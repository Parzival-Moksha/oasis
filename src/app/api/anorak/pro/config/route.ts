import { NextRequest, NextResponse } from 'next/server'

import {
  readStoredAnorakProContextConfig,
  writeStoredAnorakProContextConfig,
} from '@/lib/anorak-pro-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await readStoredAnorakProContextConfig())
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const config = await writeStoredAnorakProContextConfig({
    customModules: body.customModules,
    lobeModules: body.lobeModules,
    topMissionCount: body.topMissionCount,
    moduleValues: body.moduleValues,
  })

  return NextResponse.json({ ok: true, ...config })
}
