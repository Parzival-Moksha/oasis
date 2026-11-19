// ░▒▓ KEYCHAIN STORE — which keys are held, as the Academy's keychain view and the skill map show them ▓▒░
// One small external store (useSyncExternalStore). Nothing runs while neither view is open: no poll, no
// request. While one is open the list is re-read every 20 s (the server reuses a look for 45 s), right
// away when it opens, and after every change the owner makes.
//
// A pasted key value passes through `storeKey` as an argument and is never kept: not in this state, not
// in a variable that outlives the call, not in a response (the server never sends one back).

import type { KeychainKeyView, KeyState } from '../../lib/village/keychain'
import { forgetFeatureKeyStates } from '../../lib/feature-keys-client'
import { closeCharacter, getCharacterState, openCharacter } from './character-store'

export const VILLAGE_ACADEMY_KEYCHAIN_LAYER = 'village-academy-keychain'
const REFRESH_MS = 20_000

export interface KeychainSources {
  folders: number
  envFiles: number
  plugins: number
  claudeLogin: string
  codexLogin: string
  ghLogin: string
}

export interface KeychainStoreState {
  /** The keychain view is open. */
  open: boolean
  keys: KeychainKeyView[]
  sources: KeychainSources | null
  scannedAt: number
  loading: boolean
  error: string | null
  /** The skill map is open: it wants the key states for its gems. */
  mapWatching: boolean
}

let state: KeychainStoreState = { open: false, keys: [], sources: null, scannedAt: 0, loading: false, error: null, mapWatching: false }
const listeners = new Set<() => void>()
let lastBody = ''
let inFlight: Promise<void> | null = null
let refused = false
let timer: number | null = null

function set(patch: Partial<KeychainStoreState>): void {
  state = { ...state, ...patch }
  listeners.forEach(listener => listener())
  syncTimer()
}

export function getKeychainState(): KeychainStoreState {
  return state
}

export function subscribeKeychain(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** key id → state, for the map's gems and the sheet; empty until the first look. */
export function keyStates(current: KeychainStoreState = state): Map<string, KeyState> {
  return new Map(current.keys.map(key => [key.id, key.state]))
}

// ─── reading ────────────────────────────────────────────────────────────────

export function refreshKeychain(fresh = false): Promise<void> {
  if (inFlight) return inFlight
  if (refused) return Promise.resolve()
  inFlight = (async () => {
    try {
      const response = await fetch(`/api/academy/keychain${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      if (response.status === 403 || response.status === 404) refused = true
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        set({ loading: false, error: data.error || `HTTP ${response.status}` })
        return
      }
      const body = await response.text()
      if (body === lastBody) {
        if (state.loading || state.error) set({ loading: false, error: null })
        return
      }
      lastBody = body
      const data = JSON.parse(body) as { keys?: KeychainKeyView[]; sources?: KeychainSources; scannedAt?: number }
      if (!Array.isArray(data.keys)) return
      set({ keys: data.keys, sources: data.sources || null, scannedAt: data.scannedAt || Date.now(), loading: false, error: null })
    } catch {
      set({ loading: false, error: 'could not reach the Oasis' })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

function wanted(): boolean {
  return state.open || state.mapWatching
}

function syncTimer(): void {
  if (typeof window === 'undefined') return
  if (wanted() && timer === null) {
    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshKeychain()
    }, REFRESH_MS)
  } else if (!wanted() && timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

/** The skill map is open (or closed): it needs the states for its gems. */
export function watchKeychainFromMap(on: boolean): void {
  if (on === state.mapWatching) return
  set({ mapWatching: on })
  if (on) void refreshKeychain()
}

/**
 * The keychain lives on the Character menu's Keys tab. `focusKey`: a key to scroll to and light up ("needs a
 * key" on a spell opens it there).
 */
export function openKeychain(focusKey?: string | null): void {
  openCharacter('keys', { focusKey: typeof focusKey === 'string' ? focusKey : null })
}

/** Close the menu if it shows the keychain. */
export function closeKeychain(): void {
  const character = getCharacterState()
  if (character.open && character.tab === 'keys') closeCharacter()
}

/** The Character menu says whether the Keys tab is on screen: the list is polled only then (or for the map's gems). */
export function setKeychainShown(on: boolean): void {
  if (on === state.open) return
  set({ open: on, loading: on && state.keys.length === 0 })
  if (on) void refreshKeychain()
}

// ─── changing ───────────────────────────────────────────────────────────────

export type KeychainChange =
  | { key: string; action: 'have' | 'unmark' }
  | { key: string; action: 'store'; value: string; name?: string }

/** Mark, unmark, or store a pasted key. The value is passed on and dropped; the answer holds none. */
export async function changeKeychain(change: KeychainChange): Promise<{ ok: boolean; error?: string; warning?: string; file?: string; restart?: boolean }> {
  try {
    const response = await fetch('/api/academy/keychain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) })
    const data = await response.json().catch(() => ({})) as { error?: string; key?: KeychainKeyView; warning?: string; file?: string; restart?: boolean }
    if (!response.ok) return { ok: false, error: data.error || `HTTP ${response.status}` }
    lastBody = ''
    // The spell book asks again which spells have their key.
    forgetFeatureKeyStates()
    await refreshKeychain(true)
    return { ok: true, ...(data.warning ? { warning: data.warning } : {}), ...(data.file ? { file: data.file } : {}), ...(data.restart ? { restart: true } : {}) }
  } catch {
    return { ok: false, error: 'could not reach the Oasis' }
  }
}

// Dev-only console helpers (playtests): window.__oasisKeychain.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisKeychain = {
    state: () => state,
    open: () => openKeychain(),
    close: () => closeKeychain(),
    refresh: (fresh = true) => refreshKeychain(fresh),
  }
}
