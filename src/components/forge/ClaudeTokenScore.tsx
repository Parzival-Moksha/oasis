'use client'

// ░▒▓ CLAUDE TOKEN SCORE — the profile's real token counter (for tokenmaxxers) ▓▒░
// Every token Claude Code spent on this machine, read from its own transcripts (GET /api/claude-usage):
// the terminal, the desktop app and the village's agents. One big score = fresh input + cache write +
// cache read + output, each token once (cache reads are not also counted as input).

import { useEffect, useState } from 'react'

interface Counts { input: number; cacheWrite: number; cacheRead: number; output: number }
interface Summary {
  today: Counts
  week: Counts
  allTime: Counts
  firstDay: string | null
  indexing: boolean
  progress: { done: number; total: number }
}

const total = (c: Counts) => c.input + c.cacheWrite + c.cacheRead + c.output

export function formatTokenCount(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 1 : 2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(Math.round(value))
}

function Breakdown({ c }: { c: Counts }) {
  const parts: Array<[string, number, string]> = [
    ['in', c.input, 'Fresh input tokens (not from the cache)'],
    ['write', c.cacheWrite, 'Cache write: input stored in the prompt cache'],
    ['read', c.cacheRead, 'Cache read: input served from the prompt cache'],
    ['out', c.output, 'Output tokens, thinking included'],
  ]
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-white/55">
      {parts.map(([label, value, title]) => (
        <span key={label} title={title}>{label} <span className="text-white/80">{formatTokenCount(value)}</span></span>
      ))}
    </div>
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

  if (!summary || (!total(summary.allTime) && !summary.indexing)) return null
  const since = summary.firstDay ? new Date(`${summary.firstDay}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  return (
    <div className="border-b border-white/10 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Tokens · Claude Code</p>
        {summary.indexing && <span className="text-[10px] text-white/45">counting {summary.progress.done}/{summary.progress.total}…</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-2" title={`${total(summary.allTime).toLocaleString()} tokens`}>
        <span className="text-[30px] font-black leading-none text-white" style={{ textShadow: '0 0 18px rgba(251,191,36,0.45)' }}>
          {formatTokenCount(total(summary.allTime))}
        </span>
        <span className="text-[11px] text-white/55">tokens{since ? ` since ${since}` : ''}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {([['Today', summary.today], ['7 days', summary.week], ['All time', summary.allTime]] as const).map(([label, c]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-amber-200/80">{label}</span>
              <span className="font-mono text-sm font-bold text-white">{formatTokenCount(total(c))}</span>
            </div>
            <Breakdown c={c} />
          </div>
        ))}
      </div>
    </div>
  )
}
