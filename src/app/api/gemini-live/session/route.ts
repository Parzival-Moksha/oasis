import { NextRequest, NextResponse } from 'next/server'

import {
  buildGeminiLiveSessionManifest,
  getGeminiApiKey,
  sanitizeGeminiLiveModel,
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
  const worldId = sanitizeString(body.worldId)
  const worldName = sanitizeString(body.worldName)

  return NextResponse.json(buildGeminiLiveSessionManifest({
    model,
    worldId,
    worldName,
  }))
}
