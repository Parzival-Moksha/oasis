// /api/village/speak — a village agent's spoken line (the <spoken> tag of its reply) as an ElevenLabs clip.
//   POST { text, voice?, speed? }  -> { id, url, text, alignment, modelSpeed, cached }   (text capped at 400 characters; cached by text;
//        speed: ElevenLabs' voice speed, 0.7 to 1.2)
//   GET  ?id=<clip id>     -> the mp3
// Local requests only: each new line costs ElevenLabs credits on the owner's key.

import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { SpeechError, isSpeechClipId, readSpeechAudio, speak } from '@/lib/village/village-speech-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: { text?: unknown; voice?: unknown; speed?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  try {
    const clip = await speak(body.text, body.voice, { speed: body.speed })
    return NextResponse.json({ ...clip, url: `/api/village/speak?id=${clip.id}` })
  } catch (error) {
    if (error instanceof SpeechError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[Village:Speech] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const id = request.nextUrl.searchParams.get('id')
  if (!isSpeechClipId(id)) return NextResponse.json({ error: 'Unknown clip' }, { status: 400 })
  const audio = await readSpeechAudio(id)
  if (!audio) return NextResponse.json({ error: 'Unknown clip' }, { status: 404 })
  return new NextResponse(new Uint8Array(audio), {
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'private, max-age=31536000, immutable' },
  })
}
