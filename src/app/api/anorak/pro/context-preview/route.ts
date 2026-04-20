import { NextRequest, NextResponse } from 'next/server'

import {
  type CustomContextModule,
  type LegacyContextModules,
  isAnorakLobe,
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeModuleValues,
  normalizeTopMissionCount,
  resolveContextModulesForLobe,
} from '@/lib/anorak-context-modules'

export async function POST(request: NextRequest) {
  let body: {
    lobe?: string
    contextModules?: LegacyContextModules
    customModules?: CustomContextModule[]
    lobeModules?: Record<string, string[]>
    topMissionCount?: number
    moduleValues?: Record<string, number>
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.lobe || !isAnorakLobe(body.lobe)) {
    return NextResponse.json({ error: 'Invalid lobe' }, { status: 400 })
  }

  const customModules = normalizeCustomModules(body.customModules)
  const lobeModules = normalizeLobeModules(body.lobeModules, customModules, body.contextModules)
  const topMissionCount = normalizeTopMissionCount(body.topMissionCount)
  const moduleValues = normalizeModuleValues(body.moduleValues)

  try {
    const modules = await resolveContextModulesForLobe({
      lobe: body.lobe,
      customModules,
      lobeModules,
      topMissionCount,
      moduleValues,
    })

    return NextResponse.json({ lobe: body.lobe, modules })
  } catch (error) {
    return NextResponse.json({ error: `Context preview failed: ${(error as Error).message}` }, { status: 500 })
  }
}
