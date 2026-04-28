import { writeFile } from 'fs/promises'
import { join } from 'path'

import { NextRequest, NextResponse } from 'next/server'

import {
  cleanupGeneratedVoiceDirectory,
  deleteGeneratedVoiceClip,
  getGeneratedVoiceClipByUrl,
  listGeneratedVoiceClips,
  saveGeneratedVoiceClip,
} from '@/lib/generated-voice-library'
import type { ElevenLabsAlignment } from '@/lib/lip-sync-lab'

const VOICE_DIR = 'generated-voices'
const MERLIN_DEFAULT_VOICE_ID = process.env.OASIS_MERLIN_ELEVENLABS_VOICE_ID || '6sFKzaJr574YWVu4UuJF'
const PUBLIC_DIR = join(process.cwd(), 'public', VOICE_DIR)

const VOICES: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  merlin: MERLIN_DEFAULT_VOICE_ID,
}

const DEFAULT_VOICE = 'adam'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isLikelyElevenLabsVoiceId(value: string): boolean {
  return /^[A-Za-z0-9]{20,32}$/.test(value)
}

function formatVoiceLabel(voice: unknown, agentType: unknown): string {
  const voiceKey = typeof voice === 'string' ? voice.trim() : ''
  const normalizedAgentType = typeof agentType === 'string' ? agentType.trim().toLowerCase() : ''

  if (voiceKey && VOICES[voiceKey]) {
    return voiceKey.charAt(0).toUpperCase() + voiceKey.slice(1)
  }
  if (normalizedAgentType === 'merlin') return 'Merlin'
  if (voiceKey && isLikelyElevenLabsVoiceId(voiceKey)) return `Voice ${voiceKey.slice(0, 6)}`
  return DEFAULT_VOICE.charAt(0).toUpperCase() + DEFAULT_VOICE.slice(1)
}

function resolveVoiceId(voice: unknown, agentType: unknown): string {
  const voiceKey = typeof voice === 'string' ? voice.trim() : ''
  const normalizedAgentType = typeof agentType === 'string' ? agentType.trim().toLowerCase() : ''

  if (voiceKey && VOICES[voiceKey]) return VOICES[voiceKey]
  if (voiceKey && isLikelyElevenLabsVoiceId(voiceKey)) return voiceKey
  if (normalizedAgentType === 'merlin') return MERLIN_DEFAULT_VOICE_ID
  return VOICES[DEFAULT_VOICE]
}

function isElevenLabsAlignment(value: unknown): value is ElevenLabsAlignment {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray((value as ElevenLabsAlignment).characters)
    && Array.isArray((value as ElevenLabsAlignment).character_start_times_seconds)
    && Array.isArray((value as ElevenLabsAlignment).character_end_times_seconds),
  )
}

export async function GET(request: NextRequest) {
  try {
    const clipUrl = request.nextUrl.searchParams.get('url')?.trim()
    if (clipUrl) {
      const clip = await getGeneratedVoiceClipByUrl(clipUrl)
      return NextResponse.json({ clip })
    }

    const clips = await listGeneratedVoiceClips()
    return NextResponse.json({ clips })
  } catch (error) {
    console.error('[Media:VoiceTimestamps] Failed to list generated voices:', error)
    return NextResponse.json({ error: 'Failed to load generated voices' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) {
      return NextResponse.json({ error: 'Voice id is required' }, { status: 400 })
    }

    const clips = await deleteGeneratedVoiceClip(id)
    return NextResponse.json({ clips })
  } catch (error) {
    console.error('[Media:VoiceTimestamps] Failed to delete generated voice:', error)
    return NextResponse.json({ error: 'Failed to delete generated voice' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, voice: voiceKey, agentType, modelId } = body

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: 'Text too long (5000 char max)' }, { status: 400 })
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
    }

    const voiceId = resolveVoiceId(voiceKey, agentType)
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: typeof modelId === 'string' && modelId.trim() ? modelId.trim() : 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.42,
          similarity_boost: 0.78,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Media:VoiceTimestamps] ElevenLabs error:', response.status, errorText.slice(0, 500))
      return NextResponse.json({ error: 'Voice generation with timing failed' }, { status: 502 })
    }

    const payload = await response.json() as {
      audio_base64?: string
      alignment?: unknown
      normalized_alignment?: unknown
    }

    const alignment = isElevenLabsAlignment(payload.alignment) ? payload.alignment : null
    const normalizedAlignment = isElevenLabsAlignment(payload.normalized_alignment) ? payload.normalized_alignment : null

    if (!payload.audio_base64) {
      return NextResponse.json({ error: 'Voice generation returned no audio' }, { status: 502 })
    }

    await cleanupGeneratedVoiceDirectory()

    const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const filename = `${id}.mp3`
    const filePath = join(PUBLIC_DIR, filename)
    const createdAt = Date.now()
    const label = `Generated: ${formatVoiceLabel(voiceKey, agentType)} · ${new Date(createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`

    await writeFile(filePath, Buffer.from(payload.audio_base64, 'base64'))
    await saveGeneratedVoiceClip({
      id,
      label,
      url: `/${VOICE_DIR}/${filename}`,
      sourceType: 'generated',
      text: text.trim(),
      voiceId,
      createdAt,
      alignment,
      normalizedAlignment,
    })

    return NextResponse.json({
      id,
      label,
      url: `/${VOICE_DIR}/${filename}`,
      text: text.trim(),
      voiceId,
      createdAt,
      alignment,
      normalizedAlignment,
      durationEstimate: Math.ceil(text.trim().length / 15),
    })
  } catch (error) {
    console.error('[Media:VoiceTimestamps] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
