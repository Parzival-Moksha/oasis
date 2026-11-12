import { describe, expect, it } from 'vitest'

import { ACADEMY_SAMPLE_KEYS, ACADEMY_SAMPLE_SKILLS } from '../academy-sample'
import {
  ACADEMY_TREE,
  academyCheckMessage,
  academyKeyAction,
  academyLaneColor,
  academyTreeStation,
  applyAcademyUpdate,
  availableSkills,
  isStone,
  layoutAcademyNodes,
  levelFor,
  nodeLook,
  normalizeAcademyContent,
  parseAcademyFile,
  pickAcademyNode,
  traineeView,
  traineeXp,
  type AcademyContent,
  type AcademyFile,
  type AcademyKeyContext,
} from '../village-academy'

const skill = (id: string, tier: number, xp: number, needs: string[] = [], order = 0) => ({ id, name: id, tier, xp, needs, order, lane: 'core', what: '', prompt: '', proof: `show ${id}`, mins: 5, keys: [], way: null })
const RAW = [
  skill('spirit', 0, 10, [], 1),
  skill('body', 0, 10, [], 2),
  skill('website', 1, 20, [], 3),
  skill('ships', 2, 60, ['website'], 4),
  skill('users', 3, 80, ['website'], 5),
  skill('safetynet', 4, 40, ['users', 'ships'], 6),
]
const LEVELS = { levels: [{ name: 'Egg', xp: 0 }, { name: 'Hatchling', xp: 100 }, { name: 'Intern', xp: 250 }] }
const content = normalizeAcademyContent(RAW, LEVELS, 'folder') as AcademyContent
const empty: AcademyFile = { v: 1, trainees: {} }

function after(...updates: Array<Record<string, unknown>>): AcademyFile {
  let file = empty
  updates.forEach((update, index) => {
    const result = applyAcademyUpdate(file, content.skills, { trainee: 's1', ...update }, 1000 + index)
    if (!result.ok) throw new Error(result.error)
    file = result.file
  })
  return file
}

describe('academy content', () => {
  it('the sample this repo ships is three skills: Spirit, Body, Name and soul', () => {
    const sample = normalizeAcademyContent(ACADEMY_SAMPLE_SKILLS, ACADEMY_SAMPLE_KEYS, 'sample')
    expect(sample?.skills.map(item => item.name)).toEqual(['Spirit', 'Body', 'Name and soul'])
    expect(sample?.levels[0].xp).toBe(0)
    expect(sample?.keys.map(key => key.kind)).toEqual(['subscription', 'api'])
  })

  it('drops needs that point nowhere, duplicate ids and bad links; no skills is no content', () => {
    const odd = normalizeAcademyContent(
      [skill('a', 0, 5, ['ghost', 'a']), skill('a', 1, 5), { id: '' }, 'x'],
      { keys: [{ id: 'k', name: 'K', kind: 'weird', link: 'javascript:alert(1)' }], levels: [{ name: 'Later', xp: 50 }] },
      'folder',
    )
    expect(odd?.skills).toHaveLength(1)
    expect(odd?.skills[0].needs).toEqual([])
    expect(odd?.keys[0]).toMatchObject({ kind: 'account', link: '' })
    expect(odd?.levels.map(level => level.xp)).toEqual([0, 50])
    expect(normalizeAcademyContent([], {}, 'folder')).toBeNull()
    expect(normalizeAcademyContent({ nope: 1 }, {}, 'folder')).toBeNull()
  })
})

describe('availability', () => {
  it('a fresh trainee can start every skill that needs nothing', () => {
    expect(availableSkills(content.skills, {})).toEqual(['spirit', 'body', 'website'])
  })

  it('a claimed need unlocks as well as a verified one; a started skill is no longer "available"', () => {
    const progress = after({ skill: 'website', state: 'claimed' }).trainees.s1.skills
    expect(availableSkills(content.skills, progress)).toEqual(['spirit', 'body', 'ships', 'users'])
  })

  it('needs all of its needs', () => {
    const one = after({ skill: 'website', state: 'verified' }, { skill: 'users', state: 'verified' }).trainees.s1.skills
    expect(availableSkills(content.skills, one)).not.toContain('safetynet')
    const both = after({ skill: 'website', state: 'verified' }, { skill: 'users', state: 'verified' }, { skill: 'ships', state: 'claimed' }).trainees.s1.skills
    expect(availableSkills(content.skills, both)).toContain('safetynet')
  })
})

describe('XP and level', () => {
  it('level score = verified XP + half the claimed XP, rounded down', () => {
    const progress = after({ skill: 'spirit', state: 'verified' }, { skill: 'ships', state: 'verified' }, { skill: 'body', state: 'claimed' }, { skill: 'website', state: 'claimed' }).trainees.s1.skills
    expect(traineeXp(content.skills, progress)).toEqual({ verified: 70, claimed: 30, score: 85 })
    const odd = normalizeAcademyContent([skill('a', 0, 15)], {}, 'folder') as AcademyContent
    expect(traineeXp(odd.skills, { a: { state: 'claimed' } }).score).toBe(7)
  })

  it('the highest level whose XP the score reaches', () => {
    expect(levelFor(content.levels, 0)).toMatchObject({ index: 0, name: 'Egg', next: { name: 'Hatchling', xp: 100 } })
    expect(levelFor(content.levels, 99).name).toBe('Egg')
    expect(levelFor(content.levels, 100).name).toBe('Hatchling')
    expect(levelFor(content.levels, 9999)).toMatchObject({ index: 2, name: 'Intern', next: null })
  })

  it('a trainee view carries every skill, XP, level and what is available', () => {
    const file = after({ name: 'Rick', training: true }, { skill: 'spirit', state: 'verified', proof: 'saw the plan', by: 'Anorak' })
    const view = traineeView(content, 's1', file.trainees.s1)
    expect(view).toMatchObject({ key: 's1', name: 'Rick', training: true, stone: true, xp: { verified: 10, claimed: 0, score: 10 } })
    expect(Object.keys(view.skills)).toHaveLength(6)
    expect(view.skills.spirit).toMatchObject({ state: 'verified', proof: 'saw the plan', by: 'Anorak' })
    expect(view.skills.body).toEqual({ state: 'none' })
    expect(view.available).toEqual(['body', 'website'])
  })
})

describe('stone', () => {
  it('in training without Spirit and Body verified: stone; claimed is not enough', () => {
    expect(isStone(content.skills, after({ training: true }).trainees.s1)).toBe(true)
    expect(isStone(content.skills, after({ training: true }, { skill: 'spirit', state: 'verified' }, { skill: 'body', state: 'claimed' }).trainees.s1)).toBe(true)
    expect(isStone(content.skills, after({ training: true }, { skill: 'spirit', state: 'verified' }, { skill: 'body', state: 'verified' }).trainees.s1)).toBe(false)
  })

  it('not in training, or a tree without those two skills: never stone', () => {
    expect(isStone(content.skills, after({ training: false }).trainees.s1)).toBe(false)
    expect(isStone(content.skills, null)).toBe(false)
    const other = normalizeAcademyContent([skill('x', 0, 5)], {}, 'folder') as AcademyContent
    expect(isStone(other.skills, { training: true, skills: {} })).toBe(false)
  })
})

describe('node looks', () => {
  it('locked, available, claimed, verified', () => {
    const view = traineeView(content, 's1', after({ skill: 'website', state: 'claimed' }, { skill: 'spirit', state: 'verified' }).trainees.s1)
    const look = (id: string) => nodeLook(view, content.skills.find(item => item.id === id)!)
    expect([look('spirit'), look('website'), look('body'), look('ships'), look('safetynet')]).toEqual(['verified', 'claimed', 'available', 'available', 'locked'])
  })

  it('nobody picked: the roots invite, the rest is locked', () => {
    expect(content.skills.map(item => nodeLook(null, item))).toEqual(['available', 'available', 'available', 'locked', 'locked', 'locked'])
  })
})

describe('writes', () => {
  it('marks a skill with proof, who and when; none clears it', () => {
    const file = after({ name: 'Rick', skill: 'spirit', state: 'claimed', proof: 'p', by: 'owner' })
    expect(file.trainees.s1).toMatchObject({ name: 'Rick', training: false, skills: { spirit: { state: 'claimed', proof: 'p', by: 'owner', at: 1000 } } })
    const cleared = applyAcademyUpdate(file, content.skills, { trainee: 's1', skill: 'spirit', state: 'none' }, 5)
    expect(cleared.ok && cleared.file.trainees.s1.skills).toEqual({})
    expect(file.trainees.s1.skills.spirit).toBeDefined() // the input is not touched
  })

  it('finds a trainee by name, when exactly one has it', () => {
    const file = after({ name: 'Rick', training: true })
    const result = applyAcademyUpdate(file, content.skills, { trainee: 'rick', skill: 'spirit', state: 'verified' }, 7)
    expect(result.ok && result.key).toBe('s1')
    expect(result.ok && Object.keys(result.file.trainees)).toEqual(['s1'])
  })

  it('refuses what it cannot place', () => {
    expect(applyAcademyUpdate(empty, content.skills, { skill: 'spirit', state: 'claimed' }, 1)).toMatchObject({ ok: false, status: 400 })
    expect(applyAcademyUpdate(empty, content.skills, { trainee: 's1', skill: 'nope', state: 'claimed' }, 1)).toMatchObject({ ok: false, status: 400 })
    expect(applyAcademyUpdate(empty, content.skills, { trainee: 's1', skill: 'spirit', state: 'done' }, 1)).toMatchObject({ ok: false, status: 400 })
    expect(applyAcademyUpdate(empty, content.skills, { trainee: 's1' }, 1)).toMatchObject({ ok: false, status: 400 })
  })

  it('marks a skill whose needs are missing, with a warning (the checker decides)', () => {
    const result = applyAcademyUpdate(empty, content.skills, { trainee: 's1', skill: 'ships', state: 'verified' }, 1)
    expect(result).toMatchObject({ ok: true, warning: expect.stringContaining('website') })
  })

  it('training on and off, rekey to the session id, remove', () => {
    const on = after({ name: 'Rick', training: true }, { skill: 'spirit', state: 'verified' })
    expect(on.trainees.s1.training).toBe(true)
    const moved = applyAcademyUpdate(on, content.skills, { trainee: 's1', rekey: 'session-9' }, 9)
    expect(moved.ok && Object.keys(moved.file.trainees)).toEqual(['session-9'])
    expect(moved.ok && moved.file.trainees['session-9'].skills.spirit.state).toBe('verified')
    expect(applyAcademyUpdate(empty, content.skills, { trainee: 'ghost', rekey: 'x' }, 1)).toMatchObject({ ok: false, status: 404 })
    const gone = applyAcademyUpdate(on, content.skills, { trainee: 's1', remove: true }, 9)
    expect(gone.ok && gone.file.trainees).toEqual({})
  })

  it('reads a damaged file as empty and drops entries it does not understand', () => {
    expect(parseAcademyFile('not json')).toEqual({ v: 1, trainees: {} })
    const file = parseAcademyFile(JSON.stringify({ trainees: { a: { name: 'A', training: true, skills: { spirit: { state: 'verified', at: 3 }, body: { state: 'maybe' } } }, b: 4 } }))
    expect(file.trainees).toEqual({ a: { name: 'A', training: true, skills: { spirit: { state: 'verified', at: 3 } }, updatedAt: 0 } })
  })
})

describe('the check message', () => {
  it('names the trainee, session, folder, skill and proof, and says where to post', () => {
    const text = academyCheckMessage({ name: 'Rick', key: 'sess-1', cwd: 'C:\\rick', skill: content.skills[0], origin: 'http://127.0.0.1:4516' })
    expect(text).toContain('Academy check: trainee Rick (session sess-1, folder C:\\rick) claims skill spirit \'spirit\'.')
    expect(text).toContain('Proof wanted: show spirit')
    expect(text).toContain('POST http://127.0.0.1:4516/api/academy {"trainee":"sess-1","skill":"spirit"')
  })
})

describe('the tree', () => {
  const nodes = layoutAcademyNodes(content.skills)
  const at = (id: string) => nodes.find(node => node.id === id)!.local

  it('one node per skill; tiers rise and step back; rows are centred', () => {
    expect(nodes).toHaveLength(6)
    expect(at('spirit')[1]).toBe(ACADEMY_TREE.baseHeight)
    expect(at('safetynet')[1]).toBeCloseTo(ACADEMY_TREE.baseHeight + 4 * ACADEMY_TREE.tierRise)
    expect(at('safetynet')[2]).toBeCloseTo(-4 * ACADEMY_TREE.tierDepth)
    expect(at('spirit')[0]).toBeCloseTo(-ACADEMY_TREE.spacing / 2)
    expect(at('body')[0]).toBeCloseTo(ACADEMY_TREE.spacing / 2)
    expect(at('website')[0]).toBe(0)
  })

  it('no two nodes share a place', () => {
    const real = layoutAcademyNodes(normalizeAcademyContent([
      skill('a', 0, 1, [], 1), skill('b', 0, 1, [], 2), skill('c', 1, 1, ['b'], 3), skill('d', 1, 1, ['a'], 4), skill('e', 1, 1, ['d'], 5),
    ], {}, 'folder')!.skills)
    expect(new Set(real.map(node => node.local.join(','))).size).toBe(5)
    // A skill stands under what it needs: d (needs a, on the left) is left of c (needs b).
    expect(real.find(node => node.id === 'd')!.local[0]).toBeLessThan(real.find(node => node.id === 'c')!.local[0])
  })

  it('stands behind the spawn, across the plaza from the desks, facing the plaza', () => {
    expect(academyTreeStation({ x: 0, z: 7.5 }, 0)).toEqual({ position: [0, 0, 7.5 - ACADEMY_TREE.plazaDistance], rotationY: 0 })
    const turned = academyTreeStation({ x: 0, z: 0 }, Math.PI / 2)
    expect(turned.position[0]).toBeCloseTo(-ACADEMY_TREE.plazaDistance)
    expect(turned.position[2]).toBeCloseTo(0)
  })
})

describe('picking a node', () => {
  const nodes = [
    { id: 'low', position: [0, 1.6, 0] as [number, number, number] },
    { id: 'high', position: [0, 5.2, -3] as [number, number, number] },
    { id: 'side', position: [2.6, 1.6, 0] as [number, number, number] },
  ]
  const look = (from: [number, number, number], to: [number, number, number]) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const length = Math.hypot(d[0], d[1], d[2])
    return { position: from, forward: [d[0] / length, d[1] / length, d[2] / length] as [number, number, number] }
  }

  it('the node under the crosshair, however high', () => {
    const actor: [number, number, number] = [0, 0, 4]
    expect(pickAcademyNode({ actor, camera: look([0, 2, 6], [0, 5.2, -3]), nodes })?.id).toBe('high')
    expect(pickAcademyNode({ actor, camera: look([0, 2, 6], [2.6, 1.6, 0]), nodes })?.id).toBe('side')
  })

  it('looking elsewhere: only the node whose foot you stand at', () => {
    const away = look([0, 2, 6], [0, 2, 60])
    expect(pickAcademyNode({ actor: [0, 0, 4], camera: away, nodes })).toBeNull()
    expect(pickAcademyNode({ actor: [0.4, 0, 0.5], camera: away, nodes })).toMatchObject({ id: 'low' })
  })

  it('out of reach: nothing, even when looked at', () => {
    expect(pickAcademyNode({ actor: [0, 0, 30], camera: look([0, 2, 32], [0, 1.6, 0]), nodes })).toBeNull()
    expect(pickAcademyNode({ actor: null, camera: null, nodes })).toBeNull()
  })
})

describe('keys and colours', () => {
  const base: AcademyKeyContext = { code: 'KeyE', ctrl: false, meta: false, alt: false, repeat: false, typing: false, readerOpen: false, nearby: true, agent: false, worldKeysFree: true }

  it('E at a node opens it; an agent within reach or a text field keeps the key', () => {
    expect(academyKeyAction(base)).toBe('open')
    expect(academyKeyAction({ ...base, nearby: false })).toBeNull()
    expect(academyKeyAction({ ...base, agent: true })).toBeNull()
    expect(academyKeyAction({ ...base, typing: true })).toBeNull()
    expect(academyKeyAction({ ...base, worldKeysFree: false })).toBeNull()
    expect(academyKeyAction({ ...base, ctrl: true })).toBeNull()
  })

  it('Esc or E closes the open node', () => {
    expect(academyKeyAction({ ...base, readerOpen: true })).toBe('close')
    expect(academyKeyAction({ ...base, readerOpen: true, code: 'Escape', typing: true })).toBe('close')
    expect(academyKeyAction({ ...base, readerOpen: true, typing: true })).toBeNull()
    expect(academyKeyAction({ ...base, readerOpen: true, code: 'KeyF' })).toBeNull()
  })

  it('a steady colour for every lane', () => {
    expect(academyLaneColor('builder')).toBe('#34d399')
    expect(academyLaneColor('unknown-lane')).toBe(academyLaneColor('unknown-lane'))
    expect(academyLaneColor('unknown-lane')).toMatch(/^#[0-9a-f]{6}$/)
  })
})
