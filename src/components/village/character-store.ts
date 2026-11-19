// ░▒▓ CHARACTER STORE — is the player menu open, on which tab, and which key to show ▓▒░
// One small external store. The skill map (academy-store) and the keychain (keychain-store) open through
// here, so "needs a key" anywhere lands in the same menu, on the Keys tab, at that key.

import { useSyncExternalStore } from 'react'

import { isCharacterTab, type CharacterTab } from '../../lib/village/character-menu'

export const CHARACTER_MENU_LAYER = 'character-menu'
const TAB_KEY = 'oasis-character-tab'

export interface CharacterState {
  open: boolean
  tab: CharacterTab
  /** A keychain key to scroll to and light up on the Keys tab. Cleared once shown. */
  focusKey: string | null
  /** Bumps on every request to focus, so the same key can be asked for twice. */
  focusNonce: number
}

function storedTab(): CharacterTab {
  try {
    const value = typeof window === 'undefined' ? null : window.localStorage.getItem(TAB_KEY)
    return isCharacterTab(value) ? value : 'character'
  } catch {
    return 'character'
  }
}

let state: CharacterState = { open: false, tab: storedTab(), focusKey: null, focusNonce: 0 }
const listeners = new Set<() => void>()

function set(patch: Partial<CharacterState>): void {
  state = { ...state, ...patch }
  if (patch.tab) {
    try { window.localStorage.setItem(TAB_KEY, patch.tab) } catch { /* storage off */ }
  }
  listeners.forEach(listener => listener())
}

export function getCharacterState(): CharacterState {
  return state
}

export function subscribeCharacter(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useCharacterState(): CharacterState {
  return useSyncExternalStore(subscribeCharacter, getCharacterState, getCharacterState)
}

/** Open the menu (on `tab`, or where it was last); `focusKey`: a keychain key to show on the Keys tab. */
export function openCharacter(tab?: CharacterTab, options: { focusKey?: string | null } = {}): void {
  const focusKey = options.focusKey || null
  set({
    open: true,
    tab: focusKey ? 'keys' : tab || state.tab,
    focusKey,
    focusNonce: focusKey ? state.focusNonce + 1 : state.focusNonce,
  })
}

export function setCharacterTab(tab: CharacterTab): void {
  if (tab !== state.tab) set({ tab, focusKey: null })
}

export function closeCharacter(): void {
  if (state.open) set({ open: false, focusKey: null })
}

export function clearCharacterFocus(): void {
  if (state.focusKey) set({ focusKey: null })
}

// Dev-only console helpers (playtests): window.__oasisCharacter.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisCharacter = {
    state: () => state,
    open: (tab?: CharacterTab, focusKey?: string) => openCharacter(tab, { focusKey }),
    close: () => closeCharacter(),
  }
}
