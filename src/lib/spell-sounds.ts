// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SPELL SOUND MANIFEST LOOKUP
// Resolves a `spellSounds[spellId]` entry (a sound id like
// "mixkit-fairy-glitter") to the actual file URL by reading the manifest
// at /audio/spells/manifest.json once, then caching the id→file map.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

interface ManifestEntry {
  id: string
  file: string
  label?: string
  vibe?: string
}

interface SpellSoundsManifest {
  library?: ManifestEntry[]
}

const MANIFEST_URL = '/audio/spells/manifest.json'

let cache: Map<string, string> | null = null
let loadPromise: Promise<Map<string, string>> | null = null

function fetchManifest(): Promise<Map<string, string>> {
  if (typeof window === 'undefined') return Promise.resolve(new Map())
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
  return fetch(`${base}${MANIFEST_URL}`)
    .then(res => res.ok ? res.json() as Promise<SpellSoundsManifest> : Promise.reject(new Error(`HTTP ${res.status}`)))
    .then(data => {
      const map = new Map<string, string>()
      for (const entry of data.library ?? []) {
        if (entry?.id && entry?.file) map.set(entry.id, entry.file)
      }
      cache = map
      return map
    })
    .catch(err => {
      console.warn('[spell-sounds] manifest load failed:', err)
      cache = new Map()
      return cache
    })
}

/** Kicks off manifest fetch on first call; idempotent. */
export function preloadSpellSoundManifest(): Promise<Map<string, string>> {
  if (cache) return Promise.resolve(cache)
  if (loadPromise) return loadPromise
  loadPromise = fetchManifest()
  return loadPromise
}

/**
 * Returns the file URL for a given spell sound id, or null if the manifest
 * hasn't loaded yet or the id isn't in it. Triggers a background load on
 * first call so subsequent casts can resolve synchronously.
 */
export function resolveSpellSoundUrl(soundId: string | undefined | null): string | null {
  if (!soundId) return null
  if (!cache) {
    void preloadSpellSoundManifest()
    return null
  }
  return cache.get(soundId) ?? null
}
