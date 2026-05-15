import { describe, expect, it } from 'vitest'

import { NPC_DEFS } from '../npcs'
import {
  ACHIEVEMENT_DEFS,
  QUEST_ZERO_ID,
  QUEST_ZERO_STEP_DEFS,
  QUEST_ZERO_TARGET_STEP_IDS,
  SPELL_DEFS,
} from '../spellbook'

describe('Quest Zero NPC pipeline registry', () => {
  it('defines Fire Guardian as an OpenAI realtime NPC with progression-only tools', () => {
    const guardian = NPC_DEFS['quest-zero-fire-guardian']

    expect(guardian.provider).toBe('openai-realtime')
    expect(guardian.model).toBe('gpt-realtime-2')
    expect(guardian.questId).toBe(QUEST_ZERO_ID)
    expect(guardian.memoryEnabled).toBe(true)
    expect(guardian.contextModules).toContain('firebolt-trial')
    expect(guardian.toolAllowlist).toEqual(['npc_judgement'])
  })

  it('connects Firebolt unlock, targets, and achievements to Quest Zero', () => {
    expect(SPELL_DEFS.firebolt.achievementId).toBe('learn-firebolt')
    expect(ACHIEVEMENT_DEFS['learn-firebolt'].name).toBe('Keeper of the First Flame')
    expect(QUEST_ZERO_STEP_DEFS['unlock-firebolt'].unlocksSpellId).toBe('firebolt')
    expect(QUEST_ZERO_TARGET_STEP_IDS).toEqual([
      'hit-firebolt-target-1',
      'hit-firebolt-target-2',
      'hit-firebolt-target-3',
    ])
  })
})
