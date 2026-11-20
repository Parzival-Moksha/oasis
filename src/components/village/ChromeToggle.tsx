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
import { KitToggle } from '@/components/ui-kit'

const APPLIED: Record<string, string> = {
  now: 'it restarts now (same session)',
  'after this turn': 'it restarts after the running turn (same session)',
  'on next start': 'from its next start',
}

export function ChromeToggle({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  // Claude in Chrome is a Claude Code feature: a Hermes agent has none.
  if (!agent.owned || agent.runtime === 'hermes') return null
  const on = agent.chrome === true
  const label = on
    ? 'Chrome on: this agent can use your Chrome through the Claude in Chrome extension, under its permission mode like your other sessions. Click to turn off (restarts it).'
    : 'Chrome off. Click to let this agent use your Chrome (Claude in Chrome extension), under its permission mode like your other sessions. It restarts with the same session.'
  return (
    <KitToggle
      checked={on}
      disabled={busy}
      label="Chrome"
      hint={label}
      onChange={() => {
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
    />
  )
}
