import { useSyncExternalStore } from 'react'

import { getGraphicsPrefs, getServerGraphicsPrefs, subscribeGraphicsPrefs, type GraphicsPrefs } from './graphics-prefs'

/** The graphics prefs (Config → Graphics), re-rendering the caller when one changes. */
export function useGraphicsPrefs(): GraphicsPrefs {
  return useSyncExternalStore(subscribeGraphicsPrefs, getGraphicsPrefs, getServerGraphicsPrefs)
}
