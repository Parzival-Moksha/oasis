'use client'

// The Claude account of one agent, next to its model, mode and thinking pickers in the session panel (engine
// accounts.js). "auto" follows the village (Settings > Agents > Claude accounts); a pick pins this agent. It moves at
// once when idle, else before its next turn. The label shows which account its process runs on right now.

import { useOasisStore } from '../../store/oasisStore'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { accountChoices, shownAccounts } from '../../lib/village/village-accounts'
import { showNotice } from '../forge/GlobalNotice'

export function AccountSelect({ agent }: { agent: Pick<EngineAgentState, 'id' | 'owned' | 'account' | 'accountPin' | 'parked'> }) {
  const view = useOasisStore(s => s.agentEngine.connection.server?.accounts || null)
  if (!agent.owned || !view || shownAccounts(view).length < 2) return null
  const choices = accountChoices(view)
  const running = agent.account?.label || 'none yet'
  const title = agent.parked
    ? `Every account is out of usage: it waits${agent.parked.until ? ` until ${new Date(agent.parked.until).toTimeString().slice(0, 5)}` : ''}, then goes on by itself.`
    : `Its process runs on ${running}. "auto" follows the village; a pick pins this agent (it moves to another account only when that one is out).`
  return (
    <label className="flex items-center gap-1" title={title} data-agent-account={agent.account?.id || ''}>
      account
      <select
        value={agent.accountPin || 'auto'}
        onChange={event => {
          const value = event.target.value
          getAgentEngineClient().setAccount(agent.id, value === 'auto' ? null : value).catch(error => showNotice(`Account switch failed: ${error instanceof Error ? error.message : String(error)}`, 'error'))
        }}
        onKeyDown={event => event.stopPropagation()}
        className="max-w-[130px] rounded border border-white/15 bg-black/50 px-1 py-0.5 text-[11px] text-white"
      >
        {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.value === 'auto' ? `auto · ${running}` : choice.label}</option>)}
      </select>
    </label>
  )
}
