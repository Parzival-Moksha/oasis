export { QUEST_ZERO_WORLD_ID } from './portal-gates'

export const SPELL_IDS = [
  'firebolt',
  'brush-wand',
  'catalog-place',
  'text-to-3d',
  'text-to-pic',
  'portal-create',
  'summon-djinn',
] as const

export type SpellId = typeof SPELL_IDS[number]

export interface SpellDefinition {
  id: SpellId
  name: string
  tier: number
  category: 'combat' | 'creation' | 'npc'
  achievementId: string
}

export const SPELL_DEFS: Record<SpellId, SpellDefinition> = {
  firebolt: {
    id: 'firebolt',
    name: 'Firebolt',
    tier: 1,
    category: 'combat',
    achievementId: 'learn-firebolt',
  },
  'brush-wand': {
    id: 'brush-wand',
    name: 'Brush Wand',
    tier: 1,
    category: 'creation',
    achievementId: 'learn-brush-wand',
  },
  'catalog-place': {
    id: 'catalog-place',
    name: 'Place',
    tier: 1,
    category: 'creation',
    achievementId: 'learn-place',
  },
  'text-to-3d': {
    id: 'text-to-3d',
    name: 'Text to 3D',
    tier: 2,
    category: 'creation',
    achievementId: 'learn-text-to-3d',
  },
  'text-to-pic': {
    id: 'text-to-pic',
    name: 'Text to Pic',
    tier: 2,
    category: 'creation',
    achievementId: 'learn-text-to-pic',
  },
  'portal-create': {
    id: 'portal-create',
    name: 'Portal Craft',
    tier: 2,
    category: 'creation',
    achievementId: 'learn-portal-create',
  },
  'summon-djinn': {
    id: 'summon-djinn',
    name: 'Summon Djinn',
    tier: 3,
    category: 'npc',
    achievementId: 'learn-summon-djinn',
  },
}

export const QUEST_ZERO_ID = 'quest-zero'

export const QUEST_ZERO_STEPS = [
  'meet-merlin',
  'enter-quest-zero',
  'answer-fire-guardian',
  'hit-firebolt-target-1',
  'hit-firebolt-target-2',
  'hit-firebolt-target-3',
  'unlock-firebolt',
  'complete',
] as const

export type QuestZeroStepId = typeof QUEST_ZERO_STEPS[number]

export const QUEST_ZERO_TARGET_STEP_IDS: QuestZeroStepId[] = [
  'hit-firebolt-target-1',
  'hit-firebolt-target-2',
  'hit-firebolt-target-3',
]

export interface QuestStepDefinition {
  id: QuestZeroStepId
  name: string
  unlocksSpellId?: SpellId
}

export const QUEST_ZERO_STEP_DEFS: Record<QuestZeroStepId, QuestStepDefinition> = {
  'meet-merlin': {
    id: 'meet-merlin',
    name: 'Meet Merlin',
  },
  'enter-quest-zero': {
    id: 'enter-quest-zero',
    name: 'Enter Quest Zero',
  },
  'answer-fire-guardian': {
    id: 'answer-fire-guardian',
    name: 'Answer the Fire Guardian',
  },
  'unlock-firebolt': {
    id: 'unlock-firebolt',
    name: 'Learn Firebolt',
    unlocksSpellId: 'firebolt',
  },
  'hit-firebolt-target-1': {
    id: 'hit-firebolt-target-1',
    name: 'Hit Fire Target I',
  },
  'hit-firebolt-target-2': {
    id: 'hit-firebolt-target-2',
    name: 'Hit Fire Target II',
  },
  'hit-firebolt-target-3': {
    id: 'hit-firebolt-target-3',
    name: 'Hit Fire Target III',
  },
  complete: {
    id: 'complete',
    name: 'Complete Quest Zero',
  },
}

export const ACHIEVEMENT_DEFS = {
  'learn-first-spell': {
    id: 'learn-first-spell',
    name: 'First Glimmer',
    xp: 25,
  },
  'learn-firebolt': {
    id: 'learn-firebolt',
    name: 'Keeper of the First Flame',
    xp: 25,
  },
  'first-firebolt-hit': {
    id: 'first-firebolt-hit',
    name: 'First Impact',
    xp: 25,
  },
  'quest-zero-complete': {
    id: 'quest-zero-complete',
    name: 'Rookie Wizard',
    xp: 50,
  },
} as const

export type AchievementId = keyof typeof ACHIEVEMENT_DEFS

export function isSpellId(value: unknown): value is SpellId {
  return typeof value === 'string' && (SPELL_IDS as readonly string[]).includes(value)
}

export function isQuestZeroStepId(value: unknown): value is QuestZeroStepId {
  return typeof value === 'string' && (QUEST_ZERO_STEPS as readonly string[]).includes(value)
}

export function isAchievementId(value: unknown): value is AchievementId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACHIEVEMENT_DEFS, value)
}
