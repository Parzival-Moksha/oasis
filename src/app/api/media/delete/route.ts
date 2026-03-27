// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/delete — Delete a media file from public/images/
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    // Security: only allow deleting from /images/ directory, no path traversal
    const filename = path.basename(url)
    if (filename !== url.replace('/images/', '') || url.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }

    const filePath = path.join(process.cwd(), 'public', 'images', filename)
    await unlink(filePath)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[Media:Delete] Error:', err)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
