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
