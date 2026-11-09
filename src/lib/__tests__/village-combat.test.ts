import { describe, expect, it } from 'vitest'

import {
  FULL_VITALS,
  VILLAGE_AGENT_MAX_HP,
  VILLAGE_DOWN_MS,
  VILLAGE_FLINCH_MS,
  VILLAGE_REGEN_AFTER_MS,
  applyVillageHit,
  isFlinching,
  isVillageAgentDown,
  vitalsAt,
} from '../village/village-combat'

describe('village combat', () => {
  it('four 25-point bolts knock an agent out', () => {
    let v = FULL_VITALS
    for (let i = 0; i < 3; i++) {
      const r = applyVillageHit(v, 25, 1000 + i * 100)
      expect(r.lethal).toBe(false)
      v = r.vitals
    }
    expect(v.hp).toBe(25)
    const last = applyVillageHit(v, 25, 1400)
    expect(last.lethal).toBe(true)
    expect(last.vitals.hp).toBe(0)
    expect(isVillageAgentDown(last.vitals, 1500)).toBe(true)
  })

  it('a knocked-out agent cannot be hit, then gets up with full HP', () => {
    const down = applyVillageHit({ ...FULL_VITALS, hp: 10 }, 25, 1000).vitals
    const again = applyVillageHit(down, 25, 2000)
    expect(again.landed).toBe(false)
    const up = vitalsAt(down, 1000 + VILLAGE_DOWN_MS)
    expect(up.hp).toBe(VILLAGE_AGENT_MAX_HP)
    expect(up.downAt).toBeNull()
  })

  it('heals fully after a while without hits', () => {
    const hurt = applyVillageHit(FULL_VITALS, 25, 1000).vitals
    expect(vitalsAt(hurt, 1000 + VILLAGE_REGEN_AFTER_MS - 1).hp).toBe(75)
    expect(vitalsAt(hurt, 1000 + VILLAGE_REGEN_AFTER_MS).hp).toBe(VILLAGE_AGENT_MAX_HP)
  })

  it('flinches briefly after a hit that is not lethal', () => {
    const hurt = applyVillageHit(FULL_VITALS, 25, 1000).vitals
    expect(isFlinching(hurt, 1000 + VILLAGE_FLINCH_MS - 1)).toBe(true)
    expect(isFlinching(hurt, 1000 + VILLAGE_FLINCH_MS)).toBe(false)
  })

  it('keeps a few recent damage numbers for the HUD', () => {
    let v = FULL_VITALS
    v = applyVillageHit(v, 25, 1000).vitals
    v = applyVillageHit(v, 25, 1100).vitals
    expect(v.hits.map(hit => hit.amount)).toEqual([25, 25])
    v = applyVillageHit(v, 25, 5000).vitals
    expect(v.hits).toHaveLength(1)
  })
})
