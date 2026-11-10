// ░▒▓ FRAME CALLBACK TIMING — how long each useFrame callback takes, summed per sample ▓▒░
// Chromium's long-frame attribution stops at the requestAnimationFrame entry point, which for an
// R3F scene is always the fiber loop. This wraps every subscriber the loop runs, so the perf
// heartbeat can name the callbacks a slow frame spent its time in. The wrapper caches one timed
// function per callback identity, so a steady scene allocates nothing per frame.

export interface FrameSubscriberLike {
  ref: { current: (...args: unknown[]) => unknown }
}

export interface FrameCallbackTotal {
  who: string
  ms: number
  calls: number
}

export interface FrameCallbackReport {
  /** Frames timed in the window (one in `sampleEvery`). */
  frames: number
  /** Callback time summed over the timed frames, divided by their count. */
  msPerFrame: number
  top: FrameCallbackTotal[]
}

const LABELS = new WeakMap<object, string>()

/** A short, stable name for a callback: its function name, or the first line of its source. */
export function callbackLabel(fn: (...args: unknown[]) => unknown): string {
  const known = LABELS.get(fn)
  if (known) return known
  let label = fn.name && fn.name !== 'anonymous' ? fn.name : ''
  if (!label) {
    const source = Function.prototype.toString.call(fn).replace(/\s+/g, ' ').trim()
    label = source.slice(0, 80)
  }
  LABELS.set(fn, label)
  return label
}

export class FrameCallbackTimer {
  private totals = new Map<string, FrameCallbackTotal>()
  private frames = 0
  private ticks = 0
  private active = false
  private timedFns = new WeakMap<object, (...args: unknown[]) => unknown>()
  private now: () => number
  private sampleEvery: number

  /**
   * `sampleEvery`: time one frame in that many (the rest cost one boolean check per callback), so a
   * village with a thousand frame callbacks at 165 fps keeps its frame budget.
   */
  constructor(now: () => number = () => performance.now(), sampleEvery = 8) {
    this.now = now
    this.sampleEvery = Math.max(1, Math.floor(sampleEvery))
  }

  /** Marks one frame boundary (call once per frame, before the other callbacks run). */
  tick(): void {
    this.ticks += 1
    this.active = this.ticks % this.sampleEvery === 0
    if (this.active) this.frames += 1
  }

  /**
   * Replaces each subscriber's `ref` with one that hands out timed callbacks. Idempotent per subscriber.
   * A ref wrapped by another timer (a hot reload makes a new one) is taken over, so the newest timer
   * is always the one that counts.
   */
  instrument(subscribers: readonly FrameSubscriberLike[]): number {
    let wrapped = 0
    for (const sub of subscribers) {
      type Ref = { current: (...args: unknown[]) => unknown; __perfTimed?: unknown; __perfOriginal?: Ref }
      const ref = sub.ref as Ref
      if (!ref || ref.__perfTimed === this) continue
      const original = ref.__perfTimed && ref.__perfOriginal ? ref.__perfOriginal : ref
      const timed = { __perfTimed: this, __perfOriginal: original } as unknown as Ref
      let lastFn: unknown = null
      let lastTimed: (...args: unknown[]) => unknown = original.current
      Object.defineProperty(timed, 'current', {
        configurable: true,
        enumerable: true,
        get: () => {
          const fn = original.current
          if (fn !== lastFn) { lastFn = fn; lastTimed = this.timedVersion(fn) }
          return lastTimed
        },
        set: (next: (...args: unknown[]) => unknown) => { original.current = next },
      })
      sub.ref = timed
      wrapped += 1
    }
    return wrapped
  }

  private timedVersion(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    if (typeof fn !== 'function') return fn
    const cached = this.timedFns.get(fn)
    if (cached) return cached
    const now = this.now
    const timed = (...args: unknown[]) => {
      if (!this.active) return fn(...args)
      const start = now()
      try {
        return fn(...args)
      } finally {
        const elapsed = now() - start
        const who = callbackLabel(fn)
        const totals = this.totals
        const total = totals.get(who)
        if (total) {
          total.ms += elapsed
          total.calls += 1
        } else {
          totals.set(who, { who, ms: elapsed, calls: 1 })
        }
      }
    }
    this.timedFns.set(fn, timed)
    return timed
  }

  /** The window's report, then starts a new window. */
  flush(topN = 8): FrameCallbackReport {
    let sum = 0
    for (const total of this.totals.values()) sum += total.ms
    const top = [...this.totals.values()]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, topN)
      .map(total => ({ who: total.who, ms: Math.round(total.ms * 10) / 10, calls: total.calls }))
    const report = { frames: this.frames, msPerFrame: this.frames ? Math.round((sum / this.frames) * 100) / 100 : 0, top }
    this.totals = new Map()
    this.frames = 0
    return report
  }
}
