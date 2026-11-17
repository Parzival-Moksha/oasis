// ░▒▓ FPS METER — frames per second over the last second, for the counter and the perf heartbeat ▓▒░
// The samples live on globalThis, not in Scene.tsx: after a hot reload of Scene.tsx the frame tracker inside the
// Canvas (another React root) kept the old module while the counter got the new one, so the counter read a meter
// nobody fed and showed a gray "-- FPS" until a full page reload (2026-11-17). One shared meter, whatever reloads.

const SAMPLE_WINDOW_MS = 1000
const SAMPLE_LIMIT = 240
/** No frame for this long: say so (a hidden tab, a stalled page) instead of an old number. */
export const FPS_STALE_AFTER_MS = 3000

interface FpsMeter { latest: number | null; sampleAt: number; frames: number[] }

const g = globalThis as unknown as { __oasisFpsMeter?: FpsMeter }
const meter: FpsMeter = g.__oasisFpsMeter ??= { latest: null, sampleAt: 0, frames: [] }

/** Call once a frame (useFrame). */
export function trackFrame(now = performance.now()): void {
  const frames = meter.frames
  frames.push(now)
  while (frames.length > SAMPLE_LIMIT) frames.shift()
  while (frames.length > 2 && now - frames[0] > SAMPLE_WINDOW_MS) frames.shift()
  if (frames.length >= 2) {
    const elapsed = frames[frames.length - 1] - frames[0]
    if (elapsed > 0) meter.latest = Math.round(((frames.length - 1) * 1000) / elapsed)
  }
  meter.sampleAt = now
}

/** The last reading, or null when there is none or no frame came for FPS_STALE_AFTER_MS. */
export function readLatestFps(now = typeof performance === 'undefined' ? 0 : performance.now()): number | null {
  if (meter.latest === null) return null
  return now - meter.sampleAt <= FPS_STALE_AFTER_MS ? meter.latest : null
}
