// /api/media/upload — Accept image, video, and audio files, save to public/images/

import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

type MediaType = 'image' | 'video' | 'audio'

const MAX_SIZE = 250 * 1024 * 1024 // 250MB

const EXTENSION_MEDIA_TYPE: Record<string, MediaType> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.m4v': 'video',
  '.ogv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.oga': 'audio',
  '.opus': 'audio',
  '.aac': 'audio',
  '.m4a': 'audio',
}

const DEFAULT_EXTENSION: Record<MediaType, string> = {
  image: '.png',
  video: '.mp4',
  audio: '.mp3',
}

function inferMediaType(file: File): MediaType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'

  const rawExt = path.extname(file.name).toLowerCase()
  return EXTENSION_MEDIA_TYPE[rawExt] || null
}

function resolveExtension(file: File, mediaType: MediaType): string {
  const rawExt = path.extname(file.name).toLowerCase()
  if (EXTENSION_MEDIA_TYPE[rawExt] === mediaType) return rawExt
  return DEFAULT_EXTENSION[mediaType]
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const mediaType = inferMediaType(file)
    if (!mediaType) {
      return NextResponse.json({ error: `Unsupported type: ${file.type || 'unknown'}` }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({
        error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 250MB`,
      }, { status: 400 })
    }

    const ext = resolveExtension(file, mediaType)
    const prefix = mediaType === 'video' ? 'vid' : mediaType === 'audio' ? 'aud' : 'img'
    const safeName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const mediaDir = path.join(process.cwd(), 'public', 'images')
    await mkdir(mediaDir, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    const filePath = path.join(mediaDir, safeName)
    await writeFile(filePath, buffer)

    return NextResponse.json({
      url: `/images/${safeName}`,
      name: file.name,
      size: file.size,
      type: file.type,
      mediaType,
    })
  } catch (err) {
    console.error('[Media:Upload] Error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
