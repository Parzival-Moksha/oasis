// /api/academy — the Oasis Academy: a skill tree in the village where the owner trains agents.
//   GET   ?set=<id> (default: the main set) &have=<rev> (leave the content out when the caller holds this revision)
//         skills, keys, levels, lanes, the sets there are, and every trainee: per-skill state (none | claimed | verified, proof, by, at),
//         XP, level, the skills it can do now, and whether it still stands as stone.
//   POST  { trainee, name?, skill, state: 'none' | 'claimed' | 'verified', proof?, by? }   mark a skill
//         { trainee, name?, training: true | false }                                      in or out of training
//         { trainee, rekey }  the agent got its session id · { trainee, remove: true }    forget a trainee
//         `trainee` is the agent's session id; a trainee's name works too.
// Local requests only, like the agent routes: the page on this machine, and agents on it (curl).

import { NextRequest, NextResponse } from 'next/server'

import { academySnapshot, updateAcademy } from '@/lib/academy-server'
import { guardAgentRoute } from '@/lib/local-request-guard'
import type { AcademyUpdate } from '@/lib/village/village-academy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    const query = request.nextUrl.searchParams
    return NextResponse.json(await academySnapshot(query.get('set'), query.get('have')))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  let body: AcademyUpdate
  try {
    body = await request.json() as AcademyUpdate
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 })
  try {
    const result = await updateAcademy(body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const snapshot = await academySnapshot()
    const trainee = snapshot.trainees.find(item => item.key === result.key) || null
    return NextResponse.json({ ok: true, trainee, ...(result.warning ? { warning: result.warning } : {}) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
