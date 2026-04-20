import 'server-only'

import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

export function getOpenclawRuntimeConfigPath(): string {
  return sanitizeString(process.env.OPENCLAW_CONFIG_PATH) || join(homedir(), '.openclaw', 'openclaw.json')
}

export async function readOpenclawRuntimeConfig(): Promise<Record<string, unknown>> {
  const configPath = getOpenclawRuntimeConfigPath()
  if (!existsSync(configPath)) return {}

  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(stripUtf8Bom(raw)) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export async function writeOpenclawRuntimeConfig(config: Record<string, unknown>): Promise<void> {
  const configPath = getOpenclawRuntimeConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

export interface OpenclawMcpServerDefinition {
  url: string
  transport: 'streamable-http'
  headers?: Record<string, string>
}

export function buildOasisOpenclawMcpDefinition(baseUrl: string): OpenclawMcpServerDefinition {
  const key = sanitizeString(process.env.OASIS_MCP_KEY)
  return {
    url: `${baseUrl}/api/mcp/oasis?agentType=openclaw`,
    transport: 'streamable-http',
    ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
  }
}

export async function readOpenclawMcpServer(name: string): Promise<Record<string, unknown> | null> {
  const safeName = sanitizeString(name)
  if (!safeName) return null

  const config = await readOpenclawRuntimeConfig()
  const mcp = config.mcp
  if (!mcp || typeof mcp !== 'object') return null
  const servers = (mcp as Record<string, unknown>).servers
  if (!servers || typeof servers !== 'object') return null
  const server = (servers as Record<string, unknown>)[safeName]
  return server && typeof server === 'object' ? server as Record<string, unknown> : null
}

export async function upsertOpenclawMcpServer(name: string, definition: OpenclawMcpServerDefinition): Promise<void> {
  const safeName = sanitizeString(name)
  if (!safeName) throw new Error('MCP server name is required.')

  const config = await readOpenclawRuntimeConfig()
  const mcp = config.mcp && typeof config.mcp === 'object' ? config.mcp as Record<string, unknown> : {}
  const servers = mcp.servers && typeof mcp.servers === 'object' ? mcp.servers as Record<string, unknown> : {}

  servers[safeName] = definition
  config.mcp = {
    ...mcp,
    servers,
  }

  await writeOpenclawRuntimeConfig(config)
}

export function sameMcpDefinition(
  current: Record<string, unknown> | null,
  expected: OpenclawMcpServerDefinition,
): boolean {
  if (!current) return false
  const currentUrl = sanitizeString(current.url)
  const currentTransport = sanitizeString(current.transport) || 'sse'
  if (currentUrl !== expected.url || currentTransport !== expected.transport) return false

  const currentHeaders = current.headers && typeof current.headers === 'object'
    ? Object.entries(current.headers as Record<string, unknown>)
        .reduce<Record<string, string>>((acc, [key, value]) => {
          if (typeof value === 'string') acc[key] = value
          return acc
        }, {})
    : {}
  const expectedHeaders = expected.headers || {}

  const currentKeys = Object.keys(currentHeaders).sort()
  const expectedKeys = Object.keys(expectedHeaders).sort()
  if (currentKeys.length !== expectedKeys.length) return false
  return currentKeys.every((key, index) => key === expectedKeys[index] && currentHeaders[key] === expectedHeaders[key])
}
