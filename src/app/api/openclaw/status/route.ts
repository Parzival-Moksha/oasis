import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'
import { listOpenclawCachedSessions } from '@/lib/openclaw-session-cache'
import { openclawGatewayHttpProbeUrl, resolveOpenclawConfig } from '@/lib/openclaw-config'
import { runOpenclawCli } from '@/lib/openclaw-cli'
import {
  buildOasisOpenclawMcpDefinition,
  getOpenclawRuntimeConfigPath,
  readOpenclawMcpServer,
  sameMcpDefinition,
} from '@/lib/openclaw-runtime-config'
import {
  hostedVisitorOpenclawStatusResponse,
  shouldBlockHostedVisitorOpenclawGateway,
} from '@/lib/openclaw-hosted-boundary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface GatewayCliState {
  state: 'ready' | 'pairing-required' | 'offline' | 'error' | 'unknown'
  label: string
  detail: string
  checkedAt: number
}

interface ProbeResult {
  reachable: boolean
  status: number | null
  ok: boolean
  label: string
  error?: string
}

interface DeviceRecordSummary {
  requestId: string
  deviceId: string
  clientId: string
  clientMode: string
  platform: string
  deviceFamily: string
  role: string
  createdAtMs?: number
}

let cachedGatewayCliState: GatewayCliState | null = null

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLoopbackHost(host: string): string {
  if (!host) return host
  if (host === 'localhost') return '127.0.0.1'
  if (host.startsWith('localhost:')) return `127.0.0.1${host.slice('localhost'.length)}`
  return host
}

function resolveRequestBaseUrl(request: NextRequest): string {
  const forwardedProto = sanitizeString(request.headers.get('x-forwarded-proto')).split(',')[0]?.trim()
  const forwardedHost = sanitizeString(request.headers.get('x-forwarded-host')).split(',')[0]?.trim()
  const host = normalizeLoopbackHost(forwardedHost || sanitizeString(request.headers.get('host')))
  const protocol = forwardedProto || (host.startsWith('127.0.0.1') || host.startsWith('[::1]') ? 'http' : 'https')
  return host ? `${protocol}://${host}` : 'http://127.0.0.1:4516'
}

async function probeHttpUrl(url: string): Promise<ProbeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    })

    return {
      reachable: true,
      status: response.status,
      ok: response.ok,
      label: response.ok ? 'reachable' : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      reachable: false,
      status: null,
      ok: false,
      label: 'offline',
      error: error instanceof Error ? error.message : 'Probe failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

async function readGatewayCliState(): Promise<GatewayCliState> {
  if (cachedGatewayCliState && cachedGatewayCliState.checkedAt > Date.now() - 30000) {
    return cachedGatewayCliState
  }

  const result = await runOpenclawCli(['health', '--json'], 12000)
  const stderr = sanitizeString(result.stderr)
  const stdout = sanitizeString(result.stdout)

  let next: GatewayCliState
  if (result.ok) {
    next = {
      state: 'ready',
      label: 'ready',
      detail: stdout || 'Gateway client auth succeeded.',
      checkedAt: Date.now(),
    }
  } else if (/pairing required/i.test(stderr) || /pairing required/i.test(stdout)) {
    next = {
      state: 'pairing-required',
      label: 'pairing required',
      detail: stderr || stdout || 'Gateway client auth requires device approval.',
      checkedAt: Date.now(),
    }
  } else if (/connect failed|unreachable|timed out/i.test(stderr)) {
    next = {
      state: 'offline',
      label: 'offline',
      detail: stderr || stdout || 'Gateway did not answer the CLI health check.',
      checkedAt: Date.now(),
    }
  } else {
    next = {
      state: 'error',
      label: 'error',
      detail: stderr || stdout || 'Gateway health check failed.',
      checkedAt: Date.now(),
    }
  }

  cachedGatewayCliState = next
  return next
}

function summarizeDeviceRecord(requestId: string, raw: unknown): DeviceRecordSummary {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const createdAtMs = typeof obj.createdAtMs === 'number' && Number.isFinite(obj.createdAtMs)
    ? obj.createdAtMs
    : undefined

  return {
    requestId,
    deviceId: sanitizeString(obj.deviceId),
    clientId: sanitizeString(obj.clientId),
    clientMode: sanitizeString(obj.clientMode),
    platform: sanitizeString(obj.platform),
    deviceFamily: sanitizeString(obj.deviceFamily),
    role: sanitizeString(obj.role),
    ...(createdAtMs ? { createdAtMs } : {}),
  }
}

async function readDeviceRecords(fileName: 'pending.json' | 'paired.json'): Promise<DeviceRecordSummary[]> {
  try {
    const devicesDir = join(dirname(getOpenclawRuntimeConfigPath()), 'devices')
    const raw = await readFile(join(devicesDir, fileName), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((entry, index) => summarizeDeviceRecord(String(index), entry))
    }
    if (!parsed || typeof parsed !== 'object') return []
    return Object.entries(parsed as Record<string, unknown>)
      .map(([requestId, entry]) => summarizeDeviceRecord(requestId, entry))
  } catch {
    return []
  }
}

async function warmNativeGatewayClient(hasStoredDeviceToken: boolean) {
  const client = getOasisGatewayClient()
  const initialStatus = client.getStatus()
  if (!hasStoredDeviceToken || initialStatus.state !== 'idle') {
    return initialStatus
  }

  try {
    await Promise.race([
      client.ensureReady(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])
  } catch {
    // Ignore here; the status snapshot below will expose the native error.
  }

  return client.getStatus()
}

export async function GET(request: NextRequest) {
  if (shouldBlockHostedVisitorOpenclawGateway(request)) {
    return hostedVisitorOpenclawStatusResponse()
  }

  const config = await resolveOpenclawConfig()
  const gatewayClient = await warmNativeGatewayClient(Boolean(config.deviceToken))
  const sessions = await listOpenclawCachedSessions()
  const oasisBaseUrl = resolveRequestBaseUrl(request)
  const gatewayProbeUrl = openclawGatewayHttpProbeUrl(config.gatewayUrl)
  const expectedMcpServer = buildOasisOpenclawMcpDefinition(oasisBaseUrl)
  const shouldSkipCliProbe = gatewayClient.state === 'ready' || (Boolean(config.deviceToken) && (gatewayClient.state === 'idle' || gatewayClient.state === 'connecting'))
  const [gateway, controlUi, browserControl, gatewayCli, pendingDevices, pairedDevices, savedMcpServer] = await Promise.all([
    probeHttpUrl(gatewayProbeUrl),
    probeHttpUrl(config.controlUiUrl),
    probeHttpUrl(config.browserControlUrl),
    shouldSkipCliProbe
      ? Promise.resolve<GatewayCliState>({
        state: 'ready',
        label: gatewayClient.state === 'ready' ? 'native' : 'warming up',
        detail: gatewayClient.state === 'ready'
          ? 'Using the native Oasis Gateway client. CLI health probe skipped to avoid stale device churn.'
          : 'Native Oasis Gateway client has a stored device token and is warming up. CLI health probe skipped to avoid stale device churn.',
        checkedAt: Date.now(),
      })
      : readGatewayCliState(),
    readDeviceRecords('pending.json'),
    readDeviceRecords('paired.json'),
    readOpenclawMcpServer('oasis'),
  ])

  return NextResponse.json({
    savedConfig: config.source === 'local',
    source: config.source,
    gatewayUrl: config.gatewayUrl,
    controlUiUrl: config.controlUiUrl,
    browserControlUrl: config.browserControlUrl,
    sshHost: config.sshHost,
    hasDeviceToken: Boolean(config.deviceToken),
    defaultSessionId: config.defaultSessionId,
    lastSessionId: config.lastSessionId,
    gatewayClient,
    gateway,
    controlUi,
    browserControl,
    gatewayCli,
    pendingDeviceCount: pendingDevices.length,
    pairedDeviceCount: pairedDevices.length,
    pendingDevices,
    sessionCount: sessions.length,
    mcpUrl: `${oasisBaseUrl}/api/mcp/oasis?agentType=openclaw`,
    mcpInstalled: sameMcpDefinition(savedMcpServer, expectedMcpServer),
    runtimeMcpConfigPath: getOpenclawRuntimeConfigPath(),
    pairingHint: 'If pairing is required, approve it on the machine running the Gateway.',
    approveCommandHint: 'openclaw devices list && openclaw devices approve <requestId>',
    recommendedTalkSurface: controlUi.reachable ? 'control-ui' : 'telegram-or-cli',
  })
}
