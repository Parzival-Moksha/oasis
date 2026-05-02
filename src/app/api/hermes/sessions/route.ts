import { NextRequest, NextResponse } from 'next/server'

import { listHermesNativeSessions, readHermesNativeSession } from '@/lib/hermes-remote'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
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

function canUseHermesSessions(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_HERMES_PROXY === 'true') return true
  if (process.env.NODE_ENV !== 'production') return true

  const host = request.headers.get('host') || ''
  const hostName = host.split(':')[0]?.toLowerCase() || ''
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(forwardedHost.split(':')[0] || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && forwardedFor !== '127.0.0.1' && forwardedFor !== '::1' && forwardedFor !== '[::1]') return false

  return true
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed)) return 30
  return Math.max(1, Math.min(parsed, 100))
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canUseHermesSessions(request)) {
    return NextResponse.json({
      error: 'Hermes native sessions are localhost-only by default. Set OASIS_ALLOW_REMOTE_HERMES_PROXY=true to allow remote access.',
    }, { status: 403 })
  }

  const sessionId = sanitizeString(request.nextUrl.searchParams.get('sessionId'))
  const source = sanitizeString(request.nextUrl.searchParams.get('source'))
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'))

  try {
    if (sessionId) {
      const detail = await readHermesNativeSession(sessionId)
      return NextResponse.json({ available: true, ...detail })
    }

    const sessions = await listHermesNativeSessions({ source, limit })
    return NextResponse.json({ available: true, sessions })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load Hermes native sessions.'

    if (sessionId) {
      return NextResponse.json({ available: false, error: message }, { status: 500 })
    }

    return NextResponse.json({
      available: false,
      sessions: [],
      error: message,
    })
  }
}
