'use client'

// ░▒▓ AGENT SESSION VIEW — the one renderer for engine schema v1 ▓▒░
// Mounted in the 2D session panel and in each desk's 3D window. Shows text, tool cards, todos,
// subagents, turn outcomes, the context meter and permission / question / plan cards.

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import type { AgentLogEntry, EngineAgentState, EngineDecisionState } from '../../store/slices/agentEngineSlice'
import type { EngineQuestion } from '../../lib/agent-engine-types'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import {
  VILLAGE_STATUS_COLOR,
  formatCost,
  formatTokens,
  modelLabel,
  statusColor,
} from './village-status'

export type SessionViewVariant = '2d' | '3d'

function run(promise: Promise<unknown>, failure: string) {
  promise.catch((error: unknown) => {
    showNotice(`${failure}: ${error instanceof Error ? error.message : String(error)}`, 'error')
  })
}

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

const BUTTON = 'rounded-md border px-2.5 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40'
const ALLOW = `${BUTTON} border-emerald-300/40 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/30`
const NEUTRAL = `${BUTTON} border-sky-300/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/25`
const DENY = `${BUTTON} border-rose-300/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/25`

// ─── decisions ──────────────────────────────────────────────────────────────

function inputPreview(decision: Pick<EngineDecisionState, 'toolName' | 'input'>): string {
  const input = (decision.input || {}) as Record<string, unknown>
  if (typeof input.command === 'string') return input.command
  if (typeof input.file_path === 'string') {
    const content = typeof input.content === 'string' ? `\n\n${input.content}` : typeof input.new_string === 'string' ? `\n\n${input.new_string}` : ''
    return `${input.file_path}${content}`
  }
  if (typeof input.url === 'string') return input.url
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return ''
  }
}

function QuestionForm({ agentId, decision, compact }: { agentId: string; decision: EngineDecisionState; compact: boolean }) {
  const questions = useMemo(() => {
    const raw = (decision.input as { questions?: EngineQuestion[] } | undefined)?.questions
    return Array.isArray(raw) ? raw.filter(q => q && typeof q.question === 'string') : []
  }, [decision.input])
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const client = getAgentEngineClient()

  const submit = (answers: Record<string, string>) => {
    setBusy(true)
    client.answerQuestion(agentId, decision.requestId, answers)
      .catch((error: unknown) => showNotice(`Answer failed: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  const single = questions.length === 1 && !questions[0].multiSelect
  const answerFor = (q: EngineQuestion) => {
    const text = (other[q.question] || '').trim()
    if (text) return text
    return (picked[q.question] || []).join(', ')
  }
  const complete = questions.length > 0 && questions.every(q => answerFor(q))

  if (!questions.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ALLOW} disabled={busy} onClick={() => run(client.respondPermission(agentId, decision.requestId, { allow: true }), 'Allow failed')}>allow</button>
        <button type="button" className={DENY} disabled={busy} onClick={() => run(client.dismissQuestion(agentId, decision.requestId), 'Dismiss failed')}>dismiss</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {questions.map(q => (
        <div key={q.question} className="flex flex-col gap-1">
          {q.header && <div className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-200/70">{q.header}</div>}
          <div className={`${compact ? 'text-[12px]' : 'text-[13px]'} font-semibold text-white`}>{q.question}</div>
          <div className="flex flex-wrap gap-1.5">
            {(q.options || []).map(option => {
              const chosen = (picked[q.question] || []).includes(option.label)
              return (
                <button
                  key={option.label}
                  type="button"
                  disabled={busy}
                  title={option.description}
                  className={chosen ? ALLOW : NEUTRAL}
                  onClick={() => {
                    if (single) {
                      submit({ [q.question]: option.label })
                      return
                    }
                    setPicked(prev => {
                      const current = prev[q.question] || []
                      const next = q.multiSelect
                        ? (current.includes(option.label) ? current.filter(label => label !== option.label) : [...current, option.label])
                        : [option.label]
                      return { ...prev, [q.question]: next }
                    })
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {!compact && (
            <input
              value={other[q.question] || ''}
              onChange={event => setOther(prev => ({ ...prev, [q.question]: event.target.value }))}
              onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Enter' && single && event.currentTarget.value.trim()) submit({ [q.question]: event.currentTarget.value.trim() })
              }}
              placeholder="or type your own answer"
              className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none"
            />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {!single && (
          <button type="button" className={ALLOW} disabled={busy || !complete} onClick={() => submit(Object.fromEntries(questions.map(q => [q.question, answerFor(q)])))}>
            send answers
          </button>
        )}
        <button type="button" className={DENY} disabled={busy} onClick={() => run(client.dismissQuestion(agentId, decision.requestId), 'Dismiss failed')}>dismiss</button>
      </div>
    </div>
  )
}

function PlanForm({ agentId, decision, compact }: { agentId: string; decision: EngineDecisionState; compact: boolean }) {
  const plan = String((decision.input as { plan?: unknown } | undefined)?.plan || '')
  const [feedback, setFeedback] = useState('')
  const client = getAgentEngineClient()
  return (
    <div className="flex flex-col gap-2">
      {plan && (
        <div className={`${compact ? 'max-h-28' : 'max-h-64'} overflow-y-auto rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] leading-snug text-white/85`}>
          <RichText text={plan} />
        </div>
      )}
      {!compact && (
        <input
          value={feedback}
          onChange={event => setFeedback(event.target.value)}
          onKeyDown={event => event.stopPropagation()}
          placeholder="feedback if you send it back to planning"
          className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none"
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ALLOW} onClick={() => run(client.respondPlan(agentId, decision.requestId, { approve: true }), 'Approve failed')}>approve plan</button>
        {Boolean(decision.suggestions?.length) && (
          <button type="button" className={NEUTRAL} title={JSON.stringify(decision.suggestions)} onClick={() => run(client.respondPlan(agentId, decision.requestId, { approve: true, always: true }), 'Approve failed')}>
            approve + auto-accept edits
          </button>
        )}
        <button type="button" className={DENY} onClick={() => run(client.respondPlan(agentId, decision.requestId, { approve: false, message: feedback.trim() || undefined }), 'Reply failed')}>
          keep planning
        </button>
      </div>
    </div>
  )
}

function PermissionForm({ agentId, decision, compact }: { agentId: string; decision: EngineDecisionState; compact: boolean }) {
  const client = getAgentEngineClient()
  const preview = inputPreview(decision)
  return (
    <div className="flex flex-col gap-2">
      {decision.description && decision.description !== decision.summary && <div className="text-[12px] text-white/70">{decision.description}</div>}
      {preview && <Clip text={preview} limit={compact ? 140 : 600} className="rounded-md border border-white/10 bg-black/40 px-2 py-1" />}
      {decision.blockedPath && <div className="text-[11px] text-amber-200/80">outside the project: {decision.blockedPath}</div>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ALLOW} onClick={() => run(client.respondPermission(agentId, decision.requestId, { allow: true }), 'Allow failed')}>allow</button>
        {Boolean(decision.suggestions?.length) && (
          <button type="button" className={NEUTRAL} title={JSON.stringify(decision.suggestions)} onClick={() => run(client.respondPermission(agentId, decision.requestId, { allow: true, always: true }), 'Allow failed')}>
            allow always
          </button>
        )}
        <button type="button" className={DENY} onClick={() => run(client.respondPermission(agentId, decision.requestId, { allow: false }), 'Deny failed')}>deny</button>
      </div>
    </div>
  )
}

export function DecisionCard({ agentId, decision, compact }: { agentId: string; decision: EngineDecisionState; compact: boolean }) {
  const title = decision.requestKind === 'question' ? 'Question for you' : decision.requestKind === 'plan' ? 'Plan ready for approval' : 'Permission needed'
  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-500/10 px-2.5 py-2 shadow-[0_0_24px_rgba(245,158,11,0.18)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">{title}</span>
        <span className="truncate font-mono text-[10px] text-amber-100/60">{decision.toolName}</span>
      </div>
      {decision.requestKind === 'permission' && <div className="mb-1.5 text-[12px] font-semibold text-white">{decision.summary || decision.toolName}</div>}
      {decision.requestKind === 'question'
        ? <QuestionForm agentId={agentId} decision={decision} compact={compact} />
        : decision.requestKind === 'plan'
          ? <PlanForm agentId={agentId} decision={decision} compact={compact} />
          : <PermissionForm agentId={agentId} decision={decision} compact={compact} />}
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const entries = useMemo(() => {
    if (!agent) return []
    const log = agent.log
    if (!compact) return log.slice(-160)
    // The desk window shows the recent conversation, without tool noise from long ago.
    return log.slice(-8)
  }, [agent, compact])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [entries, agent?.live?.text, agent?.decisions.length])

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
      <div
        ref={scrollRef}
        onScroll={event => {
          const el = event.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]"
      >
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
  )
}

/** Compact header for the 3D window (name, status, model, context, cost). */
export function SessionWindowHeader({ agent, nearby }: { agent: EngineAgentState; nearby: boolean }) {
  const color = statusColor(agent.status)
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b pb-1.5" style={{ borderColor: `${color}55` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-black tracking-wide text-white">{agent.name}</span>
        <StatusPill status={agent.status} label={agent.status === 'needs-decision' ? 'needs you' : agent.status} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/50">
        <span className="truncate">{agent.readOnly ? `${agent.kind} · read-only` : modelLabel(agent)}{agent.statusReason ? ` · ${agent.statusReason}` : ''}</span>
        {nearby ? <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono font-bold text-white">E talk</span> : <ContextMeter agent={agent} compact />}
      </div>
    </div>
  )
}
