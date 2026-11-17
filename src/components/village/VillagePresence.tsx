'use client'

// ░▒▓ VILLAGE PRESENCE — tells the agent engine what each agent looks like, sounds like and where its place is ▓▒░
// The engine keeps a card per agent (packages/oasis-agent-engine/src/character.js) and tells the agent who it
// is from it. The body, the voice and the place only exist in this page (village memory, voice settings, the
// world's objects), so this reports them: every few seconds it puts the facts together and sends them when
// they changed, and again after the socket reconnects. Words only; a few hundred bytes per agent.

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { getAgentEngineClient } from '../../lib/agent-engine-client'
import type { EnginePresence } from '../../lib/agent-engine-types'
import { AGENT_AVATAR_CATALOG } from '../../lib/agent-avatar-catalog'
import { villageAgentKey, type Vec3 } from '../../lib/village/village-layout'
import { describePlace, type PlaceThing } from '../../lib/village/village-place'
import { villageVoice } from '../../lib/village/village-voices'
import { getLiveObjectTransform } from '../../lib/live-object-transforms'
import { getAgentVoiceSettings } from './village-companion'
import { getVillageAvatar, getVillageDesk, getVillagePlaza } from './village-actions'
import { agentDisplayName } from './village-status'

const EVERY_MS = 4000

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(n => typeof n === 'number' && Number.isFinite(n))
}

/** Everything placed in this world that has a name and a position. */
function worldThings(): PlaceThing[] {
  const state = useOasisStore.getState()
  const things: PlaceThing[] = []
  const positionOf = (id: string, fallback: unknown): Vec3 | null => {
    const live = getLiveObjectTransform(id)?.position ?? state.transforms?.[id]?.position
    return isVec3(live) ? [live[0], live[1], live[2]] : isVec3(fallback) ? [fallback[0], fallback[1], fallback[2]] : null
  }
  for (const object of state.placedCatalogAssets || []) {
    const position = positionOf(object.id, object.position)
    if (position && object.name) things.push({ name: object.imageUrl ? `picture "${object.name}"` : object.videoUrl ? `video "${object.name}"` : object.name, position })
  }
  for (const scene of state.craftedScenes || []) {
    const position = positionOf(scene.id, scene.position)
    if (position && scene.name) things.push({ name: scene.name, position })
  }
  return things
}

function avatarFacts(path: string | null): Pick<EnginePresence, 'avatar' | 'avatarName' | 'thumb'> {
  if (!path) return {}
  const clean = path.replace(/[?#].*$/, '')
  const entry = AGENT_AVATAR_CATALOG.find(item => item.path === clean)
  const fileName = (clean.split('/').pop() || clean).replace(/\.vrm$/i, '')
  return {
    avatar: clean,
    avatarName: entry?.name || fileName,
    // The gallery's thumbnails are named after the catalog id (AgentSettingsMenu avatarLabel).
    ...(entry ? { thumb: `/avatars/gallery/thumbs/${entry.id.replace(/^av_/, '')}.jpg` } : {}),
  }
}

function buildPresence(): EnginePresence[] {
  const state = useOasisStore.getState()
  const engine = state.agentEngine
  const world = state.worldRegistry.find(entry => entry.id === state.activeWorldId)?.name || ''
  const plaza = getVillagePlaza()
  const things = worldThings()
  const desks = engine.order
    .map(id => ({ id, agent: engine.agents[id], desk: getVillageDesk(id) }))
    .filter(item => item.agent && item.desk)
  return desks.map(({ id, agent, desk }) => {
    const key = villageAgentKey({ id, sessionId: agent.sessionId })
    let voice = ''
    if (agent.speak) {
      const chosen = villageVoice(getAgentVoiceSettings(key, agent.name, agent.voiceChoice).voice)
      if (chosen) voice = `${chosen.name} (${chosen.key})${chosen.sound ? `: ${chosen.sound}` : ''}`
    }
    return {
      agentId: id,
      ...avatarFacts(getVillageAvatar(id)),
      voice,
      ...(world ? { world } : {}),
      place: describePlace({
        anchor: desk!.anchor,
        rotationY: desk!.rotationY,
        plaza,
        things,
        neighbours: desks.filter(other => other.id !== id).map(other => ({ name: agentDisplayName(other.agent), position: other.desk!.anchor })),
      }),
    }
  })
}

export function VillagePresence() {
  useEffect(() => {
    let last = ''
    let sentFor: number | null = null
    const tick = () => {
      const connection = useOasisStore.getState().agentEngine.connection
      if (connection.status !== 'open') return
      // A new connection (the engine restarted, or the socket dropped): it may know nothing, tell it all again.
      if (connection.connectedAt !== sentFor) last = ''
      let agents: EnginePresence[]
      try { agents = buildPresence() } catch { return }
      if (!agents.length) return
      const next = JSON.stringify(agents)
      if (next === last) return
      last = next
      sentFor = connection.connectedAt
      // An engine older than characters answers "unknown command": nothing to do then.
      getAgentEngineClient().reportPresence(agents).catch(() => {})
    }
    const first = window.setTimeout(tick, 1500)
    const timer = window.setInterval(tick, EVERY_MS)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [])
  return null
}
