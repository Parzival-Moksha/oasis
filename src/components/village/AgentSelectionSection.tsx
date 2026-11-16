'use client'

// The agent settings menu's "Selected" section: which effect this agent wears while selected,
// and the way back to its desk after it was sent somewhere.

import { useSyncExternalStore } from 'react'
import {
  SELECTION_FX,
  clearSentGoal,
  getAgentSelectionFx,
  getAgentSelectionVersion,
  getSentGoalSeq,
  selectVillageAgent,
  setAgentSelectionFx,
  subscribeAgentSelection,
} from '@/lib/village/agent-selection'

export function AgentSelectionSection({ agentId, agentKey, name }: { agentId: string; agentKey: string; name: string }) {
  useSyncExternalStore(subscribeAgentSelection, getAgentSelectionVersion, () => 0)
  const fx = getAgentSelectionFx(agentKey)
  const sent = getSentGoalSeq(agentId) !== 0
  return (
    <div className="mb-3" data-agent-selection-fx={fx}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Selected · {name}</div>
      <div className="mb-1 text-[10px] leading-snug text-white/45">
        Click it in the world to select it; a right-click on the ground sends it there. This is what it wears while selected.
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={fx}
          aria-label="Selection effect"
          title={SELECTION_FX.find(option => option.id === fx)?.blurb}
          onChange={event => {
            setAgentSelectionFx(agentKey, event.target.value as typeof fx)
            selectVillageAgent(agentId) // show it at once
          }}
          className="min-w-0 flex-1 rounded border border-white/15 bg-black/60 px-1 py-1 text-[11px] text-white"
        >
          {SELECTION_FX.map(option => <option key={option.id} value={option.id}>{option.label} · {option.blurb}</option>)}
        </select>
        {sent && (
          <button
            type="button"
            data-agent-back-to-desk
            title="It was sent somewhere with a right-click: walk back to the desk"
            onClick={() => clearSentGoal(agentId)}
            className="shrink-0 rounded border border-white/20 bg-white/5 px-2 py-1 text-[10.5px] font-bold text-white transition hover:bg-white/15"
          >
            Back to desk
          </button>
        )}
      </div>
    </div>
  )
}
