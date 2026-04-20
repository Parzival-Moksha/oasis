// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LOBEPROMPT API — read/write agent .md definitions from CEHQ
// GET ?lobe=curator → returns the .md content
// PUT { lobe, content } → writes override (or falls back to disk .md)
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as path from 'path'

const VALID_LOBES = ['curator', 'coder', 'reviewer', 'tester', 'gamer', 'merlin', 'anorak-pro'] as const
const AGENTS_DIR = path.resolve(process.cwd(), '.claude', 'agents')

function lobePath(lobe: string): string {
  return path.join(AGENTS_DIR, `${lobe}.md`)
}

export async function GET(request: NextRequest) {
  const lobe = request.nextUrl.searchParams.get('lobe')
  if (!lobe || !VALID_LOBES.includes(lobe as typeof VALID_LOBES[number])) {
    return NextResponse.json({ error: `Invalid lobe. Must be one of: ${VALID_LOBES.join(', ')}` }, { status: 400 })
  }

  try {
    const content = await fs.readFile(lobePath(lobe), 'utf-8')
    return NextResponse.json({ lobe, content, charCount: content.length })
  } catch {
    return NextResponse.json({ error: `Agent definition not found: ${lobe}.md` }, { status: 404 })
  }
}

export async function PUT(request: NextRequest) {
  let body: { lobe: string; content: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { lobe, content } = body
  if (!lobe || !VALID_LOBES.includes(lobe as typeof VALID_LOBES[number])) {
    return NextResponse.json({ error: `Invalid lobe. Must be one of: ${VALID_LOBES.join(', ')}` }, { status: 400 })
  }
  if (typeof content !== 'string' || content.length < 10) {
    return NextResponse.json({ error: 'Content too short (min 10 chars)' }, { status: 400 })
  }
  if (content.length > 50000) {
    return NextResponse.json({ error: 'Content too long (max 50000 chars)' }, { status: 400 })
  }

  try {
    await fs.writeFile(lobePath(lobe), content, 'utf-8')
    return NextResponse.json({ lobe, charCount: content.length, saved: true })
  } catch {
    return NextResponse.json({ error: 'Failed to write agent definition' }, { status: 500 })
  }
}
