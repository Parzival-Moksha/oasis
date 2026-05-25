import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'

const SAFE_AVATAR_FILE = /^([a-zA-Z0-9_-]+(?:-wide)?)\.(jpg|jpeg|png|webp|gif)$/i
const CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

function responseFor(buffer: Buffer, ext: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': CONTENT_TYPE[ext] || 'application/octet-stream',
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
}

export async function GET(_request: Request, { params }: { params: { file: string } }) {
  const file = decodeURIComponent(params.file || '')
  const match = file.match(SAFE_AVATAR_FILE)
  if (!match) {
    return NextResponse.json({ error: 'Invalid avatar file' }, { status: 400 })
  }

  const avatarDir = path.join(process.cwd(), 'public', 'avatars')
  const [, stem, extRaw] = match
  const ext = extRaw.toLowerCase()
  const requestedPath = path.join(avatarDir, file)
  const normalizedFile = `${stem}.webp`
  const normalizedPath = path.join(avatarDir, normalizedFile)

  try {
    const buffer = await fs.readFile(ext === 'webp' ? requestedPath : normalizedPath)
    return responseFor(buffer, 'webp')
  } catch {
    // Legacy profile rows may still point at /avatars/*.jpg or *.png. Convert
    // those once on demand so the tiny circular avatar never pulls a raw upload.
    if (ext !== 'webp') {
      try {
        const original = await fs.readFile(requestedPath)
        const image = sharp(original, { animated: false }).rotate()
        const isWide = stem.endsWith('-wide')
        const normalized = isWide
          ? await image.resize(640, 360, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()
          : await image.resize(96, 96, { fit: 'cover', position: 'attention' }).webp({ quality: 68 }).toBuffer()
        await fs.writeFile(normalizedPath, normalized).catch(() => {})
        return responseFor(normalized, 'webp')
      } catch {
        // Fall through to a real 404 below.
      }
    }
    return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
  }
}
