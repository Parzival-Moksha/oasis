'use client'

// ░▒▓ CLAUDE TOKEN SCORE — the profile's real token counter (for tokenmaxxers) ▓▒░
// Every token Claude Code spent on this machine, read from its own transcripts (GET /api/claude-usage):
// the terminal, the desktop app and the village's agents with their subagents, each reply counted once.
// The score is what the models wrote (output, thinking included) plus fresh input. The prompt cache is
// shown apart and smaller: "context re-read" is the same context read again on every turn (tens of
// billions, cheap, not new work) and "context cached" is input stored for reuse.

import { useEffect, useState } from 'react'

import { ClaudePlanLimits } from './ClaudePlanLimits'
import { TokenDailyChart, type ChartDay } from './TokenDailyChart'

interface Counts { input: number; cacheWrite: number; cacheRead: number; output: number }
interface Summary {
  today: Counts
  week: Counts
  allTime: Counts
  /** The last 7 days and every day of this month, split by model family (days end at 04:20). */
  days7?: ChartDay[]
  month?: { label: string; days: ChartDay[] }
  firstDay: string | null
  indexing: boolean
  progress: { done: number; total: number }
}

/** The score: what the models wrote plus fresh input (lib/claude-usage-index headlineTokens). */
const headline = (c: Counts) => c.output + c.input
const anything = (c: Counts) => c.input + c.cacheWrite + c.cacheRead + c.output

export function formatTokenCount(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 1 : 2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(Math.round(value))
}

function Breakdown({ c }: { c: Counts }) {
  return (
    <>
      <div className="mt-0.5 flex flex-wrap gap-x-2.5 text-[10.5px] text-white/60">
        <span title="Tokens the models wrote: replies, tool calls and thinking">written <span className="text-white/90">{formatTokenCount(c.output)}</span></span>
        <span title="New input the models read for the first time (not from the prompt cache)">fresh input <span className="text-white/90">{formatTokenCount(c.input)}</span></span>
      </div>
      <div className="flex flex-wrap gap-x-2.5 text-[9.5px] text-white/40">
        <span title="Input stored in the prompt cache for reuse (cache write): not text the model wrote">context cached {formatTokenCount(c.cacheWrite)}</span>
        <span title="The same context read again from the prompt cache on every turn (cache read): cheap, not new work">context re-read (cached) {formatTokenCount(c.cacheRead)}</span>
      </div>
    </>
  )
}

export function ClaudeTokenScore() {
  const [summary, setSummary] = useState<Summary | null>(null)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      fetch('/api/claude-usage')
        .then(response => (response.ok ? response.json() : null))
        .then((data: Summary | null) => {
          if (cancelled || !data) return
          setSummary(data)
          // The first count on a new machine reads all transcripts: show it grow.
          if (data.indexing) timer = setTimeout(load, 2500)
        })
        .catch(() => {})
    }
    load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // The plan limits show even before (or without) the counted tokens.
  if (!summary || (!anything(summary.allTime) && !summary.indexing)) return <ClaudePlanLimits />
  const since = summary.firstDay ? new Date(`${summary.firstDay}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  return (
    <>
    <ClaudePlanLimits />
    <div className="border-b border-white/10 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Tokens · Claude Code</p>
        {summary.indexing && <span className="text-[10px] text-white/45">counting {summary.progress.done}/{summary.progress.total}…</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2" title={`${headline(summary.allTime).toLocaleString()} tokens written + fresh input`}>
        <span data-token-score className="text-[30px] font-black leading-none text-white" style={{ textShadow: '0 0 18px rgba(251,191,36,0.45)' }}>
          {formatTokenCount(headline(summary.allTime))}
        </span>
        <span className="text-[11px] text-white/55">written + fresh input{since ? ` since ${since}` : ''}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {([['Today', summary.today], ['7 days', summary.week], ['All time', summary.allTime]] as const).map(([label, c]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-amber-200/80">{label}</span>
              <span className="font-mono text-sm font-bold text-white">{formatTokenCount(headline(c))}</span>
            </div>
            <Breakdown c={c} />
          </div>
        ))}
      </div>
      {summary.days7 && <TokenDailyChart title="Last 7 days" days={summary.days7} style="week" />}
      {summary.month && <TokenDailyChart title={summary.month.label} days={summary.month.days} style="month" height={56} />}
      <p className="mt-2 text-[9.5px] leading-snug text-white/45">
        Written: what the models wrote, thinking included. Fresh input: new text they read. Context cached: input
        stored for reuse. Context re-read: the same context read again each turn, so it dwarfs the rest. The bars are
        written + fresh input per day (a day ends at 04:20).
      </p>
    </div>
    </>
  )
}
