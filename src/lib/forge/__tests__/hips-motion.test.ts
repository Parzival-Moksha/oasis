import { describe, expect, it } from 'vitest'
import { captureHipsDeltas, detrendTravel, hipsTrackValues, localToWorldXZ, recenterStart, travelVelocity } from '../hips-motion'
import { DANCE_GROOVES, grooveFor, loopSeconds, stepTime } from '../../dance-music'

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

describe('hips movement', () => {
  it('turns a clip\'s hips positions into offsets from rest, in hips heights', () => {
    // A rig in centimetres under a parent scaled by 0.01: hips rest at 100 cm = 1 m.
    const basis = [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01]
    const out = captureHipsDeltas([0, 1], [0, 100, 0, 10, 90, -20], [0, 100, 0], basis, 1)!
    expect(Array.from(out.deltas.slice(0, 3))).toEqual([0, 0, 0])
    expect(out.deltas[3]).toBeCloseTo(0.1, 6)
    expect(out.deltas[4]).toBeCloseTo(-0.1, 6)
    expect(out.deltas[5]).toBeCloseTo(-0.2, 6)
  })

  it('follows the parent\'s rotation (a rig whose up is its z axis)', () => {
    // Parent turns local +z into world +y (and local +y into world -z).
    const basis = [1, 0, 0, 0, 0, -1, 0, 1, 0]
    const out = captureHipsDeltas([0], [0, 0, 1.5], [0, 0, 1], basis, 2)!
    expect(out.deltas[1]).toBeCloseTo(0.25, 6) // half a unit up, in a rig two units tall at the hips
    expect(out.deltas[0]).toBeCloseTo(0, 6)
    expect(out.deltas[2]).toBeCloseTo(0, 6)
  })

  it('refuses rigs it cannot measure', () => {
    expect(captureHipsDeltas([0], [0, 1, 0], [0, 1, 0], IDENTITY, 0)).toBeNull()
    expect(captureHipsDeltas([], [], [0, 1, 0], IDENTITY, 1)).toBeNull()
    expect(captureHipsDeltas([0], [Number.NaN, 1, 0], [0, 1, 0], IDENTITY, 1)).toBeNull()
  })

  it('takes the steady travel out so the loop closes, and reports it', () => {
    // Walking forward 2 hips heights over the clip, with a bounce and a sway.
    const times = [0, 0.25, 0.5, 0.75, 1]
    const deltas = new Float32Array([0, 0, 0, 0.1, -0.05, 0.5, 0, 0, 1, -0.1, -0.05, 1.5, 0, 0, 2])
    const out = detrendTravel(times, deltas)
    expect(out.travel.x).toBeCloseTo(0, 6)
    expect(out.travel.z).toBeCloseTo(2, 6)
    expect(out.deltas[12]).toBeCloseTo(out.deltas[0], 6) // last x == first x
    expect(out.deltas[14]).toBeCloseTo(out.deltas[2], 6) // last z == first z
    expect(out.deltas[3]).toBeCloseTo(0.1, 6) // the sway stays
    expect(out.deltas[4]).toBeCloseTo(-0.05, 6) // the bounce stays
    expect(out.deltas[5]).toBeCloseTo(0, 6)
    expect(Array.from(deltas.slice(12))).toEqual([0, 0, 2]) // input untouched
  })

  it('leaves height alone: a body that ends on the floor ends on the floor', () => {
    const out = detrendTravel([0, 1], new Float32Array([0, 0, 0, 0.3, -0.8, 0.4]))
    expect(out.deltas[4]).toBeCloseTo(-0.8, 6)
  })

  it('starts a clip over the character\'s own spot, keeping its height and its shape', () => {
    // A dance that begins 0.69 hips heights to the side (the capoeira clip does).
    const out = recenterStart(new Float32Array([0.69, -0.1, 0.2, 0.9, -0.3, 0.1, 0.69, -0.1, 0.2]))
    expect(Array.from(out.slice(0, 3)).map(n => +n.toFixed(4))).toEqual([0, -0.1, 0])
    expect(out[3]).toBeCloseTo(0.21, 5)
    expect(out[4]).toBeCloseTo(-0.3, 5)
    expect(out[5]).toBeCloseTo(-0.1, 5)
    expect(out[6]).toBeCloseTo(0, 6) // a closed loop stays closed
  })

  it('a fall that is not detrended keeps its true path (nothing slides)', () => {
    // Half a hips height backwards, most of it at the end: a linear detrend would push the early keys forward.
    const fall = new Float32Array([0, 0, 0, 0, -0.1, -0.02, 0, -0.8, -0.5])
    const kept = recenterStart(fall)
    expect(kept[5]).toBeCloseTo(-0.02, 6)
    const slid = detrendTravel([0, 0.5, 1], fall).deltas
    expect(slid[5]).toBeCloseTo(0.23, 5) // what detrending would have done to the middle key
  })

  it('scales the offsets to the avatar and flips x and z for VRM 0', () => {
    const deltas = new Float32Array([0.1, -0.2, 0.3])
    const tall = hipsTrackValues(deltas, [0, 1, 0.02], 1, false)
    expect(Array.from(tall).map(n => +n.toFixed(4))).toEqual([0.1, 0.8, 0.32])
    const small = hipsTrackValues(deltas, [0, 0.5, 0], 0.5, false)
    expect(Array.from(small).map(n => +n.toFixed(4))).toEqual([0.05, 0.4, 0.15])
    const vrm0 = hipsTrackValues(deltas, [0, 1, 0], 1, true)
    expect(Array.from(vrm0).map(n => +n.toFixed(4))).toEqual([-0.1, 0.8, -0.3])
  })

  it('gives travel as metres a second for the avatar', () => {
    expect(travelVelocity({ travel: { x: 0, z: 2 }, duration: 4 }, 0.9)).toEqual({ x: 0, z: 0.45 })
    expect(travelVelocity({ travel: { x: 1, z: 1 }, duration: 0 }, 1)).toEqual({ x: 0, z: 0 })
  })

  it('turns the character\'s own axes into world axes like THREE\'s rotation.y', () => {
    const forward = localToWorldXZ(0, 1, Math.PI / 2) // facing +x
    expect(forward.x).toBeCloseTo(1, 9)
    expect(forward.z).toBeCloseTo(0, 9)
    const right = localToWorldXZ(1, 0, 0)
    expect(right.x).toBeCloseTo(1, 9)
    expect(right.z).toBeCloseTo(0, 9)
  })
})

describe('dance grooves', () => {
  it('has a groove for every dance on the X key and a fallback for anything else', () => {
    for (const id of ['breakdance', 'hip-hop', 'capoeira', 'moonwalk', 'shuffling', 'thriller', 'twist', 'twirl']) {
      expect(DANCE_GROOVES[id], id).toBeDefined()
    }
    expect(grooveFor('no-such-dance')).toBe(DANCE_GROOVES['hip-hop'])
  })

  it('keeps every hit inside its bar and every bass note inside the loop', () => {
    for (const [id, g] of Object.entries(DANCE_GROOVES)) {
      for (const s of [...g.kick, ...g.snare, ...g.hat, ...(g.accent ?? [])]) {
        expect(s, id).toBeGreaterThanOrEqual(0)
        expect(s, id).toBeLessThan(g.steps)
      }
      for (const [step, semitones, length] of g.bass) {
        expect(step + length, id).toBeLessThanOrEqual(g.bars * g.steps)
        expect(semitones, id).toBeGreaterThanOrEqual(0)
        expect(semitones, id).toBeLessThanOrEqual(36)
      }
      expect(loopSeconds(g), id).toBeGreaterThan(1.5)
      expect(loopSeconds(g), id).toBeLessThan(8)
      expect(stepTime(g, g.bars * g.steps - 1), id).toBeLessThan(loopSeconds(g))
    }
  })

  it('swing delays only the off steps', () => {
    const g = DANCE_GROOVES['hip-hop']
    const sixteenth = 60 / g.bpm / 4
    expect(stepTime(g, 2)).toBeCloseTo(2 * sixteenth, 9)
    expect(stepTime(g, 3)).toBeGreaterThan(3 * sixteenth)
  })
})
