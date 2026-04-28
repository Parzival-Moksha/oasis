import { NextRequest, NextResponse } from 'next/server'

import {
  clearStoredOpenclawConfig,
  resolveOpenclawConfig,
  writeStoredOpenclawConfig,
} from '@/lib/openclaw-config'
import { resetOasisGatewayClient } from '@/lib/openclaw-gateway-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const config = await resolveOpenclawConfig()
  return NextResponse.json(config)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const saved = await writeStoredOpenclawConfig({
    gatewayUrl: typeof body?.gatewayUrl === 'string' ? body.gatewayUrl : undefined,
    controlUiUrl: typeof body?.controlUiUrl === 'string' ? body.controlUiUrl : undefined,
    browserControlUrl: typeof body?.browserControlUrl === 'string' ? body.browserControlUrl : undefined,
    sshHost: typeof body?.sshHost === 'string' ? body.sshHost : undefined,
    deviceToken: typeof body?.deviceToken === 'string' ? body.deviceToken : undefined,
    defaultSessionId: typeof body?.defaultSessionId === 'string' ? body.defaultSessionId : undefined,
    lastSessionId: typeof body?.lastSessionId === 'string' ? body.lastSessionId : undefined,
  })
  resetOasisGatewayClient()

  return NextResponse.json({
    ok: true,
    config: saved,
  })
}

export async function DELETE() {
  await clearStoredOpenclawConfig()
  resetOasisGatewayClient()
  const config = await resolveOpenclawConfig()
  return NextResponse.json({
    ok: true,
    config,
  })
}
