// default-worlds.ts — Admin-configurable default worlds for routing
// Two settings: anon (logged-out visitors) and new_user (first-time logged-in)
// Server-side only. 5 min cache — this changes very rarely.

import { getServerSupabase } from './supabase'

export interface DefaultWorlds {
  anon: string | null      // world ID shown to logged-out visitors (view mode)
  new_user: string | null  // world ID shown to first-time logged-in users (view mode)
}

const DEFAULTS: DefaultWorlds = { anon: null, new_user: null }

let cached: DefaultWorlds | null = null
let cacheExpiry = 0
const CACHE_TTL = 300_000 // 5 minutes

export async function getDefaultWorlds(): Promise<DefaultWorlds> {
  if (cached && Date.now() < cacheExpiry) return cached

  try {
    const { data } = await getServerSupabase()
      .from('app_config')
      .select('value')
      .eq('key', 'default_worlds')
      .single()

    if (data?.value && typeof data.value === 'object') {
      cached = { ...DEFAULTS, ...(data.value as Partial<DefaultWorlds>) }
      cacheExpiry = Date.now() + CACHE_TTL
      return cached
    }
  } catch {
    // DB unavailable — use defaults (both null = fallback to /explore)
  }

  return DEFAULTS
}

/** Bust the cache after admin updates */
export function invalidateDefaultWorldsCache() {
  cached = null
  cacheExpiry = 0
}
