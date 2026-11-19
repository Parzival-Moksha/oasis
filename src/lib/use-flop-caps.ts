import { useMemo, useSyncExternalStore } from 'react'

import { capsForLevel, getFlopLevel, subscribeFlopLevel, type FlopCaps } from './flop-saver'

/**
 * What the flop saver allows right now (src/lib/flop-saver.ts). A component with an effect in the
 * tier list reads its flag here, e.g. `const { particles } = useFlopCaps(); if (!particles) return null`.
 */
export function useFlopCaps(): FlopCaps {
  const level = useSyncExternalStore(subscribeFlopLevel, getFlopLevel, () => 0)
  return useMemo(() => capsForLevel(level), [level])
}
