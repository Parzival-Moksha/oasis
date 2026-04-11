import 'server-only'

import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export interface AgentSessionRecord {
  sessionId: string
  agentType: string
  createdAt: string
  updatedAt: string
  model?: string
}

const REGISTRY_PATH = join(process.cwd(), 'prisma', 'data', 'agent-session-registry.json')

function sanitizeSessionId(value: string): string {
  return value.trim()
}

async function readRegistry(): Promise<Record<string, AgentSessionRecord>> {
  if (!existsSync(REGISTRY_PATH)) return {}

  try {
    const raw = await readFile(REGISTRY_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, AgentSessionRecord> | null
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

async function writeRegistry(registry: Record<string, AgentSessionRecord>) {
  await mkdir(join(process.cwd(), 'prisma', 'data'), { recursive: true })
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2))
}

export async function getAgentSessionRecord(sessionId: string): Promise<AgentSessionRecord | null> {
  const safeSessionId = sanitizeSessionId(sessionId)
  if (!safeSessionId) return null

  const registry = await readRegistry()
  return registry[safeSessionId] || null
}

export async function listAgentSessionRecords(agentType: string): Promise<AgentSessionRecord[]> {
  const safeAgentType = agentType.trim().toLowerCase()
  if (!safeAgentType) return []

  const registry = await readRegistry()
  return Object.values(registry)
    .filter(record => record.agentType === safeAgentType)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function upsertAgentSessionRecord(
  sessionId: string,
  agentType: string,
  options?: { model?: string },
): Promise<AgentSessionRecord> {
  const safeSessionId = sanitizeSessionId(sessionId)
  const safeAgentType = agentType.trim().toLowerCase()
  if (!safeSessionId) throw new Error('sessionId is required')
  if (!safeAgentType) throw new Error('agentType is required')

  const registry = await readRegistry()
  const now = new Date().toISOString()
  const previous = registry[safeSessionId]

  const next: AgentSessionRecord = {
    sessionId: safeSessionId,
    agentType: safeAgentType,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    model: options?.model || previous?.model,
  }

  registry[safeSessionId] = next
  await writeRegistry(registry)
  return next
}
