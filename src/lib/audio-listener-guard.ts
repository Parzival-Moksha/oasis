// ░▒▓ AUDIO LISTENER GUARD — keep three's AudioListener from piling up Web Audio ramps ▓▒░
// three.js's AudioListener.updateMatrixWorld schedules nine linearRampToValueAtTime events on the
// AudioContext's listener every time it runs. Two things turn that into a slow leak:
//   1. drei's <Html> calls camera.updateMatrixWorld() once per Html element per frame, and the
//      renderer once more, so a village with 20 labels and windows schedules ~190 ramps a frame.
//   2. The context is created without a user gesture, so it sits "suspended" until something
//      resumes it (only firing a bolt did). A suspended context never consumes its timelines, so
//      every ramp stays queued and each new one is inserted into a longer list. Frames slowed
//      from 6 ms to 55 ms over 20 minutes in the owner's tab (2026-11-10), outside the JS heap,
//      and a reload cleared it.
// The guard runs the audio part at most once per frame, and only while the context is running.
// Spatial audio is unchanged when it is on; a suspended context just gets no ramps queued.

export interface ListenerLike {
  context: { state: string }
  updateMatrixWorld: (force?: boolean) => void
}

export interface GuardOptions {
  now?: () => number
  /** Calls closer together than this count as the same frame. */
  sameFrameMs?: number
}

/**
 * Replaces `listener.updateMatrixWorld` on the instance. `baseUpdate` keeps the plain Object3D
 * matrix update (always needed, cheap); `audioUpdate` is three's version with the Web Audio
 * scheduling, run once per frame while the context is running.
 */
export function guardAudioListener<T extends ListenerLike>(
  listener: T,
  baseUpdate: (this: T, force?: boolean) => void,
  audioUpdate: (this: T, force?: boolean) => void,
  options: GuardOptions = {},
): { calls: number; audioRuns: number } {
  const now = options.now || (() => performance.now())
  const sameFrameMs = options.sameFrameMs ?? 4
  const stats = { calls: 0, audioRuns: 0 }
  let lastAudioAt = -Infinity
  listener.updateMatrixWorld = function guardedUpdateMatrixWorld(this: T, force?: boolean) {
    stats.calls += 1
    if (this.context.state !== 'running') {
      baseUpdate.call(this, force)
      return
    }
    const t = now()
    if (t - lastAudioAt < sameFrameMs) {
      baseUpdate.call(this, force)
      return
    }
    lastAudioAt = t
    stats.audioRuns += 1
    audioUpdate.call(this, force)
  }
  return stats
}
