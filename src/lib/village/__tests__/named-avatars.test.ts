import { describe, expect, it } from 'vitest'
import { assignVillageAvatars, namedAvatarFor, type VillageMemory } from '../village-layout'

const HACKER = '/avatars/gallery/Hacker.vrm'
const catalog = ['/avatars/gallery/A.vrm', '/avatars/gallery/B.vrm', '/avatars/gallery/C.vrm']
const agent = (id: string, name: string) => ({ id, name, sessionId: null }) as never

describe('bodies made for one agent', () => {
  it('knows the Hacker by name, whatever the case, and nobody else', () => {
    expect(namedAvatarFor('Hacker')).toBe(HACKER)
    expect(namedAvatarFor(' hacker ')).toBe(HACKER)
    expect(namedAvatarFor('Hacker 2')).toBeNull()
    expect(namedAvatarFor('Sysadmin')).toBeNull()
    expect(namedAvatarFor(undefined)).toBeNull()
  })

  it('a new agent named Hacker wears his own body, though it is not in the pool', () => {
    const out = assignVillageAvatars([agent('h', 'Hacker'), agent('p', 'Perf')], catalog, [], {}, 5)
    expect(out.avatars.h).toBe(HACKER)
    expect(catalog).toContain(out.avatars.p)
    expect(out.memory.h?.skin).toBe(HACKER)
  })

  it('replaces a body he was dealt before (the Sysadmin renamed), but not one the owner picked', () => {
    const dealt: VillageMemory = { h: { skin: catalog[1], seenAt: 1 } }
    expect(assignVillageAvatars([agent('h', 'Hacker')], catalog, [], dealt, 5).avatars.h).toBe(HACKER)
    const picked: VillageMemory = { h: { skin: catalog[1], picked: true, seenAt: 1 } }
    expect(assignVillageAvatars([agent('h', 'Hacker')], catalog, [], picked, 5).avatars.h).toBe(catalog[1])
  })

  it('never deals his body to anyone else', () => {
    const many = Array.from({ length: 12 }, (_, i) => agent(`a${i}`, `Agent ${i}`))
    const out = assignVillageAvatars(many, catalog, [], {}, 5)
    for (const url of Object.values(out.avatars)) expect(url.startsWith(HACKER)).toBe(false)
  })
})
