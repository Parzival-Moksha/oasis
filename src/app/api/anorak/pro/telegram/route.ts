import { NextRequest, NextResponse } from 'next/server'

import {
  ensureAnorakProTelegramPolling,
  getAnorakProTelegramPollingStatus,
  isTelegramUpdate,
  pollAnorakProTelegramNow,
  processTelegramUpdate,
  stopAnorakProTelegramPolling,
  type TelegramUpdate,
} from '@/lib/anorak-pro-telegram'
import {
  clearStoredAnorakProTelegramConfig,
  clearStoredAnorakProTelegramPollingState,
  hasTelegramDeliveryCredentials,
  maskTelegramBotToken,
  readStoredAnorakProTelegramConfig,
  readStoredAnorakProTelegramPollingState,
  resolveAnorakProTelegramConfig,
  sendTelegramMessage,
  writeStoredAnorakProTelegramConfig,
  writeStoredAnorakProTelegramPollingState,
} from '@/lib/telegram'

export const dynamic = 'force-dynamic'

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '[::1]'
}

function splitHostHeader(host: string): { hostName: string; hostPort: string } {
  const trimmed = host.trim()
  if (!trimmed) return { hostName: '', hostPort: '' }

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']')
    if (end >= 0) {
      return {
        hostName: trimmed.slice(0, end + 1),
        hostPort: trimmed.slice(end + 2),
      }
    }
  }

  const colonIndex = trimmed.lastIndexOf(':')
  if (colonIndex > -1 && trimmed.indexOf(':') === colonIndex) {
    return {
      hostName: trimmed.slice(0, colonIndex),
      hostPort: trimmed.slice(colonIndex + 1),
    }
  }

  return { hostName: trimmed, hostPort: '' }
}

function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return true

  try {
    const originUrl = new URL(origin)
    if (originUrl.host === host) return true

    const { hostName, hostPort } = splitHostHeader(host)
    const originPort = originUrl.port || (originUrl.protocol === 'https:' ? '443' : '80')
    const requestPort = hostPort || (originUrl.protocol === 'https:' ? '443' : '80')

    return isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originPort === requestPort
  } catch {
    return false
  }
}

function canMutatePairing(request: NextRequest): boolean {
  if (process.env.OASIS_ALLOW_REMOTE_ANORAK_PRO_TELEGRAM_PAIRING === 'true') return true
  if (process.env.NODE_ENV !== 'production') return true

  const host = request.headers.get('host') || ''
  const hostName = splitHostHeader(host).hostName.toLowerCase()
  if (!isLoopbackHost(hostName)) return false

  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedHost && !isLoopbackHost(splitHostHeader(forwardedHost).hostName || '')) return false

  const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  if (forwardedFor && !isLoopbackAddress(forwardedFor)) return false

  return true
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeChatId(value: unknown): string {
  return sanitizeString(value).replace(/\s+/g, '')
}

function normalizeThreadId(value: unknown): string {
  return sanitizeString(value).replace(/\s+/g, '')
}

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

async function syncPollingState(origin: string) {
  const config = await resolveAnorakProTelegramConfig()
  if (config.enabled && config.pollingEnabled && hasTelegramDeliveryCredentials(config)) {
    return ensureAnorakProTelegramPolling({ origin })
  }
  return stopAnorakProTelegramPolling()
}

async function handleTelegramWebhook(request: NextRequest, update: TelegramUpdate) {
  const config = await resolveAnorakProTelegramConfig()
  if (!config.enabled || !hasTelegramDeliveryCredentials(config)) {
    return NextResponse.json({ ok: true, ignored: 'telegram-disabled' })
  }

  if (config.webhookSecret) {
    const providedSecret = request.headers.get('x-telegram-bot-api-secret-token') || ''
    if (providedSecret !== config.webhookSecret) {
      return NextResponse.json({ error: 'Invalid Telegram webhook secret' }, { status: 403 })
    }
  }

  let state = await readStoredAnorakProTelegramPollingState()
  const result = await processTelegramUpdate({
    update,
    config,
    state,
    origin: request.nextUrl.origin,
  })

  state = {
    ...result.state,
    lastOrigin: request.nextUrl.origin,
  }
  if (typeof result.updateId === 'number') {
    state.offset = Math.max(state.offset ?? result.updateId, result.updateId)
    state.lastUpdateId = result.updateId
  }
  await writeStoredAnorakProTelegramPollingState(state)

  return NextResponse.json({
    ok: true,
    kind: result.kind,
    ignored: result.ignoredReason || null,
    missionId: result.missionId || null,
  })
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }

  const config = await resolveAnorakProTelegramConfig()
  const stored = await readStoredAnorakProTelegramConfig()
  const polling = await syncPollingState(request.nextUrl.origin)

  return NextResponse.json({
    configured: hasTelegramDeliveryCredentials(config),
    enabled: config.enabled,
    source: config.source,
    canMutateConfig: canMutatePairing(request),
    chatId: config.chatId || null,
    messageThreadId: config.messageThreadId || null,
    hasBotToken: Boolean(config.botToken),
    botTokenHint: config.botToken ? maskTelegramBotToken(config.botToken) : null,
    webhookSecretSet: Boolean(config.webhookSecret),
    webhookUrl: `${request.nextUrl.origin}${request.nextUrl.pathname}`,
    pollingEnabled: config.pollingEnabled,
    pollingIntervalSec: config.pollingIntervalSec,
    voiceNotesEnabled: config.voiceNotesEnabled,
    voiceRepliesEnabled: config.voiceRepliesEnabled,
    polling,
    updatedAt: stored?.updatedAt || null,
  })
}

export async function PUT(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutatePairing(request)) {
    return NextResponse.json({ error: 'Telegram pairing writes are restricted to localhost by default.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    enabled?: unknown
    botToken?: unknown
    chatId?: unknown
    messageThreadId?: unknown
    webhookSecret?: unknown
    pollingEnabled?: unknown
    pollingIntervalSec?: unknown
    voiceNotesEnabled?: unknown
    voiceRepliesEnabled?: unknown
  } | null

  const existing = await readStoredAnorakProTelegramConfig()
  const botToken = sanitizeString(body?.botToken) || existing?.botToken || ''
  const chatId = normalizeChatId(body?.chatId) || existing?.chatId || ''
  const isFirstTelegramSetup = !existing?.botToken && !existing?.chatId && Boolean(botToken && chatId)
  const requestedEnabled = coerceBoolean(body?.enabled, existing?.enabled ?? isFirstTelegramSetup)
  const requestedPollingEnabled = coerceBoolean(body?.pollingEnabled, existing?.pollingEnabled ?? isFirstTelegramSetup)
  const config = await writeStoredAnorakProTelegramConfig({
    enabled: requestedEnabled || (isFirstTelegramSetup && !requestedEnabled && !requestedPollingEnabled),
    botToken,
    chatId,
    messageThreadId: normalizeThreadId(body?.messageThreadId) || existing?.messageThreadId || '',
    webhookSecret: sanitizeString(body?.webhookSecret) || existing?.webhookSecret || '',
    pollingEnabled: requestedPollingEnabled || (isFirstTelegramSetup && !requestedEnabled && !requestedPollingEnabled),
    pollingIntervalSec: coerceNumber(body?.pollingIntervalSec),
    voiceNotesEnabled: body?.voiceNotesEnabled !== undefined
      ? coerceBoolean(body.voiceNotesEnabled, true)
      : (existing?.voiceNotesEnabled ?? true),
    voiceRepliesEnabled: body?.voiceRepliesEnabled !== undefined
      ? coerceBoolean(body.voiceRepliesEnabled, true)
      : (existing?.voiceRepliesEnabled ?? true),
  })

  const polling = await syncPollingState(request.nextUrl.origin)

  return NextResponse.json({
    ok: true,
    configured: hasTelegramDeliveryCredentials(config),
    enabled: config.enabled,
    chatId: config.chatId || null,
    messageThreadId: config.messageThreadId || null,
    botTokenHint: config.botToken ? maskTelegramBotToken(config.botToken) : null,
    webhookSecretSet: Boolean(config.webhookSecret),
    pollingEnabled: config.pollingEnabled,
    pollingIntervalSec: config.pollingIntervalSec,
    voiceNotesEnabled: config.voiceNotesEnabled,
    voiceRepliesEnabled: config.voiceRepliesEnabled,
    polling,
    updatedAt: config.updatedAt,
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | TelegramUpdate | null

  if (isTelegramUpdate(body)) {
    return handleTelegramWebhook(request, body)
  }

  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutatePairing(request)) {
    return NextResponse.json({ error: 'Telegram pairing writes are restricted to localhost by default.' }, { status: 403 })
  }

  const action = sanitizeString(body?.action)
  const config = await resolveAnorakProTelegramConfig()

  if (action === 'test') {
    if (!hasTelegramDeliveryCredentials(config)) {
      return NextResponse.json({ error: 'Telegram bot token and chat ID are required before testing.' }, { status: 400 })
    }

    await sendTelegramMessage({
      botToken: config.botToken,
      chatId: config.chatId,
      messageThreadId: config.messageThreadId || undefined,
      text: sanitizeString(body?.text) || 'Anorak Pro Telegram link is alive.',
    })

    return NextResponse.json({ ok: true, polling: await getAnorakProTelegramPollingStatus() })
  }

  if (action === 'poll-now') {
    if (!hasTelegramDeliveryCredentials(config)) {
      return NextResponse.json({ error: 'Telegram bot token and chat ID are required before polling.' }, { status: 400 })
    }
    if (!config.enabled || !config.pollingEnabled) {
      return NextResponse.json({
        ok: false,
        bridgeDisabled: true,
        hint: 'Telegram bridge is saved but disabled. Turn on Telegram bridge and 2-way local polling, then save again.',
      }, { status: 409 })
    }
    const polling = await pollAnorakProTelegramNow({ origin: request.nextUrl.origin })
    return NextResponse.json(polling)
  }

  if (action === 'restart-polling') {
    const polling = await ensureAnorakProTelegramPolling({ origin: request.nextUrl.origin })
    return NextResponse.json({ ok: true, polling })
  }

  return NextResponse.json({ error: 'Expected a Telegram webhook update, action=test, action=poll-now, or action=restart-polling.' }, { status: 400 })
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  if (!canMutatePairing(request)) {
    return NextResponse.json({ error: 'Telegram pairing writes are restricted to localhost by default.' }, { status: 403 })
  }

  await stopAnorakProTelegramPolling()
  await clearStoredAnorakProTelegramConfig()
  await clearStoredAnorakProTelegramPollingState()
  return NextResponse.json({ ok: true, configured: false, source: 'none' })
}
