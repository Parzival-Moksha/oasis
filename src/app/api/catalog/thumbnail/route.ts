// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// THE FORGE — Catalog Thumbnail Route
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
//
//   GET  /api/catalog/thumbnail — List which catalog assets have thumbnails
//   PUT  /api/catalog/thumbnail — Upload a rendered JPEG thumbnail for a catalog asset
//
// ░▒▓█ The yearbook photographer's darkroom █▓▒░
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs'

export const dynamic = 'force-dynamic'

const THUMBS_DIR = join(process.cwd(), 'public', 'thumbs')

function ensureThumbsDir() {
  if (!existsSync(THUMBS_DIR)) mkdirSync(THUMBS_DIR, { recursive: true })
}

// GET — return list of catalog asset IDs that already have thumbnails
export async function GET() {
  ensureThumbsDir()
  const files = readdirSync(THUMBS_DIR).filter(f => f.endsWith('.jpg'))
  const existing = files.map(f => f.replace('.jpg', ''))
  return NextResponse.json({ existing, count: existing.length })
}

// PUT — save a rendered JPEG for a catalog asset
export async function PUT(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('thumbnail') as File | null
    const id = formData.get('id') as string | null

    if (!file || !id) {
      return NextResponse.json({ error: 'Missing thumbnail file or id' }, { status: 400 })
    }

    // Sanitize ID to prevent path traversal
    if (!/^[\w\-]{1,80}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid asset ID' }, { status: 400 })
    }

    ensureThumbsDir()
    const destPath = join(THUMBS_DIR, `${id}.jpg`)
    const buffer = Buffer.from(await file.arrayBuffer())
    writeFileSync(destPath, buffer)

    return NextResponse.json({ thumbnailUrl: `/thumbs/${id}.jpg` })
  } catch (err) {
    console.error('[Catalog] Thumbnail upload error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
