import type { EngineAgentStatus } from '../../lib/agent-engine-types'
import { effectiveStatus, runningSubagentCount, type EngineAgentState } from '../../store/slices/agentEngineSlice'

/** Ring / pill colours: green working, blue finished-waiting, amber needs-decision, red error, gray idle. */
export const VILLAGE_STATUS_COLOR: Record<EngineAgentStatus, string> = {
  working: '#22c55e',
  waiting: '#3b82f6',
  'needs-decision': '#f59e0b',
  error: '#ef4444',
  idle: '#9ca3af',
}

export const VILLAGE_OBSERVED_COLOR = '#22d3ee'

export const VILLAGE_STATUS_LABEL: Record<EngineAgentStatus, string> = {
  working: 'working',
  waiting: 'waiting for you',
  'needs-decision': 'needs you',
  error: 'error',
  idle: 'idle',
}

export function statusColor(status: string | null | undefined): string {
  if (status === 'helpers') return VILLAGE_HELPERS_COLOR
  return VILLAGE_STATUS_COLOR[(status || 'idle') as EngineAgentStatus] || VILLAGE_STATUS_COLOR.idle
}

export function statusLabel(agent: Pick<EngineAgentState, 'status' | 'unseen'>): string {
  if (agent.status === 'waiting' && !agent.unseen) return 'waiting'
  return VILLAGE_STATUS_LABEL[agent.status] || agent.status
}

/** Violet: the agent itself waits or idles, but its helpers (subagents) are still working. */
export const VILLAGE_HELPERS_COLOR = '#a855f7'

export interface VillageAgentLook {
  /** An engine status, or 'helpers' (its own turn is over, its subagents still work). */
  status: string
  color: string
  label: string
  /** Subagents working right now: "×3" on a working agent's sign, the count in "helpers working (3)". */
  helpers: number
}

/** What an agent's sign, desk and menu row show: its own status, unless only its helpers are still at it. */
export function villageAgentLook(agent: Pick<EngineAgentState, 'status' | 'unseen' | 'decisions' | 'subagents' | 'lastEventAt'> & { resumedAt?: number | null }, now?: number): VillageAgentLook {
  const status = effectiveStatus(agent)
  const helpers = runningSubagentCount(agent, now)
  if (helpers > 0 && (status === 'waiting' || status === 'idle')) {
    return { status: 'helpers', color: VILLAGE_HELPERS_COLOR, label: `helpers working (${helpers})`, helpers }
  }
  // The engine restarted while it worked and told it to carry on: say so while that turn runs.
  const resumed = status === 'working' && agent.resumedAt ? ' · resumed' : ''
  return { status, color: statusColor(status), label: `${statusLabel({ status, unseen: agent.unseen })}${resumed}`, helpers }
}

/** Agents the Oasis runs, and desktop-app sessions running the Oasis plugin (bridged), get a text box. */
export function canTalkTo(agent: Pick<EngineAgentState, 'owned' | 'bridged'> | null | undefined): boolean {
  return Boolean(agent && (agent.owned || agent.bridged))
}

export function agentDisplayName(agent: Pick<EngineAgentState, 'name' | 'title' | 'id'>): string {
  const name = (agent.name || '').trim()
  if (name && !/^observe [0-9a-f]{8}$/i.test(name) && !/^hook [0-9a-f]{8}$/i.test(name)) return name
  return (agent.title || name || agent.id).slice(0, 40)
}

export function modelLabel(agent: Pick<EngineAgentState, 'resolvedModel' | 'model'>): string {
  const raw = agent.resolvedModel || agent.model || ''
  if (!raw) return 'default model'
  return raw.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function formatAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '?'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return String(value)
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

/** Last path segment of a working directory, for compact labels. */
export function cwdLabel(cwd: string | null | undefined): string {
  if (!cwd) return ''
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

// ─── type: readable yet epic (the owner: the old Courier was "too wide, too lame") ─────────────────

/** Body text: Space Grotesk (self-hosted by next/font), a geometric sans with character that stays readable in long threads. */
export const VILLAGE_FONT_BODY = 'var(--font-space-grotesk), "Space Grotesk", "Segoe UI", system-ui, "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
/** Names and labels: Bahnschrift, the condensed DIN that ships with Windows (road signs, game HUDs). */
export const VILLAGE_FONT_DISPLAY = 'Bahnschrift, "Barlow Condensed", var(--font-space-grotesk), "Apple Color Emoji", "Oasis Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

/**
 * On a panel's root: small caps labels (every `uppercase`) in the condensed display face, code in JetBrains Mono
 * (not the browser's Courier). Names get VILLAGE_FONT_DISPLAY directly.
 */
export const VILLAGE_TYPE_CLASS = [
  '[&_.uppercase]:[font-family:Bahnschrift,var(--font-space-grotesk),sans-serif]',
  '[&_.uppercase]:[font-stretch:semi-condensed]',
  '[&_.font-mono]:[font-family:var(--font-jetbrains-mono),Consolas,monospace]',
  '[&_code]:[font-family:var(--font-jetbrains-mono),Consolas,monospace]',
  '[&_pre]:[font-family:var(--font-jetbrains-mono),Consolas,monospace]',
].join(' ')
