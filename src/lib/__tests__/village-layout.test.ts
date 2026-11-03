import { describe, expect, it } from 'vitest'
import {
  ANORAK_PRO_AVATAR,
  assignVillageAvatars,
  computeFocusPose,
  findNearestStation,
  layoutVillageStations,
  plazaCenter,
  resolveVillageOrigin,
  ringCapacity,
  stationAxes,
  stationLocalToWorld,
  type Vec3,
} from '../village/village-layout'

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2])

describe('layoutVillageStations', () => {
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

  it('returns nothing for an empty roster', () => {
    expect(layoutVillageStations(0)).toEqual([])
  })
})

describe('resolveVillageOrigin', () => {
  it('opens the village in the direction the camera looks', () => {
    const origin = resolveVillageOrigin({ position: [0, 0, 3], forward: [0, 0, 1] }, { position: [0, 2, 7], forward: [0, -0.2, -0.98] })
    expect(origin.x).toBe(0)
    expect(origin.z).toBe(3)
    expect(Math.abs(origin.yaw)).toBeCloseTo(Math.PI)
    const [first] = layoutVillageStations(1, { origin })
    expect(first.position[2]).toBeLessThan(3) // ahead of the player, toward -Z
  })

  it('falls back to the avatar facing, then to +Z', () => {
    expect(resolveVillageOrigin({ position: [1, 0, 1], forward: [1, 0, 0] }, { position: [1, 9, 1], forward: [0, -1, 0] }).yaw).toBeCloseTo(Math.PI / 2)
    expect(resolveVillageOrigin({ position: [1, 0, 1] }, null)).toEqual({ x: 1, z: 1, yaw: 0 })
    expect(resolveVillageOrigin(null, null)).toEqual({ x: 0, z: 3, yaw: 0 })
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

describe('assignVillageAvatars', () => {
  const catalog = ['/a.vrm', '/b.vrm', '/c.vrm', ANORAK_PRO_AVATAR]

  it('gives each agent a distinct body, never the excluded (player) one, stable per name', () => {
    const agents = [{ id: '1', name: 'Rick' }, { id: '2', name: 'Tyler' }, { id: '3', name: 'Sysadmin' }]
    const first = assignVillageAvatars(agents, catalog, ['/b.vrm'])
    expect(new Set(Object.values(first)).size).toBe(3)
    expect(Object.values(first)).not.toContain('/b.vrm')
    expect(assignVillageAvatars(agents, catalog, ['/b.vrm'])).toEqual(first)
  })

  it('dresses Anorak Pro as Anorak Pro', () => {
    expect(assignVillageAvatars([{ id: 'x', name: 'Anorak Pro' }], catalog)).toEqual({ x: ANORAK_PRO_AVATAR })
  })

  it('makes distinct URLs when there are more agents than bodies', () => {
    const agents = Array.from({ length: 6 }, (_, i) => ({ id: `id${i}`, name: `agent ${i}` }))
    const paths = Object.values(assignVillageAvatars(agents, catalog))
    expect(new Set(paths).size).toBe(6)
    expect(paths.filter(path => path.includes('?copy='))).toHaveLength(2)
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
