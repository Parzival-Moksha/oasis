// ░▒▓ VILLAGE HISTORY — scroll up in a thread, older history loads above ▓▒░
// The engine reads the transcript backwards in pieces (olderHistory, packages/oasis-agent-engine/src/history.js) and
// the store prepends each piece. One load per agent at a time; the thread view subscribes for its loading line.

import { useOasisStore } from '../../store/oasisStore'
import { selectHistoryCursor } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'

export interface OlderHistoryState {
  loading: boolean
  error: string | null
}

const IDLE: OlderHistoryState = { loading: false, error: null }
const states = new Map<string, OlderHistoryState>()
const listeners = new Set<() => void>()

function set(agentId: string, next: OlderHistoryState): void {
  states.set(agentId, next)
  listeners.forEach(listener => listener())
}

export function getOlderHistoryState(agentId: string): OlderHistoryState {
  return states.get(agentId) || IDLE
}

export function subscribeOlderHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** An engine from before olderHistory existed answers "unknown command": say how to get it. */
function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /unknown (cmd|command)|olderHistory/i.test(text) ? 'Restart the agent engine (pnpm dev:engine) to load older history.' : text
}

/** Load the piece of history before the oldest entry shown. Resolves to false when there is nothing (more) to load. */
export async function loadOlderHistory(agentId: string): Promise<boolean> {
  const current = getOlderHistoryState(agentId)
  if (current.loading || current.error) return false
  const agent = useOasisStore.getState().agentEngine.agents[agentId]
  const cursor = agent ? selectHistoryCursor(agent) : null
  if (!cursor) return false
  set(agentId, { loading: true, error: null })
  try {
    const result = await getAgentEngineClient().cmd(
      'olderHistory',
      { agentId, before: cursor.before, anchor: cursor.anchor ?? null },
      { timeoutMs: 60_000 },
    )
    useOasisStore.getState().agentEngineDispatch({
      type: 'history/older',
      agentId,
      events: Array.isArray(result?.events) ? result.events : [],
      from: typeof result?.from === 'number' ? result.from : 0,
      done: Boolean(result?.done),
      anchor: cursor.anchor ?? null,
    })
    set(agentId, IDLE)
    return !result?.done
  } catch (error) {
    // A new agent has no transcript yet: what it shows is the whole session.
    if (/no transcript/i.test(error instanceof Error ? error.message : String(error))) {
      useOasisStore.getState().agentEngineDispatch({ type: 'history/older', agentId, events: [], from: 0, done: true })
      set(agentId, IDLE)
      return false
    }
    set(agentId, { loading: false, error: describe(error) })
    return false
  }
}

/** Try again after an error (the line at the top of the thread is a button). */
export function retryOlderHistory(agentId: string): void {
  set(agentId, IDLE)
  void loadOlderHistory(agentId)
}
