import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'

import { listOpenclawCachedSessions } from '@/lib/openclaw-session-cache'
import { openclawGatewayHttpProbeUrl, resolveOpenclawConfig } from '@/lib/openclaw-config'
import { runOpenclawCli } from '@/lib/openclaw-cli'
import {
  buildOasisOpenclawMcpDefinition,
  getOpenclawRuntimeConfigPath,
  readOpenclawMcpServer,
  sameMcpDefinition,
} from '@/lib/openclaw-runtime-config'

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
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
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

async function countDeviceRecords(fileName: 'pending.json' | 'paired.json'): Promise<number> {
  try {
    const devicesDir = join(dirname(getOpenclawRuntimeConfigPath()), 'devices')
    const raw = await readFile(join(devicesDir, fileName), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.length
    if (!parsed || typeof parsed !== 'object') return 0
    return Object.keys(parsed as Record<string, unknown>).length
  } catch {
    return 0
  }
}

export async function GET(request: NextRequest) {
  const config = await resolveOpenclawConfig()
  const sessions = await listOpenclawCachedSessions()
  const oasisBaseUrl = resolveRequestBaseUrl(request)
  const gatewayProbeUrl = openclawGatewayHttpProbeUrl(config.gatewayUrl)
  const expectedMcpServer = buildOasisOpenclawMcpDefinition(oasisBaseUrl)
  const [gateway, controlUi, browserControl, gatewayCli, pendingDeviceCount, pairedDeviceCount, savedMcpServer] = await Promise.all([
    probeHttpUrl(gatewayProbeUrl),
    probeHttpUrl(config.controlUiUrl),
    probeHttpUrl(config.browserControlUrl),
    readGatewayCliState(),
    countDeviceRecords('pending.json'),
    countDeviceRecords('paired.json'),
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
    gateway,
    controlUi,
    browserControl,
    gatewayCli,
    pendingDeviceCount,
    pairedDeviceCount,
    sessionCount: sessions.length,
    mcpUrl: `${oasisBaseUrl}/api/mcp/oasis?agentType=openclaw`,
    mcpInstalled: sameMcpDefinition(savedMcpServer, expectedMcpServer),
    runtimeMcpConfigPath: getOpenclawRuntimeConfigPath(),
    pairingHint: 'If pairing is required, approve it on the machine running the Gateway.',
    approveCommandHint: 'openclaw devices list && openclaw devices approve <requestId>',
    recommendedTalkSurface: controlUi.reachable ? 'control-ui' : 'telegram-or-cli',
  })
}
