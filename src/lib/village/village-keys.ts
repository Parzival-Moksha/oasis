// ░▒▓ VILLAGE KEYS — what a key press means in the village (pure, so it can be tested) ▓▒░
//
// Next to an agent: T opens its talk window with the mic on, E opens it quietly (to write), F opens it
// straight on its full screen.
// With an agent open (side panel or its screen, the text box not focused): T starts / stops the mic,
// Enter sends what is in the box, F zooms onto its screen and back, Esc leaves the screen (one more Esc
// leaves the agent, through the input manager; a screen opened with F straight from the world leaves in one).
// Esc never stops the mic: dictation goes on after leaving (the voice widget, bottom left). Mouse-look comes
// back with a click on the scene.
// N jumps to the next agent that needs you. In the summoning circle E opens the picker.

export type VillageKeyAction =
  | 'toggle-voice'
  | 'toggle-screen'
  | 'send'
  | 'escape'
  | 'talk'
  | 'open'
  | 'screen'
  | 'picker'
  | 'next'

export interface VillageKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  repeat: boolean
  /** The key went into a text field (the agent's box, a search field…): it is typing, not a command. */
  typing: boolean
  focusedAgentId: string | null
  nearbyAgentId: string | null
  /** The world's keys are free for the village (walking around, or already in the session view). */
  worldKeysFree: boolean
  inPlaza: boolean
  agentCount: number
}

export function villageKeyAction(c: VillageKeyContext): VillageKeyAction | null {
  // Ctrl+Space dictates into the open agent's box, even while typing in it.
  if (c.ctrl && !c.alt && !c.meta && c.code === 'Space' && !c.repeat && c.focusedAgentId) return 'toggle-voice'
  if (c.ctrl || c.meta || c.alt || c.repeat || c.typing) return null
  if (c.focusedAgentId) {
    if (c.code === 'KeyT') return 'toggle-voice'
    if (c.code === 'KeyF') return 'toggle-screen'
    if (c.code === 'Enter' && !c.shift) return 'send'
    if (c.code === 'Escape') return 'escape'
  }
  // Placement, paint and other panels keep their keys (E is noclip "down", T the rotate gizmo).
  if (!c.worldKeysFree) return null
  if (c.code === 'KeyE' || c.code === 'KeyT' || c.code === 'KeyF') {
    const target = c.nearbyAgentId
    if (!target) return c.code === 'KeyE' && c.inPlaza && !c.focusedAgentId ? 'picker' : null
    if (target === c.focusedAgentId) return null
    return c.code === 'KeyT' ? 'talk' : c.code === 'KeyE' ? 'open' : 'screen'
  }
  if (c.code === 'KeyN' && !c.shift) return c.agentCount > 0 ? 'next' : null
  return null
}

// ─── the text box: grows with what you say, up to a cap, then scrolls ────────

export interface ComposerHeightInput {
  /** The text's own height (textarea scrollHeight with height:auto). */
  content: number
  min: number
  max: number
  /** Height the owner dragged the box to: it sticks (dictation scrolls inside it) until a double-click on the grip. */
  manual?: number | null
}

export function composerHeight({ content, min, max, manual }: ComposerHeightInput): number {
  const cap = Math.max(min, max)
  if (manual) return Math.round(Math.min(cap, Math.max(min, manual)))
  return Math.round(Math.max(min, Math.min(content, cap)))
}

/** Thread the box always leaves visible above it, so the header and the latest lines stay readable. */
export const COMPOSER_MIN_THREAD_PX = 140

/** The cap where the box is now: its height plus the thread's, minus the thread's minimum. */
export function composerRoom(boxHeight: number, threadHeight: number | null, min: number, max: number): number {
  const room = threadHeight === null ? Infinity : boxHeight + threadHeight - COMPOSER_MIN_THREAD_PX
  return Math.round(Math.max(min, Math.min(max, room)))
}

/** The tallest the box may get: about 450 px, but under half of what holds it, so the thread stays readable. */
export function composerMaxHeight(containerHeight: number, cap = 450): number {
  return Math.max(96, Math.min(cap, Math.round(containerHeight * 0.45)))
}
