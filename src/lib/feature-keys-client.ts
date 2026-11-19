// The page's copy of GET /api/keys/status, asked for once per page (and again when a panel that needs it opens
// after a minute: a key added to .env needs a restart of the page server anyway).
import { useEffect, useState } from 'react'

import type { FeatureKeyState } from './feature-keys'

type States = Record<string, FeatureKeyState>

let known: States | null = null
let knownAt = 0
let asking: Promise<States> | null = null
const FRESH_MS = 60_000

export function getFeatureKeyStates(): Promise<States> {
  if (known && Date.now() - knownAt < FRESH_MS) return Promise.resolve(known)
  return (asking ??= fetch('/api/keys/status')
    .then(res => (res.ok ? res.json() : { features: {} }) as Promise<{ features?: States }>)
    .then(body => {
      known = body.features || {}
      knownAt = Date.now()
      return known
    })
    // Not answered (hosted mode refuses the route, or the server is busy): nothing is greyed out.
    .catch(() => known || {})
    .finally(() => { asking = null }))
}

/** The key state of one feature; null while unknown or when the feature needs no key. */
export function useFeatureKey(spellId: string, active = true): FeatureKeyState | null {
  const [state, setState] = useState<FeatureKeyState | null>(known?.[spellId] || null)
  useEffect(() => {
    if (!active) return
    let live = true
    void getFeatureKeyStates().then(states => { if (live) setState(states[spellId] || null) })
    return () => { live = false }
  }, [spellId, active])
  return state
}

/** Every keyed feature's state, for lists (the spell book). */
export function useFeatureKeys(active = true): States {
  const [states, setStates] = useState<States>(known || {})
  useEffect(() => {
    if (!active) return
    let live = true
    void getFeatureKeyStates().then(value => { if (live) setStates(value) })
    return () => { live = false }
  }, [active])
  return states
}
