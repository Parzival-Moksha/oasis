// ░▒▓ LONG FRAMES — what a slow frame was doing, summed over a sample window ▓▒░
// Chromium's long-animation-frame entries (LoAF) say, for every animation frame over 50 ms, how
// long it ran, how much of it was rendering (style + layout) and which scripts ran, each with its
// invoker ("FrameRequestCallback", "TimerHandler", "EventListener"…), source file and function.
// The perf heartbeat sums them per 5 minutes so a slowdown in the owner's real tab names its
// function, instead of only its count. Pure functions: the component feeds entries in.

export interface LongFrameScript {
  invoker?: string
  invokerType?: string
  sourceURL?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  duration: number
  /** Time the script spent being compiled or forced to lay out, inside `duration`. */
  forcedStyleAndLayoutDuration?: number
}

export interface LongFrameEntry {
  startTime: number
  duration: number
  blockingDuration?: number
  renderStart?: number
  styleAndLayoutStart?: number
  scripts?: readonly LongFrameScript[]
}

export interface LongFrameScriptTotal {
  /** `invokerType` and the script's own name, like "user-callback FrameRequestCallback VillageWorld.tsx:393 useVisibleDeskWindows". */
  who: string
  ms: number
  count: number
}

export interface LongFrameSummary {
  /** Frames over 50 ms. */
  frames: number
  /** Their total duration. */
  ms: number
  /** Time above the 50 ms budget (what the user felt). */
  blockingMs: number
  /** Style and layout time inside those frames. */
  renderMs: number
  /** Script time attributed by Chromium. */
  scriptMs: number
  /** Forced synchronous layout inside scripts (a classic read-after-write cost). */
  forcedLayoutMs: number
  /** The longest frame seen. */
  maxMs: number
  /** Heaviest scripts by summed time. */
  top: LongFrameScriptTotal[]
}

export function scriptLabel(script: LongFrameScript): string {
  const file = (script.sourceURL || '').replace(/\?.*$/, '').split('/').filter(Boolean).slice(-1)[0] || ''
  const where = file ? `${file}${typeof script.sourceCharPosition === 'number' ? `@${script.sourceCharPosition}` : ''}` : ''
  const name = script.sourceFunctionName || ''
  const invoker = script.invoker || ''
  return [script.invokerType || '', invoker, where, name].filter(Boolean).join(' ') || '(unknown)'
}

export function summarizeLongFrames(entries: readonly LongFrameEntry[], topN = 8): LongFrameSummary {
  const totals = new Map<string, LongFrameScriptTotal>()
  let frames = 0
  let ms = 0
  let blockingMs = 0
  let renderMs = 0
  let scriptMs = 0
  let forcedLayoutMs = 0
  let maxMs = 0
  for (const entry of entries) {
    frames += 1
    ms += entry.duration
    blockingMs += entry.blockingDuration ?? Math.max(0, entry.duration - 50)
    maxMs = Math.max(maxMs, entry.duration)
    if (typeof entry.renderStart === 'number' && entry.renderStart > 0) {
      renderMs += Math.max(0, entry.startTime + entry.duration - entry.renderStart)
    }
    for (const script of entry.scripts || []) {
      scriptMs += script.duration
      forcedLayoutMs += script.forcedStyleAndLayoutDuration || 0
      const who = scriptLabel(script)
      const total = totals.get(who) || { who, ms: 0, count: 0 }
      total.ms += script.duration
      total.count += 1
      totals.set(who, total)
    }
  }
  const top = [...totals.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, topN)
    .map(total => ({ who: total.who, ms: Math.round(total.ms), count: total.count }))
  return {
    frames,
    ms: Math.round(ms),
    blockingMs: Math.round(blockingMs),
    renderMs: Math.round(renderMs),
    scriptMs: Math.round(scriptMs),
    forcedLayoutMs: Math.round(forcedLayoutMs),
    maxMs: Math.round(maxMs),
    top,
  }
}
