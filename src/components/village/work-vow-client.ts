// ░▒▓ WORK VOW, ON THE PAGE — watches for activity, counts active seconds, reports them in small steps ▓▒░
// Counts only while the tab is visible and the owner did something in the last three minutes (a key,
// the mouse, a tap, the wheel, dictating). Every 15 s the seconds go to /api/village/work, which keeps
// the book; the page only ever shows the server's total plus the seconds it has not sent yet. One
// tick a second drives it all: no per-frame work.

import { activeMsBetween, WORK_BEAT_MS, type WorkSnapshot } from '../../lib/village/work-vow'

export interface WorkVowState {
  /** The server's last answer (null until the first one). */
  snapshot: WorkSnapshot | null
  /** Active seconds counted here and not in the book yet. */
  pendingSeconds: number
  /** Counting right now: visible, recently active, and this tab is the one that counts. */
  running: boolean
  /** Another tab counts; this one only shows. */
  otherTab: boolean
  /** The server cannot be reached: the pending seconds are not in the book. */
  unsaved: boolean
}

let state: WorkVowState = { snapshot: null, pendingSeconds: 0, running: false, otherTab: false, unsaved: false }
const listeners = new Set<() => void>()

function set(patch: Partial<WorkVowState>): void {
  const next = { ...state, ...patch }
  if (next.snapshot === state.snapshot && next.pendingSeconds === state.pendingSeconds && next.running === state.running && next.otherTab === state.otherTab && next.unsaved === state.unsaved) return
  state = next
  listeners.forEach(listener => listener())
}

export function getWorkVowState(): WorkVowState {
  return state
}

export function subscribeWorkVow(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── activity ───────────────────────────────────────────────────────────────

let lastInputAt: number | null = null

/** Something the owner did (also called while dictating, where no key is pressed). */
export function markWorkActivity(): void {
  lastInputAt = Date.now()
}

// ─── the loop ───────────────────────────────────────────────────────────────

const tab = `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
let seq = 0
let pendingMs = 0
let lastTickAt = 0
let lastBeatAt = 0
let inFlight: Promise<void> | null = null
/** The route said no (hosted, shared on the network) or failed: try again after this moment. */
let quietUntil = 0
/** This tab let go while hidden; its next report says it is back. */
let letGoHidden = false

function isQuiet(): boolean {
  return Date.now() < quietUntil
}

async function post(body: unknown): Promise<{ counting?: boolean; credited?: number; snapshot?: WorkSnapshot } | null> {
  try {
    const response = await fetch('/api/village/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) quietUntil = Date.now() + 60_000
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function beat(): Promise<void> {
  if (inFlight) return inFlight
  if (isQuiet()) return Promise.resolve()
  inFlight = sendBeat().finally(() => { inFlight = null })
  return inFlight
}

async function sendBeat(): Promise<void> {
  lastBeatAt = Date.now()
  const seconds = Math.floor(pendingMs / 1000)
  seq += 1
  const back = letGoHidden
  const answer = await post({ tab, seq, seconds, ...(back ? { back: true } : {}) })
  if (!answer) return // offline or mid-reload: the seconds stay pending and go with the next report
  letGoHidden = false
  if (answer.counting === false) {
    // Another tab counts: what was counted here is theirs to count, not ours.
    pendingMs = 0
    set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: 0, otherTab: true, running: false })
    return
  }
  // The server took what the clock allows; anything it did not take is dropped, never sent twice.
  pendingMs = Math.max(0, pendingMs - seconds * 1000)
  set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: Math.floor(pendingMs / 1000), otherTab: false })
}

function tick(): void {
  const now = Date.now()
  const visible = document.visibilityState === 'visible'
  const gained = state.otherTab ? 0 : activeMsBetween(lastTickAt, now, lastInputAt, visible)
  // A tick that arrives late (a sleeping laptop, a throttled tab) is not three hours of work.
  pendingMs += Math.min(gained, 5000)
  lastTickAt = now
  const due = now - lastBeatAt >= WORK_BEAT_MS
  // Report when there is something to report; a tab that only shows asks now and then who counts.
  if (due && (pendingMs >= 1000 || !state.snapshot || (state.otherTab && visible && gained === 0 && lastInputAt !== null && now - lastInputAt < 20_000))) void beat()
  // More than a minute that the server has not taken: say so, it is not in the book.
  set({ pendingSeconds: Math.floor(pendingMs / 1000), running: gained > 0, unsaved: pendingMs > 60_000 })
}

/** The page is going away (reload, close): send what is left and let the next page count at once. */
function letGo(): void {
  if (state.otherTab) return
  seq += 1
  const body = JSON.stringify({ tab, seq, seconds: Math.floor(pendingMs / 1000), release: true })
  pendingMs = 0
  try {
    navigator.sendBeacon('/api/village/work', new Blob([body], { type: 'application/json' }))
  } catch { /* the next page starts a little later */ }
}

/** Re-read the book (after starting or stopping a mission, or from another tab's change). */
export async function refreshWorkVow(): Promise<void> {
  try {
    const response = await fetch('/api/village/work', { cache: 'no-store' })
    if (response.ok) set({ snapshot: await response.json() as WorkSnapshot })
  } catch { /* next time */ }
}

/** Start working on a mission, or stop (null): the seconds so far are booked under the old kind first. */
export async function setWorkMission(file: string | null): Promise<boolean> {
  await beat()
  const answer = await post({ mission: file })
  if (answer?.snapshot) set({ snapshot: answer.snapshot })
  return Boolean(answer?.snapshot)
}

/** Hidden: report what is left and let go, so another Oasis tab can count at once. Back in front: say so. */
function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    if (state.otherTab) return
    letGo()
    letGoHidden = true
  } else {
    void refreshWorkVow()
  }
}

const INPUTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const

export function startWorkVow(): () => void {
  lastTickAt = Date.now()
  lastBeatAt = 0
  // Nothing counts until the first real input: a reload with nobody there earns nothing.
  lastInputAt = null
  for (const type of INPUTS) window.addEventListener(type, markWorkActivity, { capture: true, passive: true })
  const timer = window.setInterval(tick, 1000)
  window.addEventListener('pagehide', letGo)
  document.addEventListener('visibilitychange', onVisibility)
  void refreshWorkVow()
  return () => {
    window.clearInterval(timer)
    for (const type of INPUTS) window.removeEventListener(type, markWorkActivity, { capture: true })
    window.removeEventListener('pagehide', letGo)
    document.removeEventListener('visibilitychange', onVisibility)
    letGo()
  }
}

// Dev-only console helper (playtests): window.__oasisWork.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisWork = {
    state: () => state,
    tab: () => tab,
    /** Show a made-up book (playtests with the API blocked). */
    show: (snapshot: WorkSnapshot) => set({ snapshot }),
  }
}
