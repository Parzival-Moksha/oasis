const HOSTED_ORIGIN = 'https://openclaw.04515.xyz'

async function loadBridgeGuard() {
  return import('./bin/openclaw-mcp-config-guard.mjs')
}

function normalizePairingTarget(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.host !== 'openclaw.04515.xyz') {
      throw new Error('04515 only accepts pairing URLs on https://openclaw.04515.xyz.')
    }
    if (!/^\/(?:pair|p)\/OASIS-[A-Z0-9]+$/.test(url.pathname)) {
      throw new Error('Expected a 04515 pairing URL like https://openclaw.04515.xyz/pair/OASIS-XXXXXXXX.')
    }
    return url.toString()
  }
  return `${HOSTED_ORIGIN}/pair/${raw}`
}

async function runBridge(pairingTarget, options = {}) {
  const target = normalizePairingTarget(pairingTarget)
  if (!target) {
    throw new Error('Pairing code or URL is required.')
  }

  const args = [target]
  if (options.gatewayUrl) args.push(`--gateway-url=${options.gatewayUrl}`)
  if (options.mcpPort) args.push(`--mcp-port=${options.mcpPort}`)
  if (options.noMcpConfig) args.push('--no-mcp-config')

  globalThis.__04515BridgeArgv = args
  await import(`./bin/04515-bridge.mjs?run=${Date.now()}`)
}

async function readJsonFile(path) {
  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(path, 'utf8'))
}

async function fileExists(path) {
  const { access } = await import('node:fs/promises')
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function healthUrlFromMcpUrl(value) {
  try {
    const url = new URL(value)
    url.pathname = '/health'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

async function checkHttpHealth(url, timeoutMs = 1200) {
  if (!url) return { ok: false, message: 'no url' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return {
      ok: response.ok,
      message: `${response.status} ${response.statusText || ''}`.trim(),
    }
  } catch (error) {
    return {
      ok: false,
      message: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function readBridgeStatus(options = {}) {
  const { resolveDefaultBridgeStatePath } = await loadBridgeGuard()
  const serverName = options.mcpServerName || 'oasis'
  const statePath = options.statePath || resolveDefaultBridgeStatePath(undefined, serverName)
  const hasState = await fileExists(statePath)
  if (!hasState) {
    return {
      statePath,
      serverName,
      hasState: false,
      active: false,
      stale: false,
      message: 'No active 04515 bridge state found.',
    }
  }

  let state
  try {
    state = await readJsonFile(statePath)
  } catch (error) {
    return {
      statePath,
      serverName,
      hasState: true,
      active: false,
      stale: true,
      message: `Could not read bridge state: ${error?.message || String(error)}`,
    }
  }

  const pid = Number(state.ownerPid || 0)
  const alive = processAlive(pid)
  const mcpUrl = typeof state.installedServer?.url === 'string' ? state.installedServer.url : ''
  const healthUrl = healthUrlFromMcpUrl(mcpUrl)
  const health = await checkHttpHealth(healthUrl)

  return {
    statePath,
    serverName,
    hasState: true,
    active: alive && health.ok,
    stale: !alive || !health.ok,
    pid,
    alive,
    mcpUrl,
    healthUrl,
    health,
    configPath: state.configPath || '',
    installedAt: state.installedAt || '',
    previousUrl: typeof state.previousServer?.url === 'string' ? state.previousServer.url : '',
    message: alive && health.ok
      ? 'Bridge appears active.'
      : 'Bridge state exists, but the process or MCP adapter is not healthy.',
  }
}

function printBridgeStatus(status) {
  console.log('04515 bridge status')
  console.log(`state: ${status.active ? 'active' : status.stale ? 'stale' : 'not running'}`)
  console.log(`server: ${status.serverName}`)
  console.log(`state file: ${status.statePath}`)
  if (!status.hasState) {
    console.log(status.message)
    return
  }
  console.log(`pid: ${status.pid || 'unknown'} (${status.alive ? 'alive' : 'not alive'})`)
  console.log(`mcp: ${status.mcpUrl || 'unknown'}`)
  console.log(`mcp health: ${status.health?.ok ? 'ok' : 'down'}${status.health?.message ? ` (${status.health.message})` : ''}`)
  if (status.configPath) console.log(`config: ${status.configPath}`)
  if (status.previousUrl) console.log(`previous oasis mcp: ${status.previousUrl}`)
  if (status.installedAt) console.log(`installed at: ${status.installedAt}`)
  console.log(status.message)
}

async function waitForExit(pid, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (!processAlive(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return !processAlive(pid)
}

async function stopBridge(options = {}) {
  const status = await readBridgeStatus(options)
  printBridgeStatus(status)
  if (!status.hasState) return

  if (status.alive && status.pid) {
    console.log(`Stopping 04515 bridge pid ${status.pid}...`)
    try {
      process.kill(status.pid, 'SIGTERM')
    } catch (error) {
      console.log(`Could not signal bridge process: ${error?.message || String(error)}`)
    }
    const exited = await waitForExit(status.pid)
    console.log(exited ? 'Bridge process exited.' : 'Bridge process did not exit before timeout.')
  }

  const { restoreBridgeMcpConfig } = await loadBridgeGuard()
  const restored = await restoreBridgeMcpConfig({
    statePath: status.statePath,
    logger: (...args) => console.log('[04515]', ...args),
  })
  if (restored?.restored) {
    console.log('OpenClaw oasis MCP config restored.')
  } else {
    console.log(`MCP restore not applied: ${restored?.reason || 'unknown'}`)
  }
}

export function register04515Cli({ program }) {
  const root = program
    .command('04515')
    .description('Connect OpenClaw to the hosted Oasis at openclaw.04515.xyz')
    .addHelpText('after', () => '\nDocs: https://openclaw.04515.xyz/skill.md\n')

  root
    .command('connect')
    .argument('<pairing-code-or-url>', 'Pairing code like OASIS-ABCD1234 or full 04515 pairing URL')
    .description('Pair this OpenClaw with a hosted 04515 Oasis session')
    .option('--gateway-url <url>', 'Local OpenClaw Gateway WebSocket URL')
    .option('--mcp-port <port>', 'Local bridge MCP adapter port', '17890')
    .option('--no-mcp-config', 'Do not update the OpenClaw oasis MCP server entry')
    .action(async (pairingTarget, options) => {
      try {
        await runBridge(pairingTarget, options)
      } catch (error) {
        console.error(`[04515] ${error?.message || String(error)}`)
        process.exitCode = 1
      }
    })

  root
    .command('status')
    .description('Show whether a 04515 bridge is currently installed/running for this OpenClaw')
    .option('--mcp-server-name <name>', 'OpenClaw MCP server entry name', 'oasis')
    .action(async (options) => {
      try {
        printBridgeStatus(await readBridgeStatus(options))
      } catch (error) {
        console.error(`[04515] ${error?.message || String(error)}`)
        process.exitCode = 1
      }
    })

  root
    .command('stop')
    .description('Stop the active 04515 bridge process and restore the previous Oasis MCP route when safe')
    .option('--mcp-server-name <name>', 'OpenClaw MCP server entry name', 'oasis')
    .action(async (options) => {
      try {
        await stopBridge(options)
      } catch (error) {
        console.error(`[04515] ${error?.message || String(error)}`)
        process.exitCode = 1
      }
    })
}
