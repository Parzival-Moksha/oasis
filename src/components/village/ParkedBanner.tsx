'use client'

// The banner of an agent that waits because every Claude account is out of usage (engine accounts.js: `parked`).
// For someone with one account this is the whole story, so it is large and plain, at the top of the agent's panel,
// desk window and screen: why it waits, when it goes on, and that it does so by itself. The owner read the small
// line under the name as "failed" (19 Nov, the packaged Oasis's walk-through, 35:50).

import type { EngineAgentState } from '../../store/slices/agentEngineSlice'

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** "at 13:20", "tomorrow at 08:00", "on Sat at 08:00". */
export function whenText(until: number, now = Date.now()): string {
  const d = new Date(until)
  const n = new Date(now)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(d) - day(n)) / 86_400_000)
  if (days <= 0) return `at ${clock(until)}`
  if (days === 1) return `tomorrow at ${clock(until)}`
  return `on ${d.toLocaleDateString('en', { weekday: 'short' })} at ${clock(until)}`
}

export function ParkedBanner({ agent, compact = false }: { agent: Pick<EngineAgentState, 'parked' | 'name'>; compact?: boolean }) {
  if (!agent.parked) return null
  const until = agent.parked.until
  return (
    <div
      role="status"
      data-agent-parked
      className={`shrink-0 rounded-lg border border-amber-300/50 bg-amber-400/15 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'} text-amber-50`}
    >
      <div className={`${compact ? 'text-[13px]' : 'text-[16px]'} font-bold leading-snug`}>
        Waiting: your Claude usage is used up for now.
      </div>
      <div className={`${compact ? 'text-[11.5px]' : 'text-[13px]'} mt-0.5 leading-snug text-amber-50/90`}>
        {until
          ? <>It carries on by itself {whenText(until)}, when the usage resets. Nothing is lost: messages you send now wait and go out then.</>
          : <>It carries on by itself as soon as an account has usage again. Nothing is lost: messages you send now wait and go out then.</>}
      </div>
    </div>
  )
}
