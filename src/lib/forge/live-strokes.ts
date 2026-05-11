// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// LIVE STROKES — transient state for in-progress paint strokes
// ─═̷─═̷─ॐ─═̷─═̷─ Watch wizardry happen in real time ─═̷─═̷─ॐ─═̷─═̷─
// Held outside the main zustand store so per-point updates don't trigger
// re-renders of unrelated UI. Components subscribe via `useLiveStrokes`.
// Cleared on stroke_ended (the persisted PaintStroke takes over the render).
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useSyncExternalStore } from 'react'
import type { InProgressStroke, PaintStrokeStyle } from './paint-stroke'

type StrokesById = Record<string, InProgressStroke>

const globalState = globalThis as typeof globalThis & {
  __oasisLiveStrokes?: { strokes: StrokesById; listeners: Set<() => void> }
}
if (!globalState.__oasisLiveStrokes) {
  globalState.__oasisLiveStrokes = { strokes: {}, listeners: new Set() }
}
const state = globalState.__oasisLiveStrokes

function notify(): void {
  // Snapshot identity must change every notify so useSyncExternalStore detects.
  state.strokes = { ...state.strokes }
  for (const listener of state.listeners) {
    try { listener() } catch { /* swallow — one bad listener mustn't kill the others */ }
  }
}

export function startLiveStroke(args: {
  id: string
  authorId: string
  authorColor: string
  style: PaintStrokeStyle
  firstPoint?: [number, number, number]
}): void {
  state.strokes[args.id] = {
    id: args.id,
    authorId: args.authorId,
    authorColor: args.authorColor,
    color: args.style.color,
    thickness: args.style.thickness,
    shininess: args.style.shininess,
    mode: args.style.mode,
    varyByVelocity: args.style.varyByVelocity,
    points: args.firstPoint ? [args.firstPoint[0], args.firstPoint[1], args.firstPoint[2]] : [],
    startedAt: Date.now(),
  }
  notify()
}

export function appendLiveStrokePoint(strokeId: string, point: [number, number, number]): void {
  const stroke = state.strokes[strokeId]
  if (!stroke) return
  stroke.points.push(point[0], point[1], point[2])
  notify()
}

export function endLiveStroke(strokeId: string): void {
  if (!(strokeId in state.strokes)) return
  delete state.strokes[strokeId]
  notify()
}

export function getLiveStrokes(): StrokesById {
  return state.strokes
}

export function useLiveStrokes(): StrokesById {
  return useSyncExternalStore(
    listener => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    getLiveStrokes,
    getLiveStrokes,
  )
}

/** Clear all live strokes (used on world switch / disconnect). */
export function clearAllLiveStrokes(): void {
  state.strokes = {}
  notify()
}
