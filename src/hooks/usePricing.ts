// usePricing — Client-side pricing hook with module-level cache
// Fetches from /api/pricing once, caches for 60s, re-fetches on demand

import { useState, useEffect } from 'react'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const CACHE_TTL = 60_000

let cachedPricing: Record<string, number> | null = null
let cacheExpiry = 0
let fetchPromise: Promise<Record<string, number>> | null = null

async function fetchPricing(): Promise<Record<string, number>> {
  // Dedup concurrent fetches
  if (fetchPromise) return fetchPromise

  fetchPromise = fetch(`${OASIS_BASE}/api/pricing`)
    .then(r => r.ok ? r.json() : Promise.reject('Failed'))
    .then(data => {
      cachedPricing = data.pricing
      cacheExpiry = Date.now() + CACHE_TTL
      fetchPromise = null
      return data.pricing as Record<string, number>
    })
    .catch(() => {
      fetchPromise = null
      return cachedPricing ?? {}
    })

  return fetchPromise
}

/** Get cached pricing synchronously (may be empty on first render) */
export function getCachedPricing(): Record<string, number> {
  return cachedPricing ?? {}
}

/** Get price for a specific key from cache */
export function getCachedPrice(key: string): number | null {
  return cachedPricing?.[key] ?? null
}

/** React hook — returns pricing map, triggers fetch on mount */
export function usePricing() {
  const [pricing, setPricing] = useState<Record<string, number>>(cachedPricing ?? {})
  const [loaded, setLoaded] = useState(!!cachedPricing)

  useEffect(() => {
    if (cachedPricing && Date.now() < cacheExpiry) {
      setPricing(cachedPricing)
      setLoaded(true)
      return
    }

    fetchPricing().then(p => {
      setPricing(p)
      setLoaded(true)
    })
  }, [])

  return { pricing, loaded }
}

/** Look up a conjure tier price: conjure_{provider}_{tier} */
export function getConjurePriceKey(provider: string, tier: string): string {
  return `conjure_${provider}_${tier}`
}
