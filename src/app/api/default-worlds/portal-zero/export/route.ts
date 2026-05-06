import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { NextResponse } from 'next/server'

import {
  buildDefaultWorldManifestEntry,
  buildDefaultWorldSeed,
  parseDefaultWorldManifest,
  upsertDefaultWorldManifestEntry,
  type DefaultWorldManifest,
} from '@/lib/default-world-seeds'
import { getOasisMode } from '@/lib/oasis-profile'
import { WELCOME_HUB_WORLD_ID } from '@/lib/portal-gates'
import { prisma } from '@/lib/db'

const PORTAL_ZERO_SLUG = 'portal-zero'
const PORTAL_ZERO_NAME = 'Portal Zero'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function readManifest(path: string): Promise<DefaultWorldManifest> {
  try {
    return parseDefaultWorldManifest(await readFile(path, 'utf8'))
  } catch {
    return { seedVersion: 1, worlds: [] }
  }
}

export async function POST() {
  if (getOasisMode() !== 'local') {
    return NextResponse.json(
      { error: 'Portal Zero seed export is only available in local Oasis mode.' },
      { status: 403 },
    )
  }

  try {
    const world = await prisma.world.findUnique({
      where: { id: WELCOME_HUB_WORLD_ID },
      select: {
        id: true,
        userId: true,
        name: true,
        icon: true,
        visibility: true,
        creatorName: true,
        creatorAvatar: true,
        thumbnailUrl: true,
        data: true,
      },
    })

    if (!world?.data) {
      return NextResponse.json(
        { error: `World ${WELCOME_HUB_WORLD_ID} was not found or has no saved data.` },
        { status: 404 },
      )
    }

    const defaultWorldsDir = join(process.cwd(), 'prisma', 'default-worlds')
    const absoluteOutPath = join(defaultWorldsDir, `${PORTAL_ZERO_SLUG}.world.json`)
    const manifestPath = join(defaultWorldsDir, 'manifest.json')
    const seed = buildDefaultWorldSeed(world, {
      slug: PORTAL_ZERO_SLUG,
      name: PORTAL_ZERO_NAME,
    })

    await mkdir(dirname(absoluteOutPath), { recursive: true })
    await writeFile(absoluteOutPath, `${JSON.stringify(seed, null, 2)}\n`)

    const manifest = await readManifest(manifestPath)
    const file = relative(defaultWorldsDir, absoluteOutPath).replace(/\\/g, '/')
    const nextManifest = upsertDefaultWorldManifestEntry(
      manifest,
      buildDefaultWorldManifestEntry(seed, file),
    )
    await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)

    return NextResponse.json({
      ok: true,
      worldId: seed.id,
      slug: seed.slug,
      name: seed.name,
      visibility: seed.visibility,
      file,
      manifest: true,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[DefaultWorlds] Portal Zero export failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
