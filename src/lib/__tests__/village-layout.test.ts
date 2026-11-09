import { describe, expect, it } from 'vitest'
import {
  ANORAK_PRO_AVATAR,
  VILLAGE_MEMORY_KEEP_MS,
  VILLAGE_SEAT_HOLD_MS,
  VILLAGE_SPAWN,
  assignVillageAvatars,
  assignVillageSeats,
  DESK_WINDOW_PX,
  DESK_WINDOW_WORLD,
  computeFocusPose,
  computeScreenPose,
  SCREEN_FILL,
  deskWindowDistanceFactor,
  findNearestStation,
  layoutVillageStations,
  plazaCenter,
  rememberVillageAgents,
  resolveVillageOrigin,
  ringCapacity,
  stationAxes,
  stationLocalToWorld,
  villageAgentKey,
  villageSeatStation,
  type Vec3,
  type VillageMemory,
  type VillageRosterAgent,
} from '../village/village-layout'

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2])

describe('layoutVillageStations / villageSeatStation', () => {
  it('puts a single desk straight ahead of the spawn, facing back toward it', () => {
    const [only] = layoutVillageStations(1)
    const center = plazaCenter()
    expect(only.position[0]).toBeCloseTo(0)
    expect(only.position[2]).toBeCloseTo(center.z + 6.5)
    const { forward } = stationAxes(only.rotationY)
    expect(forward[2]).toBeCloseTo(-1) // local +Z points back at the plaza / spawn
  })

  it('keeps neighbours apart, faces every desk at the plaza center and spills into a second ring', () => {
    const capacity = ringCapacity(0)
    const stations = layoutVillageStations(capacity + 3)
    expect(stations.filter(s => s.ring === 0)).toHaveLength(capacity)
    expect(stations.filter(s => s.ring === 1)).toHaveLength(3)
    const center = plazaCenter()
    for (const station of stations) {
      const { forward } = stationAxes(station.rotationY)
      const toCenter = [center.x - station.position[0], center.z - station.position[2]]
      const length = Math.hypot(toCenter[0], toCenter[1])
      expect(forward[0] * toCenter[0] / length + forward[2] * toCenter[1] / length).toBeCloseTo(1)
    }
    for (let i = 0; i < stations.length; i += 1) {
      for (let j = i + 1; j < stations.length; j += 1) {
        expect(dist(stations[i].position, stations[j].position)).toBeGreaterThan(3.3)
      }
    }
  })

  it('places a seat the same way whatever else is taken, filling the ring from the middle outward', () => {
    for (const count of [2, 5, 12]) {
      layoutVillageStations(count).forEach((station, seat) => expect(station).toEqual(villageSeatStation(seat)))
    }
    const xs = [0, 1, 2, 3, 4].map(seat => villageSeatStation(seat).position[0])
    expect(xs[0]).toBeCloseTo(0)
    expect(Math.sign(xs[1])).toBe(-Math.sign(xs[2])) // one to each side
    expect(Math.abs(xs[3])).toBeGreaterThan(Math.abs(xs[1]))
  })

  it('returns nothing for an empty roster', () => {
    expect(layoutVillageStations(0)).toEqual([])
  })
})

describe('resolveVillageOrigin', () => {
  it('is the spawn point unless the world says where the village is', () => {
    expect(resolveVillageOrigin()).toEqual(VILLAGE_SPAWN)
    expect(resolveVillageOrigin(null)).toEqual({ x: 0, z: 3, yaw: 0 })
    expect(resolveVillageOrigin({ x: 10, z: -4, yaw: Math.PI })).toEqual({ x: 10, z: -4, yaw: Math.PI })
    expect(resolveVillageOrigin({ x: 10, z: -4 })).toEqual({ x: 10, z: -4, yaw: 0 })
    expect(resolveVillageOrigin({ x: Number.NaN, z: 2 })).toEqual(VILLAGE_SPAWN)
  })

  it("opens the plaza in the world's direction", () => {
    const [first] = layoutVillageStations(1, { origin: resolveVillageOrigin({ x: 0, z: 0, yaw: Math.PI }) })
    expect(first.position[2]).toBeLessThan(-6) // toward -Z
  })
})

describe('station transforms', () => {
  it('maps station-local offsets into world space', () => {
    const station = { position: [10, 2, 5] as Vec3, rotationY: Math.PI / 2 }
    const [x, y, z] = stationLocalToWorld(station, [0, 1, -1])
    expect(x).toBeCloseTo(9)
    expect(y).toBeCloseTo(3)
    expect(z).toBeCloseTo(5)
  })

  it('finds the nearest station within the radius on the ground plane', () => {
    const anchors = { a: [0, 0, 0] as Vec3, b: [3, 0, 0] as Vec3 }
    expect(findNearestStation([2.2, 5, 0], anchors, 3)).toBe('b')
    expect(findNearestStation([10, 0, 0], anchors, 3)).toBeNull()
    expect(findNearestStation(null, anchors, 3)).toBeNull()
  })

  it('ignores stations far below a flying (noclip) actor so E stays "down" up there', () => {
    const anchors = { a: [0, 0, 0] as Vec3 }
    expect(findNearestStation([1, 1.7, 0], anchors, 3, 2.5)).toBe('a')
    expect(findNearestStation([1, 6, 0], anchors, 3, 2.5)).toBeNull()
  })
})

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/** One page load: remember who is here, seat them, dress them (what VillageWorld does). */
function visit(agents: VillageRosterAgent[], memory: VillageMemory, now: number, catalog: string[] = [], exclude: string[] = []) {
  const seen = rememberVillageAgents(agents, memory, now)
  const seated = assignVillageSeats(agents, seen, now)
  const dressed = assignVillageAvatars(agents, catalog, exclude, seated.memory, now)
  return { seats: seated.seats, avatars: dressed.avatars, memory: dressed.memory }
}

describe('village memory: seats', () => {
  const rick = { id: 'agent-r', name: 'Rick', sessionId: 'sess-rick' }
  const tyler = { id: 'agent-t', name: 'Tyler', sessionId: 'sess-tyler' }
  const anorak = { id: 'obs-a', name: 'Anorak', sessionId: 'sess-anorak' }

  it('keeps every desk across reloads, whatever order the engine lists agents in', () => {
    const first = visit([rick, tyler, anorak], {}, 1000)
    expect(first.seats).toEqual({ 'agent-r': 0, 'agent-t': 1, 'obs-a': 2 })
    // Reload: new agent ids (the engine restarted), another order, the same sessions.
    const again = visit([{ ...anorak, id: 'obs-b' }, { ...tyler, id: 'agent-t2' }, { ...rick, id: 'agent-r2' }], first.memory, 2000)
    expect(again.seats).toEqual({ 'obs-b': 2, 'agent-t2': 1, 'agent-r2': 0 })
  })

  it("seats a newcomer without moving anyone, and holds a leaver's desk for its return", () => {
    const start = visit([rick, tyler, anorak], {}, 1000)
    const tylerLeft = visit([rick, anorak], start.memory, 2000)
    expect(tylerLeft.seats).toEqual({ 'agent-r': 0, 'obs-a': 2 })
    const newcomer = { id: 'agent-n', name: 'Sandbox', sessionId: 'sess-new' }
    const arrived = visit([rick, anorak, newcomer], tylerLeft.memory, 3000)
    expect(arrived.seats).toEqual({ 'agent-r': 0, 'obs-a': 2, 'agent-n': 3 }) // seat 1 is still Tyler's
    const back = visit([rick, anorak, newcomer, tyler], arrived.memory, 4000)
    expect(back.seats['agent-t']).toBe(1)
    // Long gone: the hold lapses and the next newcomer may sit there.
    const later = visit([rick, anorak, newcomer], back.memory, 5000)
    const zed = { id: 'agent-z', name: 'Z', sessionId: 'sess-z' }
    const muchLater = visit([rick, anorak, newcomer, zed], later.memory, 5000 + VILLAGE_SEAT_HOLD_MS + HOUR)
    expect(muchLater.seats['agent-z']).toBe(1)
  })

  it("moves a brand-new agent's seat from its id to its session once it has one", () => {
    const fresh = { id: 'agent-f', name: 'Fresh', sessionId: null }
    const first = visit([rick, fresh], {}, 1000)
    expect(first.seats['agent-f']).toBe(1)
    expect(first.memory['agent-f']?.seat).toBe(1)
    const withSession = visit([rick, { ...fresh, sessionId: 'sess-f' }], first.memory, 1100)
    expect(withSession.seats['agent-f']).toBe(1)
    expect(withSession.memory['sess-f']?.seat).toBe(1)
    expect(withSession.memory['agent-f']).toBeUndefined()
  })

  it('"Move it here": the moved agent borrows a seat while the watcher is still there, then takes over its desk', () => {
    const watching = visit([rick, anorak], {}, 1000)
    const owned = { id: 'agent-a', name: 'Anorak', sessionId: 'sess-anorak' }
    const both = visit([rick, anorak, owned], watching.memory, 2000)
    expect(both.seats).toEqual({ 'agent-r': 0, 'obs-a': 1, 'agent-a': 2 })
    expect(both.memory['sess-anorak']?.seat).toBe(1)
    const after = visit([rick, owned], both.memory, 2100)
    expect(after.seats).toEqual({ 'agent-r': 0, 'agent-a': 1 })
  })

  it('forgets agents not seen for a long time', () => {
    const first = visit([rick, tyler], {}, 1000)
    const later = visit([rick], first.memory, 1000 + VILLAGE_MEMORY_KEEP_MS + DAY)
    expect(Object.keys(later.memory)).toEqual(['sess-rick'])
    expect(villageAgentKey({ id: 'agent-x', sessionId: null })).toBe('agent-x')
  })
})

describe('village memory: bodies', () => {
  const catalog = ['/a.vrm', '/b.vrm', '/c.vrm', ANORAK_PRO_AVATAR]
  const agents = [{ id: '1', name: 'Rick', sessionId: 's1' }, { id: '2', name: 'Tyler', sessionId: 's2' }, { id: '3', name: 'Sysadmin', sessionId: 's3' }]

  it("gives newcomers distinct bodies, never the player's, and Anorak Pro its unicorn", () => {
    const { avatars } = visit(agents, {}, 1000, catalog, ['/b.vrm'])
    expect(new Set(Object.values(avatars)).size).toBe(3)
    expect(Object.values(avatars)).not.toContain('/b.vrm')
    expect(Object.values(avatars)).not.toContain(ANORAK_PRO_AVATAR) // kept for Anorak
    expect(visit([{ id: 'x', name: 'Anorak Pro', sessionId: 'sx' }], {}, 1000, catalog).avatars).toEqual({ x: ANORAK_PRO_AVATAR })
  })

  it("keeps each agent's body when the player changes avatar or switches worlds", () => {
    const first = visit(agents, {}, 1000, catalog, ['/b.vrm'])
    const rickBody = first.avatars['1']
    // The player now wears Rick's body, and another world places an NPC in Tyler's.
    const next = visit(agents, first.memory, 2000, catalog, [rickBody, first.avatars['2']])
    expect(next.avatars['1'].startsWith(`${rickBody}?copy=`)).toBe(true)
    expect(next.avatars['2'].startsWith(`${first.avatars['2']}?copy=`)).toBe(true)
    expect(next.avatars['3']).toBe(first.avatars['3'])
    expect(next.memory.s1.skin).toBe(rickBody)
  })

  it('Anorak keeps the unicorn even when the player wears it', () => {
    const anorak = [{ id: 'x', name: 'Anorakdev', sessionId: 'sx' }]
    expect(visit(anorak, {}, 1000, catalog, [ANORAK_PRO_AVATAR]).avatars.x).toMatch(/UnicornPerson\.vrm\?copy=\d+$/)
  })

  it('makes distinct URLs when there are more agents than bodies, and copies keep their URL when others leave', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, name: `agent ${i}`, sessionId: `s${i}` }))
    const first = visit(many, {}, 1000, catalog)
    const paths = Object.values(first.avatars)
    expect(new Set(paths).size).toBe(6)
    expect(paths.filter(path => path.includes('?copy='))).toHaveLength(3)
    const fewer = visit(many.slice(1), first.memory, 2000, catalog)
    for (const agent of many.slice(1)) {
      // Same body as before; a copy only turns plain when the agent that wore it plain left.
      expect(fewer.avatars[agent.id].replace(/\?copy=\d+$/, '')).toBe(first.avatars[agent.id].replace(/\?copy=\d+$/, ''))
      if (fewer.avatars[agent.id].includes('?copy=')) expect(fewer.avatars[agent.id]).toBe(first.avatars[agent.id])
    }
  })

  it('re-dresses an agent whose remembered body left the catalog', () => {
    const memory: VillageMemory = { s1: { skin: '/gone.vrm', seenAt: 1000 } }
    const { avatars, memory: next } = visit([agents[0]], memory, 2000, catalog)
    expect(catalog).toContain(avatars['1'])
    expect(next.s1.skin).toBe(avatars['1'])
  })
})

describe('computeFocusPose', () => {
  const base = { anchor: [0, 0, 0] as Vec3, rotationY: 0, fov: 50, aspect: 16 / 9 }

  it('looks at the avatar from in front of the desk when no panel covers the screen', () => {
    const pose = computeFocusPose({ ...base, panel: 'none', panelFraction: 0 })
    expect(pose.target[0]).toBeCloseTo(0)
    expect(pose.target[2]).toBeCloseTo(0)
    expect(pose.position[2]).toBeGreaterThan(2) // station local +Z faces the camera
    expect(pose.position[1]).toBeGreaterThan(pose.target[1])
  })

  it('shifts the camera right (avatar on the left) and backs off for a right-side panel', () => {
    const free = computeFocusPose({ ...base, panel: 'none', panelFraction: 0 })
    const panel = computeFocusPose({ ...base, panel: 'right', panelFraction: 0.4 })
    expect(panel.target[0]).toBeGreaterThan(0.3)
    expect(panel.position[0]).toBeCloseTo(panel.target[0])
    expect(panel.position[2]).toBeGreaterThanOrEqual(free.position[2])
  })

  it('lowers the look target for a bottom sheet so the avatar sits in the upper part', () => {
    const free = computeFocusPose({ ...base, aspect: 9 / 19, panel: 'none', panelFraction: 0 })
    const sheet = computeFocusPose({ ...base, aspect: 9 / 19, panel: 'bottom', panelFraction: 0.55 })
    expect(sheet.target[1]).toBeLessThan(free.target[1])
  })
})

describe('desk window and screen mode (F)', () => {
  it('covers the same patch of world in both modes', () => {
    for (const mode of ['desk', 'screen'] as const) {
      const metersPerPx = deskWindowDistanceFactor(mode) / 400
      expect(DESK_WINDOW_PX[mode].width * metersPerPx).toBeCloseTo(DESK_WINDOW_WORLD.width, 5)
      expect(DESK_WINDOW_PX[mode].height * metersPerPx).toBeCloseTo(DESK_WINDOW_WORLD.height, 1)
    }
  })

  it('puts the camera square in front of the window, close enough to fill the view', () => {
    const center: Vec3 = [4, 3.4, -2]
    const fov = 50
    const aspect = 16 / 9
    for (const rotationY of [0, Math.PI / 2, 2.4]) {
      const pose = computeScreenPose({ center, rotationY, fov, aspect })
      expect(pose.target).toEqual(center)
      // Straight on: same height, displaced along the station's forward.
      expect(pose.position[1]).toBeCloseTo(center[1], 6)
      const { forward } = stationAxes(rotationY)
      const d = Math.hypot(pose.position[0] - center[0], pose.position[2] - center[2])
      expect((pose.position[0] - center[0]) / d).toBeCloseTo(forward[0], 6)
      expect((pose.position[2] - center[2]) / d).toBeCloseTo(forward[2], 6)
      // The window takes ~84% of the tighter side of the view, never more.
      const tanV = Math.tan((fov * Math.PI) / 360)
      const shownH = DESK_WINDOW_WORLD.height / (2 * d * tanV)
      const shownW = DESK_WINDOW_WORLD.width / (2 * d * tanV * aspect)
      expect(Math.max(shownH, shownW)).toBeCloseTo(SCREEN_FILL, 2)
    }
  })

  it('backs off on a tall phone screen so the width still fits', () => {
    const wide = computeScreenPose({ center: [0, 3, 0], rotationY: 0, fov: 50, aspect: 16 / 9 })
    const tall = computeScreenPose({ center: [0, 3, 0], rotationY: 0, fov: 50, aspect: 9 / 19 })
    expect(tall.position[2]).toBeGreaterThan(wide.position[2])
  })
})
