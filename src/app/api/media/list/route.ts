// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// /api/media/list — Scan public/images/ for uploaded media files
// ─═̷─═̷─📂─═̷─═̷─ Returns categorized list: images, videos, audio ─═̷─═̷─📂─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const VIDEO_EXT = ['.mp4', '.webm', '.ogg']
const AUDIO_EXT = ['.mp3', '.wav', '.flac', '.ogg']

interface MediaItem {
  name: string
  url: string
  type: 'image' | 'video' | 'audio'
  size: number
  createdAt: string
}

export async function GET() {
  try {
    const imagesDir = path.join(process.cwd(), 'public', 'images')
    let files: string[]
    try {
      files = await readdir(imagesDir)
    } catch {
      return NextResponse.json({ items: [] })
    }

    const items: MediaItem[] = []
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      let type: 'image' | 'video' | 'audio' | null = null
      if (IMAGE_EXT.includes(ext)) type = 'image'
      else if (VIDEO_EXT.includes(ext)) type = 'video'
      else if (AUDIO_EXT.includes(ext)) type = 'audio'
      if (!type) continue

      try {
        const fileStat = await stat(path.join(imagesDir, file))
        items.push({
          name: file,
          url: `/images/${file}`,
          type,
          size: fileStat.size,
          createdAt: fileStat.birthtime.toISOString(),
        })
      } catch { /* skip unreadable */ }
    }

    // Sort newest first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return NextResponse.json({ items })
  } catch (err) {
    console.error('[Media:List] Error:', err)
    return NextResponse.json({ items: [] })
  }
}
