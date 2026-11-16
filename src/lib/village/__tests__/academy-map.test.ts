import { describe, expect, it } from 'vitest'

import {
  ACADEMY_MAP,
  ACADEMY_MAP_ZOOM,
  academyLaneLook,
  academyMapKeyAction,
  clampMapView,
  fitMapView,
  layoutAcademyMap,
  pickMapNode,
  zoomMapView,
  type AcademyMapKeyContext,
} from '../academy-map'
import { normalizeAcademyContent, type AcademyContent } from '../village-academy'

const skill = (id: string, tier: number, lane: string, needs: string[] = [], order = 0) => ({ id, name: id, tier, lane, needs, order, xp: 10, what: '', prompt: '', proof: '', mins: 5, keys: [], way: null })

/** A tree shaped like the real one: a core of four, 14 lanes, crowded cells (six in one lane's ring). */
function bigTree(): AcademyContent {
  const raw: Array<ReturnType<typeof skill>> = []
  let order = 0
  const add = (id: string, tier: number, lane: string, needs: string[] = []) => raw.push(skill(id, tier, lane, needs, ++order))
  ;['a101', 'spirit', 'body', 'soul'].forEach(id => add(id, 0, 'core'))
  const lanes = ['core', 'ears', 'voice', 'reach', 'synapse', 'initiative', 'knows', 'sales', 'builder', 'money', 'sally', 'creator', 'tyler', 'hands']
  const counts: Record<string, number[]> = { tyler: [1, 6, 6, 1, 1], builder: [1, 3, 3, 4, 0], creator: [1, 2, 4, 1, 1], knows: [2, 0, 0, 0, 0] }
  for (const lane of lanes) {
    const row = counts[lane] || [1, 1, 1, 0, 0]
    row.forEach((count, index) => {
      for (let k = 0; k < count; k += 1) add(`${lane}-${index + 1}-${k}`, index + 1, lane, index > 0 && k === 0 ? [`${lane}-${index}-0`] : [])
    })
  }
  return normalizeAcademyContent(raw, { lanes: lanes.map(id => ({ id, name: id.toUpperCase() })) }, 'folder') as AcademyContent
}

describe('the skill map layout', () => {
  const content = bigTree()
  const layout = layoutAcademyMap(content.skills, content.lanes)
  const at = (id: string) => layout.nodes.find(node => node.id === id)!
  const radiusOf = (id: string) => Math.hypot(at(id).x, at(id).y)

  it('every skill has a place, and no two stand on each other', () => {
    expect(layout.nodes).toHaveLength(content.skills.length)
    let closest = Infinity
    for (let i = 0; i < layout.nodes.length; i += 1) for (let j = i + 1; j < layout.nodes.length; j += 1) {
      closest = Math.min(closest, Math.hypot(layout.nodes[i].x - layout.nodes[j].x, layout.nodes[i].y - layout.nodes[j].y))
    }
    // A node with its label is about 2.7 wide and 2.2 tall; staggered neighbours may sit a little closer than that.
    expect(closest).toBeGreaterThan(1.9)
  })

  it('the core is in the middle, and a later tier is further out', () => {
    for (const id of ['a101', 'spirit', 'body', 'soul']) expect(radiusOf(id)).toBeLessThan(3)
    expect(radiusOf('ears-1-0')).toBeGreaterThan(radiusOf('spirit') + 3)
    expect(radiusOf('ears-2-0')).toBeGreaterThan(radiusOf('ears-1-0') + 3)
    expect(radiusOf('tyler-5-0')).toBeGreaterThan(radiusOf('tyler-4-0') + 3)
    expect(layout.rings).toHaveLength(6)
  })

  it('a lane is one slice: its skills stay within a narrow angle of its name', () => {
    for (const lane of layout.lanes) {
      const own = layout.nodes.filter(node => node.lane === lane.id && node.tier > 0)
      for (const node of own) {
        const delta = Math.atan2(Math.sin(Math.atan2(node.y, node.x) - lane.angle), Math.cos(Math.atan2(node.y, node.x) - lane.angle))
        expect(Math.abs(delta)).toBeLessThan(0.7)
      }
      expect(Math.hypot(lane.x, lane.y)).toBeGreaterThan(Math.max(...layout.nodes.map(node => Math.hypot(node.x, node.y))))
    }
    expect(layout.lanes.map(lane => lane.name)).toContain('TYLER')
  })

  it('one skill alone sits dead centre; the first lane points up', () => {
    const one = normalizeAcademyContent([skill('root', 0, 'core', [], 1), skill('next', 1, 'core', ['root'], 2)], {}, 'folder') as AcademyContent
    const small = layoutAcademyMap(one.skills, one.lanes)
    expect(small.nodes.find(node => node.id === 'root')).toMatchObject({ x: 0, y: 0 })
    const next = small.nodes.find(node => node.id === 'next')!
    expect(next.y).toBeGreaterThan(3)
    expect(Math.abs(next.x)).toBeLessThan(0.01)
  })

  it('lines: every need, and a skill that needs nothing hangs on its branch or the core', () => {
    expect(layout.edges).toContainEqual({ from: 'tyler-1-0', to: 'tyler-2-0', kind: 'need' })
    const branch = layout.edges.find(edge => edge.to === 'tyler-2-3')
    expect(branch?.kind).toBe('branch')
    expect(at(branch!.from).lane).toBe('tyler')
    const root = layout.edges.find(edge => edge.to === 'ears-1-0')
    expect(root?.kind).toBe('branch')
    expect(at(root!.from).tier).toBe(0)
    // Everything above the core is tied to something.
    for (const node of layout.nodes) if (node.tier > 0) expect(layout.edges.some(edge => edge.to === node.id)).toBe(true)
    expect(layout.edges.every(edge => edge.from !== edge.to)).toBe(true)
  })

  it('is the same every time', () => {
    expect(layoutAcademyMap(content.skills, content.lanes)).toEqual(layout)
  })
})

describe('pointing, panning, zooming', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, tier: 0, lane: 'core' }, { id: 'b', x: 2, y: 0, tier: 1, lane: 'core' }]

  it('the node under the pointer is the nearest within reach', () => {
    expect(pickMapNode(nodes, 0.3, 0.2)).toBe('a')
    expect(pickMapNode(nodes, 1.2, 0)).toBe('b')
    expect(pickMapNode(nodes, 1, ACADEMY_MAP.hitRadius + 0.5)).toBeNull()
  })

  it('fit shows the whole wheel; the view cannot leave the board or zoom past its limits', () => {
    expect(fitMapView(20)).toEqual({ x: 0, y: 0, span: 42 })
    expect(clampMapView({ x: 0, y: 0, span: 1 }, 20).span).toBe(ACADEMY_MAP_ZOOM.min)
    expect(clampMapView({ x: 0, y: 0, span: 999 }, 20).span).toBe(52)
    const far = clampMapView({ x: 300, y: 400, span: 30 }, 20)
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(20)
    expect(far.x / far.y).toBeCloseTo(0.75)
  })

  it('the wheel zooms about the pointer: the board point under it stays under it', () => {
    const before = { x: 2, y: -1, span: 30 }
    const px = 0.3
    const py = -0.2
    const after = zoomMapView(before, -400, px, py, 40)
    expect(after.span).toBeLessThan(before.span)
    expect(after.x + px * after.span).toBeCloseTo(before.x + px * before.span)
    expect(after.y + py * after.span).toBeCloseTo(before.y + py * before.span)
    expect(zoomMapView(before, 400, 0, 0, 40).span).toBeGreaterThan(before.span)
  })

  it('each lane gets a frame and a pattern of its own, steadily', () => {
    expect(academyLaneLook(0)).toEqual(academyLaneLook(0))
    const looks = Array.from({ length: 14 }, (_, index) => JSON.stringify(academyLaneLook(index)))
    expect(new Set(looks).size).toBe(14)
  })
})

describe('the map keys', () => {
  const base: AcademyMapKeyContext = { code: 'KeyK', ctrl: false, meta: false, alt: false, repeat: false, typing: false, mapOpen: false, readerOpen: false, agentOpen: false, worldKeysFree: true }

  it('K opens it while walking; not while typing, with an agent open or with a modifier', () => {
    expect(academyMapKeyAction(base)).toBe('open')
    expect(academyMapKeyAction({ ...base, typing: true })).toBeNull()
    expect(academyMapKeyAction({ ...base, agentOpen: true })).toBeNull()
    expect(academyMapKeyAction({ ...base, worldKeysFree: false })).toBeNull()
    expect(academyMapKeyAction({ ...base, ctrl: true })).toBeNull()
    expect(academyMapKeyAction({ ...base, code: 'Escape' })).toBeNull()
  })

  it('K or Esc closes it; an open sheet takes Esc first', () => {
    expect(academyMapKeyAction({ ...base, mapOpen: true })).toBe('close')
    expect(academyMapKeyAction({ ...base, mapOpen: true, code: 'Escape', typing: true })).toBe('close')
    expect(academyMapKeyAction({ ...base, mapOpen: true, typing: true })).toBeNull()
    expect(academyMapKeyAction({ ...base, mapOpen: true, code: 'Escape', readerOpen: true })).toBeNull()
    expect(academyMapKeyAction({ ...base, mapOpen: true, code: 'KeyE' })).toBeNull()
  })
})
