'use client'

// Thinking effort picker for an owned agent, next to the model and mode pickers in the session panel.
// The engine switches it live (apply_flag_settings): no restart, no turn.

import { useState } from 'react'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { effortLevelsFor } from '../../lib/village/village-effort'
import { showNotice } from '../forge/GlobalNotice'
import { KitSelectField } from '@/components/ui-kit'

export function EffortSelect({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  // A Hermes agent has no effort setting (engine hermes.js refuses setEffort).
  if (!agent.owned || agent.runtime === 'hermes') return null
  const levels = effortLevelsFor(agent)
  if (!levels.length && !agent.effort) return null // this model has no effort setting
  const current = agent.effort || ''
  return (
    <KitSelectField
      label="Thinking"
      title="How hard the model thinks before it answers. Changes right away, no restart."
        value={current}
        disabled={busy}
        onChange={event => {
          const effort = event.target.value || null
          setBusy(true)
          getAgentEngineClient()
            .setEffort(agent.id, effort)
            .catch(error => {
              const message = error instanceof Error ? error.message : String(error)
              showNotice(/unknown command/i.test(message)
                ? 'This agent engine is older than the thinking switch: restart it (pnpm dev:engine) to change thinking levels.'
                : `Thinking switch failed: ${message}`, 'error')
            })
            .finally(() => setBusy(false))
        }}
        onKeyDown={event => event.stopPropagation()}
      >
        <option value="">{`default${agent.resolvedEffort && !agent.effort ? ` (${agent.resolvedEffort})` : ''}`}</option>
        {levels.map(level => <option key={level} value={level}>{level}</option>)}
        {current && !levels.includes(current) && <option value={current}>{current}</option>}
    </KitSelectField>
  )
}
