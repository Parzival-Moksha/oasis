import 'server-only'

import { extname } from 'path'

import { prisma } from '@/lib/db'
import { readStoredAnorakProContextConfig } from '@/lib/anorak-pro-config'
import {
  type AnorakProTelegramPollingState,
  type AnorakProTelegramResolvedConfig,
  downloadTelegramFile,
  getTelegramUpdates,
  hasTelegramDeliveryCredentials,
  readStoredAnorakProTelegramPollingState,
  resolveAnorakProTelegramConfig,
  sendTelegramAudio,
  sendTelegramChatAction,
  sendTelegramMessage,
  sendTelegramPhoto,
  truncateTelegramText,
  writeStoredAnorakProTelegramPollingState,
} from '@/lib/telegram'
import { transcribeLocally } from '@/lib/voice/local-stt'

export type TelegramIncomingMessage = {
  message_id?: number
  text?: string
  caption?: string
  chat?: { id?: number | string; type?: string }
  from?: { id?: number | string; is_bot?: boolean; username?: string }
  message_thread_id?: number
  voice?: {
    file_id?: string
    file_unique_id?: string
    mime_type?: string
    duration?: number
  }
  audio?: {
    file_id?: string
    mime_type?: string
    duration?: number
    file_name?: string
  }
  document?: {
    file_id?: string
    mime_type?: string
    file_name?: string
  }
}

export type TelegramUpdate = {
  update_id?: number
  message?: TelegramIncomingMessage
  edited_message?: TelegramIncomingMessage
}

export interface TelegramMediaEvent {
  mediaType: string
  url: string
  prompt?: string
}

export interface AnorakProTelegramConversationResult {
  replyText: string
  voiceText: string
  sessionId: string
  media: TelegramMediaEvent[]
}

export interface AnorakProTelegramProcessResult {
  ok: true
  kind: 'ignored' | 'help' | 'status' | 'mission' | 'conversation' | 'voice-disabled'
  state: AnorakProTelegramPollingState
  updateId: number | null
  missionId?: number
  transcript?: string
  replyText?: string
  ignoredReason?: string
}

export interface AnorakProTelegramPollingStatus {
  running: boolean
  busy: boolean
  enabled: boolean
  configured: boolean
  intervalSec: number
  offset: number | null
  origin: string
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
}

export interface AnorakProTelegramPollSummary {
  ok: true
  bootstrapped: boolean
  processedCount: number
  conversationCount: number
  missionCount: number
  ignoredCount: number
  lastUpdateId: number | null
  status: AnorakProTelegramPollingStatus
}

const DEFAULT_INTERNAL_ORIGIN = 'http://127.0.0.1:4516'

interface TelegramToolTrace {
  id: string
  icon: string
  display: string
  resultPreview?: string
  resultIsError?: boolean
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

function normalizeThreadId(value: unknown): string {
  return sanitizeString(value).replace(/\s+/g, '')
}

function normalizeOrigin(value: string): string {
  const trimmed = sanitizeString(value)
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function getInternalOrigin(explicitOrigin?: string, lastOrigin?: string): string {
  const candidates = [
    explicitOrigin,
    process.env.OASIS_INTERNAL_URL,
    process.env.OASIS_URL,
    process.env.NEXT_PUBLIC_OASIS_URL,
    lastOrigin,
    DEFAULT_INTERNAL_ORIGIN,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate || '')
    if (normalized) return normalized
  }

  return DEFAULT_INTERNAL_ORIGIN
}

function isTelegramMessage(value: unknown): value is TelegramIncomingMessage {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return Boolean(obj.chat)
}

export function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.update_id === 'number' || isTelegramMessage(obj.message) || isTelegramMessage(obj.edited_message)
}

function stripCommandPrefix(text: string): string {
  return text.replace(/^\/[a-z_]+(?:@\w+)?\s*/i, '').trim()
}

function deriveMissionName(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() || ''
  if (!firstLine) return 'Telegram mission'
  if (firstLine.length <= 120) return firstLine
  return `${firstLine.slice(0, 117).trimEnd()}...`
}

function getUpdateId(update: TelegramUpdate): number | null {
  return typeof update.update_id === 'number' ? update.update_id : null
}

function getPrimaryMessage(update: TelegramUpdate): TelegramIncomingMessage | null {
  const message = update.message || update.edited_message
  return isTelegramMessage(message) ? message : null
}

function getReplyThreadId(message: TelegramIncomingMessage, fallbackThreadId: string): string | undefined {
  const liveThreadId = typeof message.message_thread_id === 'number' ? String(message.message_thread_id) : ''
  return liveThreadId || fallbackThreadId || undefined
}

function getChatKey(message: TelegramIncomingMessage): string {
  const chatId = normalizeChatId(message.chat?.id)
  const threadId = typeof message.message_thread_id === 'number' ? String(message.message_thread_id) : 'root'
  return `${chatId}:${threadId}`
}

function recordIgnoredMessageState(
  state: AnorakProTelegramPollingState,
  message: TelegramIncomingMessage | null,
  reason: string,
): AnorakProTelegramPollingState {
  const preview = sanitizeString(message?.text || message?.caption)
  const threadId = typeof message?.message_thread_id === 'number' ? String(message.message_thread_id) : ''

  return {
    ...state,
    lastIgnoredAt: new Date().toISOString(),
    lastIgnoredReason: reason,
    lastIgnoredChatId: normalizeChatId(message?.chat?.id),
    lastIgnoredThreadId: threadId,
    lastIgnoredUsername: sanitizeString(message?.from?.username),
    lastIgnoredTextPreview: truncateTelegramText(preview, 120),
  }
}

function matchesConfiguredDestination(message: TelegramIncomingMessage, config: AnorakProTelegramResolvedConfig): boolean {
  const chatId = normalizeChatId(message.chat?.id)
  if (!chatId) return false
  if (config.chatId && chatId !== config.chatId) return false

  if (config.messageThreadId) {
    const threadId = typeof message.message_thread_id === 'number' ? String(message.message_thread_id) : ''
    if (threadId !== config.messageThreadId) return false
  }

  return true
}

function buildTelegramHelpMessage(config: AnorakProTelegramResolvedConfig): string {
  const lines = [
    'Anorak Pro Telegram is live.',
    '/status - pipeline snapshot',
    '/mission <text> - create a para mission',
    '/new - reset only the Claude session for this Telegram chat',
    config.voiceRepliesEnabled
      ? 'Plain text gets a written reply plus a short spoken TLDR by default.'
      : '/voice <text> - force a spoken TLDR for one reply',
    'Any other text message talks directly to Anorak Pro.',
  ]

  if (config.voiceNotesEnabled) {
    lines.push('Voice notes are on: send a recording and I will transcribe it locally.')
  }

  return lines.join('\n')
}

function normalizeTelegramReplyText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toSingleLine(text: string, maxLength = 200): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function extractTaggedSection(text: string, tag: string): string {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = text.match(pattern)
  return match?.[1]?.trim() || ''
}

function stripTelegramReplyTags(text: string): string {
  return text
    .replace(/<voice_tldr>[\s\S]*?<\/voice_tldr>/gi, '')
    .replace(/<text_reply>[\s\S]*?<\/text_reply>/gi, '')
    .trim()
}

function buildFallbackVoiceTldr(text: string): string {
  const cleaned = normalizeTelegramReplyText(
    stripTelegramReplyTags(text).replace(/[`*_>#-]/g, ' ')
  )
  if (!cleaned) return ''

  const firstParagraph = cleaned.split(/\n\n+/).find(Boolean) || cleaned
  const sentences = firstParagraph.match(/[^.!?]+[.!?]+/g) || []
  const summary = sentences.slice(0, 2).join(' ').trim() || firstParagraph
  return toSingleLine(summary, 260)
}

function formatTelegramToolTrail(tools: TelegramToolTrace[]): string {
  if (tools.length === 0) return ''

  const lines = ['Live tool trail']
  for (const tool of tools.slice(-4)) {
    lines.push(`${tool.icon || '🔧'} ${toSingleLine(tool.display, 180)}`)
    if (tool.resultPreview && tool.resultIsError) {
      lines.push(`x ${toSingleLine(tool.resultPreview, 160)}`)
    }
  }
  return lines.join('\n')
}

function formatTelegramMediaSummary(media: TelegramMediaEvent[]): string {
  const visibleMedia = media.filter(item => item.mediaType !== 'audio' && item.mediaType !== 'image')
  if (visibleMedia.length === 0) return ''

  return [
    'Media',
    ...visibleMedia.slice(-3).map(item => `${item.mediaType}: ${item.url}`),
  ].join('\n')
}

function formatTelegramConversationMessage(input: {
  textReply: string
  tools: TelegramToolTrace[]
  media: TelegramMediaEvent[]
}): string {
  const blocks = [
    normalizeTelegramReplyText(input.textReply),
    formatTelegramToolTrail(input.tools),
    formatTelegramMediaSummary(input.media),
  ].filter(Boolean)

  return truncateTelegramText(blocks.join('\n\n') || 'Anorak Pro did not return any text yet.')
}

async function buildStatusMessage(): Promise<string> {
  const [todoCount, wipCount, doneCount, immatureCount, topTodo, recentDone] = await Promise.all([
    prisma.mission.count({ where: { status: 'todo' } }),
    prisma.mission.count({ where: { status: 'wip' } }),
    prisma.mission.count({ where: { status: 'done' } }),
    prisma.mission.count({
      where: {
        maturityLevel: { lt: 3 },
        assignedTo: { in: ['anorak', 'anorak-pro'] },
        status: { not: 'done' },
      },
    }),
    prisma.mission.findFirst({
      where: { status: 'todo' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, priority: true, maturityLevel: true },
    }),
    prisma.mission.findFirst({
      where: { status: 'done' },
      orderBy: { endedAt: 'desc' },
      select: { id: true, name: true, endedAt: true },
    }),
  ])

  return [
    'Anorak Pro status',
    `TODO: ${todoCount} | WIP: ${wipCount} | DONE: ${doneCount} | Immature: ${immatureCount}`,
    topTodo ? `Top TODO: #${topTodo.id} ${topTodo.name} (m${topTodo.maturityLevel}, p${(topTodo.priority ?? 0).toFixed(2)})` : 'Top TODO: none',
    recentDone ? `Latest ship: #${recentDone.id} ${recentDone.name}` : 'Latest ship: none',
  ].join('\n')
}

async function createMissionFromTelegram(text: string, chatId: string): Promise<{ id: number; name: string }> {
  const trimmed = text.trim()
  const timestamp = new Date().toISOString()
  const mission = await prisma.mission.create({
    data: {
      name: deriveMissionName(trimmed),
      description: trimmed,
      status: 'todo',
      assignedTo: 'anorak-pro',
      maturityLevel: 0,
      urgency: 5,
      easiness: 5,
      impact: 5,
      priority: 1,
      notes: `Source: Telegram (${chatId})`,
      history: JSON.stringify([
        {
          timestamp,
          actor: 'carbondev',
          action: 'telegram_input',
          channel: 'telegram',
          content: trimmed,
        },
      ]),
    },
    select: { id: true, name: true },
  })

  return mission
}

async function replyToTelegramMessage(
  config: AnorakProTelegramResolvedConfig,
  message: TelegramIncomingMessage,
  text: string,
): Promise<void> {
  const chatId = normalizeChatId(message.chat?.id)
  if (!chatId) return

  await sendTelegramMessage({
    botToken: config.botToken,
    chatId,
    messageThreadId: getReplyThreadId(message, config.messageThreadId),
    text,
  })
}

function resolveTelegramMediaUrl(url: string, origin?: string): string {
  const cleanUrl = sanitizeString(url)
  if (!cleanUrl) return ''
  if (/^https?:\/\//i.test(cleanUrl)) return cleanUrl

  const normalizedOrigin = getInternalOrigin(origin)
  return cleanUrl.startsWith('/')
    ? `${normalizedOrigin}${cleanUrl}`
    : `${normalizedOrigin}/${cleanUrl.replace(/^\.?\//, '')}`
}

function inferTelegramImageFilename(url: string, prompt?: string): string {
  const slug = sanitizeString(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  try {
    const parsed = new URL(url)
    const ext = extname(parsed.pathname).toLowerCase()
    if (ext) return `${slug || 'anorak-pro-image'}${ext}`
  } catch {
    // ignore parse failure and fall back to png
  }

  return `${slug || 'anorak-pro-image'}.png`
}

async function sendTelegramConversationImages(input: {
  config: AnorakProTelegramResolvedConfig
  message: TelegramIncomingMessage
  media: TelegramMediaEvent[]
  origin?: string
}): Promise<void> {
  const chatId = normalizeChatId(input.message.chat?.id)
  if (!chatId) return

  for (const item of input.media.filter(media => media.mediaType === 'image').slice(-3)) {
    const absoluteUrl = resolveTelegramMediaUrl(item.url, input.origin)
    if (!absoluteUrl) continue

    try {
      await sendTelegramChatAction({
        botToken: input.config.botToken,
        chatId,
        messageThreadId: getReplyThreadId(input.message, input.config.messageThreadId),
        action: 'upload_photo',
      }).catch(() => {})

      const response = await fetch(absoluteUrl, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Image fetch failed (HTTP ${response.status})`)
      }

      await sendTelegramPhoto({
        botToken: input.config.botToken,
        chatId,
        messageThreadId: getReplyThreadId(input.message, input.config.messageThreadId),
        photoBytes: Buffer.from(await response.arrayBuffer()),
        filename: inferTelegramImageFilename(absoluteUrl, item.prompt),
        caption: item.prompt ? truncateTelegramText(item.prompt, 900) : 'Generated by Anorak Pro',
      })
    } catch (error) {
      await replyToTelegramMessage(
        input.config,
        input.message,
        `Generated image\n${absoluteUrl}\n\n${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => {})
    }
  }
}

function inferTelegramAudioExtension(input: {
  filePath?: string
  fileName?: string
  mimeType?: string
}): string {
  const directExt = extname(sanitizeString(input.fileName) || sanitizeString(input.filePath)).toLowerCase()
  if (directExt === '.oga') return '.ogg'
  if (directExt) return directExt

  const mime = sanitizeString(input.mimeType).toLowerCase()
  if (mime.includes('ogg') || mime.includes('opus')) return '.ogg'
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3'
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a'
  if (mime.includes('wav')) return '.wav'
  if (mime.includes('webm')) return '.webm'
  if (mime.includes('aac')) return '.aac'
  return '.ogg'
}

async function transcribeTelegramVoiceMessage(
  config: AnorakProTelegramResolvedConfig,
  message: TelegramIncomingMessage,
): Promise<string> {
  const voice = message.voice
  const audio = message.audio
  const document = message.document

  const fileId = sanitizeString(voice?.file_id || audio?.file_id || document?.file_id)
  if (!fileId) return ''

  const download = await downloadTelegramFile({
    botToken: config.botToken,
    fileId,
  })

  const extension = inferTelegramAudioExtension({
    filePath: download.filePath,
    fileName: audio?.file_name || document?.file_name,
    mimeType: voice?.mime_type || audio?.mime_type || document?.mime_type,
  })

  const parsed = await transcribeLocally(download.bytes, extension, 'auto')
  return parsed.transcript.trim()
}

async function runAnorakProTelegramConversation(input: {
  prompt: string
  sessionId?: string
  origin?: string
}): Promise<AnorakProTelegramConversationResult> {
  const origin = getInternalOrigin(input.origin)
  const storedContext = await readStoredAnorakProContextConfig()
  const response = await fetch(`${origin}/api/claude-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      prompt: [
        'You are replying inside Telegram as Anorak Pro.',
        'Keep it concise, clear, and mobile-friendly unless carbondev asks for depth.',
        'Return your final answer in exactly two XML blocks.',
        '<voice_tldr>1-3 short spoken sentences, punchy and honest, no markdown, max 260 chars.</voice_tldr>',
        '<text_reply>The full written answer for Telegram with generous line breaks and short paragraphs.</text_reply>',
        'Do not include raw tool logs in the text reply. The bridge will summarize tools separately.',
        input.prompt.trim(),
      ].join('\n\n'),
      agent: 'anorak-pro',
      sessionId: input.sessionId || undefined,
      customModules: storedContext.customModules,
      lobeModules: storedContext.lobeModules,
      topMissionCount: storedContext.topMissionCount,
      moduleValues: storedContext.moduleValues,
    }),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Anorak Pro chat failed (HTTP ${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sessionId = sanitizeString(input.sessionId)
  let rawAssistantText = ''
  let fallbackReplyText = ''
  const media: TelegramMediaEvent[] = []
  const toolTraceById = new Map<string, TelegramToolTrace>()
  const toolTraceOrder: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]' || trimmed.startsWith(':')) continue

      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
      let event: Record<string, unknown> | null = null
      try {
        event = JSON.parse(payload) as Record<string, unknown>
      } catch {
        continue
      }

      if (event.type === 'session' && typeof event.sessionId === 'string') {
        sessionId = event.sessionId
      } else if (event.type === 'text' && typeof event.content === 'string') {
        rawAssistantText += event.content
      } else if (event.type === 'tool' || event.type === 'tool_start') {
        const toolId = typeof event.id === 'string' && event.id ? event.id : `tool-${toolTraceOrder.length}`
        const nextTrace: TelegramToolTrace = {
          id: toolId,
          icon: typeof event.icon === 'string' && event.icon ? event.icon : '🔧',
          display: typeof event.display === 'string' && event.display
            ? event.display
            : (typeof event.name === 'string' && event.name ? event.name : 'Tool'),
          resultPreview: toolTraceById.get(toolId)?.resultPreview,
          resultIsError: toolTraceById.get(toolId)?.resultIsError,
        }
        if (!toolTraceById.has(toolId)) {
          toolTraceOrder.push(toolId)
        }
        toolTraceById.set(toolId, nextTrace)
      } else if (event.type === 'tool_result') {
        const toolId = typeof event.toolUseId === 'string' && event.toolUseId ? event.toolUseId : `tool-${toolTraceOrder.length}`
        const existing = toolTraceById.get(toolId)
        if (!existing) {
          toolTraceOrder.push(toolId)
        }
        toolTraceById.set(toolId, {
          id: toolId,
          icon: existing?.icon || '🔧',
          display: existing?.display || (typeof event.name === 'string' && event.name ? event.name : 'Tool'),
          resultPreview: typeof event.preview === 'string' ? event.preview : '',
          resultIsError: Boolean(event.isError),
        })
      } else if (
        event.type === 'media' &&
        typeof event.mediaType === 'string' &&
        typeof event.url === 'string'
      ) {
        media.push({
          mediaType: event.mediaType,
          url: event.url,
          prompt: typeof event.prompt === 'string' ? event.prompt : undefined,
        })
      } else if (event.type === 'error' && typeof event.content === 'string' && !fallbackReplyText.trim()) {
        fallbackReplyText = event.content
      }
    }
  }

  const taggedTextReply = extractTaggedSection(rawAssistantText, 'text_reply')
  const rawTextReply = normalizeTelegramReplyText(taggedTextReply || stripTelegramReplyTags(rawAssistantText))
  const voiceText = extractTaggedSection(rawAssistantText, 'voice_tldr') || buildFallbackVoiceTldr(rawTextReply || fallbackReplyText)
  const toolTrail = toolTraceOrder
    .map(toolId => toolTraceById.get(toolId))
    .filter((value): value is TelegramToolTrace => Boolean(value))
  const formattedReply = formatTelegramConversationMessage({
    textReply: rawTextReply || fallbackReplyText,
    tools: toolTrail,
    media,
  })

  return {
    replyText: formattedReply,
    voiceText: toSingleLine(voiceText, 260),
    sessionId,
    media,
  }
}

async function generateTelegramVoiceReplyAudio(input: {
  text: string
  origin?: string
}): Promise<{ bytes: Buffer; filename: string } | null> {
  const text = truncateTelegramText(input.text, 1400)
  if (!text) return null

  const origin = getInternalOrigin(input.origin)
  const response = await fetch(`${origin}/api/media/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      text,
      agentType: 'anorak-pro',
      voice: 'adam',
    }),
  })

  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof data.error === 'string' && data.error ? data.error : `Voice generation failed (HTTP ${response.status})`
    throw new Error(message)
  }

  const urlPath = typeof data.url === 'string' ? data.url : ''
  if (!urlPath) {
    throw new Error('Voice generation did not return an audio URL.')
  }

  const audioResponse = await fetch(urlPath.startsWith('http') ? urlPath : `${origin}${urlPath}`, {
    cache: 'no-store',
  })
  if (!audioResponse.ok) {
    throw new Error(`Unable to fetch generated voice audio (HTTP ${audioResponse.status})`)
  }

  return {
    bytes: Buffer.from(await audioResponse.arrayBuffer()),
    filename: 'anorak-pro-reply.mp3',
  }
}

export async function processTelegramUpdate(input: {
  update: TelegramUpdate
  config: AnorakProTelegramResolvedConfig
  state: AnorakProTelegramPollingState
  origin?: string
}): Promise<AnorakProTelegramProcessResult> {
  const { config } = input
  let state = { ...input.state, sessions: { ...input.state.sessions } }
  const updateId = getUpdateId(input.update)
  const message = getPrimaryMessage(input.update)

  if (!config.enabled || !hasTelegramDeliveryCredentials(config)) {
    return {
      ok: true,
      kind: 'ignored',
      state,
      updateId,
      ignoredReason: 'telegram-disabled',
    }
  }

  if (!message) {
    return {
      ok: true,
      kind: 'ignored',
      state,
      updateId,
      ignoredReason: 'empty-message',
    }
  }

  if (message.from?.is_bot) {
    return {
      ok: true,
      kind: 'ignored',
      state: recordIgnoredMessageState(state, message, 'bot-message'),
      updateId,
      ignoredReason: 'bot-message',
    }
  }

  if (!matchesConfiguredDestination(message, config)) {
    return {
      ok: true,
      kind: 'ignored',
      state: recordIgnoredMessageState(state, message, 'unexpected-chat'),
      updateId,
      ignoredReason: 'unexpected-chat',
    }
  }

  let inboundText = sanitizeString(message.text || message.caption)
  let transcript = ''
  const hasAudioAttachment = Boolean(message.voice?.file_id || message.audio?.file_id || message.document?.file_id)

  if (!inboundText && hasAudioAttachment) {
    if (!config.voiceNotesEnabled) {
      await replyToTelegramMessage(
        config,
        message,
        'Voice notes are currently disabled in Anorak Pro Telegram settings.',
      )
      return {
        ok: true,
        kind: 'voice-disabled',
        state,
        updateId,
      }
    }

    await sendTelegramChatAction({
      botToken: config.botToken,
      chatId: normalizeChatId(message.chat?.id),
      messageThreadId: getReplyThreadId(message, config.messageThreadId),
      action: 'typing',
    }).catch(() => {})

    transcript = await transcribeTelegramVoiceMessage(config, message)
    if (!transcript) {
      await replyToTelegramMessage(
        config,
        message,
        'I could not hear clear speech in that recording. Try another voice note or send text.',
      )
      return {
        ok: true,
        kind: 'conversation',
        state,
        updateId,
        transcript: '',
        replyText: 'I could not hear clear speech in that recording.',
      }
    }

    inboundText = transcript
    state.lastTranscript = truncateTelegramText(transcript, 280)
  }

  if (!inboundText) {
    return {
      ok: true,
      kind: 'ignored',
      state,
      updateId,
      ignoredReason: 'unsupported-message',
    }
  }

  state.lastInboundAt = new Date().toISOString()

  if (/^\/(?:start|help)\b/i.test(inboundText)) {
    const replyText = buildTelegramHelpMessage(config)
    await replyToTelegramMessage(config, message, replyText)
    return {
      ok: true,
      kind: 'help',
      state,
      updateId,
      transcript: transcript || undefined,
      replyText,
    }
  }

  if (/^\/status\b/i.test(inboundText)) {
    const replyText = await buildStatusMessage()
    await replyToTelegramMessage(config, message, replyText)
    return {
      ok: true,
      kind: 'status',
      state,
      updateId,
      transcript: transcript || undefined,
      replyText,
    }
  }

  const chatKey = getChatKey(message)

  if (/^\/(?:new|reset)\b/i.test(inboundText)) {
    delete state.sessions[chatKey]
    const replyText = 'Started a fresh Claude session for this Telegram chat. The Telegram history stays; only Anorak Pro context resets.'
    await replyToTelegramMessage(config, message, replyText)
    return {
      ok: true,
      kind: 'conversation',
      state,
      updateId,
      transcript: transcript || undefined,
      replyText,
    }
  }

  if (/^\/mission\b/i.test(inboundText)) {
    const missionText = stripCommandPrefix(inboundText)
    if (!missionText) {
      const replyText = 'Use /mission <text> or send plain text to talk directly with Anorak Pro.'
      await replyToTelegramMessage(config, message, replyText)
      return {
        ok: true,
        kind: 'mission',
        state,
        updateId,
        transcript: transcript || undefined,
        replyText,
      }
    }

    const mission = await createMissionFromTelegram(missionText, normalizeChatId(message.chat?.id))
    state.missionCount += 1
    const replyText = `Queued mission #${mission.id}: ${mission.name}`
    await replyToTelegramMessage(config, message, replyText)
    return {
      ok: true,
      kind: 'mission',
      state,
      updateId,
      missionId: mission.id,
      transcript: transcript || undefined,
      replyText,
    }
  }
  const explicitVoiceReply = /^\/(?:voice|speak)\b/i.test(inboundText)
  const wantsVoiceReply = config.voiceRepliesEnabled || explicitVoiceReply
  const conversationInput = explicitVoiceReply ? stripCommandPrefix(inboundText) : inboundText
  if (!conversationInput) {
    const replyText = 'Use /voice <text> if you want an audio reply, or send plain text.'
    await replyToTelegramMessage(config, message, replyText)
    return {
      ok: true,
      kind: 'conversation',
      state,
      updateId,
      transcript: transcript || undefined,
      replyText,
    }
  }

  await sendTelegramChatAction({
    botToken: config.botToken,
    chatId: normalizeChatId(message.chat?.id),
    messageThreadId: getReplyThreadId(message, config.messageThreadId),
    action: 'typing',
  }).catch(() => {})

  const conversation = await runAnorakProTelegramConversation({
    prompt: transcript
      ? `carbondev sent this Telegram voice note transcript:\n\n${conversationInput}`
      : conversationInput,
    sessionId: state.sessions[chatKey] || '',
    origin: input.origin || state.lastOrigin,
  })

  if (conversation.sessionId) {
    state.sessions[chatKey] = conversation.sessionId
  }
  state.conversationCount += 1

  await replyToTelegramMessage(config, message, conversation.replyText)
  await sendTelegramConversationImages({
    config,
    message,
    media: conversation.media,
    origin: input.origin || state.lastOrigin,
  })
  if (wantsVoiceReply) {
    try {
      await sendTelegramChatAction({
        botToken: config.botToken,
        chatId: normalizeChatId(message.chat?.id),
        messageThreadId: getReplyThreadId(message, config.messageThreadId),
        action: 'upload_voice',
      }).catch(() => {})

      const audio = await generateTelegramVoiceReplyAudio({
        text: conversation.voiceText || conversation.replyText,
        origin: input.origin || state.lastOrigin,
      })
      if (audio) {
        await sendTelegramAudio({
          botToken: config.botToken,
          chatId: normalizeChatId(message.chat?.id),
          messageThreadId: getReplyThreadId(message, config.messageThreadId),
          audioBytes: audio.bytes,
          filename: audio.filename,
          title: 'Anorak Pro reply',
          performer: 'Anorak Pro',
          caption: 'Spoken reply',
        })
      }
    } catch (error) {
      if (explicitVoiceReply) {
        await replyToTelegramMessage(
          config,
          message,
          `Voice TLDR failed, but the text reply is live.\n\n${error instanceof Error ? error.message : String(error)}`,
        ).catch(() => {})
      } else {
        console.warn('[telegram] voice reply failed:', error)
      }
    }
  }
  return {
    ok: true,
    kind: 'conversation',
    state,
    updateId,
    transcript: transcript || undefined,
    replyText: conversation.replyText,
  }
}

class AnorakProTelegramPoller {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private origin = ''
  private intervalSec = 8

  private async bootstrapState(
    state: AnorakProTelegramPollingState,
    origin: string,
  ): Promise<AnorakProTelegramPollingState> {
    const timestamp = new Date().toISOString()
    return writeStoredAnorakProTelegramPollingState({
      ...state,
      lastOrigin: origin,
      bootstrappedAt: state.bootstrappedAt || timestamp,
      lastPollAt: timestamp,
      lastSuccessfulPollAt: state.lastSuccessfulPollAt || timestamp,
      lastError: '',
    })
  }

  async ensure(options?: { origin?: string }): Promise<AnorakProTelegramPollingStatus> {
    const config = await resolveAnorakProTelegramConfig()
    const state = await readStoredAnorakProTelegramPollingState()
    const origin = getInternalOrigin(options?.origin, state.lastOrigin)
    const previousIntervalSec = this.intervalSec
    const wasRunning = Boolean(this.timer)

    this.origin = origin
    this.intervalSec = config.pollingIntervalSec

    if (!config.enabled || !config.pollingEnabled || !hasTelegramDeliveryCredentials(config)) {
      return this.stop()
    }

    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.pollOnce({ origin: this.origin })
      }, config.pollingIntervalSec * 1000)
    } else if (previousIntervalSec !== config.pollingIntervalSec) {
      clearInterval(this.timer)
      this.timer = setInterval(() => {
        void this.pollOnce({ origin: this.origin })
      }, config.pollingIntervalSec * 1000)
    }

    if (!wasRunning || !state.lastStartedAt || (state.lastStoppedAt && state.lastStoppedAt >= state.lastStartedAt)) {
      await writeStoredAnorakProTelegramPollingState({
        ...state,
        lastOrigin: origin,
        lastStartedAt: new Date().toISOString(),
        lastStoppedAt: '',
        lastError: '',
      })
    } else if (state.lastOrigin !== origin) {
      await writeStoredAnorakProTelegramPollingState({
        ...state,
        lastOrigin: origin,
      })
    }

    const freshState = await readStoredAnorakProTelegramPollingState()
    if (!freshState.bootstrappedAt) {
      await this.bootstrapState(freshState, origin)
    }

    void this.pollOnce({ origin })
    return this.getStatus()
  }

  async stop(): Promise<AnorakProTelegramPollingStatus> {
    const wasRunning = Boolean(this.timer)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    const state = await readStoredAnorakProTelegramPollingState()
    if (wasRunning || (state.lastStartedAt && (!state.lastStoppedAt || state.lastStoppedAt < state.lastStartedAt))) {
      await writeStoredAnorakProTelegramPollingState({
        ...state,
        lastStoppedAt: new Date().toISOString(),
      })
    }

    return this.getStatus()
  }

  async pollOnce(options?: { origin?: string }): Promise<AnorakProTelegramPollSummary> {
    if (this.busy) {
      return {
        ok: true,
        bootstrapped: false,
        processedCount: 0,
        conversationCount: 0,
        missionCount: 0,
        ignoredCount: 0,
        lastUpdateId: null,
        status: await this.getStatus(),
      }
    }

    this.busy = true
    let state = await readStoredAnorakProTelegramPollingState()
    let config = await resolveAnorakProTelegramConfig()

    try {
      const origin = getInternalOrigin(options?.origin, state.lastOrigin)
      let bootstrapped = false
      state = await writeStoredAnorakProTelegramPollingState({
        ...state,
        lastOrigin: origin,
        lastPollAt: new Date().toISOString(),
      })

      if (!config.enabled || !config.pollingEnabled || !hasTelegramDeliveryCredentials(config)) {
        return {
          ok: true,
          bootstrapped: false,
          processedCount: 0,
          conversationCount: 0,
          missionCount: 0,
          ignoredCount: 0,
          lastUpdateId: state.lastUpdateId,
          status: await this.getStatus(config, state),
        }
      }

      if (!state.bootstrappedAt) {
        state = await this.bootstrapState(state, origin)
        bootstrapped = true
      }

      const updates = await getTelegramUpdates({
        botToken: config.botToken,
        offset: typeof state.offset === 'number' ? state.offset + 1 : undefined,
        limit: 25,
        timeoutSec: 0,
      })

      let processedCount = 0
      let conversationCount = 0
      let missionCount = 0
      let ignoredCount = 0
      let lastUpdateId = state.lastUpdateId

      for (const raw of updates) {
        if (!isTelegramUpdate(raw)) continue
        const result = await processTelegramUpdate({
          update: raw,
          config,
          state,
          origin,
        })

        state = result.state
        const updateId = result.updateId
        if (typeof updateId === 'number') {
          lastUpdateId = updateId
          state.offset = updateId
          state.lastUpdateId = updateId
        }

        processedCount += 1
        state.processedUpdateCount += 1

        if (result.kind === 'conversation') {
          conversationCount += 1
        } else if (result.kind === 'mission') {
          missionCount += 1
        } else if (result.kind === 'ignored' || result.kind === 'voice-disabled') {
          ignoredCount += 1
        }
      }

      state.lastSuccessfulPollAt = new Date().toISOString()
      state.lastError = ''
      state = await writeStoredAnorakProTelegramPollingState(state)

      return {
        ok: true,
        bootstrapped,
        processedCount,
        conversationCount,
        missionCount,
        ignoredCount,
        lastUpdateId,
        status: await this.getStatus(config, state),
      }
    } catch (error) {
      state = await writeStoredAnorakProTelegramPollingState({
        ...state,
        lastError: error instanceof Error ? error.message : String(error),
      })

      return {
        ok: true,
        bootstrapped: false,
        processedCount: 0,
        conversationCount: 0,
        missionCount: 0,
        ignoredCount: 0,
        lastUpdateId: state.lastUpdateId,
        status: await this.getStatus(config, state),
      }
    } finally {
      this.busy = false
    }
  }

  async getStatus(
    configInput?: AnorakProTelegramResolvedConfig,
    stateInput?: AnorakProTelegramPollingState,
  ): Promise<AnorakProTelegramPollingStatus> {
    const config = configInput || await resolveAnorakProTelegramConfig()
    const state = stateInput || await readStoredAnorakProTelegramPollingState()

    return {
      running: Boolean(this.timer) && config.enabled && config.pollingEnabled && hasTelegramDeliveryCredentials(config),
      busy: this.busy,
      enabled: config.enabled,
      configured: hasTelegramDeliveryCredentials(config),
      intervalSec: config.pollingIntervalSec,
      offset: state.offset,
      origin: getInternalOrigin(this.origin, state.lastOrigin),
      lastPollAt: state.lastPollAt,
      lastSuccessfulPollAt: state.lastSuccessfulPollAt,
      lastInboundAt: state.lastInboundAt,
      lastStartedAt: state.lastStartedAt,
      lastStoppedAt: state.lastStoppedAt,
      lastError: state.lastError,
      processedUpdateCount: state.processedUpdateCount,
      conversationCount: state.conversationCount,
      missionCount: state.missionCount,
      lastUpdateId: state.lastUpdateId,
      lastTranscript: state.lastTranscript,
      lastIgnoredAt: state.lastIgnoredAt,
      lastIgnoredReason: state.lastIgnoredReason,
      lastIgnoredChatId: state.lastIgnoredChatId,
      lastIgnoredThreadId: state.lastIgnoredThreadId,
      lastIgnoredUsername: state.lastIgnoredUsername,
      lastIgnoredTextPreview: state.lastIgnoredTextPreview,
      bootstrappedAt: state.bootstrappedAt,
    }
  }
}

declare global {
  var __oasisAnorakProTelegramPoller: AnorakProTelegramPoller | undefined
}

function getPoller(): AnorakProTelegramPoller {
  if (!globalThis.__oasisAnorakProTelegramPoller) {
    globalThis.__oasisAnorakProTelegramPoller = new AnorakProTelegramPoller()
  }
  return globalThis.__oasisAnorakProTelegramPoller
}

export async function ensureAnorakProTelegramPolling(options?: { origin?: string }) {
  return getPoller().ensure(options)
}

export async function stopAnorakProTelegramPolling() {
  return getPoller().stop()
}

export async function pollAnorakProTelegramNow(options?: { origin?: string }) {
  return getPoller().pollOnce(options)
}

export async function getAnorakProTelegramPollingStatus() {
  return getPoller().getStatus()
}
