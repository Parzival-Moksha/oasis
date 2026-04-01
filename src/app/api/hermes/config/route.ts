import { NextRequest, NextResponse } from 'next/server'

import {
  clearStoredHermesConfig,
  normalizeHermesApiBase,
  readStoredHermesConfig,
  resolveHermesConfig,
  writeStoredHermesConfig,
} from '@/lib/hermes-config'

export const dynamic = 'force-dynamic'

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

function canMutatePairing(request: NextRequest): boolean {
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

type ParsedPairing = {
  apiBase: string
  apiKey: string
  defaultModel: string
  systemPrompt: string
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function parsePairingText(raw: string): ParsedPairing {
  const trimmed = raw.trim()
  if (!trimmed) return { apiBase: '', apiKey: '', defaultModel: '', systemPrompt: '' }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return {
        apiBase: sanitizeString(parsed.apiBase ?? parsed.base ?? parsed.url ?? ''),
        apiKey: sanitizeString(parsed.apiKey ?? parsed.key ?? parsed.token ?? ''),
        defaultModel: sanitizeString(parsed.defaultModel ?? parsed.model ?? ''),
        systemPrompt: sanitizeString(parsed.systemPrompt ?? parsed.prompt ?? ''),
      }
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith('oasis://')) {
    try {
      const url = new URL(trimmed)
      return {
        apiBase: sanitizeString(url.searchParams.get('base') || ''),
        apiKey: sanitizeString(url.searchParams.get('key') || ''),
        defaultModel: sanitizeString(url.searchParams.get('model') || ''),
        systemPrompt: sanitizeString(url.searchParams.get('prompt') || ''),
      }
    } catch {
      // fall through
    }
  }

  const lines = trimmed.split(/\r?\n/)
  const envMap: Record<string, string> = {}
  for (const line of lines) {
    const cleaned = line.trim()
    if (!cleaned || cleaned.startsWith('#') || !cleaned.includes('=')) continue
    const normalized = cleaned.startsWith('export ') ? cleaned.slice(7).trim() : cleaned
    const [key, ...rest] = normalized.split('=')
    envMap[key.trim()] = stripMatchingQuotes(rest.join('=').trim())
  }

  return {
    apiBase: sanitizeString(envMap.HERMES_API_BASE || envMap.API_BASE || ''),
    apiKey: sanitizeString(envMap.HERMES_API_KEY || envMap.API_SERVER_KEY || envMap.API_KEY || ''),
    defaultModel: sanitizeString(envMap.HERMES_MODEL || ''),
    systemPrompt: sanitizeString(envMap.HERMES_SYSTEM_PROMPT || ''),
  }
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }

  const config = await resolveHermesConfig()
  const stored = await readStoredHermesConfig()

  return NextResponse.json({
    configured: Boolean(config.apiKey),
    source: config.source,
    canMutateConfig: canMutatePairing(request),
    base: config.apiBase,
    defaultModel: config.defaultModel || null,
    hasSystemPrompt: Boolean(config.systemPrompt),
    updatedAt: stored?.updatedAt || null,
  })
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutatePairing(request)) {
    return NextResponse.json({ error: 'Pairing writes are restricted to localhost by default.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    pairing?: unknown
    apiBase?: unknown
    apiKey?: unknown
    defaultModel?: unknown
    systemPrompt?: unknown
  } | null

  const parsed = parsePairingText(sanitizeString(body?.pairing))
  const apiBase = normalizeHermesApiBase(sanitizeString(body?.apiBase) || parsed.apiBase)
  const apiKey = sanitizeString(body?.apiKey) || parsed.apiKey
  const defaultModel = sanitizeString(body?.defaultModel) || parsed.defaultModel
  const systemPrompt = sanitizeString(body?.systemPrompt) || parsed.systemPrompt

  if (!apiKey) {
    return NextResponse.json({
      error: 'Missing Hermes API key in pairing data. Provide HERMES_API_KEY or API_SERVER_KEY.',
    }, { status: 400 })
  }

  await writeStoredHermesConfig({ apiBase, apiKey, defaultModel, systemPrompt })

  return NextResponse.json({
    ok: true,
    configured: true,
    source: 'pairing',
    base: apiBase,
    defaultModel: defaultModel || null,
  })
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutatePairing(request)) {
    return NextResponse.json({ error: 'Pairing writes are restricted to localhost by default.' }, { status: 403 })
  }

  await clearStoredHermesConfig()
  return NextResponse.json({ ok: true, configured: false, source: 'none' })
}
