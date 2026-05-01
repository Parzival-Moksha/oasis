import type { OasisMode } from '../oasis-profile'

export type PairingWorldIdResult =
  | { ok: true; worldId: string }
  | { ok: false; code: 'world_id_required'; message: string }

export function resolvePairingWorldId(value: unknown, mode: OasisMode): PairingWorldIdResult {
  const worldId = typeof value === 'string' ? value.trim() : ''
  if (mode === 'hosted' && (!worldId || worldId === '__active__')) {
    return {
      ok: false,
      code: 'world_id_required',
      message: 'worldId is required in hosted mode',
    }
  }
  return { ok: true, worldId: worldId || '__active__' }
}
