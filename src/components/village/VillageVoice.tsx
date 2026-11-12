'use client'

// ░▒▓ VILLAGE VOICE — when a voiced agent's turn ends, its avatar says the reply's spoken line ▓▒░
// Mounted with the village. Watches the engine state for a turn that just ended (live, not replayed
// history), takes the <spoken> line of that turn's last reply (village-spoken.ts) and plays it from
// the avatar (village-companion.ts). Nothing is said, or generated, when: the agent's Voice switch is
// off, the HUD's speaker is muted, the tab is hidden, or the turn ended more than a moment ago
// (a reload or a reconnect must not replay old replies).

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { spokenForLastTurn, villageVoiceFor } from '../../lib/village/village-spoken'
import { getVillageSpeechDebug, isVillageVoiceOn, speakVillageAgent, stopVillageSpeech } from './village-companion'

/** A turn end older than this is the past (backlog after a reload), not something to say now. */
const FRESH_MS = 20_000

export function VillageVoice() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // Dev: window.__oasisVillageVoice.say('a0', 'Hello') plays a line from that agent; .debug() says what happened.
      ;(window as unknown as Record<string, unknown>).__oasisVillageVoice = {
        say: (agentId: string, text: string, voice?: string) => {
          const agent = useOasisStore.getState().agentEngine.agents[agentId]
          return speakVillageAgent(agentId, text, voice || villageVoiceFor(agent?.name), true)
        },
        stop: () => stopVillageSpeech(),
        debug: () => getVillageSpeechDebug(),
      }
    }
    const unsubscribe = useOasisStore.subscribe((state, prev) => {
      const engine = state.agentEngine
      const before = prev.agentEngine
      if (engine === before || engine.agents === before.agents) return
      for (const id of engine.order) {
        const agent = engine.agents[id]
        const was = before.agents[id]
        if (!agent || !was || agent === was) continue
        const turn = agent.lastTurn
        if (!turn || turn.ts === was.lastTurn?.ts) continue
        if (agent.speak !== true || !isVillageVoiceOn()) continue
        if (document.visibilityState !== 'visible' || Date.now() - turn.ts > FRESH_MS) continue
        const spoken = spokenForLastTurn(agent.log)
        if (spoken) void speakVillageAgent(id, spoken, villageVoiceFor(agent.name))
      }
    })
    return () => {
      unsubscribe()
      stopVillageSpeech()
    }
  }, [])
  return null
}
