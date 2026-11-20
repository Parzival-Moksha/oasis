import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EMPTY_IDENTITY, IDENTITY_KEEP_MS, SEEN_EVERY_MS, applyIdentityPatch, fieldMap, importOps, memoryFromIdentity, memoryOps,
  parseIdentityFile, parseIdentityPatch, sameLooks, voiceOps, voicesFromIdentity, type IdentityFile,
} from '../village/village-identity'
import { patchIdentity, readIdentity } from '../village/village-identity-server'

const NOW = 1_795_200_000_000
const empty = (): IdentityFile => ({ ...EMPTY_IDENTITY, agents: {}, settings: {} })
const S = 'session-a'

describe('village identity: two strengths of write', () => {
  it('a dealt seat or body never replaces the one an agent has', () => {
    let f = applyIdentityPatch(empty(), { ops: [{ agent: S, ifAbsent: { seat: 2, skin: '/avatars/gallery/CoolAlien.vrm' } }] }, NOW)
    expect(f.version).toBe(1)
    const again = applyIdentityPatch(f, { ops: [{ agent: S, ifAbsent: { seat: 7, skin: '/avatars/gallery/UnicornPerson.vrm' } }] }, NOW)
    expect(again).toBe(f) // nothing changed: same object, no new version, no write
    f = applyIdentityPatch(f, { ops: [{ agent: S, set: { skin: '/avatars/gallery/Witch.vrm', skinPicked: true } }] }, NOW)
    expect(f.agents[S]).toMatchObject({ seat: 2, skin: '/avatars/gallery/Witch.vrm', skinPicked: true })
    expect(f.version).toBe(2)
  })

  it('null clears a field; seenAt only moves forward; long-gone agents are forgotten', () => {
    let f = applyIdentityPatch(empty(), { ops: [{ agent: S, set: { homeWorld: 'w1', seenAt: NOW } }, { agent: 'old', set: { seat: 1, seenAt: NOW - IDENTITY_KEEP_MS - 1 } }] }, NOW)
    expect(f.agents.old).toBeUndefined()
    f = applyIdentityPatch(f, { ops: [{ agent: S, set: { homeWorld: null, seenAt: NOW - 5 } }] }, NOW)
    expect(f.agents[S]).toEqual({ seenAt: NOW })
  })

  it('the short form sets fields of one agent (Companion: { agent, homeWorld })', () => {
    const patch = parseIdentityPatch({ agent: S, homeWorld: 'zen-workshop' })
    expect(patch?.ops).toEqual([{ agent: S, set: { homeWorld: 'zen-workshop' } }])
    expect(parseIdentityPatch({ agent: S, homeWorld: null })?.ops).toEqual([{ agent: S, set: { homeWorld: null } }])
    expect(parseIdentityPatch({ agent: S, followWorlds: true })?.ops).toEqual([{ agent: S, set: { followWorlds: true } }])
    expect(parseIdentityPatch({ agent: S, followWorlds: 'yes' })).toBeNull()
    expect(applyIdentityPatch(empty(), parseIdentityPatch({ agent: S, followWorlds: false })!, NOW).agents[S]).toEqual({ followWorlds: false })
    expect(parseIdentityPatch({ agent: 'bad key!', homeWorld: 'x' })).toBeNull()
    expect(parseIdentityPatch({ ops: [{ agent: S, set: { accent: 'red', seat: -1, skin: 'javascript:x' } }] })).toBeNull()
  })

  it('settings merge field by field', () => {
    let f = applyIdentityPatch(empty(), { settings: { tagStyle: { style: 'extruded', size: 1 } } }, NOW)
    f = applyIdentityPatch(f, { settings: { tagStyle: { size: 1.2 } } }, NOW)
    expect(f.settings.tagStyle).toEqual({ style: 'extruded', size: 1.2 })
  })
})

describe('village identity: the page modules’ changes', () => {
  it('memory: a picked body is set, a dealt one and a new seat are ifAbsent, seenAt goes rarely, moved ids are removed', () => {
    const prev = { 'agent-1': { seat: 3, seenAt: NOW }, b: { seat: 1, skin: '/x.vrm', seenAt: NOW } }
    const next = { s1: { seat: 3, skin: '/y.vrm', seenAt: NOW + 1 }, b: { seat: 1, skin: '/z.vrm', picked: true, seenAt: NOW + SEEN_EVERY_MS } }
    const ops = memoryOps(prev, next, { b: { seenAt: NOW } })
    expect(ops).toEqual([
      { agent: 's1', set: { seenAt: NOW + 1 }, ifAbsent: { skin: '/y.vrm', seat: 3 } },
      { agent: 'b', set: { skin: '/z.vrm', skinPicked: true, seenAt: NOW + SEEN_EVERY_MS } },
      { agent: 'agent-1', remove: true },
    ])
    // Nothing moved: nothing to send (no write per frame).
    expect(memoryOps(next, next, { s1: { seenAt: NOW + 1 }, b: { seenAt: NOW + SEEN_EVERY_MS } })).toEqual([])
  })

  it('memory: handing the body back to the village clears it in the store', () => {
    const ops = memoryOps({ b: { skin: '/z.vrm', picked: true, seenAt: NOW } }, { b: { seenAt: NOW } }, { b: { seenAt: NOW } })
    expect(ops).toEqual([{ agent: 'b', set: { skinPicked: null, skin: null } }])
  })

  it('voices: a picked voice and a speed are set, a dealt voice is ifAbsent', () => {
    expect(voiceOps({}, { a: { voice: 'sarah' } })).toEqual([{ agent: 'a', ifAbsent: { voice: 'sarah' } }])
    expect(voiceOps({ a: { voice: 'sarah' } }, { a: { voice: 'charlie', picked: true, speed: 1.2 } }))
      .toEqual([{ agent: 'a', set: { voice: 'charlie', voicePicked: true, speed: 1.2 } }])
    expect(voiceOps({ a: { voice: 'charlie', speed: 1.2 } }, {})).toEqual([{ agent: 'a', set: { voice: null, voicePicked: null, speed: null } }])
  })

  it('round trip: a browser’s old copy imported, read back in the modules’ shapes', () => {
    const memory = { [S]: { seat: 2, skin: '/avatars/gallery/CoolAlien.vrm', picked: true, seenAt: NOW } }
    const voices = { [S]: { voice: 'charlie', picked: true, speed: 1.2 } }
    const f = applyIdentityPatch(empty(), { ops: importOps({ memory, voices, accent: { [S]: '#6CFE9F' }, come: { [S]: false } }) }, NOW)
    expect(memoryFromIdentity(f)).toEqual(memory)
    expect(voicesFromIdentity(f)).toEqual(voices)
    expect(fieldMap(f, 'accent')).toEqual({ [S]: '#6cfe9f' })
    expect(fieldMap(f, 'come')).toEqual({ [S]: false })
    expect(sameLooks(memoryFromIdentity(f), { [S]: { ...memory[S], seenAt: 1 } })).toBe(true)
  })

  it('two pages with empty browsers dealing at once: the first one wins, the second adopts it', () => {
    const pageA = memoryOps({}, { [S]: { seat: 0, skin: '/a.vrm', seenAt: NOW } }, {})
    const pageB = memoryOps({}, { [S]: { seat: 4, skin: '/b.vrm', seenAt: NOW } }, {})
    let f = applyIdentityPatch(empty(), { ops: pageA }, NOW)
    f = applyIdentityPatch(f, { ops: pageB }, NOW)
    expect(memoryFromIdentity(f)[S]).toMatchObject({ seat: 0, skin: '/a.vrm' })
  })
})

describe('village identity: the file', () => {
  it('writes only on change, and refuses a broken file instead of treating it as empty', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'identity-'))
    const file = path.join(dir, 'village-identity.local.json')
    expect((await readIdentity(file)).version).toBe(0)
    const one = await patchIdentity({ ops: [{ agent: S, set: { homeWorld: 'w' } }] }, file, NOW)
    expect(one.version).toBe(1)
    const same = await patchIdentity({ ops: [{ agent: S, set: { homeWorld: 'w' } }] }, file, NOW)
    expect(same.version).toBe(1)
    expect(parseIdentityFile(JSON.parse(readFileSync(file, 'utf8'))).agents[S]).toEqual({ homeWorld: 'w' })
    writeFileSync(file, '{ broken')
    await expect(readIdentity(file)).rejects.toThrow(/not valid JSON/)
    await expect(patchIdentity({ ops: [{ agent: S, ifAbsent: { seat: 1 } }] }, file, NOW)).rejects.toThrow()
  })
})
