import { existsSync } from 'fs'

import { NextRequest, NextResponse } from 'next/server'

import { analyzeAudioWithRhubarb, resolvePublicClipPath } from '@/lib/rhubarb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const clipUrl = typeof body?.clipUrl === 'string' ? body.clipUrl.trim() : ''
    const dialogText = typeof body?.dialogText === 'string' ? body.dialogText : null
    const recognizer = body?.recognizer === 'phonetic' ? 'phonetic' : 'pocketSphinx'

    if (!clipUrl) {
      return NextResponse.json({ error: 'clipUrl is required' }, { status: 400 })
    }

    const audioPath = resolvePublicClipPath(clipUrl)
    if (!audioPath || !existsSync(audioPath)) {
      return NextResponse.json({ error: 'Clip not found on disk' }, { status: 404 })
    }

    const timeline = await analyzeAudioWithRhubarb({
      audioPath,
      dialogText,
      recognizer,
    })

    return NextResponse.json({
      clipUrl,
      recognizer,
      timeline,
    })
  } catch (error) {
    console.error('[LipSync:Rhubarb] Analysis failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Rhubarb analysis failed',
    }, { status: 500 })
  }
}
