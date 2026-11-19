import { freeUalClips } from './ual-catalog'

// Which clips walk, run and sprint use: the Mixamo ones (until now) or the free Quaternius loops (CC0,
// may be shipped). Picked in Settings > Experiments; the player's avatar reloads its clips on a change.

export type LocomotionSet = 'mixamo' | 'quaternius'
const KEY = 'oasis-locomotion-set'
export const DEFAULT_LOCOMOTION_SET: LocomotionSet = 'mixamo'

/** Controller state → clip name in the free UAL1 pack. */
const QUATERNIUS: Record<string, string> = { walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop' }

export function getLocomotionSet(): LocomotionSet {
  if (typeof window === 'undefined') return DEFAULT_LOCOMOTION_SET
  try { return window.localStorage.getItem(KEY) === 'quaternius' ? 'quaternius' : DEFAULT_LOCOMOTION_SET } catch { return DEFAULT_LOCOMOTION_SET }
}

export function setLocomotionSet(set: LocomotionSet): void {
  try { window.localStorage.setItem(KEY, set) } catch { /* private mode */ }
}

/** The library id to load for a controller state. */
export function locomotionClipId(animId: string): string {
  if (getLocomotionSet() !== 'quaternius' || !QUATERNIUS[animId]) return animId
  return freeUalClips().find(clip => clip.clip === QUATERNIUS[animId] && clip.file.includes('UAL1'))?.id ?? animId
}
