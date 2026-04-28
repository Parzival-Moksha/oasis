export interface ClientAgentSessionCacheRecord<TPayload = unknown> {
  sessionId: string
  agentType: string
  title?: string
  model?: string
  payload: TPayload
  messageCount: number
  source: string
  createdAt: string
  updatedAt: string
  lastActiveAt: string
}

export interface ClientAgentSessionCacheInput<TPayload = unknown> {
  sessionId: string
  title?: string
  model?: string
  payload: TPayload
  messageCount?: number
  source?: string
  createdAt?: string | number
  lastActiveAt?: string | number
}

function apiUrl(params?: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `/api/agent-sessions?${query}` : '/api/agent-sessions'
}

const MAX_AGENT_SESSION_BATCH_BYTES = 512 * 1024

function encodedJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return MAX_AGENT_SESSION_BATCH_BYTES + 1
  }
}

async function postAgentSessionPayload(payload: Record<string, unknown>): Promise<boolean> {
  const response = await fetch('/api/agent-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.ok
}

export async function listClientAgentSessionCaches<TPayload>(
  agentType: string,
  limit?: number,
): Promise<ClientAgentSessionCacheRecord<TPayload>[]> {
  const response = await fetch(apiUrl({ agentType, limit }), { cache: 'no-store' })
  if (!response.ok) return []
  const data = await response.json().catch(() => ({})) as { records?: unknown[] }
  return Array.isArray(data.records) ? data.records as ClientAgentSessionCacheRecord<TPayload>[] : []
}

export async function getClientAgentSessionCache<TPayload>(
  agentType: string,
  sessionId: string,
): Promise<ClientAgentSessionCacheRecord<TPayload> | null> {
  if (!sessionId) return null
  const response = await fetch(apiUrl({ agentType, sessionId }), { cache: 'no-store' })
  if (!response.ok) return null
  const data = await response.json().catch(() => ({})) as { record?: unknown }
  return data.record ? data.record as ClientAgentSessionCacheRecord<TPayload> : null
}

export async function saveClientAgentSessionCache<TPayload>(
  agentType: string,
  session: ClientAgentSessionCacheInput<TPayload>,
): Promise<boolean> {
  if (!session.sessionId) return false
  return postAgentSessionPayload({ agentType, session })
}

export async function saveClientAgentSessionCaches<TPayload>(
  agentType: string,
  sessions: ClientAgentSessionCacheInput<TPayload>[],
): Promise<boolean> {
  const filtered = sessions.filter(session => session.sessionId)
  if (filtered.length === 0) return true

  let allOk = true
  let batch: ClientAgentSessionCacheInput<TPayload>[] = []

  const flush = async () => {
    if (batch.length === 0) return
    const payload = { agentType, sessions: batch }
    const ok = await postAgentSessionPayload(payload)
    allOk = allOk && ok
    batch = []
  }

  for (const session of filtered) {
    const singlePayload = { agentType, sessions: [session] }
    if (encodedJsonBytes(singlePayload) > MAX_AGENT_SESSION_BATCH_BYTES) {
      await flush()
      const ok = await saveClientAgentSessionCache(agentType, session)
      allOk = allOk && ok
      continue
    }

    const nextBatch = [...batch, session]
    if (batch.length > 0 && encodedJsonBytes({ agentType, sessions: nextBatch }) > MAX_AGENT_SESSION_BATCH_BYTES) {
      await flush()
    }
    batch.push(session)
  }

  await flush()
  return allOk
}
