// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// XP & LEVEL SYSTEM — The grind that keeps builders building
// ─═̷─═̷─ॐ─═̷─═̷─ Polynomial curve, Diablo-inspired ─═̷─═̷─ॐ─═̷─═̷─
//
// XP_required(level) = floor(100 × level^2.2)
// Level 1: 100 XP, Level 10: 15,849 XP, Level 50: ~850K XP
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░


// ═══════════════════════════════════════════════════════════════════════════
// XP AWARDS — hardcoded defaults, overridable via admin dashboard
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_XP_AWARDS = {
  // Building actions
  PLACE_CATALOG_OBJECT: 5,
  CONJURE_ASSET: 25,
  CRAFT_SCENE: 30,
  GENERATE_IMAGE: 15,
  PAINT_GROUND_BATCH: 10,    // per ~10 tiles painted
  ADD_LIGHT: 5,

  // World milestones
  FIRST_OBJECT_IN_WORLD: 50,
  FIRST_WORLD_CREATED: 200,
  SET_WORLD_PUBLIC: 100,
  WORLD_10_OBJECTS: 50,
  WORLD_50_OBJECTS: 150,

  // Social actions
  WORLD_VISITED: 2,          // passive: someone visits your world
  WORLD_UPVOTED: 10,         // passive: someone upvotes your world
  VISIT_OTHER_WORLD: 3,      // active: you explore
  UPVOTE_WORLD: 2,           // active: you participate
  DAILY_LOGIN: 15,

  // Collaboration
  CO_BUILD: 15,              // build in someone else's world

  // Meta
  VIBECODE_REPORT: 100,      // Anorak vibecode: LLM-assisted deep report

  // Onboarding quests — 3x multiplier on first-time actions
  QUEST_STEP_COMPLETE: 25,   // per quest step completed (bonus on top of normal XP)
  QUEST_ALL_COMPLETE: 200,   // all 7 quests done — builder is onboarded
} as const

// Backwards compat — code that imports XP_AWARDS still works
export const XP_AWARDS = DEFAULT_XP_AWARDS

export type XpAction = keyof typeof DEFAULT_XP_AWARDS

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL XP CONFIG — af_oasis uses local defaults
// ═══════════════════════════════════════════════════════════════════════════

/** XP awards are local-first in af_oasis. */
export async function getXpAwards(): Promise<Record<string, number>> {
  return { ...DEFAULT_XP_AWARDS }
}

/** Get XP for a specific action from local defaults. */
export async function getXpForAction(action: string): Promise<number> {
  return DEFAULT_XP_AWARDS[action as XpAction] ?? 0
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL CALCULATION — polynomial curve, exponent 2.2
// ═══════════════════════════════════════════════════════════════════════════

const LEVEL_EXPONENT = 2.2
const LEVEL_BASE = 100
const MAX_LEVEL = 99

/** Total XP required to REACH a given level (cumulative from level 1) */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0
  let total = 0
  for (let l = 1; l < level; l++) {
    total += Math.floor(LEVEL_BASE * Math.pow(l, LEVEL_EXPONENT))
  }
  return total
}

/** XP needed to go from current level to next level */
export function xpToNextLevel(level: number): number {
  return Math.floor(LEVEL_BASE * Math.pow(level, LEVEL_EXPONENT))
}

/** Calculate level from total XP */
export function levelFromXp(totalXp: number): number {
  let level = 1
  let xpAccumulated = 0
  while (level < MAX_LEVEL) {
    const needed = Math.floor(LEVEL_BASE * Math.pow(level, LEVEL_EXPONENT))
    if (xpAccumulated + needed > totalXp) break
    xpAccumulated += needed
    level++
  }
  return level
}

/** Progress within current level (0.0 to 1.0) */
export function levelProgress(totalXp: number): number {
  const level = levelFromXp(totalXp)
  const xpAtLevel = xpRequiredForLevel(level)
  const xpForNext = xpToNextLevel(level)
  if (xpForNext <= 0) return 1
  return Math.min(1, (totalXp - xpAtLevel) / xpForNext)
}

// ═══════════════════════════════════════════════════════════════════════════
// LEVEL TITLES — The path from Apprentice to Enlightened
// ═══════════════════════════════════════════════════════════════════════════

export interface LevelTitle {
  minLevel: number
  maxLevel: number
  title: string
  badge: string    // short symbol for chat/cards
}

export const LEVEL_TITLES: LevelTitle[] = [
  { minLevel: 1,  maxLevel: 4,  title: 'Apprentice',   badge: '░' },
  { minLevel: 5,  maxLevel: 9,  title: 'Journeyman',   badge: '▒' },
  { minLevel: 10, maxLevel: 14, title: 'Architect',     badge: '▓' },
  { minLevel: 15, maxLevel: 19, title: 'Worldsmith',    badge: '█' },
  { minLevel: 20, maxLevel: 24, title: 'Dreamweaver',   badge: '◈' },
  { minLevel: 25, maxLevel: 29, title: 'Archmage',      badge: '✦' },
  { minLevel: 30, maxLevel: 39, title: 'Oasis Elder',   badge: '❖' },
  { minLevel: 40, maxLevel: 49, title: 'Realm Lord',    badge: '☯' },
  { minLevel: 50, maxLevel: 99, title: 'Enlightened',   badge: 'ॐ' },
]

export function getLevelTitle(level: number): LevelTitle {
  return LEVEL_TITLES.find(t => level >= t.minLevel && level <= t.maxLevel)
    || LEVEL_TITLES[LEVEL_TITLES.length - 1]
}

// ═══════════════════════════════════════════════════════════════════════════
// WORLD VISIBILITY — who can see what
// ═══════════════════════════════════════════════════════════════════════════

export type WorldVisibility = 'private' | 'public' | 'unlisted' | 'public_edit' | 'only-with-link' | 'ffa' | 'core' | 'template'

// ▓▓▓▓【X̸P̸】▓▓▓▓ॐ▓▓▓▓【L̸E̸V̸E̸L̸】▓▓▓▓
