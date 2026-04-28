import { NextRequest, NextResponse } from 'next/server'

import { getOasisGatewayClient } from '@/lib/openclaw-gateway-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function normalizeLoopbackHost(host: string): string {
  if (!host) return host
  if (host === 'localhost') return '127.0.0.1'
  if (host.startsWith('localhost:')) return `127.0.0.1${host.slice('localhost'.length)}`
  return host
}

function resolveRequestBaseUrl(request: NextRequest): string {
  const forwardedProto = (request.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim()
  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim()
  const host = normalizeLoopbackHost(forwardedHost || request.headers.get('host') || '')
  const protocol = forwardedProto || (host.startsWith('127.0.0.1') || host.startsWith('[::1]') ? 'http' : 'https')
  return host ? `${protocol}://${host}` : 'http://127.0.0.1:4516'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sessionKey = sanitizeString(body.sessionKey)
  const model = sanitizeString(body.model)
  const voice = sanitizeString(body.voice)
  const worldId = sanitizeString(body.worldId)
  const playerName = sanitizeString(body.playerName)
  const instructions = sanitizeString(body.instructions)
  const vadThreshold = sanitizeNumber(body.vadThreshold)
  const silenceDurationMs = sanitizeNumber(body.silenceDurationMs)
  const prefixPaddingMs = sanitizeNumber(body.prefixPaddingMs)

  if (!sessionKey) {
    return NextResponse.json({ ok: false, error: 'sessionKey is required.' }, { status: 400 })
  }

  const client = getOasisGatewayClient()
  try {
    await client.ensureReady()
    const result = await client.callMethod<Record<string, unknown>>('oasis.voice.start', {
      sessionKey,
      oasisBaseUrl: resolveRequestBaseUrl(request),
      ...(model ? { model } : {}),
      ...(voice ? { voice } : {}),
      ...(worldId ? { worldId } : {}),
      ...(playerName ? { playerName } : {}),
      ...(instructions ? { instructions } : {}),
      ...(typeof vadThreshold === 'number' ? { vadThreshold } : {}),
      ...(typeof silenceDurationMs === 'number' ? { silenceDurationMs } : {}),
      ...(typeof prefixPaddingMs === 'number' ? { prefixPaddingMs } : {}),
    })
    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not start OpenClaw voice.',
    }, { status: 503 })
  }
}
