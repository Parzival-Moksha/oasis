import { NextResponse } from 'next/server'

import { getGeminiLiveConfig } from '@/lib/gemini-live-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(getGeminiLiveConfig())
}
