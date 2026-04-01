import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'

const STORED_TUNNEL_PATH = path.join(process.cwd(), 'data', 'hermes-tunnel.local.json')

export interface HermesTunnelStoredConfig {
  command: string
  autoStart: boolean
  updatedAt: string
  lastStartedAt?: string
  pid?: number
}

export interface HermesTunnelStatus {
  configured: boolean
  command: string
  autoStart: boolean
  updatedAt?: string
  lastStartedAt?: string
  pid?: number
  running: boolean
}

interface WriteHermesTunnelInput {
  command: string
  autoStart?: boolean
  lastStartedAt?: string
  pid?: number
}

type SpawnableCommand = {
  executable: string
  args: string[]
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function tokenizeCommand(raw: string): string[] {
  const matches = raw.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g) || []
  return matches.map(token => {
    const trimmed = token.trim()
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  })
}

function validateTunnelCommand(raw: string): SpawnableCommand {
  const command = sanitizeString(raw)
  if (!command) {
    throw new Error('SSH tunnel command is empty.')
  }

  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) {
    throw new Error('SSH tunnel command is empty.')
  }

  const executable = tokens[0]?.toLowerCase()
  if (executable !== 'ssh') {
    throw new Error('Tunnel launcher currently supports raw ssh commands only.')
  }

  return {
    executable: tokens[0],
    args: tokens.slice(1),
  }
}

function sanitizeStoredTunnelConfig(raw: unknown): HermesTunnelStoredConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const command = sanitizeString(obj.command)
  if (!command) return null

  return {
    command,
    autoStart: obj.autoStart !== false,
    updatedAt: sanitizeString(obj.updatedAt) || new Date().toISOString(),
    lastStartedAt: sanitizeString(obj.lastStartedAt) || undefined,
    pid: typeof obj.pid === 'number' && Number.isFinite(obj.pid) ? obj.pid : undefined,
  }
}

export async function readStoredHermesTunnelConfig(): Promise<HermesTunnelStoredConfig | null> {
  try {
    const raw = await fs.readFile(STORED_TUNNEL_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return sanitizeStoredTunnelConfig(parsed)
  } catch {
    return null
  }
}

export async function writeStoredHermesTunnelConfig(input: WriteHermesTunnelInput): Promise<HermesTunnelStoredConfig> {
  const command = sanitizeString(input.command)
  if (!command) {
    throw new Error('SSH tunnel command is required.')
  }

  validateTunnelCommand(command)

  const next: HermesTunnelStoredConfig = {
    command,
    autoStart: input.autoStart !== false,
    updatedAt: new Date().toISOString(),
    lastStartedAt: sanitizeString(input.lastStartedAt) || undefined,
    pid: typeof input.pid === 'number' && Number.isFinite(input.pid) ? input.pid : undefined,
  }

  await fs.mkdir(path.dirname(STORED_TUNNEL_PATH), { recursive: true })
  await fs.writeFile(STORED_TUNNEL_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  if (process.platform !== 'win32') {
    await fs.chmod(STORED_TUNNEL_PATH, 0o600).catch(() => {})
  }

  return next
}

export async function clearStoredHermesTunnelConfig(): Promise<void> {
  await fs.unlink(STORED_TUNNEL_PATH).catch(() => {})
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function getHermesTunnelStatus(): Promise<HermesTunnelStatus> {
  const stored = await readStoredHermesTunnelConfig()
  return {
    configured: Boolean(stored?.command),
    command: stored?.command || '',
    autoStart: stored?.autoStart !== false,
    updatedAt: stored?.updatedAt,
    lastStartedAt: stored?.lastStartedAt,
    pid: stored?.pid,
    running: isProcessAlive(stored?.pid),
  }
}

export async function ensureHermesTunnelRunning(commandOverride?: string): Promise<HermesTunnelStatus> {
  const stored = await readStoredHermesTunnelConfig()
  const command = sanitizeString(commandOverride) || stored?.command || ''
  if (!command) {
    return {
      configured: false,
      command: '',
      autoStart: stored?.autoStart !== false,
      updatedAt: stored?.updatedAt,
      lastStartedAt: stored?.lastStartedAt,
      pid: stored?.pid,
      running: false,
    }
  }

  if (stored?.pid && isProcessAlive(stored.pid)) {
    return {
      configured: true,
      command: stored.command,
      autoStart: stored.autoStart !== false,
      updatedAt: stored.updatedAt,
      lastStartedAt: stored.lastStartedAt,
      pid: stored.pid,
      running: true,
    }
  }

  const parsed = validateTunnelCommand(command)
  const child = spawn(parsed.executable, parsed.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })

  const startup = await new Promise<{ ok: boolean; error?: string }>(resolve => {
    let settled = false
    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.once('error', error => finish({ ok: false, error: error.message }))
    child.once('exit', (code, signal) => finish({
      ok: false,
      error: `SSH tunnel exited before it stayed up (${signal || code || 'unknown'}).`,
    }))

    setTimeout(() => finish({ ok: true }), 700)
  })

  if (!startup.ok) {
    throw new Error(startup.error || 'SSH tunnel failed to start.')
  }

  child.unref()

  const next = await writeStoredHermesTunnelConfig({
    command,
    autoStart: stored?.autoStart !== false,
    pid: child.pid,
    lastStartedAt: new Date().toISOString(),
  })

  return {
    configured: true,
    command: next.command,
    autoStart: next.autoStart,
    updatedAt: next.updatedAt,
    lastStartedAt: next.lastStartedAt,
    pid: next.pid,
    running: isProcessAlive(next.pid),
  }
}

export async function stopHermesTunnel(): Promise<HermesTunnelStatus> {
  const stored = await readStoredHermesTunnelConfig()
  if (stored?.pid && isProcessAlive(stored.pid)) {
    try {
      process.kill(stored.pid)
    } catch {
      // Best effort.
    }
  }

  const next = stored
    ? await writeStoredHermesTunnelConfig({
        command: stored.command,
        autoStart: stored.autoStart,
      })
    : null

  return {
    configured: Boolean(next?.command),
    command: next?.command || stored?.command || '',
    autoStart: next?.autoStart !== false,
    updatedAt: next?.updatedAt || stored?.updatedAt,
    lastStartedAt: next?.lastStartedAt || stored?.lastStartedAt,
    pid: undefined,
    running: false,
  }
}
