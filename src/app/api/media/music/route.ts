// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/music — Text-to-Music via ElevenLabs Music API
// ─═̷─═̷─🎵─═̷─═̷─ Prompt → ElevenLabs /v1/music → MP3 → disk → URL ─═̷─═̷─🎵─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const MUSIC_DIR = 'generated-music'
const PUBLIC_DIR = join(process.cwd(), 'public', MUSIC_DIR)
const DEFAULT_MODEL = 'music_v1'
const DEFAULT_DURATION_MS = 30000
const MIN_DURATION_MS = 3000
const MAX_DURATION_MS = 600000
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'
const FILE_CAP = 100

function clampDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return DEFAULT_DURATION_MS
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, Math.round(n)))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, durationMs, instrumental, model, outputFormat } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: 'Prompt too long (2000 char max)' }, { status: 400 })
    }

    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ELEVENLABS_API_KEY not configured' }, { status: 500 })
    }

    const music_length_ms = clampDuration(durationMs)
    const model_id = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL
    const output_format = typeof outputFormat === 'string' && outputFormat.trim() ? outputFormat.trim() : DEFAULT_OUTPUT_FORMAT
    const force_instrumental = instrumental === true

    const musicRes = await fetch(`https://api.elevenlabs.io/v1/music?output_format=${encodeURIComponent(output_format)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        prompt: prompt.trim(),
        music_length_ms,
        model_id,
        force_instrumental,
      }),
    })

    if (!musicRes.ok) {
      const err = await musicRes.text()
      console.error('[Media:Music] ElevenLabs error:', musicRes.status, err.slice(0, 500))
      return NextResponse.json({ error: 'Music generation failed', detail: err.slice(0, 200) }, { status: 502 })
    }

    if (!existsSync(PUBLIC_DIR)) await mkdir(PUBLIC_DIR, { recursive: true })
    try {
      const files = await readdir(PUBLIC_DIR)
      // Cleanup runs before the write below, so we make room for one more
      // file: delete down to FILE_CAP - 1, leaving exactly FILE_CAP after write.
      if (files.length >= FILE_CAP) {
        const sorted = files.sort() // lexicographic on `music-{timestamp}-...` = oldest first
        const toDelete = files.length - FILE_CAP + 1
        for (const old of sorted.slice(0, toDelete)) {
          await unlink(join(PUBLIC_DIR, old)).catch(() => {})
        }
      }
    } catch { /* cleanup is best-effort */ }

    const id = `music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const filename = `${id}.mp3`
    const filePath = join(PUBLIC_DIR, filename)

    const buffer = Buffer.from(await musicRes.arrayBuffer())
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/${MUSIC_DIR}/${filename}`,
      durationMs: music_length_ms,
      instrumental: force_instrumental,
    })
  } catch (err) {
    console.error('[Media:Music] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
