// ░▒▓ VILLAGE EFFORT — which thinking levels an agent's model takes ▓▒░

import { ENGINE_EFFORT_LEVELS, type EngineModelInfo } from '../agent-engine-types'

const bare = (model: string | null | undefined) => (model || '').replace(/\[1m\]$/i, '').toLowerCase()

/**
 * Thinking levels the agent's current model takes, from the CLI's own model list (initialize).
 * [] = the model has no effort setting (haiku-4-5). Unknown model list: every level, the CLI
 * refuses what it can't do (setEffort reads the level back).
 */
export function effortLevelsFor(agent: {
  model?: string | null
  resolvedModel?: string | null
  models?: EngineModelInfo[] | null
}): string[] {
  const models = agent.models || []
  // An engine from before 2026-11-09 drops the effort fields: no list says anything then.
  if (!models.some(m => m.supportsEffort !== undefined || m.supportedEffortLevels)) return [...ENGINE_EFFORT_LEVELS]
  const wanted = bare(agent.model)
  const resolved = bare(agent.resolvedModel)
  const match = (wanted && models.find(m => bare(m.value) === wanted))
    || (resolved && models.find(m => bare(m.resolvedModel) === resolved || bare(m.value) === resolved))
    || models.find(m => m.value === 'default')
  if (!match) return [...ENGINE_EFFORT_LEVELS]
  if (!match.supportsEffort) return []
  return match.supportedEffortLevels?.length ? [...match.supportedEffortLevels] : [...ENGINE_EFFORT_LEVELS]
}
