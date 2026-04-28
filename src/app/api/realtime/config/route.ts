import { NextResponse } from 'next/server'

import { getRealtimeVoiceConfig, readRealtimePromptTemplate } from '@/lib/realtime-voice-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const config = getRealtimeVoiceConfig()
  return NextResponse.json({
    ...config,
    promptTemplate: readRealtimePromptTemplate(),
  })
}
