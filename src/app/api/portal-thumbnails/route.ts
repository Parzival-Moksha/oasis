import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'

import { allPortalThumbnailSvgs, PORTAL_THUMB_DIR } from '@/lib/portal-thumbnails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const THUMBS_DIR = join(process.cwd(), 'public', PORTAL_THUMB_DIR)

function ensureThumbsDir() {
  if (!existsSync(THUMBS_DIR)) mkdirSync(THUMBS_DIR, { recursive: true })
}

function existingIds(): string[] {
  ensureThumbsDir()
  return readdirSync(THUMBS_DIR)
    .filter(file => file.endsWith('.svg'))
    .map(file => file.replace(/\.svg$/, ''))
}

export async function GET() {
  return NextResponse.json({ existing: existingIds() })
}

export async function POST() {
  ensureThumbsDir()
  const existing = new Set(existingIds())
  const generated: string[] = []

  for (const item of allPortalThumbnailSvgs()) {
    const path = join(THUMBS_DIR, `${item.id}.svg`)
    if (existing.has(item.id) && readFileSync(path, 'utf8') === item.svg) continue
    writeFileSync(path, item.svg, 'utf8')
    generated.push(item.id)
  }

  return NextResponse.json({
    ok: true,
    generated,
    existing: existingIds(),
  })
}
