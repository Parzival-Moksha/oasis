import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PrismaClient } from '../node_modules/.prisma/client'

type JsonObject = Record<string, unknown>

interface DefaultWorldManifestEntry {
  slug: string
  id: string
  file: string
  name?: string
  visibility?: string
}

interface DefaultWorldManifest {
  seedVersion: number
  worlds: DefaultWorldManifestEntry[]
}

interface DefaultWorldSeed {
  seedVersion: number
  slug: string
  id: string
  userId?: string
  name: string
  icon?: string
  visibility: string
  creatorName?: string
  creatorAvatar?: string | null
  thumbnailUrl?: string | null
  data: JsonObject
}

const prisma = new PrismaClient()
const args = process.argv.slice(2)

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

function readOption(name: string): string | null {
  const prefix = `--${name}=`
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || null
}

function countWorldObjects(state: JsonObject): number {
  const listLength = (value: unknown) => Array.isArray(value) ? value.length : 0
  return (
    listLength(state.conjuredAssetIds) +
    listLength(state.catalogPlacements) +
    listLength(state.craftedScenes) +
    listLength(state.portalGates) +
    listLength(state.agentAvatars) +
    listLength(state.agentWindows)
  )
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function snapshotExistingWorld(worldId: string): Promise<void> {
  const existing = await prisma.world.findUnique({
    where: { id: worldId },
    select: { data: true, objectCount: true },
  })
  if (!existing?.data) return

  await prisma.worldSnapshot.create({
    data: {
      worldId,
      data: existing.data,
      objectCount: existing.objectCount,
      source: 'manual',
    },
  })
}

async function seedWorld(entry: DefaultWorldManifestEntry, rootDir: string): Promise<void> {
  const seed = await readJson<DefaultWorldSeed>(join(rootDir, entry.file))
  if (!seed.id || !seed.name || !seed.visibility || !seed.data) {
    throw new Error(`Default world seed ${entry.file} is missing required fields.`)
  }

  const worldId = seed.id
  const now = new Date()
  const objectCount = countWorldObjects(seed.data)
  const dataString = JSON.stringify(seed.data)
  const worldData = {
    userId: seed.userId || 'local-user',
    name: seed.name,
    icon: seed.icon || '0',
    visibility: seed.visibility,
    data: dataString,
    objectCount,
    creatorName: seed.creatorName || 'The Oasis',
    creatorAvatar: seed.creatorAvatar || null,
    thumbnailUrl: seed.thumbnailUrl || null,
    updatedAt: now,
  }

  const existing = await prisma.world.findUnique({
    where: { id: worldId },
    select: {
      id: true,
      userId: true,
      name: true,
      icon: true,
      visibility: true,
      data: true,
      objectCount: true,
      creatorName: true,
      creatorAvatar: true,
      thumbnailUrl: true,
    },
  })

  const shouldUpdateDefault = hasFlag('update-core') && ['core', 'public'].includes(seed.visibility)
  const shouldUpdate = Boolean(existing && shouldUpdateDefault)

  if (existing && !shouldUpdate) {
    console.log(`[seed:default-worlds] Skipping existing ${seed.slug} (${worldId}).`)
    return
  }

  if (existing) {
    const alreadyCurrent =
      existing.userId === worldData.userId &&
      existing.name === worldData.name &&
      existing.icon === worldData.icon &&
      existing.visibility === worldData.visibility &&
      existing.data === worldData.data &&
      existing.objectCount === worldData.objectCount &&
      (existing.creatorName || null) === (worldData.creatorName || null) &&
      (existing.creatorAvatar || null) === (worldData.creatorAvatar || null) &&
      (existing.thumbnailUrl || null) === (worldData.thumbnailUrl || null)

    if (alreadyCurrent) {
      console.log(`[seed:default-worlds] ${seed.slug} (${worldId}) is already current.`)
      return
    }
  }

  if (existing && hasFlag('snapshot')) {
    await snapshotExistingWorld(worldId)
    console.log(`[seed:default-worlds] Snapshotted existing ${seed.slug} (${worldId}).`)
  }

  if (existing) {
    await prisma.world.update({
      where: { id: worldId },
      data: worldData,
    })
    console.log(`[seed:default-worlds] Updated ${seed.slug} (${worldId}) as ${seed.name}.`)
    return
  }

  await prisma.world.create({
    data: {
      id: worldId,
      ...worldData,
      createdAt: now,
    },
  })
  console.log(`[seed:default-worlds] Created ${seed.slug} (${worldId}) as ${seed.name}.`)
}

async function main() {
  const rootDir = join(process.cwd(), 'prisma', 'default-worlds')
  const manifest = await readJson<DefaultWorldManifest>(join(rootDir, 'manifest.json'))
  const requestedSlug = readOption('world')
  const entries = requestedSlug
    ? manifest.worlds.filter(world => world.slug === requestedSlug || world.id === requestedSlug)
    : manifest.worlds

  if (requestedSlug && entries.length === 0) {
    throw new Error(`No default world matched --world=${requestedSlug}`)
  }

  for (const entry of entries) {
    await seedWorld(entry, rootDir)
  }
}

main()
  .catch((error) => {
    console.error('[seed:default-worlds] Failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
