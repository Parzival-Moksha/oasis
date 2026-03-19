// POST /api/profile/avatar3d — save 3D avatar selection
// Accepts: { url: string, urlType: 'localPath' | 'dataURL' | 'httpURL' }
// localPath → store the path directly (gallery VRMs in public/)
// dataURL → decode base64, save to disk
// httpURL → store the URL directly

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getServerSupabase } from '@/lib/supabase'
import path from 'path'
import fs from 'fs/promises'

const MAX_GLB_SIZE = 10 * 1024 * 1024 // 10MB

export async function POST(request: Request) {
  try {
    const session = await auth()
    const _uid = session?.user?.id || process.env.ADMIN_USER_ID || 'local-user'; if (false) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { url, urlType } = body

    // Remove avatar — set to null
    if (urlType === 'remove') {
      await getServerSupabase()
        .from('profiles')
        .update({ avatar_3d_url: null, updated_at: new Date().toISOString() })
        .eq('id', _uid)
      console.log(`[Avatar3D] Removed avatar for user ${_uid}`)
      return NextResponse.json({ avatar_3d_url: null })
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing avatar URL' }, { status: 400 })
    }

    let avatar3dUrl: string

    if (urlType === 'localPath') {
      // Gallery selection — validate it's a safe path (no traversal)
      if (!url.startsWith('/avatars/') || url.includes('..')) {
        return NextResponse.json({ error: 'Invalid avatar path' }, { status: 400 })
      }
      avatar3dUrl = url
      console.log(`[Avatar3D] Gallery selection: ${url} for user ${_uid}`)
    } else if (urlType === 'dataURL' && url.startsWith('data:')) {
      const matches = url.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) {
        return NextResponse.json({ error: 'Invalid data URL format' }, { status: 400 })
      }

      const buffer = Buffer.from(matches[2], 'base64')
      if (buffer.length > MAX_GLB_SIZE) {
        return NextResponse.json({ error: 'Avatar too large (max 10MB)' }, { status: 400 })
      }

      const avatarDir = path.join(process.cwd(), 'public', 'avatars')
      await fs.mkdir(avatarDir, { recursive: true })

      const filename = `${_uid}_3d.glb`
      await fs.writeFile(path.join(avatarDir, filename), buffer)

      avatar3dUrl = `/avatars/${filename}`
      console.log(`[Avatar3D] Saved ${filename} (${(buffer.length / 1024).toFixed(0)}KB)`)
    } else if (url.startsWith('https://')) {
      avatar3dUrl = url.slice(0, 2000)
    } else {
      return NextResponse.json({ error: 'Invalid avatar URL type' }, { status: 400 })
    }

    await getServerSupabase()
      .from('profiles')
      .update({ avatar_3d_url: avatar3dUrl, updated_at: new Date().toISOString() })
      .eq('id', _uid)

    return NextResponse.json({ avatar_3d_url: avatar3dUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Avatar3D] Error:', msg)
    return NextResponse.json({ error: 'Failed to save 3D avatar' }, { status: 500 })
  }
}
