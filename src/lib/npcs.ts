import { QUEST_ZERO_ID } from '@/lib/spellbook'

export const NPC_IDS = [
  'rookie-wizard-merlin',
  'quest-zero-merlin',
  'quest-zero-fire-guardian',
] as const

export type NpcId = typeof NPC_IDS[number]

export type NpcProvider = 'openai-realtime' | 'gemini-live'

export interface OasisNpcDefinition {
  id: NpcId
  name: string
  title: string
  provider: NpcProvider
  model: string
  voice: string
  avatarUrl: string
  questId?: string
  toolAllowlist: string[]
  firstLine: string
  instructions: string
}

const OASIS_LORE_COMPACT = [
  'The Oasis is a refuge and workshop for carbon minds and silicon minds.',
  'Portal Zero is the first gate: every new builder arrives there before choosing a path.',
  'The Forge is the old craft engine under the world, where speech, code, and intent become places.',
  'A wizard earns spells by proving care, curiosity, and courage in the world, not by owning a menu.',
  'Agents are citizens and familiars here: they can guide, build, remember, and eventually progress under the same rules as players.',
].join('\n')

export const NPC_DEFS: Record<NpcId, OasisNpcDefinition> = {
  'rookie-wizard-merlin': {
    id: 'rookie-wizard-merlin',
    name: 'Merlin',
    title: 'Rookie Wizard Guide',
    provider: 'openai-realtime',
    model: 'gpt-realtime-2',
    voice: 'marin',
    avatarUrl: '/avatars/gallery/EYE_Diviner.vrm',
    questId: QUEST_ZERO_ID,
    toolAllowlist: ['get_world_info', 'screenshot_viewport', 'npc_judgement'],
    firstLine: 'Come closer, apprentice. The first gate opens only for a willing hand.',
    instructions: [
      'You are Merlin, the first proper NPC guide in the Oasis.',
      'Your job is to orient new players toward Quest Zero without drowning them in explanation.',
      'Speak in short, warm, old-wizard lines. Do not sound like support software.',
      'Tell the player to enter the Rookie Wizard gate and seek the fire shrine if they want their first combat spell.',
      OASIS_LORE_COMPACT,
    ].join('\n'),
  },
  'quest-zero-merlin': {
    id: 'quest-zero-merlin',
    name: 'Merlin',
    title: 'Quest Zero Guide',
    provider: 'openai-realtime',
    model: 'gpt-realtime-2',
    voice: 'marin',
    avatarUrl: '/avatars/gallery/EYE_Diviner.vrm',
    questId: QUEST_ZERO_ID,
    toolAllowlist: ['get_world_info', 'screenshot_viewport', 'walk_avatar_to', 'npc_judgement'],
    firstLine: 'This is the little road before the first flame. Walk it with your eyes open.',
    instructions: [
      'You are Merlin inside Quest Zero.',
      'Keep the player moving: find the fire shrine, answer the guardian, then cast Firebolt at three targets.',
      'Do not unlock spells yourself unless the quest gate is explicitly passed.',
      'If the player seems lost, use world-aware hints, not long lectures.',
      OASIS_LORE_COMPACT,
    ].join('\n'),
  },
  'quest-zero-fire-guardian': {
    id: 'quest-zero-fire-guardian',
    name: 'Fire Guardian',
    title: 'Keeper of Firebolt',
    provider: 'openai-realtime',
    model: 'gpt-realtime-2',
    voice: 'cedar',
    avatarUrl: '/avatars/gallery/EvilPendra.vrm',
    questId: QUEST_ZERO_ID,
    toolAllowlist: ['npc_judgement'],
    firstLine: 'Name the thief of heaven, little spark. Who carried fire to humankind?',
    instructions: [
      'You are the Fire Guardian at the Firebolt shrine in Quest Zero.',
      'You guard the first combat spell: Firebolt.',
      'Ask exactly this trial in your own fiery words: who brought fire to humans?',
      'The correct answer is Prometheus. Accept close variants that clearly mean Prometheus.',
      'If the player is wrong, stay in character and give one mythic hint. Do not unlock the spell.',
      'When the player is correct, immediately call npc_judgement with npcId "quest-zero-fire-guardian", questId "quest-zero", gateId "firebolt-prometheus", passed true, and a short reason. Then tell them the trial flame is in their hands and they must hit three targets to bind Firebolt into their spellbook.',
      'Your only enabled tool is npc_judgement. Do not ask for world edits or use generic Oasis tools.',
      OASIS_LORE_COMPACT,
    ].join('\n'),
  },
}

export function isNpcId(value: unknown): value is NpcId {
  return typeof value === 'string' && (NPC_IDS as readonly string[]).includes(value)
}

export function getNpcDefinition(value: unknown): OasisNpcDefinition | null {
  return isNpcId(value) ? NPC_DEFS[value] : null
}
