import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_TOOL_INCLUDE = Object.freeze([
  'get_world_info',
  'get_world_state',
  'query_objects',
  'search_assets',
  'get_asset_catalog',
  'get_craft_guide',
  'self_craft_scene',
  'place_object',
  'modify_object',
  'remove_object',
  'set_sky',
  'set_ground_preset',
  'paint_ground_tiles',
  'add_light',
  'modify_light',
  'set_behavior',
  'set_avatar',
  'walk_avatar_to',
  'list_avatar_animations',
  'play_avatar_animation',
  'screenshot_viewport',
  'screenshot_avatar',
  'avatarpic_user',
])

function isSafeYamlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(String(value || ''))
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function splitLines(text) {
  const normalized = normalizeNewlines(text)
  if (!normalized) return []
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n')
}

function topLevelKeyIndex(lines, key) {
  const pattern = new RegExp(`^${key}:\\s*(?:#.*)?$`)
  return lines.findIndex(line => pattern.test(line))
}

function blockEnd(lines, startIndex, maxIndent) {
  let index = startIndex + 1
  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() && !line.startsWith(' '.repeat(maxIndent + 1))) break
    index += 1
  }
  return index
}

function serverBlockRange(lines, mcpStart, mcpEnd, serverName) {
  const pattern = new RegExp(`^  ${serverName}:\\s*(?:#.*)?$`)
  const start = lines.findIndex((line, index) => index > mcpStart && index < mcpEnd && pattern.test(line))
  if (start < 0) return null
  let end = start + 1
  while (end < mcpEnd) {
    const line = lines[end]
    if (line.trim() && /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line)) break
    end += 1
  }
  return { start, end }
}

export function resolveDefaultHermesConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.hermes', 'config.yaml')
}

export function resolveDefaultHermesStatePath(homeDir = os.homedir(), serverName = 'oasis') {
  return path.join(homeDir, '.hermes', `${serverName}-mcp-bridge-state.json`)
}

export function buildHermesMcpServerBlock({
  serverName = 'oasis',
  url,
  tools = DEFAULT_TOOL_INCLUDE,
} = {}) {
  if (!isSafeYamlKey(serverName)) {
    throw new Error(`Unsafe Hermes MCP server name: ${serverName}`)
  }
  if (!url || typeof url !== 'string') {
    throw new Error('Hermes MCP URL is required.')
  }
  const include = tools.map(tool => String(tool).trim()).filter(Boolean)
  return [
    `  ${serverName}:`,
    `    url: ${JSON.stringify(url)}`,
    '    enabled: true',
    '    tools:',
    `      include: [${include.join(', ')}]`,
    '      prompts: false',
    '      resources: false',
    '    timeout: 45',
    '    connect_timeout: 5',
  ]
}

export function upsertHermesMcpServerConfig(
  currentText,
  {
    serverName = 'oasis',
    url,
    tools = DEFAULT_TOOL_INCLUDE,
  } = {},
) {
  const lines = splitLines(currentText)
  const block = buildHermesMcpServerBlock({ serverName, url, tools })
  const mcpStart = topLevelKeyIndex(lines, 'mcp_servers')

  if (mcpStart < 0) {
    const next = [...lines]
    if (next.length > 0 && next[next.length - 1].trim()) next.push('')
    next.push('mcp_servers:', ...block)
    return `${next.join('\n')}\n`
  }

  const mcpEnd = blockEnd(lines, mcpStart, 0)
  const existing = serverBlockRange(lines, mcpStart, mcpEnd, serverName)
  const next = [...lines]
  if (existing) {
    next.splice(existing.start, existing.end - existing.start, ...block)
  } else {
    next.splice(mcpEnd, 0, ...block)
  }
  return `${next.join('\n')}\n`
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return ''
    throw err
  }
}

export async function installHermesMcpConfig({
  configPath = resolveDefaultHermesConfigPath(),
  statePath = resolveDefaultHermesStatePath(path.dirname(path.dirname(configPath))),
  serverName = 'oasis',
  url,
  tools = DEFAULT_TOOL_INCLUDE,
  logger = () => {},
} = {}) {
  const previousText = await readTextIfExists(configPath)
  const nextText = upsertHermesMcpServerConfig(previousText, { serverName, url, tools })
  if (previousText === nextText) {
    logger('Hermes MCP config already points at Oasis bridge.', { configPath, serverName, url })
    return { changed: false, configPath, statePath }
  }

  await mkdir(path.dirname(configPath), { recursive: true })
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, JSON.stringify({
    configPath,
    serverName,
    previousText,
    nextText,
    updatedAt: new Date().toISOString(),
  }, null, 2))
  await writeFile(configPath, nextText)
  logger('Hermes MCP config updated. Run /reload-mcp in Hermes, or restart the Hermes gateway/dashboard.', {
    configPath,
    serverName,
    url,
  })
  return { changed: true, configPath, statePath }
}

export async function restoreHermesMcpConfig({
  statePath = resolveDefaultHermesStatePath(),
  logger = () => {},
} = {}) {
  const raw = await readFile(statePath, 'utf8')
  const parsed = JSON.parse(raw)
  const configPath = typeof parsed?.configPath === 'string' ? parsed.configPath : resolveDefaultHermesConfigPath()
  const previousText = typeof parsed?.previousText === 'string' ? parsed.previousText : ''
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, previousText)
  logger('Hermes MCP config restored.', { configPath, statePath })
  return { configPath, statePath }
}

export const HERMES_OASIS_MCP_TOOL_INCLUDE = DEFAULT_TOOL_INCLUDE
