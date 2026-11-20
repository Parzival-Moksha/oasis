'use client'

// ░▒▓ FOLLOW ACROSS WORLDS — next to Follow: this agent goes wherever the owner goes, world to world ▓▒░
// The owner (2026-11-20): "Follow and then Follow Across Worlds, basically. Another toggle switch… off by default for
// all new agents"; on for Anorak. Kept in the shared identity store (followWorlds); village-worlds.ts reads it.

import { useSyncExternalStore } from 'react'
import { KitToggle } from '@/components/ui-kit'
import { getVillageIdentityVersion, subscribeVillageIdentity } from '../../lib/village/village-identity-client'
import { isVillageFollowAcrossWorlds, setVillageFollowAcrossWorlds } from './village-worlds'

export function FollowWorldsToggle({ agentKey, name, kit = false }: { agentKey: string; name: string; kit?: boolean }) {
  useSyncExternalStore(subscribeVillageIdentity, getVillageIdentityVersion, () => 0)
  const on = isVillageFollowAcrossWorlds(agentKey, name)
  const hint = on ? 'It is in whatever world you are in.' : 'It stays in its own world; the Agents menu can call it.'
  if (kit) {
    return <KitToggle checked={on} onChange={next => setVillageFollowAcrossWorlds(agentKey, next)} label="Follow across worlds" hint={hint} />
  }
  return (
    <label className="mt-1 flex cursor-pointer items-start gap-2" title={hint}>
      <input type="checkbox" checked={on} data-agent-follow-worlds={on ? 'on' : 'off'} onChange={event => setVillageFollowAcrossWorlds(agentKey, event.target.checked)} className="mt-[2px] accent-amber-300" />
      <span>Follow across worlds</span>
    </label>
  )
}
