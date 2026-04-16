import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'

const STORED_CONFIG_PATH = path.join(process.cwd(), 'data', 'anorak-pro-telegram.local.json')
const POLLING_STATE_PATH = path.join(process.cwd(), 'data', 'anorak-pro-telegram-poll.local.json')

const DEFAULT_POLL_INTERVAL_SEC = 8
const MIN_POLL_INTERVAL_SEC = 3
const MAX_POLL_INTERVAL_SEC = 60

export interface TelegramSendMessageInput {
  botToken: string
  chatId: string | number
  text: string
  messageThreadId?: string | number | null
  disableNotification?: boolean
}

export interface TelegramSendChatActionInput {
  botToken: string
  chatId: string | number
  action: 'typing' | 'record_voice' | 'upload_voice' | 'upload_photo'
  messageThreadId?: string | number | null
}

export interface TelegramSendAudioInput {
  botToken: string
  chatId: string | number
  audioBytes: Buffer
  filename: string
  caption?: string
  title?: string
  performer?: string
  messageThreadId?: string | number | null
}

export interface TelegramSendPhotoInput {
  botToken: string
  chatId: string | number
  photoBytes: Buffer
  filename?: string
  caption?: string
  messageThreadId?: string | number | null
}

export interface TelegramGetUpdatesInput {
  botToken: string
  offset?: number | null
  limit?: number | null
  timeoutSec?: number | null
}

export interface TelegramFileDownloadInput {
  botToken: string
  fileId: string
}

export interface TelegramFileDownloadResult {
  ok: true
  filePath: string
  fileUrl: string
  bytes: Buffer
}

export interface AnorakProTelegramStoredConfig {
  enabled: boolean
  botToken: string
  chatId: string
  messageThreadId: string
  webhookSecret: string
  pollingEnabled: boolean
  pollingIntervalSec: number
  voiceNotesEnabled: boolean
  voiceRepliesEnabled: boolean
  updatedAt: string
}

export interface AnorakProTelegramResolvedConfig {
  enabled: boolean
  botToken: string
  chatId: string
  messageThreadId: string
  webhookSecret: string
  pollingEnabled: boolean
  pollingIntervalSec: number
  voiceNotesEnabled: boolean
  voiceRepliesEnabled: boolean
  source: 'pairing' | 'env' | 'none'
  updatedAt?: string
}

interface WriteAnorakProTelegramConfigInput {
  enabled: boolean
  botToken: string
  chatId: string
  messageThreadId?: string
  webhookSecret?: string
  pollingEnabled?: boolean
  pollingIntervalSec?: number
  voiceNotesEnabled?: boolean
  voiceRepliesEnabled?: boolean
}

export interface AnorakProTelegramPollingState {
  offset: number | null
  lastOrigin: string
  lastPollAt: string
  lastSuccessfulPollAt: string
  lastInboundAt: string
  lastStartedAt: string
  lastStoppedAt: string
  lastError: string
  processedUpdateCount: number
  conversationCount: number
  missionCount: number
  lastUpdateId: number | null
  lastTranscript: string
  lastIgnoredAt: string
  lastIgnoredReason: string
  lastIgnoredChatId: string
  lastIgnoredThreadId: string
  lastIgnoredUsername: string
  lastIgnoredTextPreview: string
  bootstrappedAt: string
  sessions: Record<string, string>
}

function sanitizeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return value.toString()
  return ''
}

function normalizeChatId(value: unknown): string {
  return sanitizeString(value).replace(/\s+/g, '')
}

function normalizeMessageThreadId(value: unknown): string {
  return sanitizeString(value).replace(/\s+/g, '')
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
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

function coerceFiniteInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function clampPollInterval(value: unknown): number {
  const parsed = coerceFiniteInteger(value)
  if (parsed == null) return DEFAULT_POLL_INTERVAL_SEC
  return Math.min(MAX_POLL_INTERVAL_SEC, Math.max(MIN_POLL_INTERVAL_SEC, parsed))
}

function isAsciiSafe(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false
  }
  return true
}

function sanitizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const entries = Object.entries(value as Record<string, unknown>)
  const next: Record<string, string> = {}
  for (const [key, raw] of entries) {
    const cleanKey = sanitizeString(key)
    const cleanValue = sanitizeString(raw)
    if (cleanKey && cleanValue) {
      next[cleanKey] = cleanValue
    }
  }
  return next
}

function sanitizeStoredConfig(raw: unknown): AnorakProTelegramStoredConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  return {
    enabled: coerceBoolean(obj.enabled, true),
    botToken: sanitizeString(obj.botToken),
    chatId: normalizeChatId(obj.chatId),
    messageThreadId: normalizeMessageThreadId(obj.messageThreadId),
    webhookSecret: sanitizeString(obj.webhookSecret),
    pollingEnabled: coerceBoolean(obj.pollingEnabled, false),
    pollingIntervalSec: clampPollInterval(obj.pollingIntervalSec),
    voiceNotesEnabled: coerceBoolean(obj.voiceNotesEnabled, true),
    voiceRepliesEnabled: coerceBoolean(obj.voiceRepliesEnabled, true),
    updatedAt: sanitizeString(obj.updatedAt) || new Date().toISOString(),
  }
}

function createDefaultPollingState(): AnorakProTelegramPollingState {
  return {
    offset: null,
    lastOrigin: '',
    lastPollAt: '',
    lastSuccessfulPollAt: '',
    lastInboundAt: '',
    lastStartedAt: '',
    lastStoppedAt: '',
    lastError: '',
    processedUpdateCount: 0,
    conversationCount: 0,
    missionCount: 0,
    lastUpdateId: null,
    lastTranscript: '',
    lastIgnoredAt: '',
    lastIgnoredReason: '',
    lastIgnoredChatId: '',
    lastIgnoredThreadId: '',
    lastIgnoredUsername: '',
    lastIgnoredTextPreview: '',
    bootstrappedAt: '',
    sessions: {},
  }
}

function sanitizePollingState(raw: unknown): AnorakProTelegramPollingState {
  if (!raw || typeof raw !== 'object') return createDefaultPollingState()

  const obj = raw as Record<string, unknown>
  return {
    offset: coerceFiniteInteger(obj.offset),
    lastOrigin: sanitizeString(obj.lastOrigin),
    lastPollAt: sanitizeString(obj.lastPollAt),
    lastSuccessfulPollAt: sanitizeString(obj.lastSuccessfulPollAt),
    lastInboundAt: sanitizeString(obj.lastInboundAt),
    lastStartedAt: sanitizeString(obj.lastStartedAt),
    lastStoppedAt: sanitizeString(obj.lastStoppedAt),
    lastError: sanitizeString(obj.lastError),
    processedUpdateCount: Math.max(0, coerceFiniteInteger(obj.processedUpdateCount) ?? 0),
    conversationCount: Math.max(0, coerceFiniteInteger(obj.conversationCount) ?? 0),
    missionCount: Math.max(0, coerceFiniteInteger(obj.missionCount) ?? 0),
    lastUpdateId: coerceFiniteInteger(obj.lastUpdateId),
    lastTranscript: sanitizeString(obj.lastTranscript),
    lastIgnoredAt: sanitizeString(obj.lastIgnoredAt),
    lastIgnoredReason: sanitizeString(obj.lastIgnoredReason),
    lastIgnoredChatId: sanitizeString(obj.lastIgnoredChatId),
    lastIgnoredThreadId: sanitizeString(obj.lastIgnoredThreadId),
    lastIgnoredUsername: sanitizeString(obj.lastIgnoredUsername),
    lastIgnoredTextPreview: sanitizeString(obj.lastIgnoredTextPreview),
    bootstrappedAt: sanitizeString(obj.bootstrappedAt),
    sessions: sanitizeStringMap(obj.sessions),
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  if (process.platform !== 'win32') {
    await fs.chmod(filePath, 0o600).catch(() => {})
  }
}

export async function readStoredAnorakProTelegramConfig(): Promise<AnorakProTelegramStoredConfig | null> {
  try {
    const raw = await fs.readFile(STORED_CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(stripUtf8Bom(raw)) as unknown
    return sanitizeStoredConfig(parsed)
  } catch {
    return null
  }
}

export async function writeStoredAnorakProTelegramConfig(
  input: WriteAnorakProTelegramConfigInput,
): Promise<AnorakProTelegramStoredConfig> {
  const next: AnorakProTelegramStoredConfig = {
    enabled: Boolean(input.enabled),
    botToken: sanitizeString(input.botToken),
    chatId: normalizeChatId(input.chatId),
    messageThreadId: normalizeMessageThreadId(input.messageThreadId),
    webhookSecret: sanitizeString(input.webhookSecret),
    pollingEnabled: Boolean(input.pollingEnabled),
    pollingIntervalSec: clampPollInterval(input.pollingIntervalSec),
    voiceNotesEnabled: input.voiceNotesEnabled !== false,
    voiceRepliesEnabled: input.voiceRepliesEnabled !== false,
    updatedAt: new Date().toISOString(),
  }

  if ((next.enabled || next.pollingEnabled) && (!next.botToken || !next.chatId)) {
    throw new Error('Bot token and chat ID are required when the Telegram bridge is enabled.')
  }
  if (next.botToken && !isAsciiSafe(next.botToken)) {
    throw new Error('Bot token contains non-ASCII characters (masked placeholder?). Paste the real token.')
  }
  if (next.webhookSecret && !isAsciiSafe(next.webhookSecret)) {
    throw new Error('Webhook secret contains non-ASCII characters.')
  }

  await writeJsonFile(STORED_CONFIG_PATH, next)
  return next
}

export async function clearStoredAnorakProTelegramConfig(): Promise<void> {
  await fs.unlink(STORED_CONFIG_PATH).catch(() => {})
}

export async function readStoredAnorakProTelegramPollingState(): Promise<AnorakProTelegramPollingState> {
  try {
    const raw = await fs.readFile(POLLING_STATE_PATH, 'utf8')
    const parsed = JSON.parse(stripUtf8Bom(raw)) as unknown
    return sanitizePollingState(parsed)
  } catch {
    return createDefaultPollingState()
  }
}

export async function writeStoredAnorakProTelegramPollingState(
  input: AnorakProTelegramPollingState,
): Promise<AnorakProTelegramPollingState> {
  const next = sanitizePollingState(input)
  await writeJsonFile(POLLING_STATE_PATH, next)
  return next
}

export async function clearStoredAnorakProTelegramPollingState(): Promise<void> {
  await fs.unlink(POLLING_STATE_PATH).catch(() => {})
}

function coerceEnvEnabled(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

export async function resolveAnorakProTelegramConfig(): Promise<AnorakProTelegramResolvedConfig> {
  const stored = await readStoredAnorakProTelegramConfig()

  const envBotToken = sanitizeString(process.env.ANORAK_PRO_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
  const envChatId = normalizeChatId(process.env.ANORAK_PRO_TELEGRAM_CHAT_ID)
  const envThreadId = normalizeMessageThreadId(process.env.ANORAK_PRO_TELEGRAM_MESSAGE_THREAD_ID)
  const envWebhookSecret = sanitizeString(process.env.ANORAK_PRO_TELEGRAM_WEBHOOK_SECRET)
  const envPollingEnabled = coerceEnvEnabled(process.env.ANORAK_PRO_TELEGRAM_POLLING_ENABLED, false)
  const envPollIntervalSec = clampPollInterval(process.env.ANORAK_PRO_TELEGRAM_POLL_INTERVAL_SEC)
  const envVoiceNotesEnabled = coerceEnvEnabled(process.env.ANORAK_PRO_TELEGRAM_VOICE_NOTES_ENABLED, true)
  const envVoiceRepliesEnabled = coerceEnvEnabled(process.env.ANORAK_PRO_TELEGRAM_VOICE_REPLIES_ENABLED, true)

  const botToken = stored?.botToken || envBotToken
  const chatId = stored?.chatId || envChatId
  const messageThreadId = stored?.messageThreadId || envThreadId
  const webhookSecret = stored?.webhookSecret || envWebhookSecret
  const enabled = stored
    ? stored.enabled
    : coerceEnvEnabled(process.env.ANORAK_PRO_TELEGRAM_ENABLED, Boolean(botToken && chatId))
  const pollingEnabled = stored?.pollingEnabled ?? envPollingEnabled
  const pollingIntervalSec = stored?.pollingIntervalSec ?? envPollIntervalSec
  const voiceNotesEnabled = stored?.voiceNotesEnabled ?? envVoiceNotesEnabled
  const voiceRepliesEnabled = stored?.voiceRepliesEnabled ?? envVoiceRepliesEnabled

  return {
    enabled,
    botToken,
    chatId,
    messageThreadId,
    webhookSecret,
    pollingEnabled,
    pollingIntervalSec,
    voiceNotesEnabled,
    voiceRepliesEnabled,
    source: stored ? 'pairing' : (botToken || chatId || webhookSecret ? 'env' : 'none'),
    updatedAt: stored?.updatedAt,
  }
}

export function maskTelegramBotToken(botToken: string): string {
  const trimmed = sanitizeString(botToken)
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '********'
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

export function hasTelegramDeliveryCredentials(
  config: Pick<AnorakProTelegramResolvedConfig, 'botToken' | 'chatId'>,
): boolean {
  return Boolean(config.botToken && config.chatId)
}

export function truncateTelegramText(text: string, maxLength = 3800): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 14)).trimEnd()}\n\n[truncated]`
}

function parseOptionalInteger(value: string | number | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

interface TelegramApiEnvelope<T> {
  ok?: boolean
  description?: string
  result?: T
}

async function telegramJsonRequest<T>(
  botToken: string,
  methodName: string,
  init?: RequestInit,
): Promise<T> {
  const cleanBotToken = sanitizeString(botToken)
  if (!cleanBotToken) {
    throw new Error('Telegram bot token is required.')
  }

  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(cleanBotToken)}/${methodName}`, {
    cache: 'no-store',
    ...init,
  })

  const data = await response.json().catch(async () => ({
    description: await response.text().catch(() => 'Telegram request failed'),
  })) as TelegramApiEnvelope<T>

  if (!response.ok || data.ok === false || typeof data.result === 'undefined') {
    throw new Error(data.description || `Telegram ${methodName} failed (HTTP ${response.status})`)
  }

  return data.result
}

export async function sendTelegramMessage(input: TelegramSendMessageInput): Promise<{ ok: true; messageId?: number }> {
  const botToken = sanitizeString(input.botToken)
  const chatId = normalizeChatId(input.chatId)
  const text = truncateTelegramText(input.text)
  const messageThreadId = parseOptionalInteger(input.messageThreadId)

  if (!botToken) throw new Error('Telegram bot token is required.')
  if (!chatId) throw new Error('Telegram chat ID is required.')
  if (!text) throw new Error('Telegram message text is empty.')

  const result = await telegramJsonRequest<{ message_id?: number }>(botToken, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(input.disableNotification ? { disable_notification: true } : {}),
      ...(messageThreadId != null ? { message_thread_id: messageThreadId } : {}),
    }),
  })

  return { ok: true, messageId: result.message_id }
}

export async function sendTelegramChatAction(input: TelegramSendChatActionInput): Promise<{ ok: true }> {
  const botToken = sanitizeString(input.botToken)
  const chatId = normalizeChatId(input.chatId)
  const messageThreadId = parseOptionalInteger(input.messageThreadId)

  if (!botToken) throw new Error('Telegram bot token is required.')
  if (!chatId) throw new Error('Telegram chat ID is required.')

  await telegramJsonRequest(botToken, 'sendChatAction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: input.action,
      ...(messageThreadId != null ? { message_thread_id: messageThreadId } : {}),
    }),
  })

  return { ok: true }
}

export async function sendTelegramAudio(input: TelegramSendAudioInput): Promise<{ ok: true; messageId?: number }> {
  const botToken = sanitizeString(input.botToken)
  const chatId = normalizeChatId(input.chatId)
  const filename = sanitizeString(input.filename) || 'anorak-pro.mp3'
  const caption = sanitizeString(input.caption)
  const title = sanitizeString(input.title)
  const performer = sanitizeString(input.performer)
  const messageThreadId = parseOptionalInteger(input.messageThreadId)

  if (!botToken) throw new Error('Telegram bot token is required.')
  if (!chatId) throw new Error('Telegram chat ID is required.')
  if (!Buffer.isBuffer(input.audioBytes) || input.audioBytes.length === 0) {
    throw new Error('Telegram audio upload is empty.')
  }

  const form = new FormData()
  const audioBytes = Uint8Array.from(input.audioBytes)
  form.set('chat_id', chatId)
  form.set('audio', new Blob([audioBytes], { type: 'audio/mpeg' }), filename)
  if (caption) form.set('caption', truncateTelegramText(caption, 900))
  if (title) form.set('title', title)
  if (performer) form.set('performer', performer)
  if (messageThreadId != null) form.set('message_thread_id', String(messageThreadId))

  const result = await telegramJsonRequest<{ message_id?: number }>(botToken, 'sendAudio', {
    method: 'POST',
    body: form,
  })

  return { ok: true, messageId: result.message_id }
}

export async function sendTelegramPhoto(input: TelegramSendPhotoInput): Promise<{ ok: true; messageId?: number }> {
  const botToken = sanitizeString(input.botToken)
  const chatId = normalizeChatId(input.chatId)
  const filename = sanitizeString(input.filename) || 'anorak-pro.png'
  const caption = sanitizeString(input.caption)
  const messageThreadId = parseOptionalInteger(input.messageThreadId)
  const lowerFilename = filename.toLowerCase()
  const mimeType = lowerFilename.endsWith('.jpg') || lowerFilename.endsWith('.jpeg')
    ? 'image/jpeg'
    : lowerFilename.endsWith('.webp')
      ? 'image/webp'
      : lowerFilename.endsWith('.gif')
        ? 'image/gif'
        : 'image/png'

  if (!botToken) throw new Error('Telegram bot token is required.')
  if (!chatId) throw new Error('Telegram chat ID is required.')
  if (!Buffer.isBuffer(input.photoBytes) || input.photoBytes.length === 0) {
    throw new Error('Telegram photo upload is empty.')
  }

  const form = new FormData()
  const photoBytes = Uint8Array.from(input.photoBytes)
  form.set('chat_id', chatId)
  form.set('photo', new Blob([photoBytes], { type: mimeType }), filename)
  if (caption) form.set('caption', truncateTelegramText(caption, 900))
  if (messageThreadId != null) form.set('message_thread_id', String(messageThreadId))

  const result = await telegramJsonRequest<{ message_id?: number }>(botToken, 'sendPhoto', {
    method: 'POST',
    body: form,
  })

  return { ok: true, messageId: result.message_id }
}

export async function getTelegramUpdates(
  input: TelegramGetUpdatesInput,
): Promise<Array<Record<string, unknown>>> {
  const botToken = sanitizeString(input.botToken)
  const params = new URLSearchParams()
  if (typeof input.offset === 'number' && Number.isFinite(input.offset)) {
    params.set('offset', String(Math.trunc(input.offset)))
  }
  params.set('limit', String(Math.min(100, Math.max(1, input.limit ?? 25))))
  params.set('timeout', String(Math.max(0, input.timeoutSec ?? 0)))
  params.set('allowed_updates', JSON.stringify(['message', 'edited_message']))

  return telegramJsonRequest<Array<Record<string, unknown>>>(
    botToken,
    `getUpdates?${params.toString()}`,
  )
}

export async function downloadTelegramFile(input: TelegramFileDownloadInput): Promise<TelegramFileDownloadResult> {
  const botToken = sanitizeString(input.botToken)
  const fileId = sanitizeString(input.fileId)

  if (!botToken) throw new Error('Telegram bot token is required.')
  if (!fileId) throw new Error('Telegram file ID is required.')

  const fileInfo = await telegramJsonRequest<{ file_path?: string }>(botToken, 'getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  })

  const filePath = sanitizeString(fileInfo.file_path)
  if (!filePath) {
    throw new Error('Telegram did not return a downloadable file path.')
  }

  const fileUrl = `https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${filePath}`
  const response = await fetch(fileUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Telegram file download failed (HTTP ${response.status})`)
  }

  return {
    ok: true,
    filePath,
    fileUrl,
    bytes: Buffer.from(await response.arrayBuffer()),
  }
}
