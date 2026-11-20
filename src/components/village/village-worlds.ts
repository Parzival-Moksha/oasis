// ░▒▓ VILLAGE WORLDS (page) — which world each agent is in, read from what the page knows ▓▒░
// Follow me (village-companion), calls and the village's world and home spots (the homes file, village-homes.ts).
// Each agent's own home world comes from the shared identity store (Citizens', /api/village/identity, field
// homeWorld). The rule itself is lib/village/village-worlds.ts.

import { useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { villageAgentKey } from '../../lib/village/village-layout'
import { homeSpotWorlds } from '../../lib/village/village-homes'
import { agentWorld, isAgentHere } from '../../lib/village/village-worlds'
import { getVillageFollowVersion, subscribeVillageFollow } from './village-companion'
import { FOLLOW_DEFAULT } from '../../lib/village/village-follow'
import { currentVillageWorld, getVillageHomesFile, getVillageHomesVersion, subscribeVillageHomes } from './village-homes'
import { getVillageIdentity, getVillageIdentityVersion, queueVillageIdentity, subscribeVillageIdentity } from '../../lib/village/village-identity-client'

/** Its own home world, from the shared identity store (absent: the village's world). */
function homeWorldOf(key: string): string | null {
  return getVillageIdentity()?.agents?.[key]?.homeWorld ?? null
}

/** Sets (or clears, with null) an agent's own home world in the shared store. */
export function setVillageAgentHomeWorld(key: string, world: string | null): void {
  queueVillageIdentity([{ agent: key, set: { homeWorld: world } }])
}

/**
 * "Follow across worlds" (its settings, next to Follow): it is in whatever world the owner is in. The shared
 * identity store's followWorlds; absent: on for Anorak (the owner, 2026-11-20: "I want him to be following me
 * everywhere I go"), off for everyone else.
 */
export function isVillageFollowAcrossWorlds(key: string, name: string | null | undefined): boolean {
  const own = getVillageIdentity()?.agents?.[key]?.followWorlds
  return typeof own === 'boolean' ? own : FOLLOW_DEFAULT.test(name || '')
}

export function setVillageFollowAcrossWorlds(key: string, on: boolean): void {
  queueVillageIdentity([{ agent: key, set: { followWorlds: on } }])
}

/** The world an agent is in (null: every world, while no village world is chosen). */
export function villageAgentWorld(agentId: string): string | null {
  const state = useOasisStore.getState()
  const agent = state.agentEngine.agents[agentId]
  if (!agent) return null
  const key = villageAgentKey({ id: agentId, sessionId: agent.sessionId })
  const file = getVillageHomesFile()
  return agentWorld({
    follows: isVillageFollowAcrossWorlds(key, agent.name),
    calledTo: file.calls[key] ?? null,
    homeWorld: homeWorldOf(key),
    homeSpots: homeSpotWorlds(file, key),
  }, file.villageWorld, currentVillageWorld())
}

export function isVillageAgentHere(agentId: string): boolean {
  return isAgentHere(villageAgentWorld(agentId), currentVillageWorld())
}

/** A world's name for people ("Zen Workshop"). */
export function villageWorldName(world: string | null): string {
  if (!world) return 'every world'
  return useOasisStore.getState().worldRegistry.find(entry => entry.id === world)?.name || 'another world'
}

/** Re-renders when anything that decides where agents are changes. Returns a number that changes with it. */
export function useVillageWorldsVersion(): number {
  const homes = useSyncExternalStore(subscribeVillageHomes, getVillageHomesVersion, () => 0)
  const follow = useSyncExternalStore(subscribeVillageFollow, getVillageFollowVersion, () => 0)
  const identity = useSyncExternalStore(subscribeVillageIdentity, getVillageIdentityVersion, () => 0)
  const world = useOasisStore(s => s.viewingWorldId || s.activeWorldId || '')
  return homes * 1000 + follow * 7 + identity * 13 + world.length
}
