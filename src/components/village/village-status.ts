import type { EngineAgentStatus } from '../../lib/agent-engine-types'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'

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
  return VILLAGE_STATUS_COLOR[(status || 'idle') as EngineAgentStatus] || VILLAGE_STATUS_COLOR.idle
}

export function statusLabel(agent: Pick<EngineAgentState, 'status' | 'unseen'>): string {
  if (agent.status === 'waiting' && !agent.unseen) return 'waiting'
  return VILLAGE_STATUS_LABEL[agent.status] || agent.status
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
