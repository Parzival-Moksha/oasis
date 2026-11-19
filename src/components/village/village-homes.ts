// ░▒▓ VILLAGE HOMES (page) — this page's copy of where every agent lives, and its answers to agents' requests ▓▒░
// The file is on the page server (/api/village/homes, lib/village/village-homes.ts). This page reads it, looks for
// news every few seconds (a few bytes when nothing changed), sets and clears homes for the owner, and answers what
// agents asked with `me.mjs home …`: only a page knows the world the owner is in and where an agent stands.

import { useEffect } from 'react'
import { useOasisStore } from '../../store/oasisStore'
import { villageAgentKey } from '../../lib/village/village-layout'
import { isStageWorldName } from '../../lib/village/village-stage'
import { EMPTY_HOMES, homeOf, parseHomesFile, withHome, yawToward, type HomeRequest, type HomesFile, type VillageHome } from '../../lib/village/village-homes'
import { getVillagePlaza, getVillageStation } from './village-actions'

const HOMES_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/village/homes`
const EVERY_MS = 4000

let file: HomesFile = EMPTY_HOMES
let version = 0
const listeners = new Set<() => void>()
const answering = new Set<string>()

function changed(next: HomesFile): void {
  file = next
  version += 1
  listeners.forEach(listener => listener())
}

export function subscribeVillageHomes(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getVillageHomesVersion(): number {
  return version
}

/** The world the owner is in (the one the village shows). */
export function currentVillageWorld(): string | null {
  const state = useOasisStore.getState()
  return state.viewingWorldId || state.activeWorldId || null
}

/** This agent's home in this world, if it has one. */
export function getVillageHome(world: string | null | undefined, key: string | null | undefined): VillageHome | null {
  return homeOf(file, world, key)
}

async function post(body: Record<string, unknown>): Promise<HomesFile | null> {
  const response = await fetch(HOMES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({})) as { file?: unknown; error?: string }
  if (!response.ok) throw new Error(data.error || `homes answered ${response.status}`)
  return data.file ? parseHomesFile(data.file) : null
}

/** The owner's choice: this agent lives here now (`at`, facing `yaw`). Shown at once, saved on the server. */
export async function setVillageHome(world: string, key: string, at: { x: number; z: number; yaw: number }): Promise<void> {
  changed(withHome(file, world, key, { x: at.x, z: at.z, yaw: at.yaw, by: 'owner', at: Date.now() }))
  const saved = await post({ action: 'set', world, agent: key, home: { ...at, by: 'owner' } })
  if (saved) changed(saved)
}

/** Back to its seat on the ring (its desk) in this world. */
export async function clearVillageHome(world: string, key: string): Promise<void> {
  changed(withHome(file, world, key, null))
  const saved = await post({ action: 'clear', world, agent: key })
  if (saved) changed(saved)
}

/** Which agent of this page a request is for, if any. */
function agentFor(request: HomeRequest): string | null {
  const engine = useOasisStore.getState().agentEngine
  if (request.agentId && engine.agents[request.agentId]) return request.agentId
  return engine.order.find(id => villageAgentKey({ id, sessionId: engine.agents[id]?.sessionId }) === request.agentKey) || null
}

/** Answers what agents asked (`me.mjs home here | x z | clear`) for the world this page shows. */
async function answerRequests(): Promise<void> {
  const world = currentVillageWorld()
  if (!world) return
  const state = useOasisStore.getState()
  const worldName = state.worldRegistry.find(entry => entry.id === world)?.name || world
  for (const request of file.requests) {
    if (answering.has(request.id)) continue
    const agentId = agentFor(request)
    // Not an agent this page knows: another page may.
    if (!agentId) continue
    answering.add(request.id)
    let answer: Record<string, unknown>
    if (isStageWorldName(worldName)) {
      answer = { id: request.id, ok: false, note: `the owner is in "${worldName}", a stage for the Council: no homes there. Ask again when they are back in the village.` }
    } else if (request.kind === 'clear') {
      answer = { id: request.id, ok: true, world, agent: request.agentKey, home: null, note: `back to your seat on the ring in "${worldName}"` }
    } else {
      const live = request.kind === 'here' ? getVillageStation(agentId) : null
      const x = request.kind === 'here' ? live?.anchor[0] : request.x
      const z = request.kind === 'here' ? live?.anchor[2] : request.z
      if (typeof x !== 'number' || typeof z !== 'number') {
        answer = { id: request.id, ok: false, note: 'your body is not in the world this page shows' }
      } else {
        // Facing the plaza, so it looks into the village; without a plaza, the way it faces now.
        const plaza = getVillagePlaza()
        const yaw = plaza ? yawToward({ x, z }, { x: plaza[0], z: plaza[2] }) : live?.rotationY ?? 0
        answer = { id: request.id, ok: true, world, agent: request.agentKey, home: { x, z, yaw }, note: `your home in "${worldName}" is at x ${x.toFixed(1)}, z ${z.toFixed(1)}, facing the plaza` }
      }
    }
    try {
      const saved = await post({ action: 'answer', ...answer })
      if (saved) changed(saved)
    } catch {
      answering.delete(request.id)
    }
  }
}

async function refresh(): Promise<void> {
  const response = await fetch(`${HOMES_URL}?since=${file.version}`, { cache: 'no-store' })
  if (!response.ok) return
  const data = await response.json() as { unchanged?: boolean }
  if (!data.unchanged) changed(parseHomesFile(data))
  if (file.requests.length) await answerRequests()
}

/** Mounted once with the village: loads the homes and keeps them fresh. */
export function useVillageHomesSync(): void {
  useEffect(() => {
    let alive = true
    let busy = false
    const tick = () => {
      if (!alive || busy) return
      busy = true
      refresh().catch(() => {}).finally(() => { busy = false })
    }
    tick()
    const timer = window.setInterval(tick, EVERY_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])
}
