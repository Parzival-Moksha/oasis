'use client'

// Claude in Chrome switch for an owned agent, next to the eyes switch in the session panel.
// On: the agent can use the owner's real Chrome (the Claude in Chrome extension: logged-in sites,
// uploads), and every browser action asks first (a decision card), whatever mode the agent runs in.
// The CLI only reads it at start: the agent restarts with the same session (now when idle, after the
// running turn otherwise). Off by default; kept per agent in the engine's roster (engine chrome.js).

import { useState } from 'react'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'

const APPLIED: Record<string, string> = {
  now: 'it restarts now (same session)',
  'after this turn': 'it restarts after the running turn (same session)',
  'on next start': 'from its next start',
}

export function ChromeToggle({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  if (!agent.owned) return null
  const on = agent.chrome === true
  const label = on
    ? 'Chrome on: this agent can use your Chrome through the Claude in Chrome extension, under its permission mode like your other sessions. Click to turn off (restarts it).'
    : 'Chrome off. Click to let this agent use your Chrome (Claude in Chrome extension), under its permission mode like your other sessions. It restarts with the same session.'
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
          .setChrome(agent.id, !on)
          .then(result => {
            const applied = result?.data?.applied
            if (applied && applied !== 'unchanged') showNotice(`Chrome ${!on ? 'on' : 'off'} for ${agent.name}: ${APPLIED[applied] || applied}.`, 'info')
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            showNotice(/unknown command/i.test(message)
              ? 'This agent engine is older than the Chrome switch: restart it (pnpm dev:engine) first.'
              : `Chrome switch failed: ${message}`, 'error')
          })
          .finally(() => setBusy(false))
      }}
      onKeyDown={event => event.stopPropagation()}
      className={`flex h-[22px] items-center gap-1 rounded border px-1.5 text-[10.5px] disabled:opacity-50 ${on
        ? 'border-sky-300/60 bg-sky-400/20 text-sky-100'
        : 'border-white/15 bg-black/50 text-white/45 hover:text-white/80'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.5" fill={on ? 'currentColor' : 'none'} />
        <path d="M12 8.5h8.2M9 13.8 5 6.6M15 13.8l-4.2 7.3" />
      </svg>
      chrome
    </button>
  )
}
