'use client'

// ░▒▓ VILLAGE WORLD ROW — Settings > Agents: do agents live in one world, or come with the owner? ▓▒░
// The owner (2026-11-20): "I just kinda wanna have it A/B… for most people, including me, it will make more sense for
// agents to chill in one world… one agent only could exist in one world, except if I specifically request it."
//   Agents live in one world (default): each agent is in its own world (village-worlds.ts); the one the owner first
//   chose this in, unless it has its own home. Agents set to "Follow across worlds" (Anorak) still come along.
//   Agents come with me: everyone appears wherever he is (as before 2026-11-20).

import { useState } from 'react'
import { KitTabs } from '@/components/ui-kit'
import { useOasisStore } from '../../store/oasisStore'
import { isStageWorldName } from '../../lib/village/village-stage'
import { showNotice } from '../forge/GlobalNotice'
import { currentVillageWorld, getVillageHomesFile, setVillageWorld } from './village-homes'
import { useVillageWorldsVersion, villageWorldName } from './village-worlds'

type Mode = 'one' | 'with'

export function VillageWorldRow() {
  useVillageWorldsVersion()
  const [busy, setBusy] = useState(false)
  const worldName = useOasisStore(s => s.worldRegistry.find(entry => entry.id === (s.viewingWorldId || s.activeWorldId))?.name || '')
  const village = getVillageHomesFile().villageWorld
  const mode: Mode = village ? 'one' : 'with'
  const choose = (next: Mode) => {
    if (busy || next === mode) return
    const here = currentVillageWorld()
    // One world: the one he is in now (never a Council stage).
    if (next === 'one' && (!here || isStageWorldName(worldName))) {
      showNotice('Go to the world they should live in first.', 'warn')
      return
    }
    setBusy(true)
    setVillageWorld(next === 'one' ? here : null)
      .catch(error => showNotice(`Could not change it: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="py-1.5" data-village-world={village || 'with-me'}>
      <KitTabs<Mode>
        tabs={[
          { id: 'one', label: 'Agents live in one world', title: 'Each agent stays in its world; the Agents menu reaches it from anywhere' },
          { id: 'with', label: 'Agents come with me', title: 'Everyone appears wherever you are' },
        ]}
        active={mode}
        onChange={choose}
      />
      <div className="kit-hint mt-1">
        {village
          ? `They live in ${villageWorldName(village)}, unless one has its own home. Agents set to "Follow across worlds" (Anorak) come along. From any world the Agents menu reaches the others: Call here or Go there.`
          : 'Everyone appears wherever you are.'}
      </div>
    </div>
  )
}
