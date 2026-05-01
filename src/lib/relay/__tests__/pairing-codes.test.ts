import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PairingCodeError,
  _dropPairingCodeStoreMemoryForTests,
  _peekPairingCode,
  _resetPairingCodeStoreForTests,
  createPairingCode,
  redeemPairingCode,
} from '../pairing-codes'

const FIXED_NOW = 1_700_000_000_000
const ORIGINAL_STORE_PATH = process.env.OASIS_PAIRING_CODE_STORE_PATH

beforeEach(() => { _resetPairingCodeStoreForTests() })
afterEach(() => {
  _resetPairingCodeStoreForTests()
  if (ORIGINAL_STORE_PATH === undefined) delete process.env.OASIS_PAIRING_CODE_STORE_PATH
  else process.env.OASIS_PAIRING_CODE_STORE_PATH = ORIGINAL_STORE_PATH
})

describe('createPairingCode', () => {
  it('produces a code in the OASIS-XXXXXXXX shape', () => {
    const created = createPairingCode({
      browserSessionId: 'bs_1',
      worldId: 'w',
      scopes: ['chat.stream'],
      now: FIXED_NOW,
    })
    expect(created.code).toMatch(/^OASIS-[A-Z2-9]{8}$/)
  })

  it('binds the code to bs/world/scopes and a 5-min default expiry', () => {
    const created = createPairingCode({
      browserSessionId: 'bs_1',
      worldId: 'w',
      scopes: ['world.read', 'chat.stream'],
      now: FIXED_NOW,
    })
    expect(created.expiresAt).toBe(FIXED_NOW + 5 * 60 * 1000)
    const peek = _peekPairingCode(created.code)
    expect(peek?.browserSessionId).toBe('bs_1')
    expect(peek?.worldId).toBe('w')
    expect(peek?.scopes).toEqual(['world.read', 'chat.stream'])
  })

  it('respects a custom ttl', () => {
    const created = createPairingCode({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      ttlMs: 1_000,
      now: FIXED_NOW,
    })
    expect(created.expiresAt).toBe(FIXED_NOW + 1_000)
  })

  it('rejects invalid input', () => {
    expect(() => createPairingCode({ browserSessionId: '', worldId: 'w', scopes: ['chat.stream'] }))
      .toThrowError(PairingCodeError)
    expect(() => createPairingCode({ browserSessionId: 'bs', worldId: '', scopes: ['chat.stream'] }))
      .toThrowError(PairingCodeError)
    expect(() => createPairingCode({ browserSessionId: 'bs', worldId: 'w', scopes: [] }))
      .toThrowError(PairingCodeError)
  })

  it('produces unique codes across calls', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const c = createPairingCode({
        browserSessionId: `bs_${i}`,
        worldId: 'w',
        scopes: ['chat.stream'],
        now: FIXED_NOW,
      })
      codes.add(c.code)
    }
    expect(codes.size).toBe(50)
  })
})

describe('redeemPairingCode', () => {
  it('returns the bound session/world/scopes and deletes the code', () => {
    const created = createPairingCode({
      browserSessionId: 'bs_xyz',
      worldId: 'world-7',
      scopes: ['world.read', 'screenshot.request'],
      now: FIXED_NOW,
    })
    const redeemed = redeemPairingCode(created.code, FIXED_NOW + 1_000)
    expect(redeemed).toEqual({
      browserSessionId: 'bs_xyz',
      worldId: 'world-7',
      scopes: ['world.read', 'screenshot.request'],
    })
    expect(_peekPairingCode(created.code)).toBeNull()
  })

  it('refuses to redeem a code twice', () => {
    const created = createPairingCode({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      now: FIXED_NOW,
    })
    redeemPairingCode(created.code, FIXED_NOW + 1)
    expect(() => redeemPairingCode(created.code, FIXED_NOW + 2))
      .toThrowError(/not found or already used/)
  })

  it('refuses an unknown code', () => {
    expect(() => redeemPairingCode('OASIS-NOPENOPE', FIXED_NOW))
      .toThrowError(PairingCodeError)
  })

  it('refuses an expired code (and prunes it)', () => {
    const created = createPairingCode({
      browserSessionId: 'bs',
      worldId: 'w',
      scopes: ['chat.stream'],
      ttlMs: 1_000,
      now: FIXED_NOW,
    })
    expect(() => redeemPairingCode(created.code, FIXED_NOW + 5_000))
      .toThrowError(/not found|expired/)
    expect(_peekPairingCode(created.code)).toBeNull()
  })

  it('refuses empty input', () => {
    expect(() => redeemPairingCode('', FIXED_NOW)).toThrowError(PairingCodeError)
  })
})

describe('expiry pruning', () => {
  it('purges expired entries on next create', () => {
    const expired = createPairingCode({
      browserSessionId: 'bs1',
      worldId: 'w',
      scopes: ['chat.stream'],
      ttlMs: 1_000,
      now: FIXED_NOW,
    })
    expect(_peekPairingCode(expired.code)).not.toBeNull()
    createPairingCode({
      browserSessionId: 'bs2',
      worldId: 'w',
      scopes: ['chat.stream'],
      now: FIXED_NOW + 10_000,
    })
    expect(_peekPairingCode(expired.code)).toBeNull()
  })
})

describe('disk mirror', () => {
  it('reloads unexpired codes after process memory is dropped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oasis-pairing-codes-'))
    process.env.OASIS_PAIRING_CODE_STORE_PATH = join(dir, 'codes.json')
    _resetPairingCodeStoreForTests()

    try {
      const created = createPairingCode({
        browserSessionId: 'bs_persist',
        worldId: 'world-persist',
        scopes: ['world.read', 'chat.stream'],
        now: FIXED_NOW,
      })
      _dropPairingCodeStoreMemoryForTests()

      expect(_peekPairingCode(created.code)?.worldId).toBe('world-persist')
      expect(redeemPairingCode(created.code, FIXED_NOW + 1_000).browserSessionId).toBe('bs_persist')

      _dropPairingCodeStoreMemoryForTests()
      expect(_peekPairingCode(created.code)).toBeNull()
    } finally {
      _resetPairingCodeStoreForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
