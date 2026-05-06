export interface DefaultWorldSource {
  id: string
  userId: string
  name: string
  icon: string | null
  visibility: string
  creatorName: string | null
  creatorAvatar: string | null
  thumbnailUrl: string | null
  data: string | null
}

export interface DefaultWorldSeed {
  seedVersion: 1
  slug: string
  id: string
  userId: string
  name: string
  icon: string
  visibility: string
  creatorName: string
  creatorAvatar: string | null
  thumbnailUrl: string | null
  data: unknown
}

export interface DefaultWorldManifestEntry {
  slug: string
  id: string
  file: string
  name: string
  visibility: string
}

export interface DefaultWorldManifest {
  seedVersion: number
  worlds: DefaultWorldManifestEntry[]
}

export interface DefaultWorldSeedOptions {
  slug: string
  name?: string
  icon?: string
  visibility?: string
}

export function buildDefaultWorldSeed(
  source: DefaultWorldSource,
  options: DefaultWorldSeedOptions,
): DefaultWorldSeed {
  if (!source.data) {
    throw new Error(`World ${source.id} has no saved data.`)
  }

  return {
    seedVersion: 1,
    slug: options.slug,
    id: source.id,
    userId: source.userId,
    name: options.name || source.name,
    icon: options.icon || source.icon || '0',
    visibility: options.visibility || source.visibility,
    creatorName: source.creatorName || 'The Oasis',
    creatorAvatar: source.creatorAvatar,
    thumbnailUrl: source.thumbnailUrl,
    data: JSON.parse(source.data) as unknown,
  }
}

export function buildDefaultWorldManifestEntry(
  seed: Pick<DefaultWorldSeed, 'slug' | 'id' | 'name' | 'visibility'>,
  file: string,
): DefaultWorldManifestEntry {
  return {
    slug: seed.slug,
    id: seed.id,
    file,
    name: seed.name,
    visibility: seed.visibility,
  }
}

export function upsertDefaultWorldManifestEntry(
  manifest: DefaultWorldManifest,
  entry: DefaultWorldManifestEntry,
): DefaultWorldManifest {
  const worlds = manifest.worlds.filter(world => world.slug !== entry.slug && world.id !== entry.id)
  worlds.push(entry)
  worlds.sort((a, b) => a.slug.localeCompare(b.slug))
  return { seedVersion: 1, worlds }
}

export function parseDefaultWorldManifest(text: string): DefaultWorldManifest {
  const parsed = JSON.parse(text) as Partial<DefaultWorldManifest>
  return {
    seedVersion: typeof parsed.seedVersion === 'number' ? parsed.seedVersion : 1,
    worlds: Array.isArray(parsed.worlds) ? parsed.worlds : [],
  }
}
