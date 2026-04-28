import {
  saveClientAgentSessionCaches,
  type ClientAgentSessionCacheInput,
} from '@/lib/agent-session-cache-client'
import { readBrowserStorage, removeBrowserStorage } from '@/lib/browser-storage'

const MERLIN_SESSION_CACHE_KEY = 'oasis-merlin-session-cache'
const MERLIN_LEGACY_SESSIONS_KEY = 'oasis-merlin-sessions'
const ANORAK_PRO_SESSIONS_KEY = 'oasis-anorak-pro-sessions'
const HERMES_NATIVE_SESSION_CACHE_KEY = 'oasis-hermes-native-session-cache'

type AgentCacheType = 'merlin' | 'anorak-pro' | 'hermes-native'

interface LegacyKeyMigration {
  key: string
  agentType: AgentCacheType
  sessions: ClientAgentSessionCacheInput<unknown>[]
}

interface MigrationResult {
  migrated: number
  removedKeys: string[]
}

let migrationPromise: Promise<MigrationResult> | null = null

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseTime(value: unknown): number | undefined {
  const direct = finiteNumber(value)
  if (direct !== undefined) return direct
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function latestTimestampFromArray(items: unknown): number | undefined {
  if (!Array.isArray(items)) return undefined
  const latest = items.reduce((value, item) => {
    if (!isRecord(item)) return value
    return Math.max(value, parseTime(item.timestamp) || parseTime(item.createdAt) || parseTime(item.updatedAt) || 0)
  }, 0)
  return latest || undefined
}

function titleFromMessages(sessionId: string, messages: unknown, fallbackPrefix: string): string {
  if (Array.isArray(messages)) {
    const firstUser = messages.find(item => {
      if (!isRecord(item)) return false
      return typeof item.content === 'string' && item.content.trim() && (item.role === 'user' || item.type === 'text')
    })
    if (isRecord(firstUser) && typeof firstUser.content === 'string') {
      return firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 80)
    }
  }
  return `${fallbackPrefix} ${sessionId.slice(-8)}`
}

function messageCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function chooseLargerPayload(current: ClientAgentSessionCacheInput<unknown> | undefined, next: ClientAgentSessionCacheInput<unknown>) {
  if (!current) return next
  return (next.messageCount || 0) >= (current.messageCount || 0) ? next : current
}

function readMerlinSessionCache(): LegacyKeyMigration {
  const sessions = new Map<string, ClientAgentSessionCacheInput<unknown>>()
  const parsed = parseJson(readBrowserStorage(MERLIN_SESSION_CACHE_KEY))

  if (isRecord(parsed)) {
    for (const [sessionId, payload] of Object.entries(parsed)) {
      if (!sessionId || !Array.isArray(payload) || payload.length === 0) continue
      const next: ClientAgentSessionCacheInput<unknown> = {
        sessionId,
        title: titleFromMessages(sessionId, payload, 'Merlin'),
        payload,
        messageCount: messageCount(payload),
        source: 'legacy-localStorage',
        lastActiveAt: latestTimestampFromArray(payload),
      }
      sessions.set(sessionId, chooseLargerPayload(sessions.get(sessionId), next))
    }
  }

  return { key: MERLIN_SESSION_CACHE_KEY, agentType: 'merlin', sessions: [...sessions.values()] }
}

function readMerlinLegacySessions(): LegacyKeyMigration {
  const sessions = new Map<string, ClientAgentSessionCacheInput<unknown>>()
  const parsed = parseJson(readBrowserStorage(MERLIN_LEGACY_SESSIONS_KEY))

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!isRecord(entry)) continue
      const sessionId = typeof entry.id === 'string' ? entry.id : ''
      const payload = entry.messages
      if (!sessionId || !Array.isArray(payload) || payload.length === 0) continue
      const title = typeof entry.label === 'string'
        ? entry.label
        : typeof entry.name === 'string'
          ? entry.name
          : titleFromMessages(sessionId, payload, 'Merlin')
      const next: ClientAgentSessionCacheInput<unknown> = {
        sessionId,
        title,
        model: typeof entry.model === 'string' ? entry.model : undefined,
        payload,
        messageCount: messageCount(payload),
        source: 'legacy-localStorage',
        createdAt: typeof entry.createdAt === 'string' || typeof entry.createdAt === 'number' ? entry.createdAt : undefined,
        lastActiveAt: parseTime(entry.lastActiveAt) || parseTime(entry.updatedAt) || latestTimestampFromArray(payload),
      }
      sessions.set(sessionId, chooseLargerPayload(sessions.get(sessionId), next))
    }
  }

  return { key: MERLIN_LEGACY_SESSIONS_KEY, agentType: 'merlin', sessions: [...sessions.values()] }
}

function readAnorakProLegacySessions(): LegacyKeyMigration {
  const sessions: ClientAgentSessionCacheInput<unknown>[] = []
  const parsed = parseJson(readBrowserStorage(ANORAK_PRO_SESSIONS_KEY))

  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!isRecord(entry)) continue
      const sessionId = typeof entry.id === 'string' ? entry.id : ''
      if (!sessionId) continue
      const entries = Array.isArray(entry.entries) ? entry.entries : []
      sessions.push({
        sessionId,
        title: typeof entry.name === 'string' ? entry.name : `Anorak Pro ${sessionId.slice(-8)}`,
        payload: entry,
        messageCount: entries.length,
        source: 'legacy-localStorage',
        createdAt: typeof entry.createdAt === 'string' || typeof entry.createdAt === 'number' ? entry.createdAt : undefined,
        lastActiveAt: latestTimestampFromArray(entries) || parseTime(entry.updatedAt) || parseTime(entry.createdAt),
      })
    }
  }

  return { key: ANORAK_PRO_SESSIONS_KEY, agentType: 'anorak-pro', sessions }
}

function readHermesNativeSessionCache(): LegacyKeyMigration {
  const sessions: ClientAgentSessionCacheInput<unknown>[] = []
  const parsed = parseJson(readBrowserStorage(HERMES_NATIVE_SESSION_CACHE_KEY))

  if (isRecord(parsed)) {
    for (const [sessionId, payload] of Object.entries(parsed)) {
      if (!sessionId || !Array.isArray(payload) || payload.length === 0) continue
      sessions.push({
        sessionId,
        title: titleFromMessages(sessionId, payload, 'Hermes'),
        payload,
        messageCount: messageCount(payload),
        source: 'legacy-localStorage',
        lastActiveAt: latestTimestampFromArray(payload),
      })
    }
  }

  return { key: HERMES_NATIVE_SESSION_CACHE_KEY, agentType: 'hermes-native', sessions }
}

export function runLocalStorageAgentCacheMigration(): Promise<MigrationResult> {
  if (typeof window === 'undefined') return Promise.resolve({ migrated: 0, removedKeys: [] })
  if (migrationPromise) return migrationPromise

  migrationPromise = (async () => {
    const migrations = [
      readMerlinSessionCache(),
      readMerlinLegacySessions(),
      readAnorakProLegacySessions(),
      readHermesNativeSessionCache(),
    ]

    const result: MigrationResult = { migrated: 0, removedKeys: [] }

    for (const migration of migrations) {
      if (migration.sessions.length === 0) continue
      const ok = await saveClientAgentSessionCaches(migration.agentType, migration.sessions)
      if (!ok) continue
      removeBrowserStorage(migration.key)
      result.migrated += migration.sessions.length
      result.removedKeys.push(migration.key)
    }

    if (result.migrated > 0) {
      console.info('[OasisStorage] migrated localStorage agent session cache to SQLite:', result)
    }

    return result
  })()

  try {
    return migrationPromise
  } finally {
    void migrationPromise.finally(() => {
      migrationPromise = null
    })
  }
}
