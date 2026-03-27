// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/upload — Accept image + video files, save to public/images/
// ─═̷─═̷─🖼️─═̷─═̷─ Local-first: files land on disk, served statically ─═̷─═̷─🖼️─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac',
]
const ALLOWED_EXT: Record<string, string> = {
  '.png': '.png', '.jpg': '.jpg', '.jpeg': '.jpeg', '.webp': '.webp', '.gif': '.gif',
  '.mp4': '.mp4', '.webm': '.webm', '.ogg': '.ogg',
  '.mp3': '.mp3', '.wav': '.wav', '.flac': '.flac',
}
const MAX_SIZE = 100 * 1024 * 1024 // 100MB (videos can be large)

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported type: ${file.type}. Allowed: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 100MB` }, { status: 400 })
    }

    // Sanitize filename: whitelist extension
    const rawExt = path.extname(file.name).toLowerCase()
    const ext = ALLOWED_EXT[rawExt] || (file.type.startsWith('video/') ? '.mp4' : '.png')
    const prefix = file.type.startsWith('video/') ? 'vid' : file.type.startsWith('audio/') ? 'aud' : 'img'
    const safeName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const imagesDir = path.join(process.cwd(), 'public', 'images')
    await mkdir(imagesDir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    const filePath = path.join(imagesDir, safeName)
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/images/${safeName}`,
      name: file.name,
      size: file.size,
      type: file.type,
      mediaType: file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image',
    })
  } catch (err) {
    console.error('[Media:Upload] Error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
