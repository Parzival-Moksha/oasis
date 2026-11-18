// GET /api/village/missions/picture?name=<file> — a mission's picture, from `pictures/` in the missions folder.
// Local requests only. The wall asks with ?v=<modified time>, so a replaced picture shows without F5.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { missionsDir } from '@/lib/oasis-settings'
import { isMissionPicture } from '@/lib/village/village-missions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const name = new URL(request.url).searchParams.get('name') || ''
  if (!isMissionPicture(name) || name !== path.basename(name)) return NextResponse.json({ error: 'not a picture name' }, { status: 400 })
  const dir = missionsDir()
  try {
    const bytes = await fs.readFile(path.join(dir, 'pictures', name))
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'content-type': TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' },
    })
  } catch {
    return NextResponse.json({ error: 'no such picture' }, { status: 404 })
  }
}
