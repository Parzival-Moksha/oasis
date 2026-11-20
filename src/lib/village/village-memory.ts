// ░▒▓ VILLAGE MEMORY — each agent's desk and body, the same in every browser and app window ▓▒░
// Keyed by session id (village-layout.ts villageAgentKey), so a reload, a world switch or a
// "Move it here" leaves everyone where they were. One memory for all worlds: seats are numbers,
// each world places seat N the same way around its own village origin.
// Since 2026-11-20 the truth is the store on this PC (village-identity.ts): this module derives the memory from it
// and sends its changes there. localStorage keeps a copy only for a page that cannot reach the store.

import type { VillageMemory } from './village-layout'
import { memoryFromIdentity, memoryOps, sameLooks } from './village-identity'
import { getVillageIdentity, isVillageIdentityOffline, isVillageIdentityReady, queueVillageIdentity, subscribeVillageIdentity } from './village-identity-client'

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

function fromStore(): VillageMemory | null {
  const file = isVillageIdentityReady() && !isVillageIdentityOffline() ? getVillageIdentity() : null
  return file ? (memoryFromIdentity(file) as VillageMemory) : null
}

export function getVillageMemory(): VillageMemory {
  if (!cache) cache = fromStore() ?? read()
  return cache
}

// Another tab or window changed a seat or a body (or the store just loaded): take it, keeping our own `seenAt`s.
subscribeVillageIdentity(() => {
  const stored = fromStore()
  if (!stored) return
  if (cache && sameLooks(stored, cache)) return
  const seen = cache || {}
  cache = Object.fromEntries(Object.entries(stored).map(([key, entry]) => [key, { ...entry, seenAt: Math.max(entry.seenAt || 0, seen[key]?.seenAt || 0) }]))
  version += 1
  listeners.forEach(listener => listener())
})

export function saveVillageMemory(next: VillageMemory): void {
  const prev = cache || {}
  cache = next
  const file = getVillageIdentity()
  queueVillageIdentity(memoryOps(prev, next, file?.agents || {}))
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
