import { randomUUID } from 'node:crypto'

import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core'
import { getRealtimeVoiceProvider } from 'openclaw/plugin-sdk/realtime-voice'
import { z } from 'zod'

import {
  OASIS_MCP_INSTRUCTIONS,
  OASIS_MCP_TOOL_SPECS,
  prepareOasisToolArgs,
} from '../../src/lib/mcp/oasis-tool-spec.js'

const VOICE_EVENT = 'oasis.voice'
const VOICE_SCOPE = 'operator.write'
const DEFAULT_PROVIDER_ID = 'openai'
const DEFAULT_MODEL = 'gpt-realtime'
const DEFAULT_VOICE = 'alloy'
const REALTIME_MODEL_ALLOWLIST = new Set(['gpt-realtime', 'gpt-realtime-mini'])
const DEFAULT_OASIS_BASE_URL = 'http://127.0.0.1:4516'
const DEFAULT_AGENT_TYPE = 'openclaw'
const DEFAULT_VAD_THRESHOLD = 0.5
const DEFAULT_SILENCE_DURATION_MS = 500
const DEFAULT_PREFIX_PADDING_MS = 300
const MAX_HISTORY_MESSAGES = 18
const DEFAULT_TOOL_NAMES = [
  'get_world_info',
  'get_world_state',
  'search_assets',
  'place_object',
  'walk_avatar_to',
]

const voiceSessions = new Map()
const toolSpecByName = new Map(OASIS_MCP_TOOL_SPECS.map(spec => [spec.name, spec]))

function buildConnIds(connId) {
  return new Set([connId])
}

function sanitizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeRealtimeModel(value) {
  const next = sanitizeString(value)
  return REALTIME_MODEL_ALLOWLIST.has(next) ? next : DEFAULT_MODEL
}

function sanitizeInteger(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function sanitizeNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(entry => sanitizeString(entry))
    .filter(Boolean)
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {}
}

function readScopedRealtimeApiKey(cfg) {
  const root = asRecord(cfg)
  const plugins = asRecord(root.plugins)
  const entries = asRecord(plugins.entries)
  const voicePortal = asRecord(entries['oasis-voice-portal'])
  const voicePortalConfig = asRecord(voicePortal.config)
  const voicePortalRealtime = asRecord(voicePortalConfig.realtime)
  const voicePortalProviders = asRecord(voicePortalRealtime.providers)
  const voicePortalOpenai = asRecord(voicePortalProviders.openai)

  const voiceCall = asRecord(entries['voice-call'])
  const voiceCallConfig = asRecord(voiceCall.config)
  const voiceCallRealtime = asRecord(voiceCallConfig.realtime)
  const voiceCallProviders = asRecord(voiceCallRealtime.providers)
  const voiceCallOpenai = asRecord(voiceCallProviders.openai)

  const env = asRecord(root.env)

  return sanitizeString(voicePortalConfig.openaiApiKey)
    || sanitizeString(voicePortalOpenai.apiKey)
    || sanitizeString(voiceCallOpenai.apiKey)
    || sanitizeString(env.OPENAI_REALTIME_API_KEY)
    || sanitizeString(process.env.OPENAI_REALTIME_API_KEY)
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function cleanHistoryText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/m, '')
    .replace(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2}[^\]]*\]\s*/gm, '')
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return cleanHistoryText(content)
  if (!Array.isArray(content)) return ''
  return cleanHistoryText(
    content
      .map(block => {
        if (typeof block === 'string') return block
        const record = asRecord(block)
        const type = sanitizeString(record.type)
        if (type && !['text', 'output_text', 'input_text'].includes(type)) return ''
        return sanitizeString(record.text) || sanitizeString(record.content)
      })
      .filter(Boolean)
      .join('\n'),
  )
}

function normalizeHistoryEntry(raw) {
  const record = asRecord(raw)
  if (sanitizeString(record.type) === 'message') {
    const nested = asRecord(record.message)
    return {
      ...nested,
      id: sanitizeString(record.id) || sanitizeString(nested.id),
      timestamp: record.timestamp ?? nested.timestamp,
    }
  }
  return record
}

function summarizeJson(value, maxLength = 120) {
  if (value == null) return 'no args'
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (!raw) return 'no args'
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw
}

function respondError(respond, error, code = 'PLUGIN_ERROR') {
  const message = error instanceof Error ? error.message : String(error)
  respond(false, undefined, { code, message })
}

function sanitizeParametersSchema(schema) {
  const record = asRecord(schema)
  const properties = asRecord(record.properties)
  const required = Array.isArray(record.required)
    ? record.required.filter(value => typeof value === 'string')
    : []
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: true,
  }
}

function buildRealtimeToolSpecs(toolNames) {
  return toolNames
    .map(name => {
      const spec = toolSpecByName.get(name)
      if (!spec) return null
      return {
        type: 'function',
        name: spec.name,
        description: spec.description,
        parameters: sanitizeParametersSchema(z.toJSONSchema(spec.inputSchema)),
      }
    })
    .filter(Boolean)
}

async function loadRecentSessionTurns(api, sessionKey) {
  if (!sessionKey) return []
  try {
    const payload = await api.runtime.subagent.getSessionMessages({
      sessionKey,
      limit: MAX_HISTORY_MESSAGES,
    })
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    return messages
      .map(normalizeHistoryEntry)
      .map(entry => {
        const role = sanitizeString(entry.role).toLowerCase()
        if (!role || !['user', 'assistant', 'system'].includes(role)) return null
        const text = extractTextFromContent(entry.content)
        if (!text) return null
        return {
          role,
          text,
          timestamp: parseTimestamp(entry.timestamp),
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-12)
  } catch {
    return []
  }
}

function buildReplayHistoryBlock(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return ''
  return turns
    .map(turn => `${turn.role === 'assistant' ? 'OPENCLAW' : turn.role.toUpperCase()}: ${turn.text}`)
    .join('\n')
}

async function buildVoiceInstructions(api, session) {
  const recentTurns = await loadRecentSessionTurns(api, session.sessionKey)
  const replayHistory = buildReplayHistoryBlock(recentTurns)
  return [
    sanitizeString(session.instructions),
    'You are OpenClaw speaking live through the Oasis body.',
    'Continue the current OpenClaw session faithfully. Preserve the voice, goals, and personality already present in the recent session transcript instead of resetting into a generic assistant.',
    'When you need to inspect or act inside the Oasis world, use the provided Oasis tools instead of guessing.',
    'Do not claim your hands are unwired if a relevant tool is available.',
    'Keep spoken replies concise, confident, and natural for live voice conversation.',
    session.playerName ? `You are speaking with ${session.playerName}.` : '',
    session.worldId ? `Current Oasis world id: ${session.worldId}.` : '',
    OASIS_MCP_INSTRUCTIONS,
    replayHistory ? `Recent session transcript:\n${replayHistory}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function createVoiceSessionContext({
  api,
  context,
  connId,
  sessionKey,
  oasisBaseUrl,
  worldId,
  agentType,
  playerName,
  model,
  voice,
  vadThreshold,
  silenceDurationMs,
  prefixPaddingMs,
  instructions,
  toolNames,
}) {
  const publish = (payload) => {
    context.broadcastToConnIds(VOICE_EVENT, payload, buildConnIds(connId))
  }

  return {
    id: randomUUID(),
    api,
    connId,
    sessionKey,
    oasisBaseUrl,
    worldId,
    agentType,
    playerName,
    model,
    voice,
    vadThreshold,
    silenceDurationMs,
    prefixPaddingMs,
    instructions,
    toolNames,
    publish,
    closed: false,
    bridge: null,
  }
}

function normalizeToolArgs(toolName, rawArgs, session) {
  const preparedArgs = prepareOasisToolArgs(toolName, rawArgs, {
    worldId: session.worldId,
    agentType: session.agentType,
  })

  if (toolName === 'walk_avatar_to' && !sanitizeString(preparedArgs.agentType)) {
    preparedArgs.agentType = session.agentType
  }

  return preparedArgs
}

async function executeOasisToolCall(session, toolEvent) {
  const callId = sanitizeString(toolEvent.callId) || sanitizeString(toolEvent.itemId) || randomUUID()
  const toolName = sanitizeString(toolEvent.name)
  const rawArgs = toolEvent.args && typeof toolEvent.args === 'object' ? toolEvent.args : {}
  const args = normalizeToolArgs(toolName, rawArgs, session)
  const startedAt = Date.now()

  session.publish({
    type: 'tool.start',
    voiceSessionId: session.id,
    sessionKey: session.sessionKey,
    callId,
    toolName,
    args,
    argsSummary: summarizeJson(args),
    timestamp: startedAt,
  })

  let result
  try {
    const response = await fetch(`${session.oasisBaseUrl.replace(/\/$/, '')}/api/oasis-tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: toolName,
        args,
      }),
    })
    result = await response.json().catch(() => ({
      ok: false,
      error: `Oasis tool "${toolName}" returned an unreadable response.`,
    }))
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const finishedAt = Date.now()
  const eventType = result?.ok === false ? 'tool.error' : 'tool.done'
  session.publish({
    type: eventType,
    voiceSessionId: session.id,
    sessionKey: session.sessionKey,
    callId,
    toolName,
    args,
    argsSummary: summarizeJson(args),
    result,
    durationMs: finishedAt - startedAt,
    timestamp: finishedAt,
  })

  try {
    session.bridge?.submitToolResult(callId, result)
  } catch {
    // Ignore late tool delivery on torn-down bridges.
  }
}

function closeVoiceSession(session, reason = 'completed') {
  if (!session || session.closed) return
  session.closed = true
  try {
    session.bridge?.close()
  } catch {
    // ignore
  }
  voiceSessions.delete(session.id)
  session.publish({
    type: 'closed',
    voiceSessionId: session.id,
    sessionKey: session.sessionKey,
    reason,
    timestamp: Date.now(),
  })
}

async function createRealtimeBridge(session) {
  const cfg = session.api.runtime.config.loadConfig()
  const provider = getRealtimeVoiceProvider(DEFAULT_PROVIDER_ID, cfg)
  if (!provider) {
    throw new Error(`Realtime voice provider "${DEFAULT_PROVIDER_ID}" is not registered on this OpenClaw host.`)
  }
  const apiKey = readScopedRealtimeApiKey(cfg)
  if (!apiKey) {
    throw new Error('The Oasis voice portal needs a scoped Realtime key at plugins.entries.oasis-voice-portal.config.openaiApiKey or OPENAI_REALTIME_API_KEY. A global OPENAI_API_KEY is intentionally ignored here.')
  }

  const providerConfig = provider.resolveConfig
    ? provider.resolveConfig({
        cfg,
        rawConfig: {
          apiKey,
          model: session.model,
          voice: session.voice,
          vadThreshold: session.vadThreshold,
          silenceDurationMs: session.silenceDurationMs,
          prefixPaddingMs: session.prefixPaddingMs,
        },
      })
    : {
        apiKey,
        model: session.model,
        voice: session.voice,
        vadThreshold: session.vadThreshold,
        silenceDurationMs: session.silenceDurationMs,
        prefixPaddingMs: session.prefixPaddingMs,
      }

  if (!provider.isConfigured?.({ cfg, providerConfig })) {
    throw new Error('The OpenAI realtime voice provider is not configured on this OpenClaw host.')
  }

  const instructions = await buildVoiceInstructions(session.api, session)
  const tools = buildRealtimeToolSpecs(session.toolNames)

  return provider.createBridge({
    providerConfig,
    instructions,
    tools,
    onAudio: (audioBuffer) => {
      session.publish({
        type: 'assistant.audio.chunk',
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        audioBase64: audioBuffer.toString('base64'),
        encoding: 'g711_ulaw',
        sampleRate: 8000,
        timestamp: Date.now(),
      })
    },
    onClearAudio: () => {
      session.publish({
        type: 'assistant.clear',
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        timestamp: Date.now(),
      })
    },
    onMark: (markName) => {
      session.publish({
        type: 'assistant.mark',
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        markName,
        timestamp: Date.now(),
      })
    },
    onTranscript: (role, text, isFinal) => {
      const trimmed = sanitizeString(text)
      if (!trimmed) return
      session.publish({
        type: role === 'assistant'
          ? (isFinal ? 'assistant.final' : 'assistant.partial')
          : (isFinal ? 'user.final' : 'user.partial'),
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        text: trimmed,
        timestamp: Date.now(),
      })
    },
    onToolCall: (toolEvent) => {
      void executeOasisToolCall(session, toolEvent)
    },
    onReady: () => {
      session.publish({
        type: 'ready',
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        model: session.model,
        voice: session.voice,
        timestamp: Date.now(),
      })
    },
    onError: (error) => {
      session.publish({
        type: 'error',
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      })
    },
    onClose: (reason) => {
      closeVoiceSession(session, reason || 'completed')
    },
  })
}

function registerGatewayMethods(api) {
  api.registerGatewayMethod('oasis.voice.start', async ({ params, client, context, respond }) => {
    try {
      const sessionKey = sanitizeString(params?.sessionKey)
      if (!sessionKey) {
        respond(false, undefined, { code: 'BAD_REQUEST', message: 'sessionKey is required.' })
        return
      }

      const connId = sanitizeString(client?.connId)
      if (!connId) {
        respond(false, undefined, { code: 'MISSING_CONN', message: 'Gateway connId is required for Oasis voice.' })
        return
      }

      const session = createVoiceSessionContext({
        api,
        context,
        connId,
        sessionKey,
        oasisBaseUrl: sanitizeString(params?.oasisBaseUrl) || DEFAULT_OASIS_BASE_URL,
        worldId: sanitizeString(params?.worldId),
        agentType: sanitizeString(params?.agentType) || DEFAULT_AGENT_TYPE,
        playerName: sanitizeString(params?.playerName),
        model: sanitizeRealtimeModel(params?.model),
        voice: sanitizeString(params?.voice) || DEFAULT_VOICE,
        vadThreshold: sanitizeNumber(params?.vadThreshold, DEFAULT_VAD_THRESHOLD),
        silenceDurationMs: sanitizeInteger(params?.silenceDurationMs, DEFAULT_SILENCE_DURATION_MS),
        prefixPaddingMs: sanitizeInteger(params?.prefixPaddingMs, DEFAULT_PREFIX_PADDING_MS),
        instructions: sanitizeString(params?.instructions),
        toolNames: sanitizeStringArray(params?.toolNames).length > 0 ? sanitizeStringArray(params?.toolNames) : DEFAULT_TOOL_NAMES,
      })

      session.bridge = await createRealtimeBridge(session)
      voiceSessions.set(session.id, session)
      await session.bridge.connect()

      respond(true, {
        voiceSessionId: session.id,
        sessionKey: session.sessionKey,
        model: session.model,
        voice: session.voice,
        toolNames: session.toolNames,
      })
    } catch (error) {
      respondError(respond, error)
    }
  }, { scope: VOICE_SCOPE })

  api.registerGatewayMethod('oasis.voice.audio', async ({ params, respond }) => {
    try {
      const voiceSessionId = sanitizeString(params?.voiceSessionId)
      const audioBase64 = sanitizeString(params?.audioBase64)
      const mediaTimestampMs = sanitizeInteger(params?.mediaTimestampMs, NaN)
      const session = voiceSessions.get(voiceSessionId)

      if (!voiceSessionId || !session) {
        respond(false, undefined, { code: 'NOT_FOUND', message: 'Voice session not found.' })
        return
      }
      if (session.closed) {
        respond(false, undefined, { code: 'CLOSED', message: 'Voice session is already closed.' })
        return
      }
      if (!audioBase64) {
        respond(false, undefined, { code: 'BAD_REQUEST', message: 'audioBase64 is required.' })
        return
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64')
      if (Number.isFinite(mediaTimestampMs)) {
        session.bridge?.setMediaTimestamp(mediaTimestampMs)
      }
      session.bridge?.sendAudio(audioBuffer)
      respond(true, { ok: true, voiceSessionId })
    } catch (error) {
      respondError(respond, error)
    }
  }, { scope: VOICE_SCOPE })

  api.registerGatewayMethod('oasis.voice.mark', async ({ params, respond }) => {
    try {
      const voiceSessionId = sanitizeString(params?.voiceSessionId)
      const session = voiceSessions.get(voiceSessionId)
      if (!voiceSessionId || !session) {
        respond(true, { ok: true, voiceSessionId })
        return
      }
      session.bridge?.acknowledgeMark()
      respond(true, { ok: true, voiceSessionId })
    } catch (error) {
      respondError(respond, error)
    }
  }, { scope: VOICE_SCOPE })

  api.registerGatewayMethod('oasis.voice.stop', async ({ params, respond }) => {
    try {
      const voiceSessionId = sanitizeString(params?.voiceSessionId)
      const session = voiceSessions.get(voiceSessionId)
      if (!voiceSessionId || !session) {
        respond(true, { ok: true, voiceSessionId })
        return
      }
      closeVoiceSession(session, 'completed')
      respond(true, { ok: true, voiceSessionId })
    } catch (error) {
      respondError(respond, error)
    }
  }, { scope: VOICE_SCOPE })
}

export default definePluginEntry({
  id: 'oasis-voice-portal',
  name: 'Oasis Voice Portal',
  description: 'Expose OpenClaw-owned realtime voice turns to the Oasis Gateway client.',
  configSchema: emptyPluginConfigSchema,
  register(api) {
    registerGatewayMethods(api)
  },
})
