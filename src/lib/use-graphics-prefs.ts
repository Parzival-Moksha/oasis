import { useMemo, useSyncExternalStore } from 'react'

import { getGraphicsPrefs, getServerGraphicsPrefs, subscribeGraphicsPrefs, type GraphicsPrefs } from './graphics-prefs'
import { capGraphicsPrefs, capsForLevel, getFlopLevel, subscribeFlopLevel } from './flop-saver'

/** The graphics prefs as the owner set them (Settings → Graphics), re-rendering the caller when one changes. */
export function useSavedGraphicsPrefs(): GraphicsPrefs {
  return useSyncExternalStore(subscribeGraphicsPrefs, getGraphicsPrefs, getServerGraphicsPrefs)
}

/** The prefs to render with: what the owner set, lowered by the flop saver level (src/lib/flop-saver.ts). */
export function useGraphicsPrefs(): GraphicsPrefs {
  const saved = useSavedGraphicsPrefs()
  const level = useSyncExternalStore(subscribeFlopLevel, getFlopLevel, () => 0)
  return useMemo(() => capGraphicsPrefs(saved, capsForLevel(level)), [saved, level])
}
