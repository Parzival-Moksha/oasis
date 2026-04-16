import type { OasisSettings } from '@/components/scene-lib/types'
import { SPELL_CAST_DURATION_MS } from '@/lib/spell-casting'

export interface EmbodiedAgentSettings {
  agentActionMode: 'embodied' | 'instant'
  agentWalkSpeed: number
  agentConjureDurationMs: number
  agentScreenshotSettleMs: number
}

export const DEFAULT_EMBODIED_AGENT_SETTINGS: EmbodiedAgentSettings = {
  agentActionMode: 'embodied',
  agentWalkSpeed: 3,
  agentConjureDurationMs: SPELL_CAST_DURATION_MS,
  agentScreenshotSettleMs: 220,
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export function pickEmbodiedAgentSettings(settings?: Partial<OasisSettings> | null): EmbodiedAgentSettings {
  const actionMode = settings?.agentActionMode === 'instant' ? 'instant' : 'embodied'
  return {
    agentActionMode: actionMode,
    agentWalkSpeed: clamp(finiteNumber(settings?.agentWalkSpeed, DEFAULT_EMBODIED_AGENT_SETTINGS.agentWalkSpeed), 0.5, 12),
    agentConjureDurationMs: Math.round(clamp(
      finiteNumber(settings?.agentConjureDurationMs, DEFAULT_EMBODIED_AGENT_SETTINGS.agentConjureDurationMs),
      0,
      12000,
    )),
    agentScreenshotSettleMs: Math.round(clamp(
      finiteNumber(settings?.agentScreenshotSettleMs, DEFAULT_EMBODIED_AGENT_SETTINGS.agentScreenshotSettleMs),
      0,
      4000,
    )),
  }
}

export function readEmbodiedAgentSettingsFromStorage(): EmbodiedAgentSettings {
  if (typeof window === 'undefined') return DEFAULT_EMBODIED_AGENT_SETTINGS
  try {
    const raw = window.localStorage.getItem('oasis-settings')
    if (!raw) return DEFAULT_EMBODIED_AGENT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<OasisSettings> | null
    return pickEmbodiedAgentSettings(parsed)
  } catch {
    return DEFAULT_EMBODIED_AGENT_SETTINGS
  }
}
