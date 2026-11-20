import { freeUalClips } from './ual-catalog'

// Which clips walk, run and sprint use: the free Quaternius loops (CC0, may be shipped; the default since
// 2026-11-20, so what the owner sees is what a stranger gets) or the Mixamo ones (stay on this PC). Picked in
// Settings > Experiments; the player's avatar reloads its clips on a change.

export type LocomotionSet = 'mixamo' | 'quaternius'
// v2: everyone starts on the free set once, whatever was picked while comparing on 2026-11-19.
const KEY = 'oasis-locomotion-set-v2'
export const DEFAULT_LOCOMOTION_SET: LocomotionSet = 'quaternius'

/** Controller state → clip name in the free UAL1 pack. */
const QUATERNIUS: Record<string, string> = { walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop' }

export function getLocomotionSet(): LocomotionSet {
  if (typeof window === 'undefined') return DEFAULT_LOCOMOTION_SET
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === 'quaternius' || stored === 'mixamo' ? stored : DEFAULT_LOCOMOTION_SET
  } catch { return DEFAULT_LOCOMOTION_SET }
}

export function setLocomotionSet(set: LocomotionSet): void {
  try { window.localStorage.setItem(KEY, set) } catch { /* private mode */ }
}

/** The library id to load for a controller state. */
export function locomotionClipId(animId: string): string {
  if (getLocomotionSet() !== 'quaternius' || !QUATERNIUS[animId]) return animId
  return freeUalClips().find(clip => clip.clip === QUATERNIUS[animId] && clip.file.includes('UAL1'))?.id ?? animId
}

// ░▒▓ How fast plain WASD goes ▓▒░
// The owner, 2026-11-20: "when I just walk, it's not walking, it's actually already running", and the walk clip
// "as our default walk", its steps matched to the real speed. The free walk covers about 0.8 m/s, so a walk that
// still looks like one tops out near 1.5 m/s; the old 3 m/s can only be a jog. 'walk' is the default; 'jog' keeps
// the old speed. Shift is 4x either way, Space a quarter.

export type DefaultPace = 'walk' | 'jog'
const PACE_KEY = 'oasis-default-pace'
export const PACE_SPEED: Record<DefaultPace, number> = { walk: 1.4, jog: 3.0 }
export const PACE_CHANGED_EVENT = 'oasis:default-pace-changed'
let paceCache: DefaultPace | null = null

export function getDefaultPace(): DefaultPace {
  if (paceCache) return paceCache
  if (typeof window === 'undefined') return 'walk'
  try { paceCache = window.localStorage.getItem(PACE_KEY) === 'jog' ? 'jog' : 'walk' } catch { paceCache = 'walk' }
  return paceCache
}

export function setDefaultPace(pace: DefaultPace): void {
  paceCache = pace
  try { window.localStorage.setItem(PACE_KEY, pace) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(PACE_CHANGED_EVENT))
}

/** The player's plain WASD speed, metres a second. */
export function playerBaseSpeed(): number {
  return PACE_SPEED[getDefaultPace()]
}
