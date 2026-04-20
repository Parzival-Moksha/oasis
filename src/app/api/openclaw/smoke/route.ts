import { NextRequest, NextResponse } from 'next/server'

import { runOpenclawSmoke, type OpenclawSmokeMode } from '@/lib/openclaw-smoke'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

function normalizeMode(value: unknown): OpenclawSmokeMode {
  const mode = sanitizeString(value).toLowerCase()
  if (mode === 'live' || mode === 'external') return mode
  return 'core'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const mode = normalizeMode(body?.mode)
  const liveWorldId = sanitizeString(body?.worldId)
  const report = await runOpenclawSmoke(resolveRequestBaseUrl(request), mode, {
    ...(liveWorldId ? { liveWorldId } : {}),
  })
  return NextResponse.json(report)
}
