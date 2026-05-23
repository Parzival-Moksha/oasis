import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  buildDefaultWorldManifestEntry,
  buildDefaultWorldSeed,
  parseDefaultWorldManifest,
  upsertDefaultWorldManifestEntry,
  type DefaultWorldManifest,
  type DefaultWorldManifestEntry,
  type DefaultWorldSource,
} from './default-world-seeds'

const DEFAULT_WORLDS_ROOT = ['prisma', 'default-worlds']
const NEW_SEED_VISIBILITIES = new Set(['core', 'template'])

export interface DefaultWorldSeedWriteResult {
  updated: boolean
  slug?: string
  file?: string
  reason?: 'missing_data' | 'not_seed_backed'
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readManifest(path: string): Promise<DefaultWorldManifest> {
  const text = await readOptionalText(path)
  return text ? parseDefaultWorldManifest(text) : { seedVersion: 1, worlds: [] }
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function uniqueSlug(manifest: DefaultWorldManifest, preferred: string, worldId: string): string {
  const taken = new Set(manifest.worlds.filter(world => world.id !== worldId).map(world => world.slug))
  let slug = preferred
  let suffix = 2
  while (taken.has(slug)) {
    slug = `${preferred}-${suffix}`
    suffix += 1
  }
  return slug
}

function uniqueFile(manifest: DefaultWorldManifest, slug: string, worldId: string): string {
  const taken = new Set(manifest.worlds.filter(world => world.id !== worldId).map(world => world.file))
  let file = `${slug}.world.json`
  let suffix = 2
  while (taken.has(file)) {
    file = `${slug}-${suffix}.world.json`
    suffix += 1
  }
  return file
}

function resolveUnderRoot(rootDir: string, file: string): string {
  const absolute = resolve(rootDir, file)
  const rel = relative(rootDir, absolute)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Default world seed path escapes ${rootDir}: ${file}`)
  }
  return absolute
}

function selectManifestEntry(
  manifest: DefaultWorldManifest,
  source: DefaultWorldSource,
): DefaultWorldManifestEntry | null {
  const existing = manifest.worlds.find(world => world.id === source.id)
  if (existing) return existing
  if (!NEW_SEED_VISIBILITIES.has(source.visibility)) return null

  const preferredSlug = slugify(source.name || source.id, slugify(source.id, 'core-world'))
  const slug = uniqueSlug(manifest, preferredSlug, source.id)
  return {
    slug,
    id: source.id,
    file: uniqueFile(manifest, slug, source.id),
    name: source.name,
    visibility: source.visibility,
  }
}

export async function mirrorDefaultWorldSeed(
  source: DefaultWorldSource,
): Promise<DefaultWorldSeedWriteResult> {
  if (!source.data) return { updated: false, reason: 'missing_data' }

  const rootDir = resolve(process.cwd(), ...DEFAULT_WORLDS_ROOT)
  const manifestPath = join(rootDir, 'manifest.json')
  const manifest = await readManifest(manifestPath)
  const entry = selectManifestEntry(manifest, source)
  if (!entry) return { updated: false, reason: 'not_seed_backed' }

  const outPath = resolveUnderRoot(rootDir, entry.file)
  const file = relative(rootDir, outPath).replace(/\\/g, '/')
  const seed = buildDefaultWorldSeed(source, { slug: entry.slug })
  const seedText = `${JSON.stringify(seed, null, 2)}\n`
  const currentSeedText = await readOptionalText(outPath)
  const seedChanged = currentSeedText !== seedText
  if (seedChanged) {
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, seedText)
  }

  const nextManifest = upsertDefaultWorldManifestEntry(
    manifest,
    buildDefaultWorldManifestEntry(seed, file),
  )
  const manifestText = `${JSON.stringify(nextManifest, null, 2)}\n`
  const currentManifestText = await readOptionalText(manifestPath)
  const manifestChanged = currentManifestText !== manifestText
  if (manifestChanged) {
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, manifestText)
  }

  return {
    updated: seedChanged || manifestChanged,
    slug: entry.slug,
    file,
  }
}
