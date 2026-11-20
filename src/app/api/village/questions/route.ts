// /api/village/questions — Mindcraft's Carbon tab: what the Oasis needs from the owner, one file each.
// The folder: OASIS_QUESTIONS_DIR, else `questions` next to the missions folder (C:\7c_oasis\docs\questions).
//   GET   every mission, open first, highest priority first (the page sorts again as he likes)
//   POST  { file, answer, state?: 'answered' | 'parked', took?, expected }  his answer, written into the file's
//         header (state, answered or parked, answer, took). `expected` is the text he was looking at: a file that
//         changed underneath is not overwritten (409). Then Anorakdev gets a message with the file and the answer.
// Local requests only; automated pages may read but never answer.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { guardAgentRoute } from '@/lib/local-request-guard'
import { missionsDir } from '@/lib/oasis-settings'
import { answerCarbonMission, formatAnswerNote, isCarbonFile, parseCarbonMission, sortCarbon } from '@/lib/village/carbon-missions'
import { isAutomationRequest } from '@/lib/village/work-vow'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function questionsDir(): string {
  return process.env.OASIS_QUESTIONS_DIR || path.join(path.dirname(missionsDir()), 'questions')
}

function questionPath(file: unknown): string | null {
  if (typeof file !== 'string' || !isCarbonFile(file) || file !== path.basename(file) || /[\\/:*?"<>|]/.test(file)) return null
  return path.join(questionsDir(), file)
}

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

function localDate(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const dir = questionsDir()
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter(isCarbonFile)
  } catch {
    return NextResponse.json({ dir, missions: [], error: 'questions folder not found' })
  }
  const missions = (await Promise.all(names.map(async name => {
    try {
      return parseCarbonMission(name, await fs.readFile(path.join(dir, name), 'utf8'))
    } catch {
      return null
    }
  }))).filter((m): m is NonNullable<typeof m> => m !== null)
  return NextResponse.json({ dir, missions: sortCarbon(missions) })
}

/**
 * open.md is written from these files by scripts/questions_board.py (7c_oasis). It refuses to overwrite an
 * open.md someone typed into below its end marker; that is fine: the answer is in the file either way.
 */
function rewriteBoard(): Promise<string> {
  const script = path.join(path.dirname(path.dirname(questionsDir())), 'scripts', 'questions_board.py')
  return new Promise(resolve => {
    execFile(process.env.OASIS_PYTHON || 'python', [script], { timeout: 15_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (error, _out, stderr) => {
      resolve(error ? `board not rewritten: ${(stderr || error.message).trim().split(/\r?\n/).pop()}` : 'board rewritten')
    })
  })
}

/** Tell Anorakdev through the agent engine. Never fails the answer: the file is the record. */
async function tellAnorak(text: string): Promise<string> {
  const base = (process.env.OASIS_ENGINE_URL || 'http://127.0.0.1:4530').replace(/\/+$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  try {
    const tokenFile = process.env.OASIS_TOKEN_FILE || path.join(process.env.OASIS_DATA_DIR || path.join(os.homedir(), '.oasis'), 'token')
    const token = (await fs.readFile(tokenFile, 'utf8').catch(() => '')).trim()
    if (token) headers['x-oasis-token'] = token
    const list = await (await fetch(`${base}/api/agents`, { headers, signal: AbortSignal.timeout(4000) })).json() as Array<{ id: string; name?: string }> | { agents?: Array<{ id: string; name?: string }> }
    const agents = Array.isArray(list) ? list : list.agents || []
    const anorak = agents.find(a => /^anorakdev$/i.test(a.name || '')) || agents.find(a => /anorak/i.test(a.name || ''))
    if (!anorak) return 'no Anorak in the village'
    const response = await fetch(`${base}/api/cmd`, { method: 'POST', headers, body: JSON.stringify({ cmd: 'send', agentId: anorak.id, text, priority: 'later', source: 'Mindcraft' }), signal: AbortSignal.timeout(6000) })
    return response.ok ? `sent to ${anorak.name}` : `engine said ${response.status}`
  } catch (error) {
    return `engine not reached: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { file?: unknown; answer?: unknown; state?: unknown; took?: unknown; expected?: unknown } | null
  if (isAutomationRequest(request.headers.get('user-agent'), body)) return NextResponse.json({ error: 'automated pages cannot answer missions' }, { status: 403 })
  const file = questionPath(body?.file)
  if (!file || typeof body?.answer !== 'string' || !body.answer.trim() || typeof body.expected !== 'string') {
    return NextResponse.json({ error: 'file, answer and expected are required' }, { status: 400 })
  }
  if (body.answer.length > 10_000) return NextResponse.json({ error: 'too long' }, { status: 413 })
  const state = body.state === 'parked' ? 'parked' : 'answered'
  const took = typeof body.took === 'number' && Number.isFinite(body.took) ? Math.max(0, Math.round(body.took)) : null
  let current: string
  try {
    current = normalize(await fs.readFile(file, 'utf8'))
  } catch {
    return NextResponse.json({ error: 'mission not found' }, { status: 404 })
  }
  if (current !== normalize(body.expected)) return NextResponse.json({ error: 'the mission changed while you had it open: look at it again' }, { status: 409 })
  const next = answerCarbonMission(current, { answer: body.answer, state, took, date: localDate() })
  await fs.writeFile(file, next, 'utf8')
  const mission = parseCarbonMission(path.basename(file), next)
  const [told, board] = await Promise.all([tellAnorak(formatAnswerNote(mission, body.answer, state, took)), rewriteBoard()])
  return NextResponse.json({ ok: true, mission, told, board })
}
