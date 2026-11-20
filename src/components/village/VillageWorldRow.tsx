'use client'

// ░▒▓ VILLAGE WORLD ROW — Settings > Agents: which world the village lives in ▓▒░
// Agents with no other place (a home spot, a call, Follow me) live in the village's world and only appear there
// (village-worlds.ts). "Move the village here" makes the world the owner is in that world; "In every world" is how
// it was before (everyone appears everywhere).

import { useState } from 'react'
import { KitButton } from '@/components/ui-kit'
import { useOasisStore } from '../../store/oasisStore'
import { isStageWorldName } from '../../lib/village/village-stage'
import { showNotice } from '../forge/GlobalNotice'
import { currentVillageWorld, getVillageHomesFile, setVillageWorld } from './village-homes'
import { useVillageWorldsVersion, villageWorldName } from './village-worlds'

export function VillageWorldRow() {
  useVillageWorldsVersion()
  const [busy, setBusy] = useState(false)
  const worldName = useOasisStore(s => s.worldRegistry.find(entry => entry.id === (s.viewingWorldId || s.activeWorldId))?.name || '')
  const here = currentVillageWorld()
  const village = getVillageHomesFile().villageWorld
  const run = (world: string | null, done: string) => {
    setBusy(true)
    setVillageWorld(world)
      .then(() => showNotice(done, 'info'))
      .catch(error => showNotice(`Could not move the village: ${error instanceof Error ? error.message : String(error)}`, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="py-1.5" data-village-world={village || 'everywhere'}>
      <div className="mb-1 text-sm text-gray-300">The village lives in</div>
      <div className="kit-hint mb-1.5">
        {village
          ? `${villageWorldName(village)}. Agents without a home of their own appear only there; elsewhere the Agents menu lists them by world, with Call here and Go there.`
          : 'Every world: all agents appear wherever you are (as before).'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {here && village !== here && !isStageWorldName(worldName) && (
          <KitButton variant="primary" data-village-move-here disabled={busy} onClick={() => run(here, `The village lives in ${worldName} now.`)} title="Agents without a home of their own live in this world from now on">
            Move the village here
          </KitButton>
        )}
        {village && (
          <KitButton data-village-everywhere disabled={busy} onClick={() => run(null, 'All agents appear in every world again.')} title="Everyone appears wherever you are, as before">
            In every world
          </KitButton>
        )}
      </div>
    </div>
  )
}
