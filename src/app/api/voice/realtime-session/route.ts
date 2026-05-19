// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// POST /api/voice/realtime-session
//
// Issues an OpenAI Realtime ephemeral client secret for browser-side
// transcription-only sessions. The browser then opens a WebSocket
// directly to wss://api.openai.com/v1/realtime?intent=transcription
// using the returned secret, streams mic PCM, and gets transcription
// deltas back. Real-time, no server-side audio proxying.
//
// Model: gpt-4o-mini-transcribe (cheap, fast). Bump to
// gpt-4o-transcribe for higher fidelity when needed.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_TRANSCRIPTION_SESSIONS_URL = 'https://api.openai.com/v1/realtime/transcription_sessions'
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

export async function POST() {
  const apiKey = process.env.OPENAI_REALTIME_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      error: 'OPENAI_REALTIME_API_KEY (or OPENAI_API_KEY) not configured on this server.',
    }, { status: 500 })
  }

  try {
    const response = await fetch(OPENAI_TRANSCRIPTION_SESSIONS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        input_audio_format: 'pcm16',
        input_audio_transcription: { model: TRANSCRIBE_MODEL },
        // ─═̷─ Server VAD off — we want raw streaming + the browser tells
        // us when the user releases the button. Reduces sensitivity to
        // background noise and keeps the model output strictly bound to
        // the user's hold-to-talk window. ─═̷─
        turn_detection: null,
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return NextResponse.json({
        error: `OpenAI transcription_sessions HTTP ${response.status}: ${detail.slice(0, 240)}`,
      }, { status: 502 })
    }

    const session = await response.json() as {
      id?: string
      client_secret?: { value?: string; expires_at?: number }
    }
    const clientSecret = session.client_secret?.value
    const expiresAt = session.client_secret?.expires_at
    if (!clientSecret) {
      return NextResponse.json({
        error: 'OpenAI did not return a client_secret on the session.',
      }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      clientSecret,
      expiresAt: expiresAt || null,
      model: TRANSCRIBE_MODEL,
      sessionId: session.id || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to mint realtime transcription session.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
