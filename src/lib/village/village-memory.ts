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

// ─── the owner picks a body (agent panel → Avatar) ─────────────────────────
// Only this bumps the version: VillageWorld re-dresses on it. Its own saves don't, so no loop.

const listeners = new Set<() => void>()
let version = 0

export function subscribeVillageMemory(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVillageMemoryVersion(): number {
  return version
}

/** The skin an agent wears now (its session key, villageAgentKey), and whether the owner chose it. */
export function getVillageAgentSkin(key: string): { skin: string | null; picked: boolean } {
  const entry = getVillageMemory()[key]
  return { skin: entry?.skin || null, picked: Boolean(entry?.picked) }
}

/** Dress an agent in `skin` and keep it; null hands the choice back to the village. */
export function setVillageAgentSkin(key: string, skin: string | null): void {
  const memory = getVillageMemory()
  const { skin: _old, picked: _picked, ...rest } = memory[key] || { seenAt: Date.now() }
  const entry = skin ? { ...rest, skin, picked: true } : rest
  saveVillageMemory({ ...memory, [key]: { ...entry, seenAt: entry.seenAt ?? Date.now() } })
  version += 1
  listeners.forEach(listener => listener())
}
