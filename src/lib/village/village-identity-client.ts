// ░▒▓ VILLAGE IDENTITY (page) — the store's copy in this page, kept in step with the file on the PC ▓▒░
// Loaded once before the village places anyone (VillageWorld waits for isVillageIdentityReady), then checked every
// few seconds for changes made by another tab or app window. The village's own modules (village-memory.ts, the
// voices in village-companion.ts, panel-look.ts accents, tag-style.ts, village-looks.ts) derive their values from it
// and send their changes through queueVillageIdentity. See lib/village/village-identity.ts.
//
// The store unreachable (a hosted Oasis, the route refusing): the page goes on with this browser's own copy, marked
// offline, and VillagePresence then tells the engine nothing about looks (a guess must never reach an agent's card).

import { EMPTY_IDENTITY, importOps, parseIdentityFile, type IdentityFile, type IdentityOp, type IdentityPatch } from './village-identity'

const ROUTE = '/api/village/identity'
const POLL_MS = 5000
const FLUSH_MS = 250

let file: IdentityFile | null = null
let ready = false
let offline = false
let started = false
let version = 0
const listeners = new Set<() => void>()
let pendingOps: IdentityOp[] = []
let pendingSettings: NonNullable<IdentityPatch['settings']> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

export function isVillageIdentityReady(): boolean { return ready }
/** The store could not be reached: this page runs on its own browser copy. */
export function isVillageIdentityOffline(): boolean { return offline }
export function getVillageIdentity(): IdentityFile | null { return file }
export function getVillageIdentityVersion(): number { return version }
export function subscribeVillageIdentity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function replace(next: IdentityFile): void {
  if (file && next.version === file.version && ready) return
  file = next
  ready = true
  version += 1
  listeners.forEach(listener => { try { listener() } catch (error) { console.error('[VillageIdentity]', error) } })
}

function goOffline(): void {
  if (ready) return
  offline = true
  ready = true
  version += 1
  listeners.forEach(listener => { try { listener() } catch { /* keep going */ } })
}

/**
 * Changes for the store: sent together a moment later. Before the store is loaded they are dropped: they come from
 * this browser's own copy, the very thing that may be stale, and the module's values are replaced once it loads.
 */
export function queueVillageIdentity(ops: IdentityOp[], settings?: IdentityPatch['settings']): void {
  if (offline || !ready || typeof window === 'undefined') return
  if (ops.length) pendingOps.push(...ops)
  if (settings) pendingSettings = { ...pendingSettings, ...settings }
  if (!pendingOps.length && !Object.keys(pendingSettings).length) return
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush() }, FLUSH_MS)
}

async function flush(): Promise<void> {
  if (flushing) { queueVillageIdentity([]); return }
  if (!pendingOps.length && !Object.keys(pendingSettings).length) return
  const ops = pendingOps
  const settings = pendingSettings
  pendingOps = []
  pendingSettings = {}
  flushing = true
  try {
    const response = await fetch(ROUTE, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops, settings }) })
    const body = await response.json().catch(() => null) as { file?: unknown } | null
    if (!response.ok || !body?.file) throw new Error(`identity ${response.status}`)
    flushing = false
    replace(parseIdentityFile(body.file))
  } catch (error) {
    flushing = false
    // Try again with the next change or poll; nothing is dropped.
    pendingOps = [...ops, ...pendingOps]
    pendingSettings = { ...settings, ...pendingSettings }
    console.warn('[VillageIdentity] could not save, will retry:', error)
  }
}

async function fetchFile(): Promise<IdentityFile | 'unchanged'> {
  const since = file && ready ? `?since=${file.version}` : ''
  const response = await fetch(`${ROUTE}${since}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`identity ${response.status}`)
  const body = await response.json() as { unchanged?: boolean }
  return body.unchanged ? 'unchanged' : parseIdentityFile(body)
}

function readLocal(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') } catch { return null }
}

/** A store that has never held anything gets this browser's old copy (the first page on a new PC). */
function importThisBrowser(): IdentityOp[] {
  return importOps({
    memory: readLocal('oasis.village.memory.v1') as never,
    voices: readLocal('oasis.village.voices') as never,
    accent: readLocal('oasis.village.accentColors.v1') as never,
    come: readLocal('oasis.village.come') as never,
    follow: readLocal('oasis.village.follow') as never,
  })
}

async function load(): Promise<void> {
  for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
    try {
      const got = await fetchFile()
      if (got === 'unchanged') return
      const empty = got.version === 0 && !Object.keys(got.agents).length
      if (empty) {
        const tagStyle = readLocal('oasis.village.tagStyle.v1')
        const looks = readLocal('oasis.village.looks.v1')
        const settings = {
          ...(tagStyle && typeof tagStyle === 'object' ? { tagStyle: tagStyle as Record<string, unknown> } : {}),
          ...(looks && typeof looks === 'object' ? { looks: looks as Record<string, unknown> } : {}),
        }
        pendingOps = [...importThisBrowser(), ...pendingOps]
        pendingSettings = { ...settings, ...pendingSettings }
      }
      replace(got)
      queueVillageIdentity([])
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
  goOffline()
}

async function poll(): Promise<void> {
  if (!ready || offline || flushing || flushTimer) return
  // A save that failed earlier: send it again first.
  if (pendingOps.length || Object.keys(pendingSettings).length) { void flush(); return }
  try {
    const got = await fetchFile()
    // A change of ours went out meanwhile: its answer is newer than this.
    if (got !== 'unchanged' && !flushing && !pendingOps.length) replace(got)
  } catch { /* the page server restarting: next time */ }
}

/** Starts once per page (VillageWorld mounts it). */
export function startVillageIdentity(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void load()
  window.setInterval(() => { void poll() }, POLL_MS)
  window.addEventListener('focus', () => { void poll() })
}

/** Tests: forget everything. */
export function resetVillageIdentityForTests(next: IdentityFile | null = null): void {
  file = next
  ready = Boolean(next)
  offline = false
  started = false
  version += 1
  pendingOps = []
  pendingSettings = {}
}

export { EMPTY_IDENTITY }
