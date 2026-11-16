'use client'

// ░▒▓ VILLAGE VOICE — a voiced agent's avatar says the reply's spoken line as soon as the line is written ▓▒░
// Mounted with the village. Watches the engine state and takes the <spoken> line (village-spoken.ts) at the
// earliest of three moments: its closing tag arrives in the text still streaming in; the finished reply lands in
// the thread; the turn ends (the fallback). The clip is asked for right then (village-companion.ts), so the voice
// starts about as long after the line as ElevenLabs takes to make it, instead of waiting for the turn to close.
// Nothing is said, or generated, when: the agent's Voice switch is off, the HUD's speaker is muted, the tab is
// hidden, or the reply is older than a moment (a reload or a reconnect must not replay old replies).

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { splitSpoken, spokenForLastTurn, spokenInStream, villageVoiceFor } from '../../lib/village/village-spoken'
import { getVillageSpeechDebug, isVillageVoiceOn, speakVillageAgent, stopVillageSpeech } from './village-companion'

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
          return speakVillageAgent(agentId, text, voice || villageVoiceFor(agent?.name), true)
        },
        stop: () => stopVillageSpeech(),
        debug: () => getVillageSpeechDebug(),
      }
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
        if (!isVillageVoiceOn() || document.visibilityState !== 'visible') continue
        said.set(id, { text: spoken, at: now })
        void speakVillageAgent(id, spoken, villageVoiceFor(agent.name))
      }
    })
    return () => {
      unsubscribe()
      stopVillageSpeech()
    }
  }, [])
  return null
}
