import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAYER_SKILLS,
  PLAYER_BASE_STATS,
  buildPlayerProgression,
  computePlayerStats,
  earnedSkillPointsForLevel,
  normalizePlayerSkills,
} from '../player-progression'

describe('player progression', () => {
  it('starts Rookie Wizard players with 100 HP and 20 mana', () => {
    const progression = buildPlayerProgression({ level: 1 })

    expect(progression.hp).toBe(100)
    expect(progression.maxHp).toBe(100)
    expect(progression.mana).toBe(20)
    expect(progression.maxMana).toBe(20)
    expect(progression.stats.fireboltManaCost).toBe(5)
    expect(progression.stats.fireboltSpeedMetersPerSecond).toBe(24)
  })

  it('awards one skill point per level after level 1', () => {
    expect(earnedSkillPointsForLevel(1)).toBe(0)
    expect(earnedSkillPointsForLevel(2)).toBe(1)
    expect(earnedSkillPointsForLevel(7)).toBe(6)
  })

  it('computes wizard stats from magic-first skills', () => {
    const skills = normalizePlayerSkills({
      ...DEFAULT_PLAYER_SKILLS,
      fire: 2,
      focus: 3,
      vitality: 1,
      conjuration: 4,
    })
    const stats = computePlayerStats(skills)

    expect(stats.fireboltDamage).toBe(24)
    expect(stats.maxMana).toBe(50)
    expect(stats.maxHp).toBe(125)
    expect(stats.conjureManaCost).toBe(12)
    expect(stats.fireboltManaCost).toBe(PLAYER_BASE_STATS.fireboltManaCost)
  })
})
