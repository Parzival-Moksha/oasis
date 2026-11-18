#!/usr/bin/env node
// Puts the first world into a fresh database (the worlds listed in prisma/default-worlds/manifest.json).
// scripts/oasis.mjs runs this once, right after it created the database. A world that already exists is left alone.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEEDS = path.join(HOME, 'prisma', 'default-worlds')

function databaseUrl() {
  let env = ''
  try { env = fs.readFileSync(path.join(HOME, '.env'), 'utf8') } catch { /* defaults below */ }
  const match = /^\s*DATABASE_URL\s*=\s*"?file:([^"\r\n]+)"?/m.exec(env)
  const rel = match ? match[1].trim() : './data/oasis.db'
  const file = path.isAbsolute(rel) ? rel : path.join(HOME, 'prisma', rel)
  return `file:${file.split(path.sep).join('/')}`
}

const count = (state) => ['conjuredAssetIds', 'catalogPlacements', 'craftedScenes', 'portalGates', 'agentAvatars', 'agentWindows']
  .reduce((sum, key) => sum + (Array.isArray(state[key]) ? state[key].length : 0), 0)

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SEEDS, 'manifest.json'), 'utf8'))
  const require = createRequire(pathToFileURL(path.join(HOME, 'package.json')))
  const { PrismaClient } = require('./node_modules/.prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } })
  try {
    for (const entry of manifest.worlds || []) {
      const seed = JSON.parse(fs.readFileSync(path.join(SEEDS, path.basename(entry.file)), 'utf8'))
      if (await prisma.world.findUnique({ where: { id: seed.id }, select: { id: true } })) continue
      await prisma.world.create({
        data: {
          id: seed.id,
          userId: seed.userId || 'local-user',
          name: seed.name,
          icon: seed.icon || '🌍',
          visibility: seed.visibility || 'private',
          pvpEnabled: seed.pvpEnabled === true,
          data: JSON.stringify(seed.data),
          objectCount: count(seed.data),
          creatorName: seed.creatorName || 'The Oasis',
        },
      })
      console.log(`First world: ${seed.name}.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(String(error?.message || error)); process.exit(1) })
