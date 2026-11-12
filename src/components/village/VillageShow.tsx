'use client'

// ░▒▓ VILLAGE SHOW — /oasis in a Claude Code session puts that session in front of the owner ▓▒░
// Two ways in, both from the Oasis plugin's /oasis command (plugins/oasis/hooks/register.ts):
//   - the page is already open: the engine sends `show` over its socket (POST /bridge/open);
//   - the page was just opened with ?session=<id>: find that session's agent, or start watching its
//     transcript if nothing in the village has it yet.
// Either way the camera walks to the agent, exactly like clicking it in the Agents menu.

import { useEffect } from 'react'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { sessionToShow, withoutSession } from '../../lib/village/village-show'
import { useOasisStore } from '../../store/oasisStore'
import { focusVillageAgent } from './village-actions'

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

export function VillageShow() {
  useEffect(() => {
    let cancelled = false
    const client = getAgentEngineClient()

    // The agent may arrive a moment before its desk does: try for a few seconds.
    const focusWhenPlaced = async (agentId: string) => {
      for (let i = 0; i < 24 && !cancelled; i += 1) {
        if (focusVillageAgent(agentId)) return
        await sleep(250)
      }
    }
    const unsubscribe = client.onShow(agentId => { void focusWhenPlaced(agentId) })

    const sessionId = sessionToShow(window.location.search)
    if (sessionId) {
      void (async () => {
        const engine = () => useOasisStore.getState().agentEngine
        for (let i = 0; i < 120 && !cancelled && engine().connection.status !== 'open'; i += 1) await sleep(250)
        if (cancelled || engine().connection.status !== 'open') return
        window.history.replaceState(null, '', `${window.location.pathname}${withoutSession(window.location.search)}${window.location.hash}`)
        const known = () => Object.values(engine().agents).find(agent => agent.sessionId?.toLowerCase() === sessionId)
        let agentId = known()?.id
        if (!agentId) {
          try {
            const sessions = await client.listSessions()
            const session = sessions.find(s => s.sessionId.toLowerCase() === sessionId)
            if (session) agentId = known()?.id || (await client.observe(session.path)).id
          } catch {
            return // the engine went away; nothing to show
          }
        }
        if (agentId && !cancelled) await focusWhenPlaced(agentId)
      })()
    }

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return null
}
