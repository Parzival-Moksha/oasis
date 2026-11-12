// /api/academy — the Oasis Academy: a skill tree in the village where the owner trains agents.
//   GET   skills, keys, levels, and every trainee: per-skill state (none | claimed | verified, proof, by, at),
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
  return NextResponse.json(await academySnapshot())
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
