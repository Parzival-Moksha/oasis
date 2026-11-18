'use client'

// Two switches in the session panel, next to eyes and Chrome, and the play button on a spoken reply.
//   Follow me: the agent's avatar leaves its desk and walks beside you (lib/village/village-follow.ts).
//     Remembered per session in this browser; on by default for Anorak. Off sends it back to its desk.
//   Voice: each reply ends with a short line the avatar says out loud with an ElevenLabs voice
//     (lib/village/village-spoken.ts). Kept per agent in the engine's roster; on by default for Anorak
//     only, because every new line costs ElevenLabs credits. Which voice and how fast: the agent's settings
//     menu (AgentSettingsMenu.tsx).

import { createContext, useContext, useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import type { EngineAgentState } from '../../store/slices/agentEngineSlice'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import { showNotice } from '../forge/GlobalNotice'
import { SpokenPlayer } from './SpokenPlayer'
import { pressVillageFollow, useVillageFollowView } from './follow-view'
import {
  getVillageFollowVersion,
  getAgentVoiceSettings,
  getVillageSpeech,
  isVillageFollowOn,
  setVillageFollow,
  speakVillageAgent,
  stopVillageSpeech,
  subscribeVillageFollow,
  subscribeVillageSpeech,
} from './village-companion'

/**
 * Space and Enter press a switch, so the world must not take them as well; every other key goes on (Esc closes
 * the panel, T talks, F full screen). A switch used to swallow them all, so Esc after a click did nothing, and an
 * agent whose panel stayed open stood still (2026-11-18: "you stopped following me").
 */
function keepButtonKeys(event: { key: string; stopPropagation: () => void }): void {
  if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
}

const SWITCH_CLASS = 'flex h-[22px] items-center gap-1 rounded border px-1.5 text-[10.5px] disabled:opacity-50'
const OFF_CLASS = 'border-white/15 bg-black/50 text-white/45 hover:text-white/80'

export function FollowToggle({ agent }: { agent: Pick<EngineAgentState, 'id' | 'name' | 'sessionId'> }) {
  const key = agent.sessionId || agent.id
  // What Follow really does now: on, off, or on but held where it is by an order or the Council (follow-view.ts).
  const view = useVillageFollowView(agent.id, key, agent.name)
  const on = view !== 'off'
  const label = view === 'parked'
    ? 'Follow me is on, but this agent was sent to a spot (a right-click while it was selected) and waits there. Click to have it follow you again.'
    : view === 'council'
      ? "Follow me is on; it stands in the Council's circle until the Council ends, then it follows you again."
      : on
        ? 'Follow me on: this agent walks beside you (it comes along when you are more than 7 m away and steps aside when you get close). Click to send it back to its desk (it goes once this panel is closed).'
        : 'Follow me off: it stays at its desk. Click to have this agent walk beside you.'
  const held = view === 'parked' || view === 'council'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-village-follow={view}
      onClick={event => { pressVillageFollow(agent.id, key, agent.name); event.currentTarget.blur() }}
      onKeyDown={keepButtonKeys}
      className={`${SWITCH_CLASS} ${held ? 'border-amber-300/60 border-dashed bg-transparent text-amber-200/90' : on ? 'border-amber-300/60 bg-amber-400/20 text-amber-100' : OFF_CLASS}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="13" cy="4.5" r="2" fill={on ? 'currentColor' : 'none'} />
        <path d="M13 8l-3 4 3 3v6M10 12l-4 1M13 10l4 2M10 15l-3 6" />
      </svg>
      {view === 'parked' ? 'parked' : view === 'council' ? 'council' : 'follow'}
    </button>
  )
}

export function VoiceToggle({ agent }: { agent: EngineAgentState }) {
  const [busy, setBusy] = useState(false)
  if (!agent.owned) return null
  // null: the engine was started before this switch existed.
  const known = agent.speak !== null
  const on = agent.speak === true
  const label = !known
    ? 'Voice needs a newer agent engine: restart it (pnpm dev:engine), then this agent can say a short version of each reply out loud.'
    : on
      ? 'Voice on: each reply ends with a short line this agent says out loud (ElevenLabs, costs a little per reply). Click to turn off.'
      : 'Voice off. Click to have this agent say a short version of each reply out loud (ElevenLabs, costs a little per reply).'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-village-voice={on ? 'on' : known ? 'off' : 'unknown'}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        getAgentEngineClient()
          .setSpeak(agent.id, !on)
          .then(() => { if (on) stopVillageSpeech() })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error)
            showNotice(/unknown command/i.test(message)
              ? 'This agent engine is older than the Voice switch: restart it (pnpm dev:engine) first.'
              : `Voice switch failed: ${message}`, /unknown command/i.test(message) ? 'warn' : 'error')
          })
          .finally(() => setBusy(false))
      }}
      onKeyUp={event => event.currentTarget.blur()}
      onMouseUp={event => event.currentTarget.blur()}
      onKeyDown={keepButtonKeys}
      className={`${SWITCH_CLASS} ${on ? 'border-fuchsia-300/60 bg-fuchsia-400/20 text-fuchsia-100' : OFF_CLASS} ${known ? '' : 'opacity-60'}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9H4Z" fill={on ? 'currentColor' : 'none'} />
        {on ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9.5l4 5M21 9.5l-4 5" />}
      </svg>
      voice
    </button>
  )
}

/** The agent whose thread is being drawn (AgentSessionView provides it), so a reply knows whose voice it is. */
export const SpokenAgentContext = createContext<string | null>(null)

/** A reply's spoken line in the thread: its player, in that agent's voice. */
export function SpokenReply({ spoken }: { spoken: string }) {
  const agentId = useContext(SpokenAgentContext)
  const name = useOasisStore(s => (agentId ? s.agentEngine.agents[agentId]?.name ?? null : null))
  const sessionId = useOasisStore(s => (agentId ? s.agentEngine.agents[agentId]?.sessionId ?? null : null))
  const own = useOasisStore(s => (agentId ? s.agentEngine.agents[agentId]?.voiceChoice ?? null : null))
  if (!agentId) return null
  // A player: play and pause, seek, speed, and the whole line with the word being said lit (SpokenPlayer.tsx).
  return <SpokenPlayer agentId={agentId} agentKey={sessionId || agentId} agentName={name} own={own} spoken={spoken} />
}

/** Under a reply that has a spoken line: hear it (again). Cached by its text, so a replay costs nothing. */
export function SpokenPlayButton({ agentId, agentKey, agentName, own = null, spoken }: { agentId: string; agentKey: string; agentName: string | null; own?: string | null; spoken: string }) {
  const speech = useSyncExternalStore(subscribeVillageSpeech, getVillageSpeech, () => null)
  const mine = speech?.agentId === agentId && speech.text === spoken
  const loading = mine && speech?.phase === 'loading'
  const speaking = mine && speech?.phase === 'speaking'
  return (
    <button
      type="button"
      data-village-spoken={speaking ? 'speaking' : loading ? 'loading' : 'idle'}
      title={speaking ? 'Stop' : `Hear it: “${spoken}”`}
      aria-label={speaking ? 'Stop the spoken reply' : 'Play the spoken reply'}
      onClick={event => {
        event.stopPropagation()
        if (mine) {
          stopVillageSpeech()
          return
        }
        void speakVillageAgent(agentId, spoken, getAgentVoiceSettings(agentKey, agentName, own), true).then(played => {
          if (!played) showNotice('Could not play the spoken reply (see the console).', 'warn')
        })
      }}
      onKeyDown={event => event.stopPropagation()}
      className={`mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] transition ${speaking
        ? 'border-fuchsia-300/60 bg-fuchsia-400/20 text-fuchsia-50'
        : 'border-white/15 bg-white/5 text-white/70 hover:border-fuchsia-300/50 hover:text-white'}`}
    >
      <span aria-hidden className={`inline-block w-3 text-center text-[9px] ${loading ? 'animate-pulse' : ''}`}>{speaking ? '■' : loading ? '…' : '▶'}</span>
      <span className="truncate italic">{spoken}</span>
    </button>
  )
}
