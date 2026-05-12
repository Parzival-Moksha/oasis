import 'server-only'

import { readBrowserActiveWorldId } from '../browser-active-world'
import { getOasisMode } from '../oasis-profile'
import { WELCOME_HUB_WORLD_ID } from '../portal-gates'
import { getRegistry, loadWorld } from './world-server'

export { WELCOME_HUB_WORLD_ID } from '../portal-gates'

export interface ResolvedActiveWorld {
  worldId: string
  source: 'stored' | 'welcome' | 'registry'
  authoritative: boolean
}

async function canLoadWorld(worldId: string, userId: string): Promise<boolean> {
  return Boolean(await loadWorld(worldId, userId))
}

export async function resolveActiveWorldForUser(userId: string): Promise<ResolvedActiveWorld | null> {
  const mode = getOasisMode()
  const storedWorldId = await readBrowserActiveWorldId(userId)
  if (storedWorldId && await canLoadWorld(storedWorldId, userId)) {
    return { worldId: storedWorldId, source: 'stored', authoritative: mode === 'hosted' }
  }

  if (await canLoadWorld(WELCOME_HUB_WORLD_ID, userId)) {
    return { worldId: WELCOME_HUB_WORLD_ID, source: 'welcome', authoritative: mode === 'hosted' }
  }

  const registry = await getRegistry(userId)
  const first = registry[0]?.id
  return first ? { worldId: first, source: 'registry', authoritative: mode === 'hosted' } : null
}
