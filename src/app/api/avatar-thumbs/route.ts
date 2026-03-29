// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/avatar-thumbs — Save + list avatar gallery thumbnails
// ─═̷─═̷─ॐ─═̷─═̷─ Generated client-side, stored in public/avatars/gallery/thumbs/ ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const THUMBS_DIR = path.join(process.cwd(), 'public', 'avatars', 'gallery', 'thumbs')

export async function GET() {
  try {
    try { await fs.promises.access(THUMBS_DIR) } catch { return NextResponse.json([]) }
    const files = await fs.promises.readdir(THUMBS_DIR)
    const ids = files.filter(f => f.endsWith('.jpg')).map(f => f.replace('.jpg', ''))
    return NextResponse.json(ids)
  } catch {
    return NextResponse.json([])
  }
}

export async function PUT(request: Request) {
  try {
    const form = await request.formData()
    const rawId = form.get('id') as string
    const thumb = form.get('thumbnail') as Blob
    if (!rawId || !thumb) {
      return NextResponse.json({ error: 'Missing id or thumbnail' }, { status: 400 })
    }

    // Sanitize id to prevent path traversal
    const id = path.basename(rawId).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    await fs.promises.mkdir(THUMBS_DIR, { recursive: true })

    const buffer = Buffer.from(await thumb.arrayBuffer())
    const filePath = path.join(THUMBS_DIR, `${id}.jpg`)
    await fs.promises.writeFile(filePath, buffer)

    return NextResponse.json({ ok: true, url: `/avatars/gallery/thumbs/${id}.jpg` })
  } catch (e) {
    console.error('[AvatarThumbs] Save failed:', e)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }
}
