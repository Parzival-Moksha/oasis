'use client'

// ░▒▓ DECISION CARDS — permission / question / plan, answered from the session panel ▓▒░
// Security (review 2026-11-03, item 1): approving shows the whole tool input, never a clipped
// preview, and the "allow always" rules are spelled out. The small desk card has no approve
// buttons; it sends you to the panel. Each request can be answered once (in-flight tracking).

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { isDecisionInFlight, type EngineDecisionState } from '../../store/slices/agentEngineSlice'
import type { EngineQuestion } from '../../lib/agent-engine-types'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { clippedCharacters, describeSuggestion, permissionReviewText } from '../../lib/village/village-decisions'
import { showNotice } from '../forge/GlobalNotice'
import { focusVillageAgent } from './village-actions'

const BUTTON = 'rounded-md border px-2.5 py-1 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40'
const ALLOW = `${BUTTON} border-emerald-300/40 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/30`
const NEUTRAL = `${BUTTON} border-sky-300/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/25`
const DENY = `${BUTTON} border-rose-300/40 bg-rose-400/10 text-rose-100 hover:bg-rose-400/25`
const FIELD = 'rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-white placeholder:text-white/30 focus:border-amber-300/50 focus:outline-none'

function report(failure: string) {
  return (error: unknown) => showNotice(`${failure}: ${error instanceof Error ? error.message : String(error)}`, 'error')
}

function useInFlight(requestId: string): boolean {
  return useOasisStore(s => isDecisionInFlight(s.agentEngine, requestId))
}

/** Keep typing out of the world; Esc leaves the field (the next Esc leaves the agent). */
function fieldKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, onEnter?: () => void) {
  event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault()
    event.currentTarget.blur()
    return
  }
  if (event.key === 'Enter' && onEnter) {
    event.preventDefault()
    onEnter()
  }
}

function questionsOf(decision: EngineDecisionState): EngineQuestion[] {
  const raw = (decision.input as { questions?: EngineQuestion[] } | undefined)?.questions
  return Array.isArray(raw) ? raw.filter(q => q && typeof q.question === 'string') : []
}

function QuestionForm({ agentId, decision }: { agentId: string; decision: EngineDecisionState }) {
  const questions = useMemo(() => questionsOf(decision), [decision])
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const busy = useInFlight(decision.requestId)
  const client = getAgentEngineClient()

  const submit = (answers: Record<string, string>) => {
    if (busy) return
    client.answerQuestion(agentId, decision.requestId, answers).catch(report('Answer failed'))
  }
  const dismiss = () => { if (!busy) client.dismissQuestion(agentId, decision.requestId).catch(report('Dismiss failed')) }
  const single = questions.length === 1 && !questions[0].multiSelect
  const answerFor = (q: EngineQuestion) => (other[q.question] || '').trim() || (picked[q.question] || []).join(', ')
  const complete = questions.length > 0 && questions.every(q => answerFor(q))

  if (!questions.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={DENY} disabled={busy} onClick={dismiss}>dismiss</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {questions.map(q => (
        <div key={q.question} className="flex flex-col gap-1">
          {q.header && <div className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-200/70">{q.header}</div>}
          <div className="text-[13px] font-semibold text-white">{q.question}</div>
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
                    if (single) return submit({ [q.question]: option.label })
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
          {(q.options || []).some(option => option.description) && (
            <div className="flex flex-col gap-0.5 text-[10.5px] text-white/45">
              {(q.options || []).filter(option => option.description).map(option => <span key={option.label}><b className="text-white/60">{option.label}</b>: {option.description}</span>)}
            </div>
          )}
          <input
            value={other[q.question] || ''}
            disabled={busy}
            onChange={event => setOther(prev => ({ ...prev, [q.question]: event.target.value }))}
            onKeyDown={event => fieldKeyDown(event, single ? () => { const text = event.currentTarget.value.trim(); if (text) submit({ [q.question]: text }) } : undefined)}
            placeholder="or type your own answer (Enter sends, Esc leaves the field)"
            className={FIELD}
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {!single && (
          <button type="button" className={ALLOW} disabled={busy || !complete} onClick={() => submit(Object.fromEntries(questions.map(q => [q.question, answerFor(q)])))}>
            send answers
          </button>
        )}
        <button type="button" className={DENY} disabled={busy} onClick={dismiss}>dismiss</button>
        {busy && <span className="self-center text-[10.5px] text-white/45">sending…</span>}
      </div>
    </div>
  )
}

function SuggestionList({ decision }: { decision: EngineDecisionState }) {
  if (!decision.suggestions?.length) return null
  return (
    <div className="text-[10.5px] leading-snug text-sky-100/75">
      <span className="font-bold text-sky-100/90">allow always also applies: </span>
      {decision.suggestions.map(describeSuggestion).join(' · ')}
    </div>
  )
}

function PlanForm({ agentId, decision }: { agentId: string; decision: EngineDecisionState }) {
  const plan = String((decision.input as { plan?: unknown } | undefined)?.plan || '')
  const [feedback, setFeedback] = useState('')
  const busy = useInFlight(decision.requestId)
  const client = getAgentEngineClient()
  const answer = (approve: boolean, always = false) => {
    if (busy) return
    client.respondPlan(agentId, decision.requestId, { approve, always, message: feedback.trim() || undefined }).catch(report(approve ? 'Approve failed' : 'Reply failed'))
  }
  return (
    <div className="flex flex-col gap-2">
      {plan && (
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/40 px-2 py-1.5 font-sans text-[12px] leading-snug text-white/85">{plan}</pre>
      )}
      <input
        value={feedback}
        disabled={busy}
        onChange={event => setFeedback(event.target.value)}
        onKeyDown={event => fieldKeyDown(event)}
        placeholder="feedback if you send it back to planning (Esc leaves the field)"
        className={FIELD}
      />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ALLOW} disabled={busy} onClick={() => answer(true)}>approve plan</button>
        {Boolean(decision.suggestions?.length) && (
          <button type="button" className={NEUTRAL} disabled={busy} onClick={() => answer(true, true)}>approve + allow always</button>
        )}
        <button type="button" className={DENY} disabled={busy} onClick={() => answer(false)}>keep planning</button>
        {busy && <span className="self-center text-[10.5px] text-white/45">sending…</span>}
      </div>
      <SuggestionList decision={decision} />
    </div>
  )
}

function PermissionForm({ agentId, decision }: { agentId: string; decision: EngineDecisionState }) {
  const busy = useInFlight(decision.requestId)
  const client = getAgentEngineClient()
  const review = useMemo(() => permissionReviewText(decision.toolName, decision.input), [decision.toolName, decision.input])
  const hidden = useMemo(() => clippedCharacters(decision.input), [decision.input])
  const answer = (allow: boolean, always = false) => {
    if (busy) return
    client.respondPermission(agentId, decision.requestId, { allow, always }).catch(report(allow ? 'Allow failed' : 'Deny failed'))
  }
  return (
    <div className="flex flex-col gap-2">
      {decision.description && decision.description !== decision.summary && <div className="text-[12px] text-white/70">{decision.description}</div>}
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">exactly what it will run · {review.length} chars · scroll to read all</div>
      {/* Full input, wrapped at any character: padding can't push anything out of view. */}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/15 bg-black/55 px-2 py-1.5 font-mono text-[11px] leading-snug text-white/85">{review}</pre>
      {hidden > 0 && (
        <div className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100">
          The engine left out {hidden} characters of this input. Deny, or check it where the session runs.
        </div>
      )}
      {decision.blockedPath && <div className="text-[11px] text-amber-200/80">outside the project: {decision.blockedPath}</div>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ALLOW} disabled={busy} onClick={() => answer(true)}>{hidden > 0 ? 'allow anyway' : 'allow'}</button>
        {Boolean(decision.suggestions?.length) && (
          <button type="button" className={NEUTRAL} disabled={busy} onClick={() => answer(true, true)}>allow always</button>
        )}
        <button type="button" className={DENY} disabled={busy} onClick={() => answer(false)}>deny</button>
        {busy && <span className="self-center text-[10.5px] text-white/45">sending…</span>}
      </div>
      <SuggestionList decision={decision} />
    </div>
  )
}

function compactSummary(decision: EngineDecisionState): string {
  if (decision.requestKind === 'question') return questionsOf(decision)[0]?.question || decision.summary || 'A question for you'
  if (decision.requestKind === 'plan') return 'A plan is ready for your approval'
  return decision.summary || decision.toolName
}

export function DecisionCard({ agentId, decision, compact }: { agentId: string; decision: EngineDecisionState; compact: boolean }) {
  const title = decision.requestKind === 'question' ? 'Question for you' : decision.requestKind === 'plan' ? 'Plan ready for approval' : 'Permission needed'
  return (
    <div className="rounded-lg border border-amber-300/50 bg-amber-500/10 px-2.5 py-2 shadow-[0_0_24px_rgba(245,158,11,0.18)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">{title}</span>
        <span className="truncate font-mono text-[10px] text-amber-100/60">{decision.toolName}</span>
      </div>
      {compact ? (
        // Desk card: no approve buttons here. Answers happen in the panel, with the full input.
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-2 text-[12px] font-semibold text-white">{compactSummary(decision)}</span>
          <button type="button" className={NEUTRAL} onClick={(event) => { event.stopPropagation(); focusVillageAgent(agentId) }}>review</button>
        </div>
      ) : (
        <>
          {decision.requestKind === 'permission' && <div className="mb-1.5 text-[12px] font-semibold text-white">{decision.summary || decision.toolName}</div>}
          {decision.requestKind === 'question'
            ? <QuestionForm agentId={agentId} decision={decision} />
            : decision.requestKind === 'plan'
              ? <PlanForm agentId={agentId} decision={decision} />
              : <PermissionForm agentId={agentId} decision={decision} />}
        </>
      )}
    </div>
  )
}
