// "Escape opens the main menu when nothing else is open", as one decision over a snapshot.
// The snapshot is taken in two halves by the listener in GameMenu.tsx: what the Oasis looked like
// before anyone handled the key, and what had changed once everyone had.

import type { InputState } from '@/lib/input-manager'

export type MenuPhase = 'closed' | 'open' | 'returning'

export interface EscapeSnapshot {
  /** Before the key was handled. */
  inputState: InputState
  uiLayers: number
  typing: boolean
  selectedObject: boolean
  /** A village agent's panel or screen is open. */
  agentOpen: boolean
  panelsBefore: number
  /** After every other handler ran. */
  panelsAfter: number
  inputStateAfter: InputState
  /** The key reached the end of its path: nobody stopped it on the way. */
  reachedBubble: boolean
  defaultPrevented: boolean
  menuPhase: MenuPhase
}

const BASE_STATES: ReadonlySet<InputState> = new Set<InputState>(['orbit', 'noclip', 'third-person'])

export function menuShouldOpenOnEscape(s: EscapeSnapshot): boolean {
  if (s.menuPhase !== 'closed') return false
  if (!BASE_STATES.has(s.inputState)) return false // placing, painting, typing, inside an agent
  if (s.uiLayers > 0 || s.typing || s.selectedObject || s.agentOpen) return false
  if (!s.reachedBubble || s.defaultPrevented) return false // a panel took the key
  if (s.panelsAfter < s.panelsBefore) return false // a panel closed on this key
  if (s.inputStateAfter !== s.inputState) return false
  return true
}
