// GET /api/village/missions — the owner's missions, ranked, for the mission wall in the village.
// Reads the markdown files in OASIS_MISSIONS_DIR (default C:\7c_oasis\docs\missions). Read-only: the
// Oasis doesn't edit missions. Local requests only: these are the owner's own notes.
// (/api/missions is the old SQLite mission system; this one is the markdown folder.)

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { isMissionFile, parseMission, rankMissions } from '@/lib/village/village-missions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_DIR = 'C:\\7c_oasis\\docs\\missions'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const dir = process.env.OASIS_MISSIONS_DIR || DEFAULT_DIR
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter(isMissionFile).sort()
  } catch {
    // No folder on this machine: an empty wall, not an error.
    return NextResponse.json({ dir, missions: [], error: 'missions folder not found' })
  }
  const missions = (await Promise.all(names.map(async name => {
    try {
      return parseMission(name, await fs.readFile(path.join(dir, name), 'utf8'))
    } catch {
      return null // deleted between the listing and the read
    }
  }))).filter((mission): mission is NonNullable<typeof mission> => mission !== null)
  return NextResponse.json({ dir, missions: rankMissions(missions) })
}
