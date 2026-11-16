'use client'

// ░▒▓ VILLAGE VOICE — a voiced agent's avatar says the reply's spoken line as soon as the line is written ▓▒░
// Mounted with the village. Watches the engine state and takes the <spoken> line (village-spoken.ts) at the
// earliest of three moments: its closing tag arrives in the text still streaming in; the finished reply lands in
// the thread; the turn ends (the fallback). The clip is asked for right then (village-companion.ts), so the voice
// starts about as long after the line as ElevenLabs takes to make it, instead of waiting for the turn to close.
// An agent that comes to the owner when it needs them ("Come to me", on by default) carries the line with it
// and says it on arrival. Nothing is said, or generated, when: the agent's Voice switch is off, the HUD's speaker is muted, the tab is
// hidden, or the reply is older than a moment (a reload or a reconnect must not replay old replies).

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { splitSpoken, spokenForLastTurn, spokenInStream } from '../../lib/village/village-spoken'
import { getAgentVoiceSettings, getVillageSpeechDebug, holdVillageArrivalLine, isVillageArrived, isVillageComeOn, isVillageFollowOn, isVillageVoiceOn, speakVillageAgent, stopVillageSpeech } from './village-companion'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { getCouncilStatus, isCouncilMember, isCouncilOn, offerCouncilLine, runCouncilRequest, type CouncilRequest } from './village-council'

/** A reply older than this is the past (backlog after a reload), not something to say now. */
const FRESH_MS = 20_000
/** The same line from the same agent is not said twice within this (stream, thread and turn end all see it). */
const SAME_LINE_MS = 60_000

export function VillageVoice() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      // Dev: window.__oasisVillageVoice.say('a0', 'Hello') plays a line from that agent; .debug() says what happened.
      ;(window as unknown as Record<string, unknown>).__oasisVillageVoice = {
        say: (agentId: string, text: string, voice?: string) => {
          const agent = useOasisStore.getState().agentEngine.agents[agentId]
          const settings = getAgentVoiceSettings(agent?.sessionId || agentId, agent?.name, agent?.voiceChoice)
          return speakVillageAgent(agentId, text, voice ? { ...settings, voice } : settings, true)
        },
        stop: () => stopVillageSpeech(),
        debug: () => getVillageSpeechDebug(),
      }
    }
    // The Council's stage: the engine sends this page the moderator's steps (village-council.ts).
    const unstage = getAgentEngineClient().setStageHandler(request => runCouncilRequest(request as CouncilRequest))
    if (process.env.NODE_ENV !== 'production') {
      // Dev: window.__oasisCouncil.run({ action: 'start', agentIds: ['a0', 'a1'] }) without an engine; .status()
      ;(window as unknown as Record<string, unknown>).__oasisCouncil = { run: (request: CouncilRequest) => runCouncilRequest(request), status: () => getCouncilStatus() }
    }
    const said = new Map<string, { text: string; at: number }>()
    const unsubscribe = useOasisStore.subscribe((state, prev) => {
      const engine = state.agentEngine
      const before = prev.agentEngine
      if (engine === before || engine.agents === before.agents) return
      for (const id of engine.order) {
        const agent = engine.agents[id]
        const was = before.agents[id]
        if (!agent || !was || agent === was || agent.speak !== true) continue
        const now = Date.now()
        let spoken: string | null = null
        // 1. The line is complete in the text that is still streaming in.
        if (agent.live && agent.live.text !== was.live?.text) spoken = spokenInStream(agent.live.text)
        // 2. The finished reply just landed in the thread.
        if (!spoken && agent.log !== was.log) {
          const last = agent.log[agent.log.length - 1]
          if (last && last !== was.log[was.log.length - 1] && last.type === 'text' && !last.parentToolUseId && !last.history && now - last.ts <= FRESH_MS) {
            spoken = splitSpoken(last.text).spoken
          }
        }
        // 3. The turn ended.
        const turn = agent.lastTurn
        if (!spoken && turn && turn.ts !== was.lastTurn?.ts && now - turn.ts <= FRESH_MS) spoken = spokenForLastTurn(agent.log)
        if (!spoken) continue
        const earlier = said.get(id)
        if (earlier && earlier.text === spoken && now - earlier.at < SAME_LINE_MS) continue
        // A Council is on: one voice at a time, and the moderator says whose. A member's line is kept for its
        // turn (`speak next`); nobody else speaks until it is over.
        if (isCouncilOn()) {
          said.set(id, { text: spoken, at: now })
          if (isCouncilMember(id)) offerCouncilLine(id, spoken)
          continue
        }
        if (!isVillageVoiceOn() || document.visibilityState !== 'visible') continue
        said.set(id, { text: spoken, at: now })
        const key = agent.sessionId || id
        const settings = getAgentVoiceSettings(key, agent.name, agent.voiceChoice)
        // An agent that walks up to the owner when it needs them says its line when it gets there, not from
        // its desk: the line waits (and its clip is made) while it walks. Said at once when the agent is with
        // the owner already (it follows them, it stands in front of them, its panel is open).
        const withOwner = isVillageFollowOn(key, agent.name) || isVillageArrived(id) || engine.focusedAgentId === id
        if (!withOwner && isVillageComeOn(key) && getPlayerAvatarPose()) holdVillageArrivalLine(id, spoken, settings)
        else void speakVillageAgent(id, spoken, settings)
      }
    })
    return () => {
      unsubscribe()
      unstage()
      stopVillageSpeech()
    }
  }, [])
  return null
}
