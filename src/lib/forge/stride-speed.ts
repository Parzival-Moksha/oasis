// How fast a walk or run clip carries a body over the ground, measured on that body.
//
// The clips play in place (or with their travel taken out, see hips-motion.ts), so while a foot is planted it
// slides backwards under the body at exactly the speed the body should move. We sample the clip once on the
// avatar it was retargeted for and read that speed. Playing the clip at (real speed ÷ this) then keeps the feet
// from skating, for a short body and a tall one alike, with any clip (Quaternius or Mixamo).

import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

const SAMPLES = 96
const cache = new WeakMap<THREE.AnimationClip, number | null>()

type BoneName = Parameters<VRM['humanoid']['getNormalizedBoneNode']>[0]

/** Metres a second, or null when it can't be read (no feet, a clip that doesn't step). Cached per clip. */
export function measureStrideSpeed(vrm: VRM, clip: THREE.AnimationClip): number | null {
  if (cache.has(clip)) return cache.get(clip) ?? null
  const result = measure(vrm, clip)
  cache.set(clip, result)
  return result
}

function measure(vrm: VRM, clip: THREE.AnimationClip): number | null {
  const feet = (['leftFoot', 'rightFoot'] as BoneName[]).map(name => vrm.humanoid.getNormalizedBoneNode(name)).filter(Boolean) as THREE.Object3D[]
  const hips = vrm.humanoid.getNormalizedBoneNode('hips' as BoneName)
  if (feet.length < 2 || !hips || !(clip.duration > 0.1)) return null
  // A mixer of its own: the avatar's real mixer writes every bound bone again on its next update.
  const mixer = new THREE.AnimationMixer(vrm.scene)
  const action = mixer.clipAction(clip)
  action.play()
  const inverse = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const tracks: { x: number; y: number; z: number }[][] = [[], []]
  const hipsY: number[] = []
  try {
    vrm.scene.updateWorldMatrix(true, true)
    inverse.copy(vrm.scene.matrixWorld).invert()
    for (let i = 0; i < SAMPLES; i++) {
      mixer.setTime((clip.duration * i) / SAMPLES)
      vrm.scene.updateMatrixWorld(true)
      hipsY.push(hips.getWorldPosition(p).applyMatrix4(inverse).y)
      feet.forEach((foot, f) => {
        foot.getWorldPosition(p).applyMatrix4(inverse)
        tracks[f].push({ x: p.x, y: p.y, z: p.z })
      })
    }
  } catch {
    return null
  } finally {
    action.stop()
    mixer.uncacheAction(clip)
    mixer.uncacheRoot(vrm.scene)
  }
  const dt = clip.duration / SAMPLES
  // In a loop played in place a foot goes back and forth along the walking line: backwards while it is on the
  // ground (at the body's speed), forwards through the air. So: split each sample step by which way the foot moves,
  // call the lower of the two ways the stance (measured from the hips, along the body's own up), and take its
  // distance over its time.
  // Up is from the feet to the hips, whatever way this rig's frame reads y; heights are taken from the hips, so
  // the body's bob doesn't count either.
  const meanFoot = tracks.flat().reduce((sum, s) => sum + s.y, 0) / (tracks[0].length * 2)
  const up = hipsY.reduce((sum, y) => sum + y, 0) / hipsY.length >= meanFoot ? 1 : -1
  const speeds: number[] = []
  for (const track of tracks) {
    const range = (pick: (s: { x: number; z: number }) => number) => Math.max(...track.map(pick)) - Math.min(...track.map(pick))
    const along = range(s => s.z) >= range(s => s.x) ? (s: { x: number; z: number }) => s.z : (s: { x: number; z: number }) => s.x
    const ways = [{ distance: 0, time: 0, height: 0 }, { distance: 0, time: 0, height: 0 }]
    for (let i = 0; i < track.length; i++) {
      const next = (i + 1) % track.length
      const a = track[i]
      const b = track[next]
      const step = along(b) - along(a)
      const way = ways[step >= 0 ? 0 : 1]
      way.distance += Math.abs(step)
      way.time += dt
      way.height += up * ((a.y - hipsY[i]) + (b.y - hipsY[next])) / 2 * dt
    }
    const moving = ways.filter(w => w.time > clip.duration * 0.15)
    if (moving.length < 2) continue
    const stance = moving[0].height / moving[0].time <= moving[1].height / moving[1].time ? moving[0] : moving[1]
    speeds.push(stance.distance / stance.time)
    if (typeof window !== 'undefined' && (window as unknown as { __strideDebug?: boolean }).__strideDebug) {
      console.info(`[stride] ${clip.name} dur ${clip.duration.toFixed(2)} ` + moving.map(w => `[t ${(w.time / clip.duration).toFixed(2)} d ${w.distance.toFixed(2)} h ${(w.height / w.time).toFixed(3)}]`).join(' '))
    }
  }
  if (!speeds.length) return null
  const speed = speeds.reduce((sum, s) => sum + s, 0) / speeds.length
  return speed > 0.2 && speed < 15 ? speed : null
}

/** Playback rate that matches a clip's steps to the body's real speed, kept within what still looks like that gait. */
export function strideTimeScale(realSpeed: number, naturalSpeed: number | null, fallback = 1): number {
  if (!naturalSpeed || !(realSpeed > 0)) return fallback
  return Math.max(0.35, Math.min(3.2, realSpeed / naturalSpeed))
}

export type Gait = 'walk' | 'run' | 'sprint'

/** How far past its own stride speed a gait may be played before the next one looks better (and back, a bit lower). */
const UP = { walk: 2.1, run: 1.9 }
const DOWN = { walk: 1.9, run: 1.7 }

/**
 * Which gait fits a speed, from the clips' measured speeds on this body (walk ~0.8 m/s, jog ~2.4, sprint ~3.8 for the
 * free pack on a 1.7 m avatar). A slow walk can be sped up about twice before it looks hurried; past that the jog,
 * and past about twice the jog the sprint. A little lower on the way down, so a speed on the line doesn't flicker.
 * Null when the walk's speed is unknown: the caller keeps its own thresholds.
 */
export function pickGait(speed: number, current: Gait | null, natural: { walk?: number | null; run?: number | null }): Gait | null {
  const walk = natural.walk
  if (!walk) return null
  const run = natural.run || walk * 3
  const walkTop = walk * (current === 'run' || current === 'sprint' ? DOWN.walk : UP.walk)
  const runTop = run * (current === 'sprint' ? DOWN.run : UP.run)
  if (speed <= walkTop) return 'walk'
  if (speed <= runTop) return 'run'
  return 'sprint'
}

let lastMeasureAt = -Infinity

/**
 * The same, but at most one new measure per frame across the page (Perf, 2026-11-20: a measure is 2-4 ms, and 24
 * agents told to follow at once would each measure on the same frame). Undefined: not measured yet, ask again next
 * frame and keep the pace you have meanwhile.
 */
export function strideSpeedThisFrame(vrm: VRM, clip: THREE.AnimationClip): number | null | undefined {
  if (cache.has(clip)) return cache.get(clip) ?? null
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - lastMeasureAt < 12) return undefined
  lastMeasureAt = now
  return measureStrideSpeed(vrm, clip)
}
