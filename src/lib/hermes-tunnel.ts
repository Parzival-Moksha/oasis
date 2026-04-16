import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import * as net from 'net'

import { resolveHermesConfig } from '@/lib/hermes-config'

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
  processAlive: boolean
  processMatches: boolean
  healthy: boolean
  health: 'unconfigured' | 'saved' | 'stopped' | 'stale' | 'partial' | 'healthy'
  apiForwardReachable: boolean
  apiForwardConfigured: boolean
  reverseForwardConfigured: boolean
  issues: string[]
  error?: string
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

type ParsedTunnelCommand = SpawnableCommand & {
  destination: string
  localForwards: string[]
  remoteForwards: string[]
}

const SSH_FLAGS_WITH_VALUE = new Set([
  '-b',
  '-c',
  '-D',
  '-E',
  '-e',
  '-F',
  '-I',
  '-i',
  '-J',
  '-L',
  '-l',
  '-m',
  '-O',
  '-o',
  '-p',
  '-Q',
  '-R',
  '-S',
  '-W',
  '-w',
])

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function getExecutableBaseName(value: string): string {
  return value.split(/[\\/]/).pop()?.toLowerCase() || value.toLowerCase()
}

function looksLikeSshExecutable(value: string): boolean {
  const baseName = getExecutableBaseName(value)
  return baseName === 'ssh' || baseName === 'ssh.exe'
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

  if (!looksLikeSshExecutable(tokens[0] || '')) {
    throw new Error('Tunnel launcher currently supports raw ssh commands only.')
  }

  return {
    executable: tokens[0],
    args: tokens.slice(1),
  }
}

function parseTunnelCommand(raw: string): ParsedTunnelCommand {
  const parsed = validateTunnelCommand(raw)
  const localForwards: string[] = []
  const remoteForwards: string[] = []
  let destination = ''
  let expectValueFor = ''

  for (const token of parsed.args) {
    if (!token) continue

    if (expectValueFor) {
      if (expectValueFor === '-L') localForwards.push(token)
      else if (expectValueFor === '-R') remoteForwards.push(token)
      expectValueFor = ''
      continue
    }

    if (token === '-L' || token === '-R' || SSH_FLAGS_WITH_VALUE.has(token)) {
      expectValueFor = token
      continue
    }

    if (token.startsWith('-L') && token.length > 2) {
      localForwards.push(token.slice(2))
      continue
    }

    if (token.startsWith('-R') && token.length > 2) {
      remoteForwards.push(token.slice(2))
      continue
    }

    if (token.startsWith('-')) continue

    if (!destination) {
      destination = token
    }
  }

  return {
    ...parsed,
    destination,
    localForwards,
    remoteForwards,
  }
}

function splitForwardSpec(spec: string): string[] {
  const parts: string[] = []
  let current = ''
  let bracketDepth = 0

  for (const char of spec) {
    if (char === '[') bracketDepth += 1
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1)

    if (char === ':' && bracketDepth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  return parts.map(part => part.trim()).filter(Boolean)
}

type ForwardBindEndpoint = {
  host: string | null
  port: number | null
}

function parseForwardBindEndpoint(spec: string): ForwardBindEndpoint {
  const parts = splitForwardSpec(spec)
  if (parts.length < 3) {
    return { host: null, port: null }
  }

  if (parts.length === 3) {
    const port = Number(parts[0])
    return {
      host: null,
      port: Number.isFinite(port) ? port : null,
    }
  }

  const port = Number(parts[1])
  return {
    host: parts[0] || null,
    port: Number.isFinite(port) ? port : null,
  }
}

function normalizeProbeHost(host: string | null | undefined): string {
  const trimmed = sanitizeString(host || '')
  if (!trimmed || trimmed === '*' || trimmed === '0.0.0.0' || trimmed === '::') {
    return '127.0.0.1'
  }

  if (trimmed === '[::]' || trimmed === '[::1]') return '::1'
  return trimmed.replace(/^\[(.*)\]$/, '$1')
}

function areHostsCompatible(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const left = normalizeProbeHost(expected)
  const right = normalizeProbeHost(actual)

  if (left === right) return true
  if ((left === 'localhost' && right === '127.0.0.1') || (left === '127.0.0.1' && right === 'localhost')) return true
  if ((left === 'localhost' && right === '::1') || (left === '::1' && right === 'localhost')) return true
  return false
}

async function canReachTcp(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = net.createConnection({ host, port })

    const finish = (value: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function runCommand(executable: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return await new Promise(resolve => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.once('error', error => {
      resolve({
        stdout,
        stderr: error.message,
        code: null,
      })
    })

    child.once('close', code => {
      resolve({ stdout, stderr, code })
    })
  })
}

async function getProcessCommandLine(pid: number): Promise<string | null> {
  if (!pid || !Number.isFinite(pid)) return null

  if (process.platform === 'win32') {
    const script = `$proc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($proc) { $proc.CommandLine }`
    const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    const stdout = sanitizeString(result.stdout)
    return stdout || null
  }

  const result = await runCommand('ps', ['-p', String(pid), '-o', 'args='])
  const stdout = sanitizeString(result.stdout)
  return stdout || null
}

export function tunnelProcessMatchesCommand(expectedRaw: string, actualRaw: string): boolean {
  try {
    const expected = parseTunnelCommand(expectedRaw)
    const actual = parseTunnelCommand(actualRaw)

    if (!looksLikeSshExecutable(actual.executable)) return false
    if (expected.destination && actual.destination && expected.destination !== actual.destination) return false

    for (const forward of expected.localForwards) {
      if (!actual.localForwards.includes(forward)) return false
    }

    for (const forward of expected.remoteForwards) {
      if (!actual.remoteForwards.includes(forward)) return false
    }

    return true
  } catch {
    return false
  }
}

async function inspectTunnelProcess(pid: number | undefined, command: string): Promise<{
  processAlive: boolean
  processMatches: boolean
}> {
  if (!pid || !Number.isFinite(pid) || !isProcessAlive(pid)) {
    return {
      processAlive: false,
      processMatches: false,
    }
  }

  const commandLine = await getProcessCommandLine(pid)
  if (!commandLine) {
    return {
      processAlive: true,
      processMatches: false,
    }
  }

  return {
    processAlive: true,
    processMatches: tunnelProcessMatchesCommand(command, commandLine),
  }
}

async function buildHermesTunnelStatus(stored: HermesTunnelStoredConfig | null): Promise<HermesTunnelStatus> {
  const command = stored?.command || ''

  if (!command) {
    return {
      configured: false,
      command: '',
      autoStart: stored?.autoStart !== false,
      updatedAt: stored?.updatedAt,
      lastStartedAt: stored?.lastStartedAt,
      pid: stored?.pid,
      running: false,
      processAlive: false,
      processMatches: false,
      healthy: false,
      health: 'unconfigured',
      apiForwardReachable: false,
      apiForwardConfigured: false,
      reverseForwardConfigured: false,
      issues: [],
    }
  }

  let parsedCommand: ParsedTunnelCommand
  try {
    parsedCommand = parseTunnelCommand(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid SSH tunnel command.'
    return {
      configured: true,
      command,
      autoStart: stored?.autoStart !== false,
      updatedAt: stored?.updatedAt,
      lastStartedAt: stored?.lastStartedAt,
      pid: stored?.pid,
      running: false,
      processAlive: false,
      processMatches: false,
      healthy: false,
      health: 'stale',
      apiForwardReachable: false,
      apiForwardConfigured: false,
      reverseForwardConfigured: false,
      issues: [message],
      error: message,
    }
  }

  const inspection = await inspectTunnelProcess(stored?.pid, command)
  const config = await resolveHermesConfig()
  let apiHost: string | null = null
  let apiPort: number | null = null

  try {
    const url = new URL(config.apiBase)
    apiHost = url.hostname
    apiPort = Number(url.port || (url.protocol === 'https:' ? '443' : '80'))
  } catch {
    apiHost = null
    apiPort = null
  }

  const apiForwardConfigured = parsedCommand.localForwards.some(forward => {
    const endpoint = parseForwardBindEndpoint(forward)
    if (!endpoint.port || !apiPort) return false
    if (endpoint.port !== apiPort) return false
    return areHostsCompatible(endpoint.host, apiHost)
  })

  const reverseForwardConfigured = parsedCommand.remoteForwards.some(forward => {
    const endpoint = parseForwardBindEndpoint(forward)
    return endpoint.port === 4516
  })

  const apiForwardReachable = inspection.processMatches && apiForwardConfigured && apiHost && apiPort
    ? await canReachTcp(normalizeProbeHost(apiHost), apiPort)
    : false

  const issues: string[] = []
  if (stored?.pid && !inspection.processAlive) {
    issues.push('Saved SSH tunnel process is gone.')
  } else if (inspection.processAlive && !inspection.processMatches) {
    issues.push('Saved tunnel PID now points at a different process than the configured SSH bridge.')
  }

  if (!apiForwardConfigured) {
    issues.push(`Tunnel command does not expose the Hermes API forward for ${config.apiBase}.`)
  } else if (inspection.processMatches && !apiForwardReachable) {
    issues.push('Hermes chat forward is not accepting connections on the expected local port.')
  }

  if (!reverseForwardConfigured) {
    issues.push('Tunnel command is missing the Oasis MCP reverse forward on port 4516.')
  }

  let health: HermesTunnelStatus['health'] = 'saved'
  if (inspection.processMatches && apiForwardReachable && reverseForwardConfigured) {
    health = 'healthy'
  } else if (inspection.processAlive && !inspection.processMatches) {
    health = 'stale'
  } else if (inspection.processMatches) {
    health = 'partial'
  } else if (stored?.pid || stored?.lastStartedAt) {
    health = 'stopped'
  }

  const healthy = health === 'healthy'

  return {
    configured: true,
    command,
    autoStart: stored?.autoStart !== false,
    updatedAt: stored?.updatedAt,
    lastStartedAt: stored?.lastStartedAt,
    pid: stored?.pid,
    running: inspection.processMatches,
    processAlive: inspection.processAlive,
    processMatches: inspection.processMatches,
    healthy,
    health,
    apiForwardReachable,
    apiForwardConfigured,
    reverseForwardConfigured,
    issues,
    ...(issues[0] ? { error: issues[0] } : {}),
  }
}

function hasSshOption(args: string[], optionName: string): boolean {
  const normalizedOptionName = optionName.trim().toLowerCase()
  if (!normalizedOptionName) return false

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token) continue

    if (token === '-o') {
      const value = sanitizeString(args[index + 1]).toLowerCase()
      if (value.startsWith(`${normalizedOptionName}=`)) return true
      index += 1
      continue
    }

    if (token.toLowerCase().startsWith('-o')) {
      const value = sanitizeString(token.slice(2)).toLowerCase()
      if (value.startsWith(`${normalizedOptionName}=`)) return true
    }
  }

  return false
}

function addRequiredTunnelSshOptions(command: SpawnableCommand): SpawnableCommand {
  const extra: string[] = []

  if (!hasSshOption(command.args, 'ExitOnForwardFailure')) {
    extra.push('-o', 'ExitOnForwardFailure=yes')
  }

  if (!hasSshOption(command.args, 'ServerAliveInterval')) {
    extra.push('-o', 'ServerAliveInterval=5')
  }

  if (!hasSshOption(command.args, 'ServerAliveCountMax')) {
    extra.push('-o', 'ServerAliveCountMax=3')
  }

  if (extra.length === 0) return command

  return {
    executable: command.executable,
    args: [...extra, ...command.args],
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
    const parsed = JSON.parse(stripUtf8Bom(raw)) as unknown
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
  return await buildHermesTunnelStatus(stored)
}

async function spawnTunnelProcess(command: string): Promise<{
  child: ReturnType<typeof spawn>
  error?: string
}> {
  const parsed = addRequiredTunnelSshOptions(validateTunnelCommand(command))
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
    return { child, error: startup.error || 'SSH tunnel failed to start.' }
  }

  child.unref()
  return { child }
}

const MAX_SPAWN_ATTEMPTS = 3
const RESPAWN_DELAY_MS = 2000

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
      processAlive: false,
      processMatches: false,
      healthy: false,
      health: 'unconfigured',
      apiForwardReachable: false,
      apiForwardConfigured: false,
      reverseForwardConfigured: false,
      issues: [],
    }
  }

  const existingStatus = await buildHermesTunnelStatus({
    command,
    autoStart: stored?.autoStart !== false,
    updatedAt: stored?.updatedAt || new Date().toISOString(),
    lastStartedAt: stored?.lastStartedAt,
    pid: stored?.pid,
  })

  if (existingStatus.running && existingStatus.healthy) {
    return existingStatus
  }

  // Kill stale process before respawning so ports are freed
  if (stored?.pid && isProcessAlive(stored.pid)) {
    try {
      process.kill(stored.pid)
    } catch {
      // Best effort — process may have just exited.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  let lastError = ''

  for (let spawnAttempt = 0; spawnAttempt < MAX_SPAWN_ATTEMPTS; spawnAttempt += 1) {
    if (spawnAttempt > 0) {
      await new Promise(resolve => setTimeout(resolve, RESPAWN_DELAY_MS))
    }

    const { child, error: spawnError } = await spawnTunnelProcess(command)

    if (spawnError) {
      lastError = spawnError
      // On reverse-forward failure, the remote port may be held by a zombie
      // that ServerAliveInterval/ClientAliveInterval will reap shortly. Retry.
      if (spawnError.includes('exited before') && spawnAttempt < MAX_SPAWN_ATTEMPTS - 1) {
        continue
      }
      break
    }

    const next = await writeStoredHermesTunnelConfig({
      command,
      autoStart: stored?.autoStart !== false,
      pid: child.pid,
      lastStartedAt: new Date().toISOString(),
    })

    let latestStatus = await buildHermesTunnelStatus(next)
    let consecutiveHealthyChecks = 0

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!latestStatus.processAlive) {
        // Process died during health checks — break to outer retry loop
        lastError = 'SSH tunnel process exited during health check.'
        break
      }

      if (latestStatus.healthy) {
        consecutiveHealthyChecks += 1
        if (consecutiveHealthyChecks >= 4) {
          return latestStatus
        }
      } else {
        consecutiveHealthyChecks = 0
      }

      await new Promise(resolve => setTimeout(resolve, 500))
      latestStatus = await buildHermesTunnelStatus(next)
    }

    // If we got through health checks with a live process, return whatever we have
    if (latestStatus.processAlive) {
      return latestStatus
    }

    // Process died — retry spawn
  }

  throw new Error(lastError || 'SSH tunnel failed to start after retries.')
}

export async function stopHermesTunnel(): Promise<HermesTunnelStatus> {
  const stored = await readStoredHermesTunnelConfig()
  const status = await buildHermesTunnelStatus(stored)
  if (stored?.pid && status.processMatches) {
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

  return await buildHermesTunnelStatus(next)
}
