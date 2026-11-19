// The Oasis services (the agent engine and this page server), as the supervisor sees them, and the owner's Restart
// buttons in Settings > Agents (ServicesSettings.tsx). The supervisor is scripts/oasis-supervisor.mjs on
// 127.0.0.1:4531; it takes restarts only with the key it writes to data/oasis-supervisor.local.json, which this
// route reads, and never from a browser. Agents must not restart the servers (the owner's rule).
//   GET  -> { supervisor: boolean, services: [{ name, label, state, managed, since, restarts, lastExit, log }] }
//   POST { service: 'engine' | 'world' } -> 202 (the page server's own restart ends this request's server)
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { guardAgentRoute } from '@/lib/local-request-guard'

export const dynamic = 'force-dynamic'

const KEY_FILE = process.env.OASIS_SUPERVISOR_KEY_FILE || path.join(process.cwd(), 'data', 'oasis-supervisor.local.json')
const SUPERVISOR = `http://127.0.0.1:${Number(process.env.OASIS_SUPERVISOR_PORT || 4531)}`

function up(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
    s.setTimeout(1000, () => { s.destroy(); resolve(false) })
  })
}

export async function GET(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  try {
    const res = await fetch(`${SUPERVISOR}/status`, { signal: AbortSignal.timeout(2000), cache: 'no-store' })
    const body = await res.json()
    return NextResponse.json({ supervisor: true, services: body.services || [] })
  } catch {
    // No supervisor: the servers run in windows of their own (the old launcher). Only whether they answer is known.
    const engine = await up(Number(process.env.OASIS_PORT || 4530))
    return NextResponse.json({
      supervisor: false,
      services: [
        { name: 'engine', label: 'Agent engine', state: engine ? 'running' : 'down', managed: false },
        { name: 'world', label: 'Page server', state: 'running', managed: false },
      ],
    })
  }
}

export async function POST(request: NextRequest) {
  const denied = guardAgentRoute(request)
  if (denied) return denied
  const body = await request.json().catch(() => null) as { service?: unknown } | null
  const service = body?.service
  if (service !== 'engine' && service !== 'world') return NextResponse.json({ error: 'service: engine or world' }, { status: 400 })
  let key: string | null = null
  try { key = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).key || null } catch { key = null }
  if (!key) return NextResponse.json({ error: 'The supervisor is not running: the servers run in windows of their own. Start the Oasis from the "Oasis app" desktop icon to restart them from here.' }, { status: 409 })
  try {
    const res = await fetch(`${SUPERVISOR}/restart`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-oasis-key': key }, body: JSON.stringify({ service }), signal: AbortSignal.timeout(5000) })
    const answer = await res.json().catch(() => ({}))
    return NextResponse.json(answer, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'The supervisor did not answer.' }, { status: 502 })
  }
}
