// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// Avatar Upload — save profile pic to disk (local-first, no DB)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { getRequiredOasisUserId } from '@/lib/session'
import { prisma } from '@/lib/db'
import path from 'path'
import fs from 'fs/promises'

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const EXT_BY_MIME: Record<string, 'jpg' | 'png' | 'webp' | 'gif'> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function getFilenameExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || ''
}

function detectImageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg'
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png'
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp'
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString() === 'GIF') return 'gif'
  return null
}

export async function POST(request: Request) {
  try {
    const userId = getRequiredOasisUserId(request)
    if (!userId) {
      return NextResponse.json({ error: 'oasis_session cookie required' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('avatar') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const magicExt = detectImageExtension(buffer)
    const declaredExt = EXT_BY_MIME[file.type.toLowerCase()]
    const filenameExt = getFilenameExtension(file.name || '')
    const ext = magicExt || declaredExt || (filenameExt === 'jpeg' ? 'jpg' : EXT_BY_MIME[`image/${filenameExt}`])
    if (!ext || !magicExt || magicExt !== ext) {
      return NextResponse.json({ error: 'Invalid image. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 })
    }
    const filename = `${userId}.${ext}`

    // Ensure avatars directory exists
    const avatarDir = path.join(process.cwd(), 'public', 'avatars')
    await fs.mkdir(avatarDir, { recursive: true })

    // Clean up any previous avatar with different extension
    for (const e of ['jpg', 'png', 'webp', 'gif']) {
      if (e !== ext) {
        const old = path.join(avatarDir, `${userId}.${e}`)
        await fs.unlink(old).catch(() => {})
      }
    }

    // Write file to disk
    await fs.writeFile(path.join(avatarDir, filename), buffer)

    const avatarUrl = `/avatars/${filename}`

    // Persist avatar URL in Profile
    try {
      await prisma.profile.upsert({
        where: { userId: userId },
        create: { userId: userId, avatarUrl },
        update: { avatarUrl },
      })
    } catch (e) {
      console.error('[Avatar] Profile update failed:', e)
    }

    console.log(`[Avatar] Saved ${filename}`)
    return NextResponse.json({ avatar_url: avatarUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Avatar] Upload error:', msg)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
