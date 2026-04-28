// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/voice — Text-to-Speech via ElevenLabs
// ─═̷─═̷─🔊─═̷─═̷─ Text → ElevenLabs → MP3 → disk → URL ─═̷─═̷─🔊─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import {
  cleanupGeneratedVoiceDirectory,
  saveGeneratedVoiceClip,
} from '@/lib/generated-voice-library'
import type { ElevenLabsAlignment } from '@/lib/lip-sync-lab'

const VOICE_DIR = 'generated-voices'
const PUBLIC_DIR = join(process.cwd(), 'public', VOICE_DIR)
const MERLIN_DEFAULT_VOICE_ID = process.env.OASIS_MERLIN_ELEVENLABS_VOICE_ID || '6sFKzaJr574YWVu4UuJF'

// Default voice IDs from ElevenLabs (free tier voices)
const VOICES: Record<string, string> = {
  'rachel': '21m00Tcm4TlvDq8ikWAM',
  'adam': 'pNInz6obpgDQGcFmaJgB',
  'sam': 'yoZ06aMxZJJ28mfd3POQ',
  'elli': 'MF3mGyEYCl7XYWbV9V6O',
  'merlin': MERLIN_DEFAULT_VOICE_ID,
}
const DEFAULT_VOICE = 'adam'

function isLikelyElevenLabsVoiceId(value: string): boolean {
  return /^[A-Za-z0-9]{20,32}$/.test(value)
}

function resolveVoiceId(voice: unknown, agentType: unknown): string {
  const voiceKey = typeof voice === 'string' ? voice.trim() : ''
  const normalizedAgentType = typeof agentType === 'string' ? agentType.trim().toLowerCase() : ''

  if (voiceKey && VOICES[voiceKey]) return VOICES[voiceKey]
  if (voiceKey && isLikelyElevenLabsVoiceId(voiceKey)) return voiceKey
  if (normalizedAgentType === 'merlin') return MERLIN_DEFAULT_VOICE_ID
  return VOICES[DEFAULT_VOICE]
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

function isElevenLabsAlignment(value: unknown): value is ElevenLabsAlignment {
  return Boolean(
    value
    && typeof value === 'object'
    && Array.isArray((value as ElevenLabsAlignment).characters)
    && Array.isArray((value as ElevenLabsAlignment).character_start_times_seconds)
    && Array.isArray((value as ElevenLabsAlignment).character_end_times_seconds),
  )
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

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
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

    if (!ttsRes.ok) {
      const err = await ttsRes.text()
      console.error('[Media:Voice] ElevenLabs error:', ttsRes.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Voice generation failed' }, { status: 502 })
    }

    const payload = await ttsRes.json() as {
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

    const buffer = Buffer.from(payload.audio_base64, 'base64')
    await writeFile(filePath, buffer)
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
      voiceId,
      createdAt,
      alignment,
      normalizedAlignment,
      durationEstimate: Math.ceil(text.length / 15), // rough ~15 chars/sec
    })
  } catch (err) {
    console.error('[Media:Voice] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
