// ░▒▓ VILLAGE DICTATION — the mic and the draft of each agent's box, outside React ▓▒░
// The owner lost words (2026-11-16): F stopped or orphaned the dictation, a hot reload ended it, stopping the mic
// shrank the text, and a long dictation stopped showing new lines. So the draft and the running dictation live
// here, not in the box that shows them: the side panel (E) and the screen (F) are two views of the same draft and
// the same mic session, and a box that unmounts (F, N, Fast Refresh) changes nothing. The state sits on
// globalThis, so even this module being reloaded keeps it, and drafts are saved to localStorage, so a full page
// reload keeps the text (the mic itself ends with the page).
// The rules (tests: village-dictation.test.ts):
//   - words already in the box leave it only by the owner's own edit or a send;
//   - a line still being spoken shows as it grows; when the mic stops, or the session ends any way, its last
//     words stay even if no settled version came;
//   - typing while the mic is on keeps everything: what is in the box becomes the draft, and new lines go after;
//   - after a send, words of that dictation still settling are not added again (they were in the message).
// One dictation at a time (the engine's helper takes one mic): starting another stops the first, keeping its words.

import { registerLipSync, unregisterLipSync, resumeLipSyncContext, type LipSyncController } from '../lip-sync'
import { PLAYER_AVATAR_LIPSYNC_ID } from '../player-avatar-runtime'
import { createWLipSyncLegacyController } from '../wlipsync-driver'
import { isLiveDictationSupported, startLiveDictation, type DictationLine, type LiveDictation, type LiveDictationHandlers } from './live-dictation'

export type DictationPhase = 'idle' | 'starting' | 'listening' | 'stopping'

interface Session {
  phase: DictationPhase
  dictation: LiveDictation | null
  /** Lines of this dictation not yet folded into the draft. */
  lines: Map<number, DictationLine>
  /** Line numbers up to this one are in the draft already (or were sent): later news about them is ignored. */
  frozenThrough: number
  stopRequested: boolean
  status: string
  level: number
  lipSync: LipSyncController | null
  startedAt: number
}

interface Store {
  drafts: Map<string, string>
  sessions: Map<string, Session>
  errors: Map<string, string>
  listeners: Set<() => void>
  version: number
  saveTimer: ReturnType<typeof setTimeout> | null
  starter: (handlers: LiveDictationHandlers) => Promise<LiveDictation>
  lipSync: boolean
}

const STORAGE_KEY = 'oasis.village.drafts.v1'

function loadDrafts(): Map<string, string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    const data = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    return new Map(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0))
  } catch {
    return new Map()
  }
}

const g = globalThis as unknown as { __oasisVillageDictation?: Store }
const store: Store = g.__oasisVillageDictation ??= {
  drafts: loadDrafts(),
  sessions: new Map(),
  errors: new Map(),
  listeners: new Set(),
  version: 0,
  saveTimer: null,
  starter: startLiveDictation,
  lipSync: true,
}

export function joinText(base: string, spoken: string): string {
  if (!spoken) return base
  if (!base) return spoken
  return /\s$/.test(base) ? `${base}${spoken}` : `${base} ${spoken}`
}

function liveText(session: Session | undefined): string {
  if (!session) return ''
  return [...session.lines.values()]
    .filter(line => line.line > session.frozenThrough)
    .sort((a, b) => a.line - b.line)
    .map(line => line.text.trim())
    .filter(Boolean)
    .join(' ')
}

function notify(save = true): void {
  store.version += 1
  store.listeners.forEach(listener => listener())
  if (save) saveSoon()
}

function saveSoon(): void {
  if (typeof localStorage === 'undefined' || store.saveTimer) return
  store.saveTimer = setTimeout(() => {
    store.saveTimer = null
    try {
      const out: Record<string, string> = {}
      for (const agentId of new Set([...store.drafts.keys(), ...store.sessions.keys()])) {
        const text = draftText(agentId)
        if (text) out[agentId] = text
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    } catch { /* full or private: the in-memory draft stays */ }
  }, 250)
}

/** What the box shows: the draft and the dictation's words not folded into it yet. */
export function draftText(agentId: string): string {
  return joinText(store.drafts.get(agentId) || '', liveText(store.sessions.get(agentId)))
}

/** Fold what the dictation said so far into the draft; later news about those lines is ignored. */
function freeze(agentId: string, session: Session): void {
  const text = draftText(agentId)
  if (text) store.drafts.set(agentId, text)
  for (const line of session.lines.keys()) session.frozenThrough = Math.max(session.frozenThrough, line)
  session.lines.clear()
}

/** The owner typed or deleted: what is in the box is the draft. A running dictation goes on after it. */
export function setDraftText(agentId: string, text: string): void {
  const session = store.sessions.get(agentId)
  if (session) {
    for (const line of session.lines.keys()) session.frozenThrough = Math.max(session.frozenThrough, line)
    session.lines.clear()
  }
  if (text) store.drafts.set(agentId, text)
  else store.drafts.delete(agentId)
  notify()
}

/**
 * A send takes the box. Call it when the send starts: the mic stops, and the words of this dictation still
 * settling are not added again (they are in the message). Returns the text to send; the draft is kept until
 * `sent` says it went (a failed send leaves the box as it was).
 */
export function takeDraftForSend(agentId: string): { text: string; sent: () => void } {
  const session = store.sessions.get(agentId)
  if (session) {
    freeze(agentId, session)
    stopDictation(agentId)
  }
  const text = draftText(agentId)
  notify()
  return {
    text,
    sent: () => {
      // Only what was sent goes: words typed after pressing send stay.
      const now = store.drafts.get(agentId) || ''
      const rest = now.startsWith(text) ? now.slice(text.length).trim() : (now === text ? '' : now)
      if (rest) store.drafts.set(agentId, rest)
      else store.drafts.delete(agentId)
      notify()
    },
  }
}

function stopLipSync(session: Session): void {
  const ctrl = session.lipSync
  if (!ctrl) return
  session.lipSync = null
  try { unregisterLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl); ctrl.detach() } catch { /* already gone */ }
}

async function startLipSync(session: Session, stream: MediaStream): Promise<void> {
  if (!store.lipSync) return
  try {
    const ctrl = createWLipSyncLegacyController()
    session.lipSync = ctrl
    registerLipSync(PLAYER_AVATAR_LIPSYNC_ID, ctrl)
    await resumeLipSyncContext().catch(() => null)
    if (session.lipSync === ctrl && session.phase !== 'idle') ctrl.attachStream(stream)
  } catch { /* the avatar's mouth is a nicety */ }
}

/** The dictation ended (stopped, closed, failed): every word it gave stays in the draft. */
function finish(agentId: string, session: Session): void {
  if (store.sessions.get(agentId) !== session) return
  freeze(agentId, session)
  stopLipSync(session)
  session.phase = 'idle'
  session.level = 0
  store.sessions.delete(agentId)
  notify()
}

export async function startDictation(agentId: string, lang = 'en'): Promise<void> {
  if (store.sessions.has(agentId)) return
  // One mic at a time: another agent's dictation stops first, keeping its words.
  for (const other of [...store.sessions.keys()]) if (other !== agentId) stopDictation(other)
  store.errors.delete(agentId)
  const session: Session = { phase: 'starting', dictation: null, lines: new Map(), frozenThrough: -1, stopRequested: false, status: 'Connecting to the voice helper…', level: 0, lipSync: null, startedAt: Date.now() }
  store.sessions.set(agentId, session)
  notify(false)
  const mine = () => store.sessions.get(agentId) === session
  try {
    const dictation = await store.starter({
      lang,
      onStream: stream => { void startLipSync(session, stream) },
      onStatus: text => { if (!mine()) return; session.status = text; notify(false) },
      onReady: () => { if (!mine()) return; session.status = ''; notify(false) },
      onLevel: value => { if (!mine()) return; session.level = value; notify(false) },
      onError: text => { if (!mine()) return; store.errors.set(agentId, text); notify(false) },
      onLine: line => {
        if (!mine() || line.line <= session.frozenThrough) return
        // A line that goes quiet keeps its words: an empty update never wipes what it said.
        const before = session.lines.get(line.line)
        if (!line.text.trim() && before?.text.trim()) return
        session.lines.set(line.line, line)
        if (line.text) session.status = ''
        notify()
      },
      onDone: () => finish(agentId, session),
    })
    if (!mine()) { dictation.cancel(); return }
    session.dictation = dictation
    session.phase = session.stopRequested ? 'stopping' : 'listening'
    notify(false)
    if (session.stopRequested) dictation.stop()
  } catch (error) {
    store.errors.set(agentId, error instanceof Error ? error.message : 'Unable to access the microphone.')
    finish(agentId, session)
  }
}

/** Stop the mic: the last words settle, and all of them stay in the box. */
export function stopDictation(agentId: string): boolean {
  const session = store.sessions.get(agentId)
  if (!session || session.phase === 'stopping') return false
  stopLipSync(session)
  if (!session.dictation) {
    session.stopRequested = true
    notify(false)
    return true
  }
  session.phase = 'stopping'
  notify(false)
  session.dictation.stop()
  return true
}

export function toggleDictation(agentId: string, lang = 'en'): void {
  const session = store.sessions.get(agentId)
  if (session) {
    if (session.phase === 'starting' || session.phase === 'listening') stopDictation(agentId)
    return
  }
  void startDictation(agentId, lang)
}

export interface DictationView {
  text: string
  phase: DictationPhase
  /** The mic is on (or turning on). */
  listening: boolean
  /** Stopped, the last words settling. */
  settling: boolean
  level: number
  status: string
  error: string
  supported: boolean
}

export function dictationView(agentId: string): DictationView {
  const session = store.sessions.get(agentId)
  const phase = session?.phase || 'idle'
  return {
    text: draftText(agentId),
    phase,
    listening: phase === 'starting' || phase === 'listening',
    settling: phase === 'stopping',
    level: session?.level || 0,
    status: session?.status || '',
    error: store.errors.get(agentId) || '',
    supported: isLiveDictationSupported(),
  }
}

/** The last few words of what the box holds (for the voice widget): the words being said now come last. */
export function lastWords(agentId: string, count = 8): string {
  const words = draftText(agentId).trim().split(/\s+/).filter(Boolean)
  return words.length > count ? `…${words.slice(-count).join(' ')}` : words.join(' ')
}

/** Every running dictation (normally one), for the voice widget. */
export function runningDictations(): Array<{ agentId: string; phase: DictationPhase; startedAt: number; level: number; status: string }> {
  return [...store.sessions.entries()].map(([agentId, session]) => ({ agentId, phase: session.phase, startedAt: session.startedAt, level: session.level, status: session.status }))
}

export function clearDictationError(agentId: string): void {
  if (store.errors.delete(agentId)) notify(false)
}

export function subscribeDictation(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

export function dictationVersion(): number {
  return store.version
}

/** Tests: a fake live dictation, no lip sync, no saved drafts. */
export function __setDictationStarterForTest(starter: Store['starter']): void {
  store.starter = starter
  store.lipSync = false
  store.drafts.clear()
  store.sessions.clear()
  store.errors.clear()
}
