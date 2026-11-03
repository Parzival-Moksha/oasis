'use client'

// ░▒▓ AGENT SESSION VIEW — the one renderer for engine schema v1 ▓▒░
// Mounted in the 2D session panel and in each desk's 3D window. Shows text, tool cards, todos,
// subagents, turn outcomes, the context meter and permission / question / plan cards.

import { memo, useMemo, useState, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { effectiveStatus, type AgentLogEntry, type EngineAgentState } from '../../store/slices/agentEngineSlice'
import { DecisionCard } from './DecisionCards'
import {
  VILLAGE_STATUS_COLOR,
  formatCost,
  formatTokens,
  modelLabel,
  statusColor,
} from './village-status'

export type SessionViewVariant = '2d' | '3d'

// ─── small pieces ───────────────────────────────────────────────────────────

export function ContextMeter({ agent, compact = false }: { agent: EngineAgentState; compact?: boolean }) {
  const ctx = agent.context
  const percent = ctx?.percent ?? null
  const color = percent === null ? '#64748b' : percent >= 85 ? '#ef4444' : percent >= 60 ? '#f59e0b' : '#22c55e'
  return (
    <div className="flex min-w-0 items-center gap-2" title={ctx ? `${ctx.usedTokens ?? '?'} / ${ctx.maxTokens ?? '?'} tokens` : 'context unknown until the first turn'}>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-white/45">ctx</span>
      <div className={`relative h-1.5 ${compact ? 'w-16' : 'w-24'} shrink-0 overflow-hidden rounded-full bg-white/10`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(percent ?? 0, percent ? 2 : 0))}%`, background: color }} />
      </div>
      <span className="truncate text-[10px] tabular-nums text-white/60">
        {ctx ? `${formatTokens(ctx.usedTokens)}${ctx.maxTokens ? ` / ${formatTokens(ctx.maxTokens)}` : ''}${percent !== null ? ` · ${percent}%` : ''}` : 'n/a'}
      </span>
    </div>
  )
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const color = statusColor(status)
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
      style={{ background: `${color}26`, color, border: `1px solid ${color}66` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {label || status}
    </span>
  )
}

/** Plain text with fenced code blocks; no markdown dependency needed in the 3D windows. */
function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(/```[a-zA-Z0-9_-]*\n?/), [text])
  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => (index % 2 === 1
        ? <pre key={index} className="my-1 overflow-x-auto rounded bg-black/50 px-2 py-1 font-mono text-[11px] leading-snug text-emerald-100/90">{part.replace(/\n$/, '')}</pre>
        : <span key={index}>{part}</span>))}
    </div>
  )
}

function Clip({ text, limit, className = '' }: { text: string; limit: number; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > limit
  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] leading-snug text-white/60">{open || !long ? text : `${text.slice(0, limit)}…`}</pre>
      {long && (
        <button type="button" className="mt-0.5 text-[10px] text-sky-300/80 hover:text-sky-200" onClick={() => setOpen(v => !v)}>
          {open ? 'less' : `more (${text.length} chars)`}
        </button>
      )}
    </div>
  )
}

// ─── log entries ────────────────────────────────────────────────────────────

function userStateLabel(entry: Extract<AgentLogEntry, { type: 'user' }>): string {
  switch (entry.state) {
    case 'queued': return 'sent mid-turn, waiting for a tool boundary'
    case 'folded': return 'folded into the running turn'
    case 'taken': return entry.midTurn ? 'ran as the next turn' : ''
    default: return ''
  }
}

const LogEntryView = memo(function LogEntryView({ entry, compact }: { entry: AgentLogEntry; compact: boolean }) {
  const dim = entry.history ? 'opacity-60' : ''
  switch (entry.type) {
    case 'session':
      return (
        <div className={`text-[10px] uppercase tracking-[0.14em] text-white/35 ${dim}`}>
          {entry.observed ? 'observing read-only' : `session · ${entry.model || 'default model'}${entry.permissionMode ? ` · ${entry.permissionMode}` : ''}`}
        </div>
      )
    case 'user': {
      const state = userStateLabel(entry)
      return (
        <div className={`ml-6 rounded-lg border border-sky-300/20 bg-sky-400/10 px-2.5 py-1.5 ${dim}`}>
          <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-sky-200/70">
            {entry.state === 'seen' ? 'prompt' : 'you'}{state ? ` · ${state}` : ''}{entry.priority === 'now' ? ' · urgent' : ''}
          </div>
          <RichText text={compact && entry.text.length > 280 ? `${entry.text.slice(0, 280)}…` : entry.text} className="text-[12px] text-white/90" />
        </div>
      )
    }
    case 'text':
      return (
        <div className={`${entry.parentToolUseId ? 'ml-3 border-l border-violet-300/30 pl-2 text-white/65' : 'text-white/90'} text-[12.5px] leading-relaxed ${dim}`}>
          {entry.parentToolUseId && <span className="mr-1 text-[9px] font-black uppercase tracking-[0.12em] text-violet-200/70">subagent</span>}
          <RichText text={compact && entry.text.length > 420 ? `${entry.text.slice(0, 420)}…` : entry.text} />
        </div>
      )
    case 'tool': {
      const color = entry.status === 'running' ? '#38bdf8' : entry.status === 'error' ? '#f87171' : '#64748b'
      return (
        <div className={`${entry.parentToolUseId ? 'ml-3' : ''} rounded-md border bg-black/30 px-2 py-1 ${dim}`} style={{ borderColor: `${color}55` }}>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-white/80">
            <span style={{ color }}>{entry.status === 'running' ? '…' : entry.status === 'error' ? '✕' : '✓'}</span>
            <span className="truncate">{entry.summary || entry.name}</span>
          </div>
          {!compact && entry.output && <Clip text={entry.output} limit={220} className="mt-0.5" />}
        </div>
      )
    }
    case 'subagent':
      return (
        <div className={`rounded-md border border-violet-300/30 bg-violet-500/10 px-2 py-1 ${dim}`}>
          <div className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-200/80">
            subagent · {entry.subagentType || 'agent'} · {entry.status}{entry.lastToolName && entry.status === 'running' ? ` · ${entry.lastToolName}` : ''}
          </div>
          <div className="text-[12px] text-white/85">{entry.description}</div>
          {!compact && entry.summary && <Clip text={entry.summary} limit={240} className="mt-0.5" />}
        </div>
      )
    case 'decision':
      return (
        <div className={`rounded-md border border-amber-300/25 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-100/80 ${dim}`}>
          {entry.requestKind === 'question' ? 'asked' : entry.requestKind === 'plan' ? 'plan' : 'permission'} · {entry.summary || entry.toolName}
          <span className="ml-1 text-white/45">
            {entry.readOnly ? '(seen via hook; answer where it runs)' : entry.resolved ? `-> ${entry.resolved}` : '-> waiting for you'}
          </span>
        </div>
      )
    case 'turn': {
      const color = entry.outcome === 'error' ? VILLAGE_STATUS_COLOR.error : entry.outcome === 'needs-decision' ? VILLAGE_STATUS_COLOR['needs-decision'] : VILLAGE_STATUS_COLOR.waiting
      const bits = [
        entry.costUsd ? formatCost(entry.costUsd) : null,
        entry.durationMs !== null ? `${(entry.durationMs / 1000).toFixed(1)}s` : null,
        entry.numTurns ? `${entry.numTurns} step${entry.numTurns === 1 ? '' : 's'}` : null,
        entry.contextTokens !== null ? `ctx ${formatTokens(entry.contextTokens)}${entry.contextWindow ? `/${formatTokens(entry.contextWindow)}` : ''}` : null,
      ].filter(Boolean)
      return (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-1 text-[10.5px] ${dim}`} style={{ borderColor: `${color}55` }}>
          <span className="font-black uppercase tracking-[0.12em]" style={{ color }}>
            {entry.outcome === 'done-waiting' ? 'turn done' : entry.outcome === 'needs-decision' ? 'needs you' : entry.outcome}
          </span>
          {entry.reason && entry.reason !== 'end_turn' && <span className="text-white/50">{entry.reason}</span>}
          {bits.length > 0 && <span className="text-white/40">{bits.join(' · ')}</span>}
        </div>
      )
    }
    case 'notice': {
      const color = entry.level === 'error' ? 'text-rose-200/85' : entry.level === 'warn' ? 'text-amber-200/80' : 'text-white/45'
      return <div className={`text-[10.5px] italic ${color} ${dim}`}>{entry.text}</div>
    }
    default:
      return null
  }
})

// ─── lists ──────────────────────────────────────────────────────────────────

function TodoList({ agent, compact }: { agent: EngineAgentState; compact: boolean }) {
  if (!agent.todos.length) return null
  const done = agent.todos.filter(todo => todo.status === 'completed').length
  const shown = compact ? agent.todos.filter(todo => todo.status !== 'completed').slice(0, 4) : agent.todos
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5">
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-[0.16em] text-white/50">
        <span>todos</span>
        <span className="tabular-nums">{done}/{agent.todos.length}</span>
      </div>
      {shown.map((todo, index) => (
        <div key={`${todo.content}-${index}`} className={`flex gap-1.5 text-[11.5px] leading-snug ${todo.status === 'completed' ? 'text-white/35 line-through' : todo.status === 'in_progress' ? 'text-emerald-100' : 'text-white/75'}`}>
          <span className="shrink-0 font-mono text-[10px]">{todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[>]' : '[ ]'}</span>
          <span>{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span>
        </div>
      ))}
    </div>
  )
}

function SubagentList({ agent, compact }: { agent: EngineAgentState; compact: boolean }) {
  const running = agent.subagents.filter(s => s.status === 'running')
  const list = compact ? running : agent.subagents.slice(-6)
  if (!list.length) return null
  return (
    <div className="rounded-lg border border-violet-300/20 bg-violet-500/5 px-2.5 py-1.5">
      <div className="mb-1 text-[9px] font-black uppercase tracking-[0.16em] text-violet-200/70">
        subagents{running.length ? ` · ${running.length} running` : ''}
      </div>
      {list.map(sub => (
        <div key={sub.key} className="flex items-center gap-1.5 text-[11.5px] text-white/80">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sub.status === 'running' ? '#a78bfa' : sub.status === 'failed' ? '#f87171' : '#64748b' }} />
          <span className="truncate">{sub.description}</span>
          <span className="shrink-0 text-[10px] text-white/40">{sub.subagentType}{sub.status === 'running' && sub.lastToolName ? ` · ${sub.lastToolName}` : sub.status !== 'running' ? ` · ${sub.status}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

// ─── the view ───────────────────────────────────────────────────────────────

export interface AgentSessionViewProps {
  agentId: string
  variant: SessionViewVariant
  /** Rendered above the feed in the 3D window (the 2D panel has its own header). */
  header?: ReactNode
}

export function AgentSessionView({ agentId, variant, header }: AgentSessionViewProps) {
  const agent = useOasisStore(s => s.agentEngine.agents[agentId])
  const compact = variant === '3d'
  const log = agent?.log
  const entries = useMemo(() => {
    if (!log) return []
    // The desk window shows the recent conversation, without tool noise from long ago.
    return compact ? log.slice(-8) : log.slice(-160)
  }, [log, compact])

  if (!agent) return null
  const decisions = agent.owned ? agent.decisions : []

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {header}
      {compact && decisions[0] && <DecisionCard agentId={agent.id} decision={decisions[0]} compact />}
      <div className="flex shrink-0 flex-col gap-1.5">
        {!compact && <ContextMeter agent={agent} />}
        <TodoList agent={agent} compact={compact} />
        <SubagentList agent={agent} compact={compact} />
      </div>
      {/* column-reverse keeps the view pinned to the newest line without measuring on every
          streamed delta; scrolling up still works and is not yanked back. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto pr-1 [scrollbar-width:thin]">
      <div className="flex flex-col gap-1.5">
        {entries.length === 0 && !agent.live && (
          <div className="py-3 text-center text-[11px] text-white/35">
            {agent.owned ? 'No messages yet. Say hello.' : 'Waiting for the session to do something.'}
          </div>
        )}
        {entries.map(entry => <LogEntryView key={entry.key} entry={entry} compact={compact} />)}
        {agent.live?.text && (
          <div className="text-[12.5px] leading-relaxed text-white/90">
            <RichText text={compact && agent.live.text.length > 420 ? `…${agent.live.text.slice(-420)}` : agent.live.text} />
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-300/80 align-middle" />
          </div>
        )}
        {!compact && decisions.map(decision => <DecisionCard key={decision.requestId} agentId={agent.id} decision={decision} compact={false} />)}
      </div>
      </div>
    </div>
  )
}

/** Compact header for the 3D window (name, status, model, context, cost). */
export function SessionWindowHeader({ agent, nearby }: { agent: EngineAgentState; nearby: boolean }) {
  const status = effectiveStatus(agent)
  const color = statusColor(status)
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b pb-1.5" style={{ borderColor: `${color}55` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-black tracking-wide text-white">{agent.name}</span>
        <StatusPill status={status} label={status === 'needs-decision' ? 'needs you' : status} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
        <span className="truncate">{agent.readOnly ? `${agent.kind} · read-only` : modelLabel(agent)}{agent.statusReason ? ` · ${agent.statusReason}` : ''}</span>
        {nearby ? <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono font-bold text-white">E talk</span> : <ContextMeter agent={agent} compact />}
      </div>
    </div>
  )
}
