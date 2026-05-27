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
const PORTAL_ZERO_WORLD_ID = 'world-welcome-hub-system'
const PORTAL_ZERO_SLUG = 'portal-zero'
const PORTAL_ZERO_RUNTIME_PORTAL_PREFIXES = [
  'portal-zero-public-world-',
  'portal-zero-ffa-world-',
]
const PORTAL_ZERO_GENERATED_IMAGE_CACHE_KEYS: Record<string, string> = {
  '/generated-images/img_mpofgsazdcrr.png': '/generated-images/img_mpofgsazdcrr.png?v=pz-may28-images-2',
  '/generated-images/img_mpogfnf984ie.jpg': '/generated-images/img_mpogfnf984ie.jpg?v=pz-may28-images-2',
  '/generated-images/img_mpogk6cek7m0.png': '/generated-images/img_mpogk6cek7m0.png?v=pz-may28-images-2',
  '/generated-images/img_mpogyvugxdxx.png': '/generated-images/img_mpogyvugxdxx.png?v=pz-may28-images-2',
}
const PORTAL_ZERO_FORM_RUNTIME_KEYS = [
  'generatedWorldId',
  'generatedWorldName',
  'generatedWorldUrl',
  'generatedQrUrl',
  'lastEvent',
  'lastInteractionAt',
  'interactionCount',
  'submittedAt',
]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizePortalZeroSeedData(data: unknown): unknown {
  if (!isRecord(data)) return data
  const next: Record<string, unknown> = { ...data }

  if (Array.isArray(next.catalogPlacements)) {
    next.catalogPlacements = next.catalogPlacements.map(item => {
      if (!isRecord(item)) return item
      const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl : ''
      return {
        ...item,
        ...(PORTAL_ZERO_GENERATED_IMAGE_CACHE_KEYS[imageUrl]
          ? { imageUrl: PORTAL_ZERO_GENERATED_IMAGE_CACHE_KEYS[imageUrl] }
          : {}),
      }
    })
  }

  if (Array.isArray(next.portalGates)) {
    next.portalGates = next.portalGates.filter(gate => {
      if (!isRecord(gate) || typeof gate.id !== 'string') return true
      const gateId = gate.id
      return !PORTAL_ZERO_RUNTIME_PORTAL_PREFIXES.some(prefix => gateId.startsWith(prefix))
    })
  }

  if (Array.isArray(next.spatialWebObjects)) {
    next.spatialWebObjects = next.spatialWebObjects.map(object => {
      if (!isRecord(object)) return object
      const id = typeof object.id === 'string' ? object.id : ''
      const formId = typeof object.formId === 'string' ? object.formId : ''
      if (id !== 'spatial-google-forms-altar-portal-zero' && id !== 'spatial-google-test-altar-portal-zero' && !formId.startsWith('portal-zero-google-')) {
        return object
      }
      const clean: Record<string, unknown> = {
        ...object,
        value: '',
        statusMessage: 'PASTE A GOOGLE FORMS URL',
      }
      for (const key of PORTAL_ZERO_FORM_RUNTIME_KEYS) {
        delete clean[key]
      }
      return clean
    })
  }

  return next
}

function sanitizeSourceForSeed(source: DefaultWorldSource, entry: DefaultWorldManifestEntry): DefaultWorldSource {
  if (source.id !== PORTAL_ZERO_WORLD_ID && entry.slug !== PORTAL_ZERO_SLUG) return source
  if (!source.data) return source
  return {
    ...source,
    data: JSON.stringify(sanitizePortalZeroSeedData(JSON.parse(source.data) as unknown)),
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
  const seed = buildDefaultWorldSeed(sanitizeSourceForSeed(source, entry), { slug: entry.slug })
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
