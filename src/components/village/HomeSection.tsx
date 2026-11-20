'use client'

// ░▒▓ HOME SECTION — in an agent's settings menu: where it lives in this world ▓▒░
// "Make this its home": the agent will stand where the owner stands now, facing the way the owner faces, with no
// desk; the ground around it is its own to build on. "Back to the ring": its seat and desk again. Per world.
// The agent can do the same itself: node packages/oasis-agent-engine/scripts/me.mjs home here | <x> <z> | clear.

import { useState, useSyncExternalStore } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { getPlayerAvatarPose } from '../../lib/player-avatar-runtime'
import { HOME } from '../../lib/village/village-homes'
import { isStageWorldName } from '../../lib/village/village-stage'
import { showNotice } from '../forge/GlobalNotice'
import { clearVillageHome, getVillageHome, getVillageHomesVersion, setVillageHome, subscribeVillageHomes } from './village-homes'
import { setVillageAgentHomeWorld } from './village-worlds'

const HEADING = 'mb-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/55'
const BUTTON = 'rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[10.5px] text-white/80 transition hover:bg-white/15 disabled:opacity-40'

export function HomeSection({ agentKey, name }: { agentKey: string; name: string }) {
  useSyncExternalStore(subscribeVillageHomes, getVillageHomesVersion, () => 0)
  const world = useOasisStore(s => s.viewingWorldId || s.activeWorldId || null)
  const worldName = useOasisStore(s => s.worldRegistry.find(entry => entry.id === (s.viewingWorldId || s.activeWorldId))?.name || '')
  const [busy, setBusy] = useState(false)
  if (!world || isStageWorldName(worldName)) return null
  const home = getVillageHome(world, agentKey)

  const run = (job: () => Promise<void>, done: string) => {
    setBusy(true)
    job()
      .then(() => showNotice(done, 'info'))
      .catch(error => showNotice(`Could not save ${name}'s home: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="mb-3">
      <div className={HEADING}>Home · {name}</div>
      <div className="mb-1.5 text-[10.5px] text-white/55" data-agent-home={home ? 'home' : 'ring'}>
        {home
          ? `Lives at x ${home.x.toFixed(1)}, z ${home.z.toFixed(1)} in ${worldName || 'this world'}, no desk${home.by === 'agent' ? ' (it chose)' : ''}. The ground within ${HOME.buildRadius} m is its to build on.`
          : 'At its desk on the ring.'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          data-agent-home-here
          disabled={busy}
          title={`${name} will stand where you stand now, facing the way you face, without a desk, in this world. The ground around it is its to build on.`}
          onClick={() => {
            const pose = getPlayerAvatarPose()
            if (!pose) { showNotice('Stand somewhere in the world first (walk with your avatar).', 'warn'); return }
            const yaw = Math.atan2(pose.forward[0], pose.forward[2])
            // This world is its home world too (village-worlds.ts), whatever spots it has elsewhere.
            setVillageAgentHomeWorld(agentKey, world)
            run(() => setVillageHome(world, agentKey, { x: pose.position[0], z: pose.position[2], yaw }), `${name} lives here now.`)
          }}
          className={BUTTON}
        >
          Make this its home
        </button>
        {home && (
          <button type="button" data-agent-home-ring disabled={busy} onClick={() => run(() => clearVillageHome(world, agentKey), `${name} is back at its desk on the ring.`)} className={BUTTON}>
            Back to the ring
          </button>
        )}
      </div>
    </div>
  )
}
