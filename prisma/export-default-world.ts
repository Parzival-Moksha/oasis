import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { PrismaClient } from '../node_modules/.prisma/client'
import {
  buildDefaultWorldManifestEntry,
  buildDefaultWorldSeed,
  parseDefaultWorldManifest,
  upsertDefaultWorldManifestEntry,
  type DefaultWorldManifest,
  type DefaultWorldManifestEntry,
} from '../src/lib/default-world-seeds'

const prisma = new PrismaClient()
const args = process.argv.slice(2)

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

function readOption(name: string, fallback: string): string {
  const prefix = `--${name}=`
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || fallback
}

async function readManifest(path: string): Promise<DefaultWorldManifest> {
  try {
    return parseDefaultWorldManifest(await readFile(path, 'utf8'))
  } catch {
    return { seedVersion: 1, worlds: [] }
  }
}

async function writeManifest(path: string, entry: DefaultWorldManifestEntry): Promise<void> {
  const manifest = await readManifest(path)
  await writeFile(path, `${JSON.stringify(upsertDefaultWorldManifestEntry(manifest, entry), null, 2)}\n`)
}

async function main() {
  const worldId = readOption('world-id', 'world-welcome-hub-system')
  const slug = readOption('slug', 'portal-zero')
  const nameOverride = readOption('name', '')
  const iconOverride = readOption('icon', '')
  const visibilityOverride = readOption('visibility', '')
  const outPath = readOption('out', join('prisma', 'default-worlds', `${slug}.world.json`))
  const manifestPath = join(process.cwd(), 'prisma', 'default-worlds', 'manifest.json')

  const world = await prisma.world.findUnique({
    where: { id: worldId },
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
    throw new Error(`World ${worldId} was not found or has no saved data.`)
  }

  const output = buildDefaultWorldSeed(world, {
    slug,
    name: nameOverride || undefined,
    icon: iconOverride || undefined,
    visibility: visibilityOverride || undefined,
  })

  const absoluteOutPath = join(process.cwd(), outPath)
  await mkdir(dirname(absoluteOutPath), { recursive: true })
  await writeFile(absoluteOutPath, `${JSON.stringify(output, null, 2)}\n`)

  if (hasFlag('manifest')) {
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeManifest(
      manifestPath,
      buildDefaultWorldManifestEntry(
        output,
        relative(join(process.cwd(), 'prisma', 'default-worlds'), absoluteOutPath).replace(/\\/g, '/'),
      ),
    )
  }

  console.log(`[export:default-world] Wrote ${outPath}`)
}

main()
  .catch((error) => {
    console.error('[export:default-world] Failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
