import { NextRequest, NextResponse } from 'next/server'

import {
  clearStoredHermesTunnelConfig,
  ensureHermesTunnelRunning,
  getHermesTunnelStatus,
  stopHermesTunnel,
  writeStoredHermesTunnelConfig,
} from '@/lib/hermes-tunnel'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '[::1]'
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return true

  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true

    const [hostName, hostPort = ''] = host.split(':')
    const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')
    const requestPort = hostPort || (originUrl.protocol === 'https:' ? '443' : '80')

    return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originPort === requestPort
  } catch {
    return false
  }
}

function canMutateTunnel(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_HERMES_PAIRING === 'true') return true
  const host = request.headers.get('host') || ''
  const hostName = host.split(':')[0]?.toLowerCase() || ''
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(forwardedHost.split(':')[0] || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && !isLoopbackAddress(forwardedFor)) return false

  return true
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }

  const status = await getHermesTunnelStatus()
  return NextResponse.json({
    ...status,
    canMutateConfig: canMutateTunnel(request),
    commandPreview: status.command ? status.command.replace(/\s+/g, ' ').slice(0, 160) : '',
  })
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutateTunnel(request)) {
    return NextResponse.json({ error: 'Tunnel writes are restricted to localhost by default.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    command?: unknown
    autoStart?: unknown
    action?: unknown
  } | null

  const action = sanitizeString(body?.action) || 'save'
  const command = sanitizeString(body?.command)
  const autoStart = body?.autoStart !== false

  try {
    if (action === 'connect') {
      const status = await ensureHermesTunnelRunning(command || undefined)
      return NextResponse.json({ ok: true, ...status })
    }

    if (action === 'disconnect' || action === 'stop') {
      const status = await stopHermesTunnel()
      return NextResponse.json({ ok: true, ...status })
    }

    if (command) {
      const stored = await writeStoredHermesTunnelConfig({ command, autoStart })
      const status = await getHermesTunnelStatus()
      return NextResponse.json({
        ok: true,
        ...status,
        updatedAt: stored.updatedAt,
      })
    }

    return NextResponse.json({ error: 'SSH tunnel command is required.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to update Hermes tunnel config.',
    }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutateTunnel(request)) {
    return NextResponse.json({ error: 'Tunnel writes are restricted to localhost by default.' }, { status: 403 })
  }

  await stopHermesTunnel()
  await clearStoredHermesTunnelConfig()
  return NextResponse.json({ ok: true, configured: false, running: false, command: '' })
}
