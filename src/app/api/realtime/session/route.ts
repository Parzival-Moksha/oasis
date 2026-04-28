import { NextRequest, NextResponse } from 'next/server'

import {
  buildRealtimeInstructions,
  buildTurnDetection,
  getRealtimeApiKey,
  getRealtimeVoiceConfig,
  getRealtimeSessionTools,
  sanitizePromptTemplate,
  sanitizeRealtimeModel,
  sanitizeRealtimeVadEagerness,
  sanitizeRealtimeVoice,
  sanitizeTranscriptionModel,
} from '@/lib/realtime-voice-server'
import { isRealtimeVadEagerness, isRealtimeVadMode } from '@/lib/realtime-voice'
import { publishWorldPlayerContext, type RuntimePlayerContext } from '@/lib/world-runtime-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeWorldId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseHistory(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
      const content = typeof record.content === 'string' ? record.content.trim() : ''
      if (!role || !content) return null
      return { role, content }
    })
    .filter((entry): entry is { role: 'user' | 'assistant'; content: string } => !!entry)
}

function readToolNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function readVec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const [x, y, z] = value.slice(0, 3).map(Number)
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : undefined
}

function parsePlayerContext(value: unknown): RuntimePlayerContext | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const avatarRecord = record.avatar && typeof record.avatar === 'object' ? record.avatar as Record<string, unknown> : null
  const cameraRecord = record.camera && typeof record.camera === 'object' ? record.camera as Record<string, unknown> : null

  const avatarPosition = avatarRecord ? readVec3(avatarRecord.position) : undefined
  const cameraPosition = cameraRecord ? readVec3(cameraRecord.position) : undefined
  const avatarForward = avatarRecord ? readVec3(avatarRecord.forward) : undefined
  const cameraForward = cameraRecord ? readVec3(cameraRecord.forward) : undefined
  const avatarYaw = avatarRecord ? readToolNumber(avatarRecord.yaw) : undefined

  const avatar = avatarPosition
    ? {
        position: avatarPosition,
        ...(avatarForward ? { forward: avatarForward } : {}),
        ...(avatarYaw !== undefined ? { yaw: avatarYaw } : {}),
      }
    : null
  const camera = cameraPosition
    ? {
        position: cameraPosition,
        ...(cameraForward ? { forward: cameraForward } : {}),
      }
    : null

  if (!avatar && !camera) return null
  return { avatar, camera }
}

export async function POST(request: NextRequest) {
  const apiKey = getRealtimeApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_REALTIME_API_KEY or OPENAI_API_KEY is not configured.' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const worldId = sanitizeWorldId(body.worldId)
  if (!worldId) {
    return NextResponse.json({ error: 'worldId is required.' }, { status: 400 })
  }

  const config = getRealtimeVoiceConfig()
  const model = sanitizeRealtimeModel(body.model)
  const voice = sanitizeRealtimeVoice(body.voice)
  const vadMode = isRealtimeVadMode(body.vadMode) ? body.vadMode : config.defaultVadMode
  const vadEagerness = isRealtimeVadEagerness(body.vadEagerness)
    ? body.vadEagerness
    : sanitizeRealtimeVadEagerness(body.vadEagerness)
  const promptTemplate = sanitizePromptTemplate(body.instructions)
  const transcriptionModel = sanitizeTranscriptionModel(body.transcriptionModel)
  const playerContext = parsePlayerContext(body.playerContext)
  const history = parseHistory(body.history)

  if (playerContext) {
    await publishWorldPlayerContext(worldId, playerContext)
  }

  const instructions = await buildRealtimeInstructions({
    worldId,
    promptTemplate,
    history,
  })

  const sessionBody = {
    session: {
      type: 'realtime',
      model,
      instructions,
      tools: getRealtimeSessionTools(),
      tool_choice: 'auto',
      audio: {
        input: {
          transcription: {
            model: transcriptionModel,
          },
          turn_detection: buildTurnDetection(vadMode, vadEagerness),
        },
        output: {
          voice,
        },
      },
    },
  }

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(sessionBody),
    cache: 'no-store',
  })

  if (!response.ok) {
    const detail = await response.text()
    return NextResponse.json({
      error: 'Failed to create Realtime client secret.',
      detail,
    }, { status: 502 })
  }

  const data = await response.json() as {
    value?: string
    expires_at?: number | null
    client_secret?: { value?: string; expires_at?: number | null }
  }

  const clientSecret = data.value?.trim() || data.client_secret?.value?.trim()
  if (!clientSecret) {
    return NextResponse.json({ error: 'Realtime client secret was missing from OpenAI response.' }, { status: 502 })
  }

  const expiresAt = typeof data.expires_at === 'number'
    ? data.expires_at
    : typeof data.client_secret?.expires_at === 'number'
      ? data.client_secret.expires_at
      : null

  return NextResponse.json({
    clientSecret,
    model,
    voice,
    vadMode,
    vadEagerness,
    instructions,
    transcriptionModel,
    sessionExpiresAt: expiresAt,
  })
}
