import { NextRequest, NextResponse } from 'next/server'

import { isHostedOasis, isOasisAdmin } from './session'

export function shouldBlockHostedVisitorOpenclawGateway(request: Request | NextRequest): boolean {
  return isHostedOasis() && !isOasisAdmin(request)
}

export function hostedVisitorOpenclawBlockedResponse(surface = 'OpenClaw local gateway'): NextResponse {
  return NextResponse.json({
    ok: false,
    error: `${surface} is disabled for hosted visitors. Pair an OpenClaw bridge from the hosted relay panel instead.`,
    mode: 'hosted',
    transport: 'relay',
  }, { status: 403 })
}

export function hostedVisitorOpenclawStatusResponse(): NextResponse {
  return NextResponse.json({
    savedConfig: false,
    source: 'none',
    gatewayUrl: '',
    controlUiUrl: '',
    browserControlUrl: '',
    sshHost: '',
    hasDeviceToken: false,
    defaultSessionId: '',
    lastSessionId: '',
    gatewayClient: {
      state: 'closed',
      detail: 'Hosted visitors use the paired relay bridge, not the Oasis server loopback gateway.',
      gatewayUrl: '',
      hasDeviceToken: false,
    },
    gateway: { reachable: false, status: null, ok: false, label: 'hosted relay only' },
    controlUi: { reachable: false, status: null, ok: false, label: 'hosted relay only' },
    browserControl: { reachable: false, status: null, ok: false, label: 'hosted relay only' },
    gatewayCli: {
      state: 'unknown',
      label: 'hosted relay',
      detail: 'OpenClaw runs on the visitor machine through the paired bridge process.',
      checkedAt: Date.now(),
    },
    pendingDeviceCount: 0,
    pairedDeviceCount: 0,
    pendingDevices: [],
    sessionCount: 0,
    mcpUrl: '',
    mcpInstalled: false,
    runtimeMcpConfigPath: '',
    pairingHint: 'Mint a hosted pairing code and run the bridge on the machine with OpenClaw.',
    approveCommandHint: '',
    recommendedTalkSurface: 'telegram-or-cli',
  })
}
