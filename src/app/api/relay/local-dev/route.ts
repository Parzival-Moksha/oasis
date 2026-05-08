import { spawn, type ChildProcess } from 'child_process'
import net from 'net'

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const DEFAULT_RELAY_PORT = 4517
const RELAY_PORT = Number(process.env.RELAY_PORT || DEFAULT_RELAY_PORT)
const RELAY_READY_TIMEOUT_MS = 5_000

type GlobalRelayState = typeof globalThis & {
  __oasisLocalRelayProcess?: ChildProcess
}

function canControlLocalRelay(request: NextRequest): boolean {
  const host = request.nextUrl.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.setTimeout(800, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForRelay(port: number): Promise<boolean> {
  const deadline = Date.now() + RELAY_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return isPortListening(port)
}

async function relayStatus() {
  const globalState = globalThis as GlobalRelayState
  const child = globalState.__oasisLocalRelayProcess
  const portOpen = await isPortListening(RELAY_PORT)
  return {
    ok: true,
    running: portOpen,
    port: RELAY_PORT,
    managed: Boolean(child && !child.killed),
    pid: child && !child.killed ? child.pid ?? null : null,
  }
}

export async function GET(request: NextRequest) {
  if (!canControlLocalRelay(request)) {
    return NextResponse.json({ ok: false, error: 'Local relay control is localhost-only.' }, { status: 403 })
  }
  return NextResponse.json(await relayStatus())
}

export async function POST(request: NextRequest) {
  if (!canControlLocalRelay(request)) {
    return NextResponse.json({ ok: false, error: 'Local relay control is localhost-only.' }, { status: 403 })
  }

  if (await isPortListening(RELAY_PORT)) {
    return NextResponse.json(await relayStatus())
  }

  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(command, ['dev:relay'], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, RELAY_PORT: String(RELAY_PORT) },
    stdio: 'ignore',
    windowsHide: true,
  })

  child.unref()
  ;(globalThis as GlobalRelayState).__oasisLocalRelayProcess = child

  const running = await waitForRelay(RELAY_PORT)
  return NextResponse.json({
    ok: running,
    running,
    port: RELAY_PORT,
    managed: true,
    pid: child.pid ?? null,
    error: running ? null : `Relay process launched but port ${RELAY_PORT} did not open within ${RELAY_READY_TIMEOUT_MS}ms.`,
  }, { status: running ? 200 : 202 })
}
