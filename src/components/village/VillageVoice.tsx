'use client'

// ░▒▓ VILLAGE VOICE — an agent says its reply's spoken line when the owner opens it, once per reply ▓▒░
// Mounted with the village. Every agent's reply ends with a <spoken> line (village-spoken.ts), but nobody speaks
// unasked: several agents may walk up at once. The line of an agent's latest reply waits until the owner opens
// that agent with E or F (its panel or its full screen) and is said then, once (village-companion.ts keeps which
// replies were heard). A reply that comes in while the agent is open is said right away. So the owner can go
// from agent to agent and hear each. The clip is made when he walks up to an agent (its T/E/F prompt shows),
// so it starts the moment he opens it.
// Nothing is said, or generated, while: the HUD's speaker is muted, or a Council is on (there the moderator
// says whose turn it is; a member's line is kept for it). T opens an agent with the microphone on: then the
// line is not played over his dictation, it stays for the next E or F.

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { pendingSpoken, splitSpoken } from '../../lib/village/village-spoken'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { isVillageVoiceRequested } from './village-actions'
import {
  getAgentVoiceSettings,
  getVillageSpeechDebug,
  isVillageReplyHeard,
  isVillageVoiceOn,
  markVillageReplyHeard,
  speakVillageAgent,
  stopVillageSpeech,
  warmVillageSpeech,
} from './village-companion'
import { getCouncilStatus, isCouncilMember, isCouncilOn, noteVillageEngineConnected, noteVillageWorldChanged, offerCouncilLine, runCouncilRequest, type CouncilRequest } from './village-council'

/** A reply older than this that lands while the agent is open is the past (a backlog after a reconnect). */
const FRESH_MS = 20_000

const keyOf = (agent: Pick<EngineAgentState, 'id' | 'sessionId'>) => agent.sessionId || agent.id

/** The line of this agent's latest reply, if the owner has not heard it yet. */
function unheard(agent: EngineAgentState): { text: string; ts: number } | null {
  const pending = pendingSpoken(agent.log)
  return pending && !isVillageReplyHeard(keyOf(agent), pending.ts) ? pending : null
}

/** The owner opened this agent (or a reply came in while it is open): say its unheard line, once. */
function sayUnheard(agent: EngineAgentState): boolean {
  if (!isVillageVoiceOn() || isCouncilOn()) return false
  const pending = unheard(agent)
  if (!pending) return false
  markVillageReplyHeard(keyOf(agent), pending.ts)
  // Opening an agent is the owner's own key press or click, so it may unlock the page's sound.
  void speakVillageAgent(agent.id, pending.text, getAgentVoiceSettings(keyOf(agent), agent.name, agent.voiceChoice), true)
  return true
}

export function VillageVoice() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // Dev: window.__oasisVillageVoice.say('a0', 'Hello') plays a line from that agent; .debug() says what happened;
      // .pending('a0') is the line that waits for the owner to open that agent.
      ;(window as unknown as Record<string, unknown>).__oasisVillageVoice = {
        say: (agentId: string, text: string, voice?: string) => {
          const agent = useOasisStore.getState().agentEngine.agents[agentId]
          const settings = getAgentVoiceSettings(agent?.sessionId || agentId, agent?.name, agent?.voiceChoice)
          return speakVillageAgent(agentId, text, voice ? { ...settings, voice } : settings, true)
        },
        stop: () => stopVillageSpeech(),
        debug: () => getVillageSpeechDebug(),
        pending: (agentId: string) => {
          const agent = useOasisStore.getState().agentEngine.agents[agentId]
          return agent ? unheard(agent)?.text ?? null : null
        },
      }
    }
    // The Council's stage: the engine sends this page the moderator's steps (village-council.ts).
    const unstage = getAgentEngineClient().setStageHandler(request => runCouncilRequest(request as CouncilRequest))
    // A Council started under an engine that has since restarted has nobody left to end it (village-council.ts).
    let connectedAt = useOasisStore.getState().agentEngine.connection.connectedAt
    const unwatchEngine = useOasisStore.subscribe(state => {
      const at = state.agentEngine.connection.connectedAt
      if (at === connectedAt) return
      connectedAt = at
      if (state.agentEngine.connection.status === 'open') noteVillageEngineConnected()
    })
    // The owner went through a portal (or picked another world): a Council is tied to the world it was set in.
    let worldId = useOasisStore.getState().viewingWorldId || useOasisStore.getState().activeWorldId
    const unwatchWorld = useOasisStore.subscribe(state => {
      const now = state.viewingWorldId || state.activeWorldId
      if (now === worldId) return
      worldId = now
      noteVillageWorldChanged()
    })
    if (process.env.NODE_ENV !== 'production') {
      // Dev: window.__oasisCouncil.run({ action: 'start', agentIds: ['a0', 'a1'] }) without an engine; .status()
      ;(window as unknown as Record<string, unknown>).__oasisCouncil = { run: (request: CouncilRequest) => runCouncilRequest(request), status: () => getCouncilStatus() }
    }
    const unsubscribe = useOasisStore.subscribe((state, prev) => {
      const engine = state.agentEngine
      const before = prev.agentEngine
      if (engine === before) return

      // The owner opened an agent (E, F, a click that opens it): it says its unheard line.
      // Not when T opened it with the microphone on: its voice would land in his dictation.
      if (engine.focusedAgentId && engine.focusedAgentId !== before.focusedAgentId) {
        const agent = engine.agents[engine.focusedAgentId]
        if (agent && !isVillageVoiceRequested(agent.id)) sayUnheard(agent)
      }
      // He walks up to an agent (its prompt shows): make the clip now, so it starts the moment he opens it.
      if (engine.nearbyAgentId && engine.nearbyAgentId !== before.nearbyAgentId) {
        const agent = engine.agents[engine.nearbyAgentId]
        const pending = agent ? unheard(agent) : null
        if (agent && pending) warmVillageSpeech(pending.text, getAgentVoiceSettings(keyOf(agent), agent.name, agent.voiceChoice))
      }

      if (engine.agents === before.agents) return
      for (const id of engine.order) {
        const agent = engine.agents[id]
        const was = before.agents[id]
        if (!agent || !was || agent === was || agent.log === was.log) continue
        // A finished reply just landed in the thread.
        const last = agent.log[agent.log.length - 1]
        if (!last || last === was.log[was.log.length - 1] || last.type !== 'text' || last.parentToolUseId || last.history) continue
        if (Date.now() - last.ts > FRESH_MS) continue
        const spoken = splitSpoken(last.text).spoken
        if (!spoken) continue
        if (isCouncilOn()) {
          // One voice at a time, and the moderator says whose: a member's line is kept for its turn (`speak next`).
          if (isCouncilMember(id)) {
            markVillageReplyHeard(keyOf(agent), last.ts)
            offerCouncilLine(id, spoken)
          }
          continue
        }
        // The owner is with this agent (its panel or screen is open): he hears the reply as it lands.
        if (engine.focusedAgentId === id) sayUnheard(agent)
      }
    })
    return () => {
      unsubscribe()
      unstage()
      unwatchEngine()
      unwatchWorld()
      stopVillageSpeech()
    }
  }, [])
  return null
}
