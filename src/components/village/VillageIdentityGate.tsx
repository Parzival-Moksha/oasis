'use client'

// The village waits for the store on this PC (lib/village/village-identity.ts) before it places anyone: a page
// that dealt seats, bodies and voices from an empty browser and told the engine about them gave every agent a new
// look when the owner opened the Oasis in its own app window (2026-11-20). Normally that is a fraction of a second.

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

import { getVillageIdentityVersion, isVillageIdentityReady, startVillageIdentity, subscribeVillageIdentity } from '../../lib/village/village-identity-client'

export function VillageIdentityGate({ children }: { children: ReactNode }) {
  useEffect(() => { startVillageIdentity() }, [])
  useSyncExternalStore(subscribeVillageIdentity, getVillageIdentityVersion, () => 0)
  return isVillageIdentityReady() ? <>{children}</> : null
}
