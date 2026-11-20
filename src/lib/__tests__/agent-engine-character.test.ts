// Characters: the card per agent (engine character.js), the look descriptions (looks.js), the note riding with a
// message (agent.js), the place in words (village-place.ts) and the cameras for pictures on request (village-eyes.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as characterModule from '../../../packages/oasis-agent-engine/src/character.js'
import * as looksModule from '../../../packages/oasis-agent-engine/src/looks.js'
import * as agentModule from '../../../packages/oasis-agent-engine/src/agent.js'
import * as voiceModule from '../../../packages/oasis-agent-engine/src/voice.js'
import * as normalizeModule from '../../../packages/oasis-agent-engine/src/normalize.js'
import { describePlace, relativeDirection } from '../village/village-place'
import { computeAroundPoses, computeLookPose } from '../village/village-eyes'

interface Card { fields: Record<string, string>; who: string; file?: string | null }
const { Characters, parseCard, serializeCard, characterNote, cardStamp, charactersDirFor } = characterModule as unknown as {
  Characters: new (dir: string) => {
    fileFor: (sessionId: string) => string | null
    read: (sessionId: string) => Card
    setFacts: (sessionId: string, facts: Record<string, string | undefined>) => Card
    setOwn: (sessionId: string, own: { role?: string; who?: string }) => Card
    list: () => Array<{ sessionId: string; name: string | null }>
  }
  parseCard: (text: string) => Card
  serializeCard: (card: Card) => string
  characterNote: (card: Card, o?: { file?: string; tools?: string; showFiles?: boolean }) => string
  cardStamp: (card: Card) => string
  charactersDirFor: (rosterFile: string) => string
}
const { Looks } = looksModule as unknown as {
  Looks: new (o: Record<string, unknown>) => {
    get: (avatar: string) => string | null
    want: (avatar: string, thumb?: string) => boolean
    thumbFor: (avatar: string) => string | null
    thumbFile: (thumb: string) => string | null
    run: () => Promise<void>
    busy: boolean
  }
}
const { ENGINE_NOTE } = voiceModule as unknown as { ENGINE_NOTE: RegExp }
const { Agent } = agentModule as unknown as { Agent: new (spec: Record<string, unknown>, hub: Record<string, unknown>) => { proc: unknown; send: (text: string) => Promise<unknown>; onLine: (line: string) => void } }
const { Normalizer } = normalizeModule as unknown as {
  Normalizer: new (agentId: string, emit: (kind: string, payload: Record<string, unknown>) => void, opts: { mode: string }) => { handleStream: (msg: unknown) => void }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-characters-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const SID = '12f6ca3a-3f90-478b-87fb-4d5622efff40'

describe('character cards', () => {
  it('live in one folder next to the roster, one md file per session', () => {
    expect(charactersDirFor(path.join('data', 'agent-engine.local.json'))).toBe(path.join('data', 'characters'))
    const characters = new Characters(path.join(dir, 'a'))
    expect(characters.fileFor(SID)).toBe(path.join(dir, 'a', `${SID}.md`))
    expect(characters.fileFor('../../etc/passwd')).toBeNull()
    expect(characters.fileFor('agent-1234')).toBeNull()
  })

  it('the engine keeps its facts up to date and never touches the owner\'s or the agent\'s words', () => {
    const characters = new Characters(path.join(dir, 'b'))
    characters.setFacts(SID, { name: 'Citizens', world: 'Oasis Dusk', avatar: '/avatars/gallery/Orion.vrm', look: 'the avatar "Orion"' })
    characters.setOwn(SID, { role: 'Makes every agent a citizen.', who: 'You care about where you are.\nYou are careful with the engine.' })
    characters.setFacts(SID, { world: 'Neon Harbor', place: 'Your desk is 7 m from the plaza.', voice: 'Brian (brian): deep' })
    const card = characters.read(SID)
    expect(card.fields).toMatchObject({ name: 'Citizens', session: SID, world: 'Neon Harbor', home: 'Oasis Dusk', role: 'Makes every agent a citizen.', voice: 'Brian (brian): deep' })
    expect(card.who).toBe('You care about where you are.\nYou are careful with the engine.')
    // An unchanged report writes nothing.
    const before = fs.statSync(card.file!).mtimeMs
    const text = fs.readFileSync(card.file!, 'utf8')
    characters.setFacts(SID, { world: 'Neon Harbor' })
    expect(fs.readFileSync(card.file!, 'utf8')).toBe(text)
    expect(fs.statSync(card.file!).mtimeMs).toBe(before)
    expect(characters.list()).toEqual([{ sessionId: SID, name: 'Citizens' }])
  })

  it('a file edited by hand is read as it is', () => {
    const characters = new Characters(path.join(dir, 'c'))
    characters.setFacts(SID, { name: 'Rick' })
    const file = characters.fileFor(SID)!
    fs.writeFileSync(file, `---\r\nname: Rick\r\nrole: Builds the garden.\r\nmade-up: ignored\r\n---\r\n\r\nYou are blunt and kind.\r\n`)
    const card = characters.read(SID)
    expect(card.fields).toEqual({ name: 'Rick', role: 'Builds the garden.' })
    expect(card.who).toBe('You are blunt and kind.')
    expect(parseCard('no header at all').who).toBe('no header at all')
    expect(parseCard(serializeCard(card))).toEqual({ fields: card.fields, who: card.who })
  })

  it('clears and clips the words', () => {
    const characters = new Characters(path.join(dir, 'd'))
    characters.setOwn(SID, { role: `  a role\nover two lines ${'x'.repeat(400)}`, who: 'w'.repeat(5000) })
    let card = characters.read(SID)
    expect(card.fields.role.length).toBeLessThanOrEqual(240)
    expect(card.fields.role).not.toContain('\n')
    expect(card.who.length).toBe(1200)
    characters.setOwn(SID, { role: '', who: '' })
    card = characters.read(SID)
    expect(card.fields.role).toBeUndefined()
    expect(card.who).toBe('')
  })

  it('the note says who, look, voice and place in one hidden block', () => {
    const card: Card = {
      fields: { name: 'Citizens', role: 'Makes agents citizens', look: 'the avatar "Orion". You are tall [and blue].', voice: 'Brian (brian): deep', world: 'Oasis Dusk', place: 'Your desk is 7 m from the plaza.' },
      who: 'You care about where you are.',
    }
    const note = characterNote(card, { file: 'C:/data/characters/x.md', tools: 'C:/engine/scripts/me.mjs' })
    expect(ENGINE_NOTE.test(note)).toBe(true) // the thread hides it (no "]" inside)
    for (const piece of ['You are Citizens', 'Role: Makes agents citizens.', 'Who you are: You care', 'Your look: the avatar "Orion"', 'Your voice: Brian', 'the world "Oasis Dusk"', 'me.mjs" look', 'C:/data/characters/x.md']) expect(note).toContain(piece)
    expect(note).not.toContain('nobody has yet')
    // Results the owner should see or hear go as files, not as paths.
    expect(note).toContain('send the file with SendUserFile')
    expect(note.length).toBeLessThan(1500)
    expect(characterNote(card, { showFiles: false })).not.toContain('SendUserFile')
    // Questions that can wait: this machine's line (askLaterLine below) rides in the note.
    const { ASK_LATER } = characterModule as unknown as { ASK_LATER: string }
    if (ASK_LATER) expect(note).toContain(ASK_LATER)
    expect(ENGINE_NOTE.test(characterNote(card, { showFiles: false }))).toBe(true)
    // Since 2026-11-20 one file per question in a folder; the owner's list is written from them, so never typed into.
    const { askLaterLine } = characterModule as unknown as { askLaterLine: (o: { questionsDir?: string; grillFile?: string }) => string }
    const folder = askLaterLine({ questionsDir: 'C:\\7c_oasis\\docs\\questions\\', grillFile: 'C:/7c_oasis/docs/grill/open.md' })
    expect(folder).toContain('go in the folder C:/7c_oasis/docs/questions, one file per question, written as C:/7c_oasis/docs/questions/README.md says')
    expect(folder).toContain('what the thing is, what a yes leads to, what a no leads to, and your recommendation, with your name')
    expect(folder).toContain("not typed into the owner's list (open.md): a script writes that list from these files")
    expect(ENGINE_NOTE.test(`[Oasis you: ${folder}]`)).toBe(true)
    expect(askLaterLine({ grillFile: 'C:/x/open.md' })).toContain('go at the bottom of C:/x/open.md, under "Added by agents"') // a machine without the folder
    expect(askLaterLine({})).toBe('')
    // No words of its own yet: it is told it can write them.
    expect(characterNote({ fields: { name: 'New' }, who: '' }, { tools: 'me.mjs' })).toContain('who "<a few sentences>" writes your own who-you-are')
  })

  it('is told again when its words, its look or its world change, not when its neighbours do', () => {
    const base: Card = { fields: { name: 'A', role: 'r', look: 'l', world: 'w', place: 'p', voice: 'v' }, who: 'x' }
    const stamp = cardStamp(base)
    expect(cardStamp({ ...base, fields: { ...base.fields, place: 'another neighbour' } })).toBe(stamp)
    expect(cardStamp({ ...base, fields: { ...base.fields, world: 'elsewhere' } })).not.toBe(stamp)
    expect(cardStamp({ ...base, who: 'y' })).not.toBe(stamp)
    expect(cardStamp({ ...base, fields: { ...base.fields, look: 'new body' } })).not.toBe(stamp)
  })
})

describe('looks', () => {
  it('describes an avatar once, from its thumbnail under public, and remembers it', async () => {
    const publicDir = path.join(dir, 'public')
    fs.mkdirSync(path.join(publicDir, 'avatars', 'gallery', 'thumbs'), { recursive: true })
    fs.writeFileSync(path.join(publicDir, 'avatars', 'gallery', 'thumbs', 'orion.jpg'), 'jpg')
    const asked: string[] = []
    const told: string[] = []
    const file = path.join(dir, 'looks', '_looks.json')
    const make = () => new Looks({ file, publicDir, describe: async (f: string) => { asked.push(path.basename(f)); return 'You are tall and blue.' }, onDescribed: (avatar: string) => told.push(avatar) })
    const looks = make()
    expect(looks.want('/avatars/gallery/Orion.vrm', '/avatars/gallery/thumbs/orion.jpg')).toBe(true)
    expect(looks.want('/avatars/gallery/Orion.vrm', '/avatars/gallery/thumbs/orion.jpg')).toBe(false) // already queued
    await looks.run()
    while (looks.busy) await new Promise(r => setTimeout(r, 5))
    expect(looks.get('/avatars/gallery/Orion.vrm')).toBe('You are tall and blue.')
    expect(asked).toEqual(['orion.jpg'])
    expect(told).toEqual(['/avatars/gallery/Orion.vrm'])
    // Another run of the engine: on disk, not asked again; the thumbnail is known for the fallback picture.
    const again = make()
    expect(again.want('/avatars/gallery/Orion.vrm', '/avatars/gallery/thumbs/orion.jpg')).toBe(false)
    expect(again.get('/avatars/gallery/Orion.vrm')).toBe('You are tall and blue.')
    expect(again.thumbFor('/avatars/gallery/Orion.vrm')).toContain('orion.jpg')
    expect(asked).toHaveLength(1)
  })

  it('only reads thumbnails that are files under public, and can be switched off', () => {
    const publicDir = path.join(dir, 'public')
    const looks = new Looks({ file: path.join(dir, 'looks2.json'), publicDir, describe: async () => 'x' })
    expect(looks.thumbFile('/../../secret.jpg')).toBeNull()
    expect(looks.thumbFile('/avatars/gallery/thumbs/missing.jpg')).toBeNull()
    expect(looks.want('/avatars/gallery/None.vrm', '/avatars/gallery/thumbs/missing.jpg')).toBe(false)
    const off = new Looks({ file: path.join(dir, 'looks3.json'), publicDir, enabled: false, describe: async () => 'x' })
    expect(off.want('/avatars/gallery/Orion.vrm', '/avatars/gallery/thumbs/orion.jpg')).toBe(false)
  })
})

describe('agent: the who-you-are note rides with a message', () => {
  function makeAgent(character: () => { note: string; stamp: string } | null) {
    const written: Array<{ message: { content: unknown } }> = []
    const hub = { emit: () => {}, persist: () => {}, log: () => {}, character }
    const agent = new Agent({ id: 'agent-1', name: 'Rick', cwd: process.cwd(), speak: false, speakSet: true, voiceOffered: true }, hub)
    agent.proc = { pid: 1, stdin: { write: (line: string) => written.push(JSON.parse(line)) } }
    ;(agent as unknown as { youDue: boolean }).youDue = true // what start() sets for a new process
    return { agent, written }
  }
  const NOTE = '[Oasis you: You are Rick.]'

  it('with the first message after a start, then only when the card changed or the context was compacted', async () => {
    let stamp = 's1'
    const { agent, written } = makeAgent(() => ({ note: NOTE, stamp }))
    await agent.send('one')
    await agent.send('two')
    expect(written[0].message.content).toEqual([{ type: 'text', text: 'one' }, { type: 'text', text: NOTE }])
    expect(written[1].message.content).toBe('two')
    stamp = 's2' // the owner edited the card, or the world changed
    await agent.send('three')
    expect(written[2].message.content).toEqual([{ type: 'text', text: 'three' }, { type: 'text', text: NOTE }])
    await agent.send('four')
    expect(written[3].message.content).toBe('four')
    agent.onLine(JSON.stringify({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto' } }))
    await agent.send('five')
    expect(written[4].message.content).toEqual([{ type: 'text', text: 'five' }, { type: 'text', text: NOTE }])
  })

  it('not with a slash command, and never in the way when there is no card', async () => {
    const { agent, written } = makeAgent(() => ({ note: NOTE, stamp: 's' }))
    await agent.send('/compact')
    expect(written[0].message.content).toBe('/compact')
    await agent.send('hello')
    expect(written[1].message.content).toEqual([{ type: 'text', text: 'hello' }, { type: 'text', text: NOTE }])
    const none = makeAgent(() => null)
    await none.agent.send('hello')
    expect(none.written[0].message.content).toBe('hello')
    const broken = makeAgent(() => { throw new Error('disk') })
    await broken.agent.send('hello')
    expect(broken.written[0].message.content).toBe('hello')
  })

  it('stays out of the thread', () => {
    const seen: string[] = []
    const norm = new Normalizer('agent-1', (kind, payload) => { if (kind === 'user') seen.push(String(payload.text)) }, { mode: 'live' })
    norm.handleStream({ type: 'user', isReplay: true, uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: NOTE }] } })
    expect(seen).toEqual(['hello'])
  })
})

describe('place in words', () => {
  const anchor: [number, number, number] = [0, 0, 0]

  it('directions are the avatar\'s own: it faces +Z and its right hand is -X', () => {
    expect(relativeDirection(anchor, 0, [0, 0, 5])).toBe('ahead')
    expect(relativeDirection(anchor, 0, [-5, 0, 0])).toBe('to the right')
    expect(relativeDirection(anchor, 0, [5, 0, 0])).toBe('to the left')
    expect(relativeDirection(anchor, 0, [0, 0, -5])).toBe('behind')
    expect(relativeDirection(anchor, 0, [-5, 0, 5])).toBe('ahead to the right')
    // Turned to face +X: what was to the left is now ahead.
    expect(relativeDirection(anchor, Math.PI / 2, [5, 0, 0])).toBe('ahead')
  })

  it('names the plaza, the neighbours and the nearest things, grouped and capped', () => {
    const line = describePlace({
      anchor,
      rotationY: 0,
      plaza: [0, 0, 6.5],
      neighbours: [{ name: 'Rick', position: [3.4, 0, 0.5] }, { name: 'Far Away', position: [40, 0, 0] }],
      things: [
        { name: 'torii_gate', position: [0, 0, 9] },
        { name: 'Pine tree', position: [-4, 0, 0] },
        { name: 'Pine tree', position: [-6, 0, 0.5] },
        { name: 'Mountain', position: [0, 0, 300] },
        ...Array.from({ length: 10 }, (_, i) => ({ name: `Lamp ${i}`, position: [0, 0, -(12 + i)] as [number, number, number] })),
      ],
    })
    expect(line).toContain('Your desk is 7 m from the centre of the village plaza, which is ahead.')
    expect(line).toContain('Next to you: Rick (3 m to the left).')
    expect(line).toContain('2 × Pine tree (from 4 m to the right)')
    expect(line).toContain('torii gate (9 m ahead)')
    expect(line).not.toContain('Mountain')
    expect(line).not.toContain('Far Away')
    expect((line.match(/Lamp/g) || []).length).toBe(4) // six things at most: two groups and four lamps
  })

  it('says so when nothing is around', () => {
    expect(describePlace({ anchor, rotationY: 0, plaza: null, neighbours: [], things: [] })).toBe('You have a desk in the village. Nothing is built near you yet.')
  })
})

describe('cameras for pictures on request', () => {
  const station = { anchor: [10, 2, 5] as [number, number, number], rotationY: 0 }

  it('look: from the front, at the whole body', () => {
    const pose = computeLookPose(station)
    expect(pose.position[2]).toBeGreaterThan(5 + 2) // in front of it (it faces +Z)
    expect(pose.target).toEqual([10, 3.1, 5])
    expect(Math.hypot(pose.position[0] - 10, pose.position[2] - 5)).toBeGreaterThan(2)
  })

  it('around: four sides, each camera a step out so its own body is behind it', () => {
    const poses = computeAroundPoses(station)
    expect(poses.map(p => p.label)).toEqual(['ahead', 'right', 'behind', 'left'])
    const dir = (p: { position: number[]; target: number[] }) => [Math.round(p.target[0] - p.position[0]) + 0, Math.round(p.target[2] - p.position[2]) + 0]
    expect(dir(poses[0])).toEqual([0, 5])
    expect(dir(poses[1])).toEqual([-5, 0]) // its right hand is -X
    expect(dir(poses[2])).toEqual([0, -5])
    expect(dir(poses[3])).toEqual([5, 0])
    for (const p of poses) expect(Math.hypot(p.position[0] - 10, p.position[2] - 5)).toBeCloseTo(0.6)
  })
})
