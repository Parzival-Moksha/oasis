import 'server-only'

import { readBrowserActiveWorldId } from '../browser-active-world'
import { getOasisMode } from '../oasis-profile'
import { getRegistry, loadWorld } from './world-server'

export const WELCOME_HUB_WORLD_ID = 'world-welcome-hub-system'

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

  if (mode === 'hosted' && await canLoadWorld(WELCOME_HUB_WORLD_ID, userId)) {
    return { worldId: WELCOME_HUB_WORLD_ID, source: 'welcome', authoritative: true }
  }

  const registry = await getRegistry(userId)
  const first = registry[0]?.id
  return first ? { worldId: first, source: 'registry', authoritative: mode === 'hosted' } : null
}
