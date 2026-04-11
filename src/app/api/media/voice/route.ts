// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/voice — Text-to-Speech via ElevenLabs
// ─═̷─═̷─🔊─═̷─═̷─ Text → ElevenLabs → MP3 → disk → URL ─═̷─═̷─🔊─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, voice: voiceKey, agentType } = body

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

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })

    if (!ttsRes.ok) {
      const err = await ttsRes.text()
      console.error('[Media:Voice] ElevenLabs error:', ttsRes.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Voice generation failed' }, { status: 502 })
    }

    // Save to public dir (cap at 100 files, cleanup oldest)
    if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true })
    try {
      const files = await readdir(PUBLIC_DIR)
      if (files.length > 100) {
        const sorted = files.sort() // lexicographic = oldest first (voice-{timestamp}-...)
        for (const old of sorted.slice(0, files.length - 100)) {
          await unlink(join(PUBLIC_DIR, old)).catch(() => {})
        }
      }
    } catch { /* cleanup is best-effort */ }
    const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const filename = `${id}.mp3`
    const filePath = join(PUBLIC_DIR, filename)

    const buffer = Buffer.from(await ttsRes.arrayBuffer())
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/${VOICE_DIR}/${filename}`,
      durationEstimate: Math.ceil(text.length / 15), // rough ~15 chars/sec
    })
  } catch (err) {
    console.error('[Media:Voice] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
