export { QUEST_ZERO_WORLD_ID } from './portal-gates'

export const SPELL_IDS = [
  'firebolt',
  'lightning-bolt',
  'ice-bolt',
  'brush-wand',
  'catalog-place',
  'text-to-3d',
  'text-to-pic',
  'text-to-pic-building',
  'text-to-music',
  'text-to-video',
  'meshy-object',
  'meshy-character',
  'portal-create',
  'sky-background',
  'ground-texture',
  'ground-elevation',
  'lights',
  'text-3d',
  'own-audio-upload',
  'own-video-upload',
  'own-image-upload',
  'summon-djinn',
  'summon-custom-npc',
  'summon-openclaw',
  'summon-hermes',
  'browser',
  'summon-fighter-npc',
] as const

export type SpellId = typeof SPELL_IDS[number]

export const HOSTED_USER_LOCKED_SPELL_IDS = [
  'text-to-video',
  'meshy-object',
  'meshy-character',
  'summon-fighter-npc',
] as const satisfies readonly SpellId[]

export function isHostedUserLockedSpell(id: SpellId): boolean {
  return (HOSTED_USER_LOCKED_SPELL_IDS as readonly SpellId[]).includes(id)
}

export type SpellActionId =
  | 'cast-firebolt'
  | 'open-place-menu'
  | 'open-wizard'
  | 'open-sky-panel'
  | 'open-ground-texture'
  | 'open-ground-elevation'
  | 'open-lights-panel'
  | 'open-paint-wand'
  | 'open-text-3d'
  | 'open-agent-launcher'
  | 'place-merlin'
  | 'place-openclaw'
  | 'place-hermes'
  | 'place-browser'

export const SPELLBOOK_PAGE_IDS = [
  'recipe-catalog',
  'premium',
  'world-root',
  'creative',
  'own-spells',
  'combat',
  'agent',
] as const

export type SpellbookPageId = typeof SPELLBOOK_PAGE_IDS[number]

export interface SpellbookPageDefinition {
  id: SpellbookPageId
  name: string
  shortName: string
}

export const SPELLBOOK_PAGES: Record<SpellbookPageId, SpellbookPageDefinition> = {
  'recipe-catalog': { id: 'recipe-catalog', name: 'Recipe Catalog', shortName: 'Recipe' },
  premium: { id: 'premium', name: 'Premium Craft', shortName: 'Premium' },
  'world-root': { id: 'world-root', name: 'World Root', shortName: 'World' },
  creative: { id: 'creative', name: 'Creative', shortName: 'Creative' },
  'own-spells': { id: 'own-spells', name: 'Own Spells', shortName: 'Own' },
  combat: { id: 'combat', name: 'Combat', shortName: 'Combat' },
  agent: { id: 'agent', name: 'Agents', shortName: 'Agents' },
}

export interface SpellDefinition {
  id: SpellId
  name: string
  tier: number
  category: SpellbookPageId
  achievementId: string
  summary: string
  stats: string[]
  defaultUnlocked?: boolean
  actionId?: SpellActionId
  lockedSummary?: string
}

export const SPELL_DEFS: Record<SpellId, SpellDefinition> = {
  firebolt: {
    id: 'firebolt',
    name: 'Firebolt',
    tier: 1,
    category: 'combat',
    achievementId: 'learn-firebolt',
    summary: 'A fast flame projectile. Left click or tap Fire to cast.',
    stats: ['1 mana', '24 m/s', 'Left click or Fire button'],
    actionId: 'cast-firebolt',
  },
  'lightning-bolt': {
    id: 'lightning-bolt',
    name: 'Lightning Bolt',
    tier: 2,
    category: 'combat',
    achievementId: 'learn-lightning-bolt',
    summary: 'A direct shock spell for fast-hit combat encounters.',
    stats: ['1 mana', 'Burst damage', 'Left click or Fire button'],
  },
  'ice-bolt': {
    id: 'ice-bolt',
    name: 'Ice Bolt',
    tier: 2,
    category: 'combat',
    achievementId: 'learn-ice-bolt',
    summary: 'A slowing projectile for monster control and arena fights.',
    stats: ['1 mana', 'Slow', 'Left click or Fire button'],
  },
  'brush-wand': {
    id: 'brush-wand',
    name: 'Brush Wand',
    tier: 1,
    category: 'creative',
    achievementId: 'learn-brush-wand',
    summary: 'Paint persistent world-bound curves and marks.',
    stats: ['Color', 'Thickness', 'World-bound'],
    actionId: 'open-paint-wand',
  },
  'catalog-place': {
    id: 'catalog-place',
    name: 'Place',
    tier: 1,
    category: 'recipe-catalog',
    achievementId: 'learn-place',
    summary: 'Place catalog objects into editable worlds.',
    stats: ['Catalog', 'World allowlist', 'Object inspector'],
    actionId: 'open-place-menu',
  },
  'text-to-3d': {
    id: 'text-to-3d',
    name: 'Text to 3D',
    tier: 2,
    category: 'premium',
    achievementId: 'learn-text-to-3d',
    summary: 'Turn a prompt into a 3D asset or crafted scene.',
    stats: ['AI craft', 'Generated asset', 'Mana/credit gated'],
    actionId: 'open-wizard',
  },
  'text-to-pic': {
    id: 'text-to-pic',
    name: 'Text to Pic',
    tier: 2,
    category: 'premium',
    achievementId: 'learn-text-to-pic',
    summary: 'Generate images for framed art and future Conjure-style buildings.',
    stats: ['Image craft', 'Frames', 'Prompt-first'],
    actionId: 'open-wizard',
  },
  'text-to-pic-building': {
    id: 'text-to-pic-building',
    name: 'Text to Pic Building',
    tier: 2,
    category: 'premium',
    achievementId: 'learn-text-to-pic-building',
    summary: 'Generate a textured in-world image structure in the Conjure building style.',
    stats: ['Image craft', 'Building', 'Prompt-first'],
    actionId: 'open-wizard',
  },
  'text-to-music': {
    id: 'text-to-music',
    name: 'Text to Music',
    tier: 3,
    category: 'premium',
    achievementId: 'learn-text-to-music',
    summary: 'Generate world music or a loopable ambience from a prompt.',
    stats: ['Audio craft', 'Loop', 'Premium'],
    actionId: 'open-wizard',
  },
  'text-to-video': {
    id: 'text-to-video',
    name: 'Text to Video',
    tier: 3,
    category: 'premium',
    achievementId: 'learn-text-to-video',
    summary: 'Generate video panels, rituals, and animated lore surfaces.',
    stats: ['Video craft', 'Panel', 'Premium'],
    actionId: 'open-wizard',
    lockedSummary: 'Local/admin only during the public demo.',
  },
  'meshy-object': {
    id: 'meshy-object',
    name: 'Text to Object',
    tier: 3,
    category: 'premium',
    achievementId: 'learn-meshy-object',
    summary: 'Generate a standalone 3D prop through the external 3D asset pipeline.',
    stats: ['Meshy/Tripo', 'Prop', 'Generated asset'],
    actionId: 'open-wizard',
    lockedSummary: 'Local/admin only during the public demo.',
  },
  'meshy-character': {
    id: 'meshy-character',
    name: 'Text to Character',
    tier: 3,
    category: 'premium',
    achievementId: 'learn-meshy-character',
    summary: 'Generate character-style assets for future NPCs and avatars.',
    stats: ['Meshy/Tripo', 'Character', 'Generated asset'],
    actionId: 'open-wizard',
    lockedSummary: 'Local/admin only during the public demo.',
  },
  'portal-create': {
    id: 'portal-create',
    name: 'Portal Craft',
    tier: 2,
    category: 'world-root',
    achievementId: 'learn-portal-create',
    summary: 'Create gates between worlds and publish spatial paths.',
    stats: ['World link', 'Arrival pose', 'Visibility rules'],
    actionId: 'open-wizard',
  },
  'sky-background': {
    id: 'sky-background',
    name: 'Background',
    tier: 1,
    category: 'world-root',
    achievementId: 'learn-background',
    summary: 'Change the world sky, panorama, or atmosphere backdrop.',
    stats: ['World root', 'Sky', 'Theme'],
    actionId: 'open-sky-panel',
  },
  'ground-texture': {
    id: 'ground-texture',
    name: 'Ground Texture',
    tier: 1,
    category: 'world-root',
    achievementId: 'learn-ground-texture',
    summary: 'Paint terrain material and biome surface detail.',
    stats: ['World root', 'Texture brush', 'Tile-safe'],
    actionId: 'open-ground-texture',
  },
  'ground-elevation': {
    id: 'ground-elevation',
    name: 'Ground Elevation',
    tier: 1,
    category: 'world-root',
    achievementId: 'learn-ground-elevation',
    summary: 'Sculpt hills, depressions, paths, and terrain flow.',
    stats: ['World root', 'Elevation brush', 'Persistent'],
    actionId: 'open-ground-elevation',
  },
  lights: {
    id: 'lights',
    name: 'Lights',
    tier: 1,
    category: 'world-root',
    achievementId: 'learn-lights',
    summary: 'Place and tune world lights for mood and readability.',
    stats: ['World root', 'Color', 'Intensity'],
    actionId: 'open-lights-panel',
  },
  'text-3d': {
    id: 'text-3d',
    name: '3D Text',
    tier: 1,
    category: 'creative',
    achievementId: 'learn-text-3d',
    summary: 'Place editable 3D text into the current world.',
    stats: ['Typography', 'Selectable', 'World-bound'],
    actionId: 'open-text-3d',
  },
  'own-audio-upload': {
    id: 'own-audio-upload',
    name: 'Own MP3',
    tier: 1,
    category: 'own-spells',
    achievementId: 'learn-own-audio-upload',
    summary: 'Bring a sound, chant, or loop into the world library.',
    stats: ['Upload', 'Audio', 'World media'],
    actionId: 'open-wizard',
  },
  'own-video-upload': {
    id: 'own-video-upload',
    name: 'Own MP4',
    tier: 1,
    category: 'own-spells',
    achievementId: 'learn-own-video-upload',
    summary: 'Bring a video panel or moving memory into the world.',
    stats: ['Upload', 'Video', 'World media'],
    actionId: 'open-wizard',
  },
  'own-image-upload': {
    id: 'own-image-upload',
    name: 'Own Image',
    tier: 1,
    category: 'own-spells',
    achievementId: 'learn-own-image-upload',
    summary: 'Bring an image, sigil, or texture into the world library.',
    stats: ['Upload', 'Image', 'World media'],
    actionId: 'open-wizard',
  },
  'summon-djinn': {
    id: 'summon-djinn',
    name: 'Summon Djinn',
    tier: 3,
    category: 'agent',
    achievementId: 'learn-summon-djinn',
    summary: 'Call an embodied guide, familiar, or NPC with scoped tools.',
    stats: ['NPC', 'Voice', 'Tool allowlist'],
    actionId: 'place-merlin',
  },
  'summon-custom-npc': {
    id: 'summon-custom-npc',
    name: 'Summon Custom NPC',
    tier: 3,
    category: 'agent',
    achievementId: 'learn-summon-custom-npc',
    summary: 'Open the NPC path for a custom personality, model, voice, and context.',
    stats: ['NPC', 'Personality', 'Context modules'],
    actionId: 'open-agent-launcher',
  },
  'summon-fighter-npc': {
    id: 'summon-fighter-npc',
    name: 'Summon Fighter NPC',
    tier: 3,
    category: 'agent',
    achievementId: 'learn-summon-fighter-npc',
    summary: 'Spawn a future combat-capable agent that will obey arena rules.',
    stats: ['NPC', 'Combat', 'Future physics'],
    actionId: 'open-agent-launcher',
    lockedSummary: 'Fighter NPCs are paused until combat AI is wired.',
  },
  'summon-openclaw': {
    id: 'summon-openclaw',
    name: 'Summon OpenClaw',
    tier: 3,
    category: 'agent',
    achievementId: 'learn-summon-openclaw',
    summary: 'Place the OpenClaw agent as an in-world 3D window.',
    stats: ['Agent', '3D window', 'Embodied tools'],
    actionId: 'place-openclaw',
  },
  'summon-hermes': {
    id: 'summon-hermes',
    name: 'Summon Hermes',
    tier: 3,
    category: 'agent',
    achievementId: 'learn-summon-hermes',
    summary: 'Place Hermes as a spatial assistant for voice and avatar workflows.',
    stats: ['Agent', 'Voice', '3D window'],
    actionId: 'place-hermes',
  },
  browser: {
    id: 'browser',
    name: 'Browser',
    tier: 2,
    category: 'agent',
    achievementId: 'learn-browser',
    summary: 'Open a living web scrying pane for docs, dashboards, maps, and shared references.',
    stats: ['Agent spell', 'Live web pane', 'Baroque frame'],
    actionId: 'place-browser',
  },
}

export function isSpellDefaultUnlocked(spellId: SpellId): boolean {
  return SPELL_DEFS[spellId].defaultUnlocked !== false
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
