// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useRailMenuExclusion — only one left-rail menu open at a time
// ─═̷─═̷─🪟─═̷─═̷─ Each rail menu calls this hook with a unique name + its
// open/close state. When any menu opens, all OTHERS close. Implemented via
// a window CustomEvent so menus don't need to share React state — works
// across internal-state menus (SettingsMenu) AND parent-controlled menus
// (Spellbook, AgentLauncher) uniformly.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

'use client'

import { useEffect } from 'react'

export type RailMenuId =
  | 'settings'
  | 'spellbook'
  | 'agents'
  | 'help'
  | 'world'
  | 'place'
  | 'profile'
  | 'wizard'

const EVENT_NAME = 'oasis:rail-menu-open'

interface RailMenuOpenDetail {
  menuId: RailMenuId
}

export function useRailMenuExclusion(
  menuId: RailMenuId,
  isOpen: boolean,
  close: () => void,
) {
  // ░▒▓ Broadcast: when our own isOpen flips to true, tell other menus to close.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent<RailMenuOpenDetail>(EVENT_NAME, { detail: { menuId } }))
  }, [isOpen, menuId])

  // ░▒▓ Listen: if any OTHER menu opens while we're open, close ourselves.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOtherOpen = (event: Event) => {
      const detail = (event as CustomEvent<RailMenuOpenDetail>).detail
      if (!detail) return
      if (detail.menuId === menuId) return
      close()
    }
    window.addEventListener(EVENT_NAME, onOtherOpen)
    return () => window.removeEventListener(EVENT_NAME, onOtherOpen)
  }, [menuId, close])
}
