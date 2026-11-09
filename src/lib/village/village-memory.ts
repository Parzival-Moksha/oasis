// ░▒▓ VILLAGE MEMORY — each agent's desk and body, kept in this browser (localStorage) ▓▒░
// Keyed by session id (village-layout.ts villageAgentKey), so a reload, a world switch or a
// "Move it here" leaves everyone where they were. One memory for all worlds: seats are numbers,
// each world places seat N the same way around its own village origin.

import type { VillageMemory } from './village-layout'

const STORAGE_KEY = 'oasis.village.memory.v1'

let cache: VillageMemory | null = null

function read(): VillageMemory {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as VillageMemory) : {}
  } catch {
    return {}
  }
}

export function getVillageMemory(): VillageMemory {
  if (!cache) cache = read()
  return cache
}

export function saveVillageMemory(next: VillageMemory): void {
  cache = next
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: the village still works, it just forgets on reload.
  }
}
