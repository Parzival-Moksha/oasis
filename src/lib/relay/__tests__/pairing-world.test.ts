import { describe, expect, it } from 'vitest'

import { resolvePairingWorldId } from '../pairing-world'

describe('resolvePairingWorldId', () => {
  it('keeps the local dev sentinel available outside hosted mode', () => {
    expect(resolvePairingWorldId(undefined, 'local')).toEqual({ ok: true, worldId: '__active__' })
    expect(resolvePairingWorldId('__active__', 'local')).toEqual({ ok: true, worldId: '__active__' })
  })

  it('requires an explicit world id in hosted mode', () => {
    expect(resolvePairingWorldId(undefined, 'hosted')).toMatchObject({ ok: false, code: 'world_id_required' })
    expect(resolvePairingWorldId('__active__', 'hosted')).toMatchObject({ ok: false, code: 'world_id_required' })
  })

  it('trims explicit hosted world ids', () => {
    expect(resolvePairingWorldId(' world-1 ', 'hosted')).toEqual({ ok: true, worldId: 'world-1' })
  })
})
