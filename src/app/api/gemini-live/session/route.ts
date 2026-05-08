import { NextRequest, NextResponse } from 'next/server'

import {
  buildGeminiLiveSessionManifest,
  getGeminiApiKey,
  sanitizeGeminiLiveModel,
  sanitizeGeminiLiveVoice,
} from '@/lib/gemini-live-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  if (!getGeminiApiKey()) {
    return NextResponse.json({ error: 'GEMINI_API_KEY or GOOGLE_API_KEY is not configured.' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const model = sanitizeGeminiLiveModel(body.model)
  const voice = sanitizeGeminiLiveVoice(body.voice)
  const worldId = sanitizeString(body.worldId)
  const worldName = sanitizeString(body.worldName)
  const systemInstruction = sanitizeString(body.systemInstruction)

  try {
    return NextResponse.json(await buildGeminiLiveSessionManifest({
      model,
      voice,
      worldId,
      worldName,
      systemInstruction,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Gemini Live session.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
