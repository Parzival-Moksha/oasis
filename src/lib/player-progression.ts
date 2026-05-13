export const PLAYER_SKILL_CAP = 5

export const PLAYER_BASE_STATS = {
  hp: 100,
  mana: 20,
  fireboltManaCost: 5,
  fireboltSpeedMetersPerSecond: 24,
  conjureManaCost: 20,
} as const

export const PLAYER_SKILL_KEYS = [
  'fire',
  'ice',
  'lightning',
  'vitality',
  'focus',
  'conjuration',
  'mobility',
] as const

export type PlayerSkillKey = typeof PLAYER_SKILL_KEYS[number]
export type PlayerSkillSet = Record<PlayerSkillKey, number>

export interface PlayerComputedStats {
  maxHp: number
  maxMana: number
  fireboltDamage: number
  fireboltManaCost: number
  fireboltSpeedMetersPerSecond: number
  manaRegenMultiplier: number
  conjureManaCost: number
  moveSpeedMultiplier: number
}

export interface PlayerProgression {
  hp: number
  mana: number
  maxHp: number
  maxMana: number
  unspentSkillPoints: number
  skills: PlayerSkillSet
  stats: PlayerComputedStats
}

export const DEFAULT_PLAYER_SKILLS: PlayerSkillSet = {
  fire: 0,
  ice: 0,
  lightning: 0,
  vitality: 0,
  focus: 0,
  conjuration: 0,
  mobility: 0,
}

export const PLAYER_SKILL_DEFS: Array<{
  id: PlayerSkillKey
  label: string
  shortLabel: string
  tone: string
  description: string
}> = [
  { id: 'fire', label: 'Fire', shortLabel: 'FIR', tone: '#f97316', description: 'Firebolt power and future burn effects.' },
  { id: 'ice', label: 'Ice', shortLabel: 'ICE', tone: '#38bdf8', description: 'Ice bolt control and future chill/freeze effects.' },
  { id: 'lightning', label: 'Lightning', shortLabel: 'LIT', tone: '#a78bfa', description: 'Lightning bolt speed and future chain effects.' },
  { id: 'vitality', label: 'Vitality', shortLabel: 'VIT', tone: '#22c55e', description: 'Maximum HP for dangerous quest and PvP worlds.' },
  { id: 'focus', label: 'Focus', shortLabel: 'FOC', tone: '#06b6d4', description: 'Maximum mana and mana regeneration multiplier.' },
  { id: 'conjuration', label: 'Conjuration', shortLabel: 'CON', tone: '#f59e0b', description: 'Cheaper creation magic and later stronger conjures.' },
  { id: 'mobility', label: 'Mobility', shortLabel: 'MOV', tone: '#84cc16', description: 'Movement speed in gameplay-enabled worlds.' },
]

export function clampSkillRank(value: unknown): number {
  const rank = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  return Math.max(0, Math.min(PLAYER_SKILL_CAP, rank))
}

export function normalizePlayerSkills(raw: Partial<Record<PlayerSkillKey, unknown>> = {}): PlayerSkillSet {
  return {
    fire: clampSkillRank(raw.fire),
    ice: clampSkillRank(raw.ice),
    lightning: clampSkillRank(raw.lightning),
    vitality: clampSkillRank(raw.vitality),
    focus: clampSkillRank(raw.focus),
    conjuration: clampSkillRank(raw.conjuration),
    mobility: clampSkillRank(raw.mobility),
  }
}

export function allocatedSkillPoints(skills: PlayerSkillSet): number {
  return PLAYER_SKILL_KEYS.reduce((total, key) => total + skills[key], 0)
}

export function earnedSkillPointsForLevel(level: number): number {
  return Math.max(0, Math.floor(level) - 1)
}

export function computePlayerStats(skills: PlayerSkillSet): PlayerComputedStats {
  return {
    maxHp: PLAYER_BASE_STATS.hp + skills.vitality * 25,
    maxMana: PLAYER_BASE_STATS.mana + skills.focus * 10,
    fireboltDamage: 14 + skills.fire * 5,
    fireboltManaCost: PLAYER_BASE_STATS.fireboltManaCost,
    fireboltSpeedMetersPerSecond: PLAYER_BASE_STATS.fireboltSpeedMetersPerSecond,
    manaRegenMultiplier: 1 + skills.focus * 0.35,
    conjureManaCost: Math.max(10, PLAYER_BASE_STATS.conjureManaCost - skills.conjuration * 2),
    moveSpeedMultiplier: 1 + skills.mobility * 0.07,
  }
}

export function summarizeSkill(skill: PlayerSkillKey, skills: PlayerSkillSet): string {
  const stats = computePlayerStats(skills)
  switch (skill) {
    case 'fire':
      return `${stats.fireboltDamage} firebolt damage`
    case 'ice':
      return skills.ice > 0 ? `chill rank ${skills.ice}` : 'ice bolt locked'
    case 'lightning':
      return skills.lightning > 0 ? `spark rank ${skills.lightning}` : 'lightning locked'
    case 'vitality':
      return `${stats.maxHp} max HP`
    case 'focus':
      return `${stats.maxMana} mana, x${stats.manaRegenMultiplier.toFixed(2)} regen`
    case 'conjuration':
      return `${stats.conjureManaCost} mana conjures`
    case 'mobility':
      return `x${stats.moveSpeedMultiplier.toFixed(2)} move`
  }
}

export function profileToPlayerSkills(profile: {
  skillFire?: number | null
  skillIce?: number | null
  skillLightning?: number | null
  skillVitality?: number | null
  skillFocus?: number | null
  skillConjuration?: number | null
  skillMobility?: number | null
}): PlayerSkillSet {
  return normalizePlayerSkills({
    fire: profile.skillFire ?? 0,
    ice: profile.skillIce ?? 0,
    lightning: profile.skillLightning ?? 0,
    vitality: profile.skillVitality ?? 0,
    focus: profile.skillFocus ?? 0,
    conjuration: profile.skillConjuration ?? 0,
    mobility: profile.skillMobility ?? 0,
  })
}

export function buildPlayerProgression(profile: {
  hp?: number | null
  mana?: number | null
  unspentSkillPoints?: number | null
  level?: number | null
  skillFire?: number | null
  skillIce?: number | null
  skillLightning?: number | null
  skillVitality?: number | null
  skillFocus?: number | null
  skillConjuration?: number | null
  skillMobility?: number | null
}): PlayerProgression {
  const skills = profileToPlayerSkills(profile)
  const stats = computePlayerStats(skills)
  const earned = earnedSkillPointsForLevel(profile.level ?? 1)
  const allocated = allocatedSkillPoints(skills)
  const unspent = Math.max(0, profile.unspentSkillPoints ?? Math.max(0, earned - allocated), earned - allocated)
  return {
    hp: Math.max(0, Math.min(stats.maxHp, profile.hp ?? PLAYER_BASE_STATS.hp)),
    mana: Math.max(0, Math.min(stats.maxMana, profile.mana ?? PLAYER_BASE_STATS.mana)),
    maxHp: stats.maxHp,
    maxMana: stats.maxMana,
    unspentSkillPoints: unspent,
    skills,
    stats,
  }
}

export function profileSkillField(skill: PlayerSkillKey): 'skillFire' | 'skillIce' | 'skillLightning' | 'skillVitality' | 'skillFocus' | 'skillConjuration' | 'skillMobility' {
  switch (skill) {
    case 'fire': return 'skillFire'
    case 'ice': return 'skillIce'
    case 'lightning': return 'skillLightning'
    case 'vitality': return 'skillVitality'
    case 'focus': return 'skillFocus'
    case 'conjuration': return 'skillConjuration'
    case 'mobility': return 'skillMobility'
  }
}
