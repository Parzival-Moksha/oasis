// /api/village/missions — Mindcraft: the owner's missions, for the mission wall in the village.
// The missions are the markdown files in OASIS_MISSIONS_DIR (default C:\7c_oasis\docs\missions).
//   GET    the ranked list
//   PATCH  { file, patch: { state, who, doneWhen, ease, impact, urgency }, by }   header lines; changes go into the log
//   POST   { file, who, text, guess? }  one more entry in the mission's log        (or { create: title, who })
//   PUT    { file, markdown, expected } the whole text, refused when the file changed meanwhile
// Local requests only: these are the owner's own notes, and agents edit the same files.
// (/api/missions is the old SQLite mission system; this one is the markdown folder.)

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { missionsDir } from '@/lib/oasis-settings'
import { isMissionFile, isMissionPicture, parseMission, rankMissions } from '@/lib/village/village-missions'
import { appendMissionLog, missionFileName, newMissionMarkdown, setMissionHeader, type MissionHeaderPatch } from '@/lib/village/village-mission-edit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 400_000

/** Only a plain mission file name inside the folder: no path, no README. */
function missionPath(file: unknown): string | null {
  if (typeof file !== 'string' || !isMissionFile(file) || file !== path.basename(file) || /[\\/:*?"<>|]/.test(file) || file.startsWith('.')) return null
  return path.join(missionsDir(), file)
}

function stamp(now = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`
}

async function readMission(file: string): Promise<string> {
  return (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const dir = missionsDir()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter(isMissionFile).sort()
  } catch {
    // No folder on this machine: an empty wall, not an error.
    return NextResponse.json({ dir, missions: [], error: 'missions folder not found' })
  }
  // Pictures: `pictures/<name>` from the mission's `picture:` line, or one named like the mission file.
  const pictures = new Map<string, number>()
  try {
    for (const name of (await fs.readdir(path.join(dir, 'pictures'))).filter(isMissionPicture)) {
      pictures.set(name.toLowerCase(), Math.round((await fs.stat(path.join(dir, 'pictures', name))).mtimeMs))
    }
  } catch { /* no pictures yet */ }
  const pictureUrl = (file: string, named: string): string | null => {
    const stem = file.replace(/\.md$/i, '').toLowerCase()
    const found = [named, `${stem}.jpg`, `${stem}.png`, `${stem}.webp`, `${stem}.jpeg`].find(name => name && pictures.has(name.toLowerCase()))
    return found ? `/api/village/missions/picture?name=${encodeURIComponent(found)}&v=${pictures.get(found.toLowerCase())}` : null
  }
  const missions = (await Promise.all(names.map(async name => {
    try {
      const mission = parseMission(name, await fs.readFile(path.join(dir, name), 'utf8'))
      return { ...mission, pictureUrl: pictureUrl(name, mission.picture) }
    } catch {
      return null // deleted between the listing and the read
    }
  }))).filter((mission): mission is NonNullable<typeof mission> => mission !== null)
  return NextResponse.json({ dir, missions: rankMissions(missions) })
}

/** Header lines. What changed is written into the log, so scores keep a history. */
export async function PATCH(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { file?: unknown; patch?: MissionHeaderPatch; by?: unknown } | null
  const file = missionPath(body?.file)
  if (!file || !body?.patch || typeof body.patch !== 'object') return fail(400, 'file and patch are required')
  try {
    const before = await readMission(file)
    const { markdown, changes } = setMissionHeader(before, body.patch)
    if (!changes.length) return NextResponse.json({ ok: true, changes })
    const by = typeof body.by === 'string' && body.by.trim() ? body.by : 'owner'
    await fs.writeFile(file, appendMissionLog(markdown, { at: stamp(), who: by, text: changes.join(', ') }), 'utf8')
    return NextResponse.json({ ok: true, changes })
  } catch {
    return fail(404, 'mission not found')
  }
}

/** One more entry in the log, or a new mission. */
export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { file?: unknown; who?: unknown; text?: unknown; guess?: { who?: unknown; text?: unknown }; create?: unknown } | null
  const who = typeof body?.who === 'string' && body.who.trim() ? body.who : 'owner'
  if (typeof body?.create === 'string' && body.create.trim()) {
    const name = missionFileName(body.create)
    const target = missionPath(name)
    if (!target) return fail(400, 'that title makes no file name')
    try {
      // wx: never over an existing mission.
      await fs.writeFile(target, newMissionMarkdown(body.create, who, stamp()), { encoding: 'utf8', flag: 'wx' })
    } catch {
      return fail(409, `${name} already exists`)
    }
    return NextResponse.json({ ok: true, file: name })
  }
  const file = missionPath(body?.file)
  if (!file || typeof body?.text !== 'string' || !body.text.trim()) return fail(400, 'file and text are required')
  if (body.text.length > 20_000) return fail(413, 'too long for a log entry')
  const guess = body.guess && typeof body.guess.text === 'string' && body.guess.text.trim()
    ? { who: typeof body.guess.who === 'string' ? body.guess.who : 'owner', text: body.guess.text }
    : null
  try {
    await fs.writeFile(file, appendMissionLog(await readMission(file), { at: stamp(), who, text: body.text, guess }), 'utf8')
    return NextResponse.json({ ok: true })
  } catch {
    return fail(404, 'mission not found')
  }
}

/** The whole text. `expected` is what the editor started from: a file changed meanwhile is not overwritten. */
export async function PUT(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { file?: unknown; markdown?: unknown; expected?: unknown } | null
  const file = missionPath(body?.file)
  if (!file || typeof body?.markdown !== 'string' || typeof body.expected !== 'string') return fail(400, 'file, markdown and expected are required')
  if (body.markdown.length > MAX_BYTES) return fail(413, 'too long')
  try {
    if (await readMission(file) !== body.expected.replace(/\r\n?/g, '\n')) return fail(409, 'the file changed on disk since you opened it')
    await fs.writeFile(file, `${body.markdown.replace(/\r\n?/g, '\n').replace(/\s+$/, '')}\n`, 'utf8')
    return NextResponse.json({ ok: true })
  } catch {
    return fail(404, 'mission not found')
  }
}
