/**
 * Stateful pairing-code store. Lives in the Next process; the relay sidecar
 * never sees these — by the time the OpenClaw bridge talks to the relay it
 * already holds a signed device token issued by `/api/relay/devices/exchange`.
 *
 * Codes are short, human-readable, single-use, and expire in 5 minutes.
 * The store is pinned to globalThis so HMR doesn't drop pending pairings.
 *
 * In Node deployments the map is mirrored to a tiny JSON file under
 * prisma/data, so PM2 reloads do not invalidate an already-visible code.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Scope } from './protocol'

const DEFAULT_TTL_MS = 5 * 60 * 1000
const CODE_LEN = 8
// Avoid easily-confused glyphs (0/O, 1/I/l).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Cap on simultaneously-active (unredeemed, unexpired) codes per session. */
export const MAX_ACTIVE_CODES_PER_SESSION = 3

interface PairingCodeEntry {
  browserSessionId: string
  worldId: string
  scopes: Scope[]
  exp: number
  createdAt: number
}

interface PairingCodeStore {
  byCode: Map<string, PairingCodeEntry>
  loaded: boolean
}

type PersistedPairingCodeStore = Record<string, PairingCodeEntry>

function shouldPersistPairingCodes(): boolean {
  if (process.env.OASIS_PAIRING_CODE_STORE === 'memory') return false
  return process.env.NODE_ENV !== 'test' || Boolean(process.env.OASIS_PAIRING_CODE_STORE_PATH)
}

function pairingCodeStorePath(): string {
  return process.env.OASIS_PAIRING_CODE_STORE_PATH?.trim()
    || join(process.cwd(), 'prisma', 'data', 'relay-pairing-codes.local.json')
}

function isPairingCodeEntry(value: unknown): value is PairingCodeEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.browserSessionId === 'string'
    && typeof record.worldId === 'string'
    && Array.isArray(record.scopes)
    && record.scopes.every(scope => typeof scope === 'string')
    && typeof record.exp === 'number'
    && Number.isFinite(record.exp)
    && typeof record.createdAt === 'number'
    && Number.isFinite(record.createdAt)
}

function loadPersistedStore(store: PairingCodeStore): void {
  if (store.loaded) return
  store.loaded = true
  if (!shouldPersistPairingCodes()) return

  const file = pairingCodeStorePath()
  if (!existsSync(file)) return
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return
    for (const [code, entry] of Object.entries(parsed as PersistedPairingCodeStore)) {
      if (!isPairingCodeEntry(entry)) continue
      store.byCode.set(code, {
        browserSessionId: entry.browserSessionId,
        worldId: entry.worldId,
        scopes: [...entry.scopes],
        exp: entry.exp,
        createdAt: entry.createdAt,
      })
    }
  } catch {
    // Corrupt persistence should not take pairing down; fresh codes still work.
  }
}

function persistStore(store: PairingCodeStore): void {
  if (!shouldPersistPairingCodes()) return
  const file = pairingCodeStorePath()
  try {
    const out: PersistedPairingCodeStore = {}
    for (const [code, entry] of store.byCode.entries()) {
      out[code] = { ...entry, scopes: [...entry.scopes] }
    }
    mkdirSync(dirname(file), { recursive: true })
    if (Object.keys(out).length === 0) {
      if (existsSync(file)) unlinkSync(file)
      return
    }
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
  } catch {
    // Pairing remains usable in memory if the disk mirror is unavailable.
  }
}

function getStore(): PairingCodeStore {
  const g = globalThis as typeof globalThis & { __oasisRelayPairingCodes?: PairingCodeStore }
  if (!g.__oasisRelayPairingCodes) {
    g.__oasisRelayPairingCodes = { byCode: new Map(), loaded: false }
  }
  loadPersistedStore(g.__oasisRelayPairingCodes)
  return g.__oasisRelayPairingCodes
}

function pruneExpired(store: PairingCodeStore, now: number) {
  let changed = false
  for (const [code, entry] of store.byCode.entries()) {
    if (entry.exp <= now) {
      store.byCode.delete(code)
      changed = true
    }
  }
  if (changed) persistStore(store)
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return `OASIS-${out}`
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export class PairingCodeError extends Error {
  constructor(message: string, public readonly code: string = 'pairing_code_error') {
    super(message)
    this.name = 'PairingCodeError'
  }
}

export interface CreatePairingCodeInput {
  browserSessionId: string
  worldId: string
  scopes: Scope[]
  ttlMs?: number
  /** Override now() for testing. */
  now?: number
}

export interface CreatedPairingCode {
  code: string
  expiresAt: number
}

export function createPairingCode(input: CreatePairingCodeInput): CreatedPairingCode {
  if (!input.browserSessionId) throw new PairingCodeError('browserSessionId required', 'invalid_input')
  if (!input.worldId)          throw new PairingCodeError('worldId required',          'invalid_input')
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    throw new PairingCodeError('at least one scope required', 'invalid_input')
  }
  const now = input.now ?? Date.now()
  const ttl = typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS
  const exp = now + ttl
  const store = getStore()
  pruneExpired(store, now)

  // Per-session cap — a noisy or compromised cookie can otherwise fill the
  // global Map and exhaust the human-readable code namespace.
  let activeForSession = 0
  for (const entry of store.byCode.values()) {
    if (entry.browserSessionId === input.browserSessionId && entry.exp > now) {
      activeForSession += 1
    }
  }
  if (activeForSession >= MAX_ACTIVE_CODES_PER_SESSION) {
    throw new PairingCodeError(
      `at most ${MAX_ACTIVE_CODES_PER_SESSION} active pairing codes per session`,
      'too_many_active',
    )
  }

  let code = generateCode()
  while (store.byCode.has(code)) code = generateCode()

  store.byCode.set(code, {
    browserSessionId: input.browserSessionId,
    worldId: input.worldId,
    scopes: [...input.scopes],
    exp,
    createdAt: now,
  })
  persistStore(store)
  return { code, expiresAt: exp }
}

export interface RedeemedPairingCode {
  browserSessionId: string
  worldId: string
  scopes: Scope[]
}

/** Single-use redemption — the entry is deleted on success. */
export function redeemPairingCode(code: string, now = Date.now()): RedeemedPairingCode {
  if (typeof code !== 'string' || code.length === 0) {
    throw new PairingCodeError('code required', 'invalid_input')
  }
  const store = getStore()
  pruneExpired(store, now)
  const entry = store.byCode.get(code)
  if (!entry) {
    throw new PairingCodeError('pairing code not found or already used', 'not_found')
  }
  if (entry.exp <= now) {
    store.byCode.delete(code)
    persistStore(store)
    throw new PairingCodeError('pairing code expired', 'expired')
  }
  store.byCode.delete(code)
  persistStore(store)
  return {
    browserSessionId: entry.browserSessionId,
    worldId: entry.worldId,
    scopes: entry.scopes,
  }
}

/** Read-only inspection helper. Tests + ops dashboards. */
export function _peekPairingCode(code: string): PairingCodeEntry | null {
  const entry = getStore().byCode.get(code)
  return entry ? { ...entry, scopes: [...entry.scopes] } : null
}

/** Test helper — never call from production code. */
export function _resetPairingCodeStoreForTests(): void {
  const store = getStore()
  store.byCode.clear()
  store.loaded = true
  persistStore(store)
}

/** Test helper â€” simulate a fresh process without deleting the disk mirror. */
export function _dropPairingCodeStoreMemoryForTests(): void {
  const g = globalThis as typeof globalThis & { __oasisRelayPairingCodes?: PairingCodeStore }
  g.__oasisRelayPairingCodes = { byCode: new Map(), loaded: false }
}
