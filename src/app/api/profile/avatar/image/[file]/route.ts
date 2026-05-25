import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const SAFE_AVATAR_FILE = /^[a-zA-Z0-9_-]+(?:-wide)?\.webp$/

export async function GET(_request: Request, { params }: { params: { file: string } }) {
  const file = decodeURIComponent(params.file || '')
  if (!SAFE_AVATAR_FILE.test(file)) {
    return NextResponse.json({ error: 'Invalid avatar file' }, { status: 400 })
  }

  const avatarPath = path.join(process.cwd(), 'public', 'avatars', file)
  try {
    const buffer = await fs.readFile(avatarPath)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Avatar not found' }, { status: 404 })
  }
}
