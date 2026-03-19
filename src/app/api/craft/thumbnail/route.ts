// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Crafted Scene Thumbnail Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/craft/thumbnail — List which crafted scenes have thumbnails
//   PUT  /api/craft/thumbnail — Save a rendered JPEG thumbnail for a crafted scene
//
// ░▒▓█ The offscreen sculptor's darkroom — JSON primitives → JPEG portraits █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'

export const dynamic = 'force-dynamic'

const THUMBS_DIR = join(process.cwd(), 'public', 'crafted-thumbs')

function ensureDir() {
  if (!existsSync(THUMBS_DIR)) mkdirSync(THUMBS_DIR, { recursive: true })
}

// GET — return list of crafted scene IDs that already have thumbnails
export async function GET() {
  ensureDir()
  const files = readdirSync(THUMBS_DIR).filter(f => f.endsWith('.jpg'))
  const existing = files.map(f => f.replace('.jpg', ''))
  return NextResponse.json({ existing, count: existing.length })
}

// PUT — save a rendered JPEG for a crafted scene
export async function PUT(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('thumbnail') as File | null
    const id = formData.get('id') as string | null

    if (!file || !id) {
      return NextResponse.json({ error: 'Missing thumbnail file or id' }, { status: 400 })
    }
    if (!/^[\w\-]{1,80}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    ensureDir()
    const destPath = join(THUMBS_DIR, `${id}.jpg`)
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Thumbnail too large (5MB max)' }, { status: 413 })
    }
    writeFileSync(destPath, buffer)

    return NextResponse.json({ thumbnailUrl: `/crafted-thumbs/${id}.jpg` })
  } catch (err) {
    console.error('[Craft] PUT thumbnail error:', err)
    return NextResponse.json({ error: 'Failed to save thumbnail' }, { status: 500 })
  }
}
