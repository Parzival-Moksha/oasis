'use client'

// Eyes switch for an owned agent, next to the model, mode and thinking pickers in the session panel.
// On: each message you send carries a wide picture from the agent's own desk (VillageEyes.tsx takes it,
// the engine attaches it). Kept per agent in the engine's roster; on by default for Anorak.

import { useState } from 'react'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import { KitToggle } from '@/components/ui-kit'

export function EyesToggle({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  if (!agent.owned) return null
  const on = agent.eyes === true
  const label = on
    ? 'Eyes on: each message you send carries a picture of what this agent sees from its desk. Click to turn off.'
    : 'Eyes off. Click to send a picture of what this agent sees from its desk with each of your messages.'
  return (
    <KitToggle
      checked={on}
      disabled={busy}
      label="Eyes"
      hint={label}
      onChange={() => {
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
    />
  )
}
