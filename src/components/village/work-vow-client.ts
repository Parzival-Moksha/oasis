// ░▒▓ WORK VOW, ON THE PAGE — watches for activity, counts active seconds, reports them in small steps ▓▒░
// Counts only while the tab is visible and the owner did something in the last three minutes (a key,
// the mouse, a tap, the wheel, dictating). Every 15 s the seconds go to /api/village/work, which keeps
// the book; the page only ever shows the server's total plus the seconds it has not sent yet. One
// tick a second drives it all: no per-frame work.

import { onEngineEvent } from '../../lib/agent-engine-client'
import { activeMsBetween, isAutomationClient, ownTurnMs, WORK_BEAT_MS, type AgentWorkReport, type WorkSnapshot } from '../../lib/village/work-vow'
import { useOasisStore } from '../../store/oasisStore'

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
  /** This page is driven by automation (a test browser): it shows the book and never reports. */
  automated: boolean
  /** When another tab counts: its browser and since when (for the HUD). */
  other?: { client?: string; since: number }
}

/**
 * What must outlive this module: a hot reload swaps the module under the HUD, and a fresh copy that
 * started from nothing left the HUD hidden and the 3D clock at 0:00:00 (2026-11-17). The page keeps
 * one of these; every copy of the module picks it up and carries on.
 */
interface WorkVowGlobal {
  state: WorkVowState
  listeners: Set<() => void>
  tab: string
  seq: number
  pendingMs: number
  lastInputAt: number | null
  /** How many HUDs are mounted (the counter runs while there is one). */
  users: number
  /** Stops the copy that is running (its timer and listeners). */
  halt: (() => void) | null
}
const holder = globalThis as unknown as { __oasisWorkVow?: WorkVowGlobal }
const G: WorkVowGlobal = holder.__oasisWorkVow ||= {
  state: { snapshot: null, pendingSeconds: 0, running: false, otherTab: false, unsaved: false, automated: false },
  listeners: new Set(),
  tab: `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
  seq: 0,
  pendingMs: 0,
  lastInputAt: null,
  users: 0,
  halt: null,
}

let state: WorkVowState = G.state
const listeners = G.listeners

function set(patch: Partial<WorkVowState>): void {
  state = G.state
  const next = { ...state, ...patch }
  if (next.snapshot === state.snapshot && next.pendingSeconds === state.pendingSeconds && next.running === state.running && next.otherTab === state.otherTab && next.unsaved === state.unsaved && next.automated === state.automated && next.other === state.other) return
  state = next
  G.state = next
  listeners.forEach(listener => listener())
}

export function getWorkVowState(): WorkVowState {
  // The page's one state, not this copy's: a HUD still holding an older copy of this module reads the same number.
  return G.state
}

export function subscribeWorkVow(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── activity ───────────────────────────────────────────────────────────────

let lastInputAt: number | null = G.lastInputAt

/** Something the owner did (also called while dictating, where no key is pressed). */
export function markWorkActivity(): void {
  lastInputAt = Date.now()
  G.lastInputAt = lastInputAt
}

// ─── focus: what the owner has open (an agent, a mission card), so each second lands in the right place ───

export interface WorkFocusNow {
  agent: { key: string; name: string } | null
  /** A mission file. */
  mission: string | null
}

let focus: WorkFocusNow = { agent: null, mission: null }

/** The owner opened or left an agent or a mission card: book the seconds so far under what was open, then switch. */
export function setWorkFocus(next: WorkFocusNow): void {
  if ((next.agent?.key || '') === (focus.agent?.key || '') && next.mission === focus.mission) return
  if (pendingMs >= 1000) void beat()
  focus = next
}

// ─── agent hours: finished turns and helpers, as the engine reports them ────

const helperSpans = new Map<string, Map<string, { start: number; end: number | null }>>()
let workQueue: AgentWorkReport[] = []
let workTimer: number | null = null

function queueAgentWork(report: AgentWorkReport): void {
  if (!maySend()) return
  workQueue.push(report)
  if (workTimer !== null) return
  workTimer = window.setTimeout(() => {
    workTimer = null
    const batch = workQueue
    workQueue = []
    void post({ agentWork: batch })
  }, 2000)
}

function onEngine(event: { kind: string; agentId: string; ts: number } & Record<string, unknown>): void {
  if (event.kind !== 'turn.end' && event.kind !== 'subagent.start' && event.kind !== 'subagent.end') return
  const agent = useOasisStore.getState().agentEngine.agents[event.agentId]
  if (!agent || typeof event.ts !== 'number') return
  const who = { key: agent.sessionId || agent.id, name: agent.name || agent.id }
  const spans = helperSpans.get(event.agentId) || new Map<string, { start: number; end: number | null }>()
  helperSpans.set(event.agentId, spans)
  const ids = [event.toolUseId, event.taskId].filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (event.kind === 'subagent.start') {
    if (ids[0]) spans.set(ids[0], { start: event.ts, end: null })
    return
  }
  if (event.kind === 'subagent.end') {
    const id = ids.find(candidate => spans.has(candidate))
    const span = id ? spans.get(id) : null
    if (!span || span.end !== null) return
    span.end = event.ts
    // A helper counts in full, under its parent.
    queueAgentWork({ ...who, ts: event.ts, kind: 'helper', ms: event.ts - span.start })
    return
  }
  if (typeof event.durationMs !== 'number' || !(event.durationMs > 0)) return
  // The agent's own time: the turn minus the time it only waited on helpers.
  queueAgentWork({ ...who, ts: event.ts, kind: 'turn', ms: ownTurnMs(event.durationMs, event.ts, [...spans.values()]) })
  for (const [id, span] of spans) if (span.end !== null && span.end <= event.ts) spans.delete(id)
}

// ─── the loop ───────────────────────────────────────────────────────────────

const tab = G.tab
let seq = G.seq
let pendingMs = G.pendingMs
let lastReadAt = 0
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

/**
 * A test browser never counts the owner's work. Playwright and other webdrivers set navigator.webdriver;
 * headless browsers say so in their user agent; a page can also carry ?playtest in its URL. Such a page
 * reads the book (the HUD still shows) but sends nothing. Playtests of the counter itself set
 * window.__oasisWorkTestMode = true first: then it counts and reports, marked as automation, and the
 * server ignores it (the playtests answer the reports themselves).
 */
function automation(): { automated: boolean; testMode: boolean } {
  if (typeof window === 'undefined') return { automated: false, testMode: false }
  const automated = isAutomationClient({ webdriver: navigator.webdriver, userAgent: navigator.userAgent, href: location.href })
  return { automated, testMode: automated && (window as unknown as { __oasisWorkTestMode?: boolean }).__oasisWorkTestMode === true }
}

/** May this page send anything to the work book? */
function maySend(): boolean {
  const { automated, testMode } = automation()
  return !automated || testMode
}

async function post(body: unknown): Promise<{ counting?: boolean; credited?: number; otherTab?: boolean; other?: { client?: string; since: number }; snapshot?: WorkSnapshot } | null> {
  if (!maySend()) return null
  if (automation().automated) body = { ...(body as object), automation: true }
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
  const answer = await post({ tab, seq, seconds, focus, ...(back ? { back: true } : {}) })
  if (!answer) return // offline or mid-reload: the seconds stay pending and go with the next report
  letGoHidden = false
  if (answer.counting === false) {
    if (answer.otherTab) {
      // A different tab reported within the last minute: it counts, what was counted here is its to count.
      pendingMs = 0
      set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: 0, otherTab: true, running: false, other: answer.other })
      return
    }
    // Turned away for another reason (a report that crossed this tab's own letting-go): nobody else
    // counts, so say "back" with the next report and keep the seconds.
    letGoHidden = true
    lastBeatAt = 0
    set({ snapshot: answer.snapshot || state.snapshot, otherTab: false })
    return
  }
  // The server took what the clock allows; anything it did not take is dropped, never sent twice.
  pendingMs = Math.max(0, pendingMs - seconds * 1000)
  set({ snapshot: answer.snapshot || state.snapshot, pendingSeconds: Math.floor(pendingMs / 1000), otherTab: false, other: undefined })
}

function tick(): void {
  const now = Date.now()
  const visible = document.visibilityState === 'visible'
  // A test browser's input is not the owner's work: it gains nothing (unless a counter playtest asks).
  const gained = state.otherTab || !maySend() ? 0 : activeMsBetween(lastTickAt, now, lastInputAt, visible)
  // A tick that arrives late (a sleeping laptop, a throttled tab) is not three hours of work.
  pendingMs += Math.min(gained, 5000)
  lastTickAt = now
  G.seq = seq
  G.pendingMs = pendingMs
  // No book yet (the first read failed, the server was compiling): keep asking, every 5 s, until there is one.
  if (!state.snapshot && now - lastReadAt >= 5000) void refreshWorkVow()
  const due = now - lastBeatAt >= WORK_BEAT_MS
  // Report when there is something to report; a tab that only shows asks now and then who counts.
  if (due && (pendingMs >= 1000 || !state.snapshot || (state.otherTab && visible && gained === 0 && lastInputAt !== null && now - lastInputAt < 20_000))) void beat()
  // More than a minute that the server has not taken: say so, it is not in the book.
  set({ pendingSeconds: Math.floor(pendingMs / 1000), running: gained > 0, unsaved: pendingMs > 60_000 })
}

/** The page is going away (reload, close): send what is left and let the next page count at once. */
function letGo(): void {
  if (state.otherTab || !maySend()) return
  // Whoever lets go must say "back" with its next report, or the server keeps turning this same tab away
  // ("another tab is counting" with no other tab). That covers every way of letting go that the page survives:
  // hidden and shown again, the HUD remounting (a hot reload, React's dev double-mount), a page restored from cache.
  letGoHidden = true
  seq += 1
  const body = JSON.stringify({ tab, seq, seconds: Math.floor(pendingMs / 1000), focus, release: true, ...(automation().automated ? { automation: true } : {}) })
  pendingMs = 0
  try {
    navigator.sendBeacon('/api/village/work', new Blob([body], { type: 'application/json' }))
  } catch { /* the next page starts a little later */ }
}

/** Re-read the book (after starting or stopping a mission, or from another tab's change). */
export async function refreshWorkVow(): Promise<void> {
  lastReadAt = Date.now()
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
  } else {
    void refreshWorkVow()
  }
}

const INPUTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const

/** This copy of the module takes the clock: timer, input listeners, engine events. */
function run(): void {
  G.halt?.() // a copy from before a hot reload stops; this one carries on with the same tab, numbers and book
  set({ automated: automation().automated && !automation().testMode })
  lastTickAt = Date.now()
  lastBeatAt = 0
  for (const type of INPUTS) window.addEventListener(type, markWorkActivity, { capture: true, passive: true })
  const timer = window.setInterval(tick, 1000)
  window.addEventListener('pagehide', letGo)
  document.addEventListener('visibilitychange', onVisibility)
  const stopEngine = onEngineEvent(onEngine)
  const halt = () => {
    window.clearInterval(timer)
    for (const type of INPUTS) window.removeEventListener(type, markWorkActivity, { capture: true })
    window.removeEventListener('pagehide', letGo)
    document.removeEventListener('visibilitychange', onVisibility)
    stopEngine()
    if (G.halt === halt) G.halt = null
  }
  G.halt = halt
  void refreshWorkVow()
}

/** A HUD is on screen: the counter runs while at least one is. */
export function startWorkVow(): () => void {
  G.users += 1
  if (G.users === 1 || !G.halt) run()
  return () => {
    G.users = Math.max(0, G.users - 1)
    if (G.users > 0) return
    G.halt?.()
    letGo()
  }
}

// A hot reload made this copy while a HUD is on screen: take over from the old copy at once.
if (typeof window !== 'undefined' && G.users > 0) run()

// Dev-only console helper (playtests): window.__oasisWork.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as Record<string, unknown>).__oasisWork = {
    state: () => state,
    tab: () => tab,
    /** Show a made-up book (playtests with the API blocked). */
    show: (snapshot: WorkSnapshot) => set({ snapshot }),
  }
}
