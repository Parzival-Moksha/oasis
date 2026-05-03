import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_VERSION = 1
const DEFAULT_SERVER_NAME = 'oasis'

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sameServerConfig(a, b) {
  if (!isRecord(a) || !isRecord(b)) return false
  return a.url === b.url
    && a.transport === b.transport
    && JSON.stringify(a.headers || {}) === JSON.stringify(b.headers || {})
}

function ensureConfigShape(config) {
  if (!isRecord(config)) {
    throw new Error('OpenClaw config is not a JSON object')
  }
  return config
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function readConfigFileOrEmpty(filePath) {
  try {
    return { config: await readJsonFile(filePath), existed: true }
  } catch (err) {
    if (err?.code === 'ENOENT') return { config: {}, existed: false }
    throw err
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function resolveDefaultOpenclawConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.openclaw', 'openclaw.json')
}

export function resolveDefaultBridgeStatePath(homeDir = os.homedir(), serverName = DEFAULT_SERVER_NAME) {
  return path.join(homeDir, '.openclaw-oasis-bridge', `mcp-${serverName}-restore.json`)
}

export function createBridgeMcpServerConfig(url) {
  return {
    url,
    transport: 'streamable-http',
  }
}

async function readRestoreState(statePath) {
  if (!existsSync(statePath)) return null
  const state = await readJsonFile(statePath)
  if (!isRecord(state) || state.version !== STATE_VERSION) return null
  return state
}

function applyServerConfig(config, serverName, serverConfig) {
  const next = structuredClone(config)
  const mcp = isRecord(next.mcp) ? { ...next.mcp } : {}
  const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {}
  servers[serverName] = { ...serverConfig }
  next.mcp = { ...mcp, servers }
  return next
}

function restorePreviousServer(config, state) {
  const next = structuredClone(config)
  const mcp = isRecord(next.mcp) ? { ...next.mcp } : {}
  const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {}

  if (state.hadPreviousServer) {
    servers[state.serverName] = { ...state.previousServer }
  } else {
    delete servers[state.serverName]
  }

  if (Object.keys(servers).length > 0) {
    next.mcp = { ...mcp, servers }
  } else if (Object.keys(mcp).length > 0) {
    delete mcp.servers
    if (Object.keys(mcp).length > 0) next.mcp = mcp
    else delete next.mcp
  } else {
    delete next.mcp
  }

  return next
}

export async function installBridgeMcpConfig({
  configPath = resolveDefaultOpenclawConfigPath(),
  statePath = resolveDefaultBridgeStatePath(os.homedir(), DEFAULT_SERVER_NAME),
  serverName = DEFAULT_SERVER_NAME,
  serverConfig,
  logger = () => {},
} = {}) {
  if (!serverConfig?.url) {
    throw new Error('serverConfig.url is required')
  }

  const existingState = await readRestoreState(statePath)
  const loadedConfig = await readConfigFileOrEmpty(configPath)
  const config = ensureConfigShape(loadedConfig.config)
  const currentServer = isRecord(config.mcp?.servers) ? config.mcp.servers[serverName] : undefined

  if (existingState && sameServerConfig(currentServer, existingState.installedServer)) {
    logger('OpenClaw MCP config already points at bridge; preserving existing restore state.')
    return {
      changed: false,
      configPath,
      statePath,
      serverName,
      installedServer: existingState.installedServer,
      previousServer: existingState.previousServer,
      hadPreviousServer: existingState.hadPreviousServer,
      restore: () => restoreBridgeMcpConfig({ statePath, logger }),
    }
  }

  const backupPath = `${configPath}.oasis-bridge-${nowStamp()}.bak`
  if (loadedConfig.existed) {
    await writeFile(backupPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }

  const state = {
    version: STATE_VERSION,
    configPath,
    statePath,
    serverName,
    installedServer: { ...serverConfig },
    hadPreviousServer: isRecord(currentServer),
    previousServer: isRecord(currentServer) ? { ...currentServer } : null,
    backupPath: loadedConfig.existed ? backupPath : '',
    hadConfigFile: loadedConfig.existed,
    installedAt: new Date().toISOString(),
    ownerPid: process.pid,
  }

  await writeJsonFile(statePath, state)
  await writeJsonFile(configPath, applyServerConfig(config, serverName, serverConfig))

  logger(`OpenClaw MCP server "${serverName}" now points at bridge adapter ${serverConfig.url}`)
  if (loadedConfig.existed) logger(`OpenClaw config backup written: ${backupPath}`)

  return {
    changed: true,
    configPath,
    statePath,
    serverName,
    backupPath,
    installedServer: state.installedServer,
    previousServer: state.previousServer,
    hadPreviousServer: state.hadPreviousServer,
    restore: () => restoreBridgeMcpConfig({ statePath, logger }),
  }
}

export async function restoreBridgeMcpConfig({
  statePath = resolveDefaultBridgeStatePath(),
  logger = () => {},
  force = false,
} = {}) {
  const state = await readRestoreState(statePath)
  if (!state) {
    logger('No bridge MCP restore state found.')
    return { ok: true, restored: false, reason: 'no_state' }
  }

  const config = ensureConfigShape(await readJsonFile(state.configPath))
  const currentServer = isRecord(config.mcp?.servers) ? config.mcp.servers[state.serverName] : undefined
  if (!force && !sameServerConfig(currentServer, state.installedServer)) {
    logger(`OpenClaw MCP server "${state.serverName}" changed after bridge install; leaving user config untouched.`)
    return { ok: true, restored: false, reason: 'changed_by_user' }
  }

  await writeJsonFile(state.configPath, restorePreviousServer(config, state))
  await rm(statePath, { force: true })
  logger(`OpenClaw MCP server "${state.serverName}" restored to previous config.`)
  return { ok: true, restored: true }
}
