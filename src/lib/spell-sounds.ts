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
const FALLBACK_SOUND_FILES: Record<string, string> = {
  'mixkit-choir-magic-shine': '/audio/spells/mixkit-choir-magic-shine-658.ogg',
  'mixkit-explosion-hit': '/audio/spells/mixkit-explosion-hit-1704.ogg',
  'mixkit-fairy-glitter': '/audio/spells/mixkit-fairy-glitter-867.ogg',
  'mixkit-fairy-sparkle-whoosh': '/audio/spells/mixkit-fairy-sparkle-whoosh-869.ogg',
  'mixkit-icicles-spell-whoosh': '/audio/spells/mixkit-icicles-spell-whoosh-881.ogg',
  'mixkit-magic-sparkle-whoosh': '/audio/spells/mixkit-magic-sparkle-whoosh-2350.ogg',
  'mixkit-spellcaster-fairy-swoosh': '/audio/spells/mixkit-spellcaster-fairy-swoosh-1463.ogg',
}

let cache: Map<string, string> | null = null
let loadPromise: Promise<Map<string, string>> | null = null

function fetchManifest(): Promise<Map<string, string>> {
  if (typeof window === 'undefined') return Promise.resolve(new Map())
  // Use the absolute origin so the URL never gets misinterpreted as a
  // relative path on routes that aren't at /. We do NOT prefix with
  // NEXT_PUBLIC_BASE_PATH because next.config.mjs pins that to '' for the
  // hosted oasis (root-served), and reading the env var in the client
  // bundle has been a source of "Failed to fetch" reports.
  const url = new URL(MANIFEST_URL, window.location.origin).toString()
  return fetch(url, { cache: 'force-cache' })
    .then(res => res.ok ? res.json() as Promise<SpellSoundsManifest> : Promise.reject(new Error(`HTTP ${res.status} (${url})`)))
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
      // Reset promise so a later call can retry the fetch (e.g. after the
      // user opens the Sound tab once the dev server is fully up).
      loadPromise = null
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
  const fallback = FALLBACK_SOUND_FILES[soundId] ?? null
  if (!cache) {
    void preloadSpellSoundManifest()
    return fallback
  }
  return cache.get(soundId) ?? fallback
}
