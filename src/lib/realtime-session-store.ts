'use client'

import {
  DEFAULT_REALTIME_PANEL_POS,
  DEFAULT_REALTIME_PANEL_SIZE,
  DEFAULT_REALTIME_PANEL_SETTINGS,
  REALTIME_ACTIVE_SESSION_KEY,
  REALTIME_PANEL_POS_KEY,
  REALTIME_PANEL_SIZE_KEY,
  REALTIME_PANEL_SETTINGS_KEY,
  REALTIME_STORAGE_KEY,
  clampRealtimePanelSettings,
  type RealtimeLocalSession,
  type RealtimePanelSize,
  type RealtimePanelSettings,
  type RealtimeStoreRecord,
} from '@/lib/realtime-voice'

const REALTIME_DB_NAME = 'oasis-realtime-voice'
const REALTIME_DB_VERSION = 1
const REALTIME_DB_STORE = 'state'
const REALTIME_DB_KEY = 'sessions'

let memoryStore: RealtimeStoreRecord = { sessions: {} }
let dbPromise: Promise<IDBDatabase> | null = null
let hydratePromise: Promise<RealtimeStoreRecord> | null = null

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readRealtimeStore(): RealtimeStoreRecord {
  return memoryStore
}

function sanitizeStore(raw: unknown): RealtimeStoreRecord {
  if (!raw || typeof raw !== 'object') {
    return { sessions: {} }
  }
  const parsed = raw as { sessions?: unknown }
  if (!parsed.sessions || typeof parsed.sessions !== 'object') {
    return { sessions: {} }
  }
  return { sessions: parsed.sessions as Record<string, RealtimeLocalSession> }
}

function readLegacyStore(): RealtimeStoreRecord {
  if (!hasWindow()) return { sessions: {} }
  const parsed = safeParse<RealtimeStoreRecord>(window.localStorage.getItem(REALTIME_STORAGE_KEY), { sessions: {} })
  return sanitizeStore(parsed)
}

function openRealtimeDb(): Promise<IDBDatabase> {
  if (!hasWindow() || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(REALTIME_DB_NAME, REALTIME_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(REALTIME_DB_STORE)) {
        db.createObjectStore(REALTIME_DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Failed to open realtime voice database.'))
  })
  return dbPromise
}

async function readPersistedStore(): Promise<RealtimeStoreRecord> {
  try {
    const db = await openRealtimeDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(REALTIME_DB_STORE, 'readonly')
      const store = tx.objectStore(REALTIME_DB_STORE)
      const request = store.get(REALTIME_DB_KEY)
      request.onsuccess = () => resolve(sanitizeStore(request.result))
      request.onerror = () => reject(request.error || new Error('Failed to read realtime voice state.'))
    })
  } catch {
    return { sessions: {} }
  }
}

async function persistStore(store: RealtimeStoreRecord) {
  try {
    const db = await openRealtimeDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(REALTIME_DB_STORE, 'readwrite')
      const objectStore = tx.objectStore(REALTIME_DB_STORE)
      objectStore.put(store, REALTIME_DB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('Failed to persist realtime voice state.'))
      tx.onabort = () => reject(tx.error || new Error('Realtime voice persistence aborted.'))
    })
  } catch {
    // Memory store remains the fallback; intentionally swallow persistence failures.
  }
}

export async function hydrateRealtimeStore(): Promise<RealtimeStoreRecord> {
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    const legacy = readLegacyStore()
    if (Object.keys(legacy.sessions).length > 0) {
      memoryStore = legacy
      try {
        window.localStorage.removeItem(REALTIME_STORAGE_KEY)
      } catch {}
      await persistStore(memoryStore)
      return memoryStore
    }

    memoryStore = await readPersistedStore()
    return memoryStore
  })()

  try {
    return await hydratePromise
  } finally {
    hydratePromise = null
  }
}

export function writeRealtimeStore(store: RealtimeStoreRecord) {
  memoryStore = sanitizeStore(store)
  void persistStore(memoryStore)
}

export function upsertRealtimeSession(session: RealtimeLocalSession) {
  const store = readRealtimeStore()
  const sessions = { ...store.sessions, [session.id]: session }
  const ordered = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)
  while (ordered.length > 24) {
    const dropped = ordered.pop()
    if (dropped) delete sessions[dropped.id]
  }
  writeRealtimeStore({ sessions })
}

export function deleteRealtimeSession(sessionId: string) {
  const store = readRealtimeStore()
  if (!store.sessions[sessionId]) return
  const sessions = { ...store.sessions }
  delete sessions[sessionId]
  writeRealtimeStore({ sessions })
  if (hasWindow() && window.localStorage.getItem(REALTIME_ACTIVE_SESSION_KEY) === sessionId) {
    window.localStorage.removeItem(REALTIME_ACTIVE_SESSION_KEY)
  }
}

export function listRealtimeSessions(): RealtimeLocalSession[] {
  return Object.values(readRealtimeStore().sessions).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readActiveRealtimeSessionId(): string {
  if (!hasWindow()) return ''
  return window.localStorage.getItem(REALTIME_ACTIVE_SESSION_KEY) || ''
}

export function writeActiveRealtimeSessionId(sessionId: string) {
  if (!hasWindow()) return
  if (!sessionId) {
    window.localStorage.removeItem(REALTIME_ACTIVE_SESSION_KEY)
    return
  }
  window.localStorage.setItem(REALTIME_ACTIVE_SESSION_KEY, sessionId)
}

export function readRealtimePanelPosition(): { x: number; y: number } {
  if (!hasWindow()) return DEFAULT_REALTIME_PANEL_POS
  const parsed = safeParse<{ x?: number; y?: number }>(window.localStorage.getItem(REALTIME_PANEL_POS_KEY), DEFAULT_REALTIME_PANEL_POS)
  return {
    x: typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : DEFAULT_REALTIME_PANEL_POS.x,
    y: typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : DEFAULT_REALTIME_PANEL_POS.y,
  }
}

export function writeRealtimePanelPosition(position: { x: number; y: number }) {
  if (!hasWindow()) return
  window.localStorage.setItem(REALTIME_PANEL_POS_KEY, JSON.stringify(position))
}

export function readRealtimePanelSize(): RealtimePanelSize {
  if (!hasWindow()) return DEFAULT_REALTIME_PANEL_SIZE
  const parsed = safeParse<Partial<RealtimePanelSize>>(window.localStorage.getItem(REALTIME_PANEL_SIZE_KEY), DEFAULT_REALTIME_PANEL_SIZE)
  return {
    w: typeof parsed.w === 'number' && Number.isFinite(parsed.w) ? parsed.w : DEFAULT_REALTIME_PANEL_SIZE.w,
    h: typeof parsed.h === 'number' && Number.isFinite(parsed.h) ? parsed.h : DEFAULT_REALTIME_PANEL_SIZE.h,
  }
}

export function writeRealtimePanelSize(size: RealtimePanelSize) {
  if (!hasWindow()) return
  window.localStorage.setItem(REALTIME_PANEL_SIZE_KEY, JSON.stringify(size))
}

export function readRealtimePanelSettings(): RealtimePanelSettings {
  if (!hasWindow()) return DEFAULT_REALTIME_PANEL_SETTINGS
  const parsed = safeParse<Partial<RealtimePanelSettings>>(window.localStorage.getItem(REALTIME_PANEL_SETTINGS_KEY), DEFAULT_REALTIME_PANEL_SETTINGS)
  return clampRealtimePanelSettings(parsed)
}

export function writeRealtimePanelSettings(settings: RealtimePanelSettings) {
  if (!hasWindow()) return
  window.localStorage.setItem(REALTIME_PANEL_SETTINGS_KEY, JSON.stringify(clampRealtimePanelSettings(settings)))
}
