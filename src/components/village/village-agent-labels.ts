// Labels for the agents menu: the whole name, and the thinking level in words.

import type { EngineSessionMeta } from '../../lib/agent-engine-types'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { agentDisplayName } from './village-status'

/** Owned agents used to be named after their session title cut to 32 characters at summon time. */
export const CUT_NAME_LENGTH = 32

const titleMaps = new WeakMap<EngineSessionMeta[], Map<string, string>>()

/** sessionId → title, cached per session list (the store keeps the same array until the next load). */
export function sessionTitles(items: EngineSessionMeta[]): Map<string, string> {
  let titles = titleMaps.get(items)
  if (!titles) {
    titles = new Map(items.filter(item => item.sessionId && item.title).map(item => [item.sessionId, String(item.title)]))
    titleMaps.set(items, titles)
  }
  return titles
}

/**
 * The whole name: when the stored name is the start of the session's title (cut at summon time, or
 * at 40 characters for a watched session), the full title. A name the owner chose stays as it is.
 */
export function fullAgentName(agent: Pick<EngineAgentState, 'id' | 'name' | 'title' | 'sessionId'>, titles?: Map<string, string>): string {
  const shown = agentDisplayName(agent)
  const title = (agent.title || (agent.sessionId && titles?.get(agent.sessionId)) || '').trim()
  return title.length > shown.length && title.startsWith(shown.trim()) ? title : shown
}

/** "high", or the default with what it means right now: "default (medium)". Watched sessions: unknown. */
export function thinkingLabel(agent: Pick<EngineAgentState, 'owned' | 'effort' | 'resolvedEffort'>): string {
  if (!agent.owned) return ''
  if (agent.effort) return agent.effort
  return agent.resolvedEffort ? `default (${agent.resolvedEffort})` : 'default'
}
