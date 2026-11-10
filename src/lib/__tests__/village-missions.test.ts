import { describe, expect, it } from 'vitest'
import {
  MISSION_FACE,
  MISSION_WALL_MAX,
  clampWords,
  isMissionFile,
  layoutMissionWall,
  missionAtlasGrid,
  missionAtlasTile,
  missionKeyAction,
  parseMission,
  plainText,
  rankMissions,
  wrapByWidth,
  type MissionKeyContext,
} from '../village/village-missions'
import { plazaCenter, villageSeatStation } from '../village/village-layout'

const FILE = `state: doing
who: Mission Wall (village agent)
done when: the owner walks behind Anorak and reads any mission with E or F.
score: ease 3 · impact 5 · urgency 4

# Missions in the world

The owner: "every thread goes under".

## Log
- 2026-11-10. Asked for.
`

describe('parseMission', () => {
  it('reads the header, the title and the score', () => {
    const mission = parseMission('mission-wall.md', FILE)
    expect(mission).toMatchObject({
      file: 'mission-wall.md',
      title: 'Missions in the world',
      state: 'doing',
      column: 'doing',
      who: 'Mission Wall (village agent)',
      ease: 3,
      impact: 5,
      urgency: 4,
      priority: 0.48,
    })
    expect(mission.tldr).toBe('the owner walks behind Anorak and reads any mission with E or F.')
    expect(mission.markdown).toBe(FILE)
  })

  it('maps states to kanban columns', () => {
    const column = (state: string) => parseMission('a.md', `state: ${state}\n\n# A`).column
    expect(['idea', 'agreed', 'doing', 'shipped', 'verified', 'whatever'].map(column))
      .toEqual(['to do', 'to do', 'doing', 'done', 'done', 'to do'])
  })

  it('falls back to the first paragraph when there is no "done when"', () => {
    const mission = parseMission('a.md', 'state: idea\nscore: ease 5 · impact 5 · urgency 5\n\n# A title\n\n## Why\n\nBecause **it** [matters](x.md),\nand more.\n\nLater.')
    expect(mission.tldr).toBe('Because it matters, and more.')
    expect(mission.priority).toBe(1)
  })

  it('survives a file with no header, CRLF line ends and a BOM', () => {
    const mission = parseMission('loose-note.md', '\uFEFF# Loose\r\n\r\nJust words.\r\n')
    expect(mission).toMatchObject({ title: 'Loose', state: 'idea', column: 'to do', priority: null, tldr: 'Just words.' })
    expect(parseMission('untitled.md', 'state: idea\n\nwords').title).toBe('untitled')
  })

  it('leaves the priority empty when the score is incomplete', () => {
    expect(parseMission('a.md', 'score: ease 3 · impact 5\n\n# A').priority).toBeNull()
  })

  it('keeps colons inside a value', () => {
    expect(parseMission('a.md', 'who: Debugger (in C:\\af_oasis)\n\n# A').who).toBe('Debugger (in C:\\af_oasis)')
  })
})

describe('rankMissions', () => {
  const m = (file: string, column: 'to do' | 'doing' | 'done', priority: number | null) => ({ file, column, priority })
  it('doing, then to do, then done; highest priority first; ties by file name', () => {
    const ranked = rankMissions([
      m('z-done.md', 'done', 0.9),
      m('b.md', 'to do', 0.29),
      m('a.md', 'to do', 0.29),
      m('unscored.md', 'to do', null),
      m('doing-low.md', 'doing', 0.1),
      m('doing-high.md', 'doing', 0.5),
      m('big.md', 'to do', 0.8),
    ])
    expect(ranked.map(x => x.file)).toEqual(['doing-high.md', 'doing-low.md', 'big.md', 'a.md', 'b.md', 'unscored.md', 'z-done.md'])
  })
})

describe('isMissionFile', () => {
  it('takes every markdown file but the README', () => {
    expect(['a.md', 'README.md', 'readme.MD', 'notes.txt', 'b.MD'].filter(isMissionFile)).toEqual(['a.md', 'b.MD'])
  })
})

describe('layoutMissionWall', () => {
  const center = plazaCenter()
  const desk = (seat: number) => {
    const station = villageSeatStation(seat)
    return { x: station.position[0], z: station.position[2] }
  }
  const missions = (open: number, done: number) => [
    ...Array.from({ length: open }, (_, i) => ({ file: `open-${i}.md`, column: (i < 2 ? 'doing' : 'to do') as 'doing' | 'to do' })),
    ...Array.from({ length: done }, (_, i) => ({ file: `done-${i}.md`, column: 'done' as const })),
  ]
  const dist = (a: { x: number; z: number }, p: [number, number, number]) => Math.hypot(a.x - p[0], a.z - p[2])

  it('puts the highest priority nearest to Anorak, and never nearer than the one before', () => {
    const anchor = desk(0)
    const panels = layoutMissionWall(missions(10, 0), { center, anchor, desks: [anchor] })
    expect(panels).toHaveLength(10)
    const distances = panels.map(panel => dist(anchor, panel.position))
    for (let i = 1; i < distances.length; i += 1) expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] - 1e-9)
    // The first one stands straight behind the desk, away from the plaza.
    const first = panels[0].position
    expect(Math.hypot(first[0] - center.x, first[2] - center.z)).toBeGreaterThan(Math.hypot(anchor.x - center.x, anchor.z - center.z) + 3)
  })

  it('faces the plaza', () => {
    const anchor = desk(1)
    for (const panel of layoutMissionWall(missions(8, 2), { center, anchor, desks: [anchor] })) {
      const forward = [Math.sin(panel.rotationY), Math.cos(panel.rotationY)]
      const toCenter = [center.x - panel.position[0], center.z - panel.position[2]]
      const length = Math.hypot(toCenter[0], toCenter[1])
      expect((forward[0] * toCenter[0] + forward[1] * toCenter[1]) / length).toBeCloseTo(1, 6)
    }
  })

  it('keeps panels apart, and clear of every desk and its helpers', () => {
    // A full first ring and a few desks on the second, straight behind Anorak.
    const desks = Array.from({ length: 10 }, (_, seat) => desk(seat))
    const panels = layoutMissionWall(missions(14, 4), { center, anchor: desks[0], desks })
    for (let i = 0; i < panels.length; i += 1) {
      for (let j = i + 1; j < panels.length; j += 1) {
        expect(Math.hypot(panels[i].position[0] - panels[j].position[0], panels[i].position[2] - panels[j].position[2])).toBeGreaterThan(2.6)
      }
      for (const d of desks) expect(dist(d, panels[i].position)).toBeGreaterThan(3.2)
      // Outside the plaza and the desk ring: no walking path is blocked.
      expect(Math.hypot(panels[i].position[0] - center.x, panels[i].position[2] - center.z)).toBeGreaterThan(9)
    }
  })

  it('sends done missions to the farthest arc, dimmed', () => {
    const anchor = desk(0)
    const panels = layoutMissionWall(missions(9, 3), { center, anchor, desks: [anchor] })
    const open = panels.filter(panel => !panel.dimmed)
    const done = panels.filter(panel => panel.dimmed)
    expect(done.map(panel => panel.file)).toEqual(['done-0.md', 'done-1.md', 'done-2.md'])
    const lastOpenRow = Math.max(...open.map(panel => panel.row))
    for (const panel of done) {
      expect(panel.row).toBeGreaterThan(lastOpenRow)
      expect(panel.lift).toBeGreaterThan(0)
    }
    // Only done missions: they still get an arc.
    expect(layoutMissionWall(missions(0, 2), { center, anchor, desks: [] }).every(panel => panel.dimmed && panel.row === 0)).toBe(true)
  })

  it('caps the wall, dropping done ones first', () => {
    const anchor = desk(0)
    const panels = layoutMissionWall(missions(MISSION_WALL_MAX - 2, 10), { center, anchor, desks: [anchor] })
    expect(panels).toHaveLength(MISSION_WALL_MAX)
    expect(panels.filter(panel => panel.dimmed)).toHaveLength(2)
    expect(layoutMissionWall(missions(40, 0), { center, anchor, max: 5 })).toHaveLength(5)
  })

  it('without Anorak, stands on the far side of the plaza', () => {
    const panels = layoutMissionWall(missions(3, 0), { center, anchor: null, fallbackYaw: 0, desks: [] })
    // Yaw 0 looks along +Z: the wall is beyond the plaza centre, centred on that line.
    expect(panels[0].position[0]).toBeCloseTo(center.x, 6)
    expect(panels[0].position[2]).toBeGreaterThan(center.z + 9)
    // Somebody else sits at seat 0, where the wall would start from: same place, behind that desk.
    const taken = layoutMissionWall(missions(3, 0), { center, anchor: null, fallbackYaw: 0, desks: [desk(0)] })
    expect(taken[0].position).toEqual(panels[0].position)
  })

  it('moves nobody when a mission far down the list is added', () => {
    const anchor = desk(0)
    const before = layoutMissionWall(missions(6, 0), { center, anchor, desks: [anchor] })
    const after = layoutMissionWall(missions(7, 0), { center, anchor, desks: [anchor] })
    expect(after.slice(0, 6)).toEqual(before)
  })
})

describe('missionAtlasGrid', () => {
  it('fits every face into one texture, tiles side by side', () => {
    for (const count of [1, 2, 5, 12, 24]) {
      const grid = missionAtlasGrid(count)
      expect(grid.cols * grid.rows).toBeGreaterThanOrEqual(count)
      expect(grid.width).toBeLessThanOrEqual(4096)
      expect(grid.height).toBeLessThanOrEqual(4096)
      expect(grid.tileWidth / grid.tileHeight).toBeCloseTo(MISSION_FACE.width / MISSION_FACE.height, 1)
      const seen = new Set<string>()
      for (let i = 0; i < count; i += 1) {
        const tile = missionAtlasTile(grid, i)
        expect(tile.x + grid.tileWidth).toBeLessThanOrEqual(grid.width)
        expect(tile.y + grid.tileHeight).toBeLessThanOrEqual(grid.height)
        seen.add(`${tile.x},${tile.y}`)
      }
      expect(seen.size).toBe(count)
    }
  })
  it('is as sharp as asked while it fits, and coarser on a small GPU', () => {
    expect(missionAtlasGrid(12).pxPerMeter).toBe(420)
    expect(missionAtlasGrid(24, 2048).pxPerMeter).toBeLessThan(420)
    expect(missionAtlasGrid(0).cols).toBe(1)
  })
})

describe('text that fits', () => {
  const measure = (text: string) => text.length
  it('wraps on words and ends what does not fit with an ellipsis', () => {
    expect(wrapByWidth('Talk to my agents in the Oasis', 16, 2, measure)).toEqual(['Talk to my', 'agents in the…'])
    expect(wrapByWidth('Short title', 16, 2, measure)).toEqual(['Short title'])
    expect(wrapByWidth('One two', 3, 2, measure)).toEqual(['One', 'two'])
    expect(wrapByWidth('', 10, 2, measure)).toEqual([])
  })
  it('keeps a single word that is too wide', () => {
    expect(wrapByWidth('Supercalifragilistic', 5, 2, measure)).toEqual(['Supercalifragilistic'])
  })
  it('clamps a TL;DR on a word', () => {
    expect(clampWords('short', 20)).toBe('short')
    const clamped = clampWords('the owner plays an hour-long session and FPS stays where it started', 30)
    expect(clamped).toBe('the owner plays an hour-long…')
  })
  it('strips inline markdown', () => {
    expect(plainText('**Bold** and `code` and [a link](x.md)  here')).toBe('Bold and code and a link here')
  })
})

describe('missionKeyAction', () => {
  const keys = (code: string, patch: Partial<MissionKeyContext> = {}) => missionKeyAction({
    code, ctrl: false, meta: false, alt: false, repeat: false, typing: false, reader: null, nearby: true, agent: false, worldKeysFree: true, ...patch,
  })
  it('E reads beside the world, F over the whole screen', () => {
    expect(keys('KeyE')).toBe('read')
    expect(keys('KeyF')).toBe('full')
    expect(keys('KeyT')).toBeNull()
  })
  it('does nothing away from a panel, next to an agent, or while placing', () => {
    expect(keys('KeyE', { nearby: false })).toBeNull()
    expect(keys('KeyE', { agent: true })).toBeNull()
    expect(keys('KeyF', { worldKeysFree: false })).toBeNull()
    expect(keys('KeyE', { typing: true })).toBeNull()
    expect(keys('KeyE', { ctrl: true })).toBeNull()
    expect(keys('KeyE', { repeat: true })).toBeNull()
  })
  it('while reading: F switches, Esc and E close, other keys pass', () => {
    expect(keys('KeyF', { reader: 'side', worldKeysFree: false })).toBe('toggle-full')
    expect(keys('Escape', { reader: 'full', worldKeysFree: false, nearby: false })).toBe('close')
    expect(keys('KeyE', { reader: 'side', worldKeysFree: false })).toBe('close')
    expect(keys('ArrowDown', { reader: 'side' })).toBeNull()
    expect(keys('Escape')).toBeNull()
  })
})
