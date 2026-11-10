'use client'

// Eyes switch for an owned agent, next to the model, mode and thinking pickers in the session panel.
// On: each message you send carries a wide picture from the agent's own desk (VillageEyes.tsx takes it,
// the engine attaches it). Kept per agent in the engine's roster; on by default for Anorak.

import { useState } from 'react'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'

export function EyesToggle({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  if (!agent.owned) return null
  const on = agent.eyes === true
  const label = on
    ? 'Eyes on: each message you send carries a picture of what this agent sees from its desk. Click to turn off.'
    : 'Eyes off. Click to send a picture of what this agent sees from its desk with each of your messages.'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        getAgentEngineClient()
          .setEyes(agent.id, !on)
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            showNotice(/unknown command/i.test(message)
              ? 'This agent engine is older than eyes: restart it (pnpm dev:engine) to switch them on.'
              : `Eyes switch failed: ${message}`, 'error')
          })
          .finally(() => setBusy(false))
      }}
      onKeyDown={event => event.stopPropagation()}
      className={`flex h-[22px] w-[26px] items-center justify-center rounded border disabled:opacity-50 ${on
        ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-200'
        : 'border-white/15 bg-black/50 text-white/45 hover:text-white/80'}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" fill={on ? 'currentColor' : 'none'} />
        {!on && <path d="M4 4l16 16" />}
      </svg>
    </button>
  )
}
