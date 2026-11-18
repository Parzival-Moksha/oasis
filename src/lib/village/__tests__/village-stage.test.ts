import { describe, expect, it } from 'vitest'
import { STATION, stationLocalToWorld } from '../village-layout'
import { STAGE, isStageWorldName, stageArrival, stationAtAnchor } from '../village-stage'

describe('stage worlds', () => {
  it('are the worlds with Council in the name', () => {
    expect(isStageWorldName('The Council')).toBe(true)
    expect(isStageWorldName('council fire')).toBe(true)
    expect(isStageWorldName('Zen Workshop')).toBe(false)
    expect(isStageWorldName('Councillor office')).toBe(false)
    expect(isStageWorldName(null)).toBe(false)
  })
})

describe('stageArrival', () => {
  it('is straight out behind the place, facing the fire', () => {
    const spot = stageArrival({ x: 3, z: 9 }, { x: 0, z: 9 })
    expect(spot.x).toBeCloseTo(3 + STAGE.arriveDistance)
    expect(spot.z).toBeCloseTo(9)
    // Facing -x (towards the centre): forward (sin yaw, cos yaw) = (-1, 0).
    expect(Math.sin(spot.yaw)).toBeCloseTo(-1)
    expect(Math.cos(spot.yaw)).toBeCloseTo(0)
  })
  it('copes with a place on the centre', () => {
    const spot = stageArrival({ x: 0, z: 0 }, { x: 0, z: 0 }, 2)
    expect(spot.z).toBeCloseTo(2)
  })
})

describe('stationAtAnchor', () => {
  it('puts the station so that its avatar spot is the anchor', () => {
    for (const yaw of [0, 0.7, Math.PI, -2.1]) {
      const station = stationAtAnchor([4, 0.2, -3], yaw)
      const back = stationLocalToWorld(station, STATION.avatar)
      expect(back[0]).toBeCloseTo(4)
      expect(back[1]).toBeCloseTo(0.2)
      expect(back[2]).toBeCloseTo(-3)
      expect(station.rotationY).toBe(yaw)
    }
  })
})

import { blockedArcs, openAngle, stageRoute, type StageObstacle } from '../village-stage'

// The Council world's seats: six logs and two stones at 4.45 m, every 45 degrees from 22.5.
const CENTER = { x: 0, z: 9 }
const SEATS: StageObstacle[] = [22.5, 67.5, 112.5, 157.5, -157.5, -112.5, -67.5, -22.5].map((deg, i) => ({
  x: Math.sin((deg * Math.PI) / 180) * 4.45,
  z: 9 + Math.cos((deg * Math.PI) / 180) * 4.45,
  reach: i % 4 === 1 ? 0.6 : 0.8,
}))
const placeAt = (deg: number, r = 3.6) => ({ x: Math.sin((deg * Math.PI) / 180) * r, z: 9 + Math.cos((deg * Math.PI) / 180) * r })
const deg = (rad: number) => Math.round((rad * 180) / Math.PI)

describe('the way in between the seats', () => {
  it('a place in a gap walks straight in', () => {
    const route = stageRoute(placeAt(45), CENTER, SEATS)
    expect(route.door).toBeNull()
    expect(deg(route.angle)).toBe(45)
  })
  it('a place behind a log goes round it through the nearest gap', () => {
    const route = stageRoute(placeAt(22.5), CENTER, SEATS)
    expect(route.door).not.toBeNull()
    const arcs = blockedArcs(SEATS, CENTER)
    expect(openAngle(route.angle, arcs)).toBeCloseTo(route.angle)
    // The nearest open side, well clear of the log at 22.5.
    expect(Math.abs(deg(route.angle) - 22.5)).toBeGreaterThan(10)
    expect(Math.abs(deg(route.angle) - 22.5)).toBeLessThan(23)
    // The door is inside the ring of seats, the arrival out beyond it.
    const doorR = Math.hypot(route.door!.x - CENTER.x, route.door!.z - CENTER.z)
    expect(doorR).toBeLessThan(4.45 - 0.8)
    expect(doorR).toBeGreaterThan(3.59)
    expect(Math.hypot(route.arrival.x - CENTER.x, route.arrival.z - CENTER.z)).toBeCloseTo(9.6)
  })
  it('every place of six, seven or eight on the circle finds an open way', () => {
    const arcs = blockedArcs(SEATS, CENTER)
    for (const n of [4, 5, 6, 7, 8]) {
      for (let i = 0; i < n; i += 1) {
        const route = stageRoute(placeAt(180 + (360 * (i + 1)) / (n + 1)), CENTER, SEATS)
        expect(arcs.every(arc => Math.abs(((route.angle - arc.angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > arc.half)).toBe(true)
      }
    }
  })
  it('things inside the circle or beyond the arrival are not in the way', () => {
    const route = stageRoute(placeAt(22.5), CENTER, [{ x: 0, z: 9, reach: 1 }, { ...placeAt(22.5, 11), reach: 1 }])
    expect(route.door).toBeNull()
  })
})
