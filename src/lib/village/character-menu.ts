// ░▒▓ CHARACTER MENU — the player's menu: who you are, your skills, your keys ▓▒░
// Pure: the tabs and what a key press means. The owner, 2026-11-19: "it's not a profile, man... a cool
// looking player menu", "in Diablo we have the character and we have the skills". One menu, three tabs.

export type CharacterTab = 'character' | 'skills' | 'keys'

export const CHARACTER_TABS: Array<{ id: CharacterTab; label: string; hint: string }> = [
  { id: 'character', label: 'Character', hint: 'Level, XP, avatar, accounts' },
  { id: 'skills', label: 'Skills', hint: 'The skill map (K)' },
  { id: 'keys', label: 'Keys', hint: 'The keychain' },
]

export function isCharacterTab(value: unknown): value is CharacterTab {
  return value === 'character' || value === 'skills' || value === 'keys'
}

/** K: the skill map. Same as the skill map's key before it moved into this menu. */
export const CHARACTER_SKILLS_KEY = 'KeyK'

export interface CharacterKeyContext {
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  repeat: boolean
  /** The key went into a text field. */
  typing: boolean
  open: boolean
  tab: CharacterTab
  /** A skill's sheet is open over the menu: it takes Esc first. */
  readerOpen: boolean
  /** An agent's panel is open: K is a letter there. */
  agentOpen: boolean
  /** The world's keys are free (walking around, nothing else open). */
  worldKeysFree: boolean
}

export type CharacterKeyAction = 'open-skills' | 'to-skills' | 'close'

/**
 * K opens the menu on Skills; K on Skills closes it, K on another tab goes to Skills. Esc closes it,
 * unless a skill's sheet is open (that closes first) or a text field has the keyboard.
 */
export function characterKeyAction(c: CharacterKeyContext): CharacterKeyAction | null {
  if (c.ctrl || c.meta || c.alt || c.repeat) return null
  if (c.open) {
    if (c.code === 'Escape') return c.readerOpen || c.typing ? null : 'close'
    if (c.code !== CHARACTER_SKILLS_KEY || c.typing || c.readerOpen) return null
    return c.tab === 'skills' ? 'close' : 'to-skills'
  }
  if (c.code !== CHARACTER_SKILLS_KEY || c.typing || c.agentOpen || !c.worldKeysFree) return null
  return 'open-skills'
}

/** XP still to go and the level's span, from what /api/profile says (progress is a share of the span). */
export function levelProgressNumbers(xp: number, levelProgress: number, xpToNext: number): { into: number; span: number; left: number } {
  const span = Math.max(1, Math.round(xpToNext))
  const into = Math.max(0, Math.min(span, Math.round(Math.max(0, Math.min(1, levelProgress)) * span)))
  return { into, span, left: span - into }
}
