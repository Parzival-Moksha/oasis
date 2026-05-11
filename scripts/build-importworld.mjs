// scripts/build-importworld.mjs
// Creates (or replaces) the "importworld" SQLite world record with all 386
// new catalog assets placed in zones by category. Skips loose-tier MCP placement
// for performance.

import path from 'node:path'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'

const require = createRequire(import.meta.url)
const { PrismaClient } = require('c:/af_oasis/node_modules/.prisma/client')
const prisma = new PrismaClient()

const ROOT = 'c:/af_oasis'
const EXTRAS = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'asset-catalog-extras.json'), 'utf8'))

// Zones: { category, originX, originZ, cols, gridX, gridZ, scale, yOffset? }
const ZONES = {
  'highlands-fantasy':     { originX: -55, originZ: -45, cols: 5,  gridX: 12, gridZ: 12, scale: 1.5 },
  'scifi-megakit':         { originX: 8,   originZ: -75, cols: 14, gridX: 4,  gridZ: 4,  scale: 1 },
  'fantasy-props':         { originX: -60, originZ: 0,   cols: 10, gridX: 3,  gridZ: 3,  scale: 1 },
  'stylized-nature':       { originX: 5,   originZ: 0,   cols: 9,  gridX: 5,  gridZ: 5,  scale: 1.2 },
  'random-objects':        { originX: -6,  originZ: -25, cols: 4,  gridX: 4,  gridZ: 4,  scale: 1 },
  'psx-derelict':          { originX: -3,  originZ: -10, cols: 3,  gridX: 3,  gridZ: 3,  scale: 1.5 },
}

const byCategory = {}
for (const a of EXTRAS.additions) {
  byCategory[a.category] ||= []
  byCategory[a.category].push(a)
}

const placements = []
const baseTs = Date.now()
let placedCount = 0

for (const [cat, list] of Object.entries(byCategory)) {
  const z = ZONES[cat]
  if (!z) {
    console.log(`[importworld] no zone for category ${cat}, skipping`)
    continue
  }
  list.forEach((asset, i) => {
    const col = i % z.cols
    const row = Math.floor(i / z.cols)
    const x = z.originX + col * z.gridX
    const zCoord = z.originZ + row * z.gridZ
    placements.push({
      id: `catalog-${asset.id}-${baseTs + placedCount}`,
      catalogId: asset.id,
      name: asset.name,
      glbPath: asset.path,
      position: [x, 0, zCoord],
      rotation: [0, 0, 0],
      scale: z.scale * (asset.defaultScale ?? 1),
    })
    placedCount++
  })
  console.log(`[importworld] placed ${list.length} of ${cat} starting at (${z.originX},${z.originZ})`)
}

const worldState = {
  version: 1,
  terrain: null,
  groundPresetId: 'grass',
  groundTiles: {},
  craftedScenes: [],
  conjuredAssetIds: [],
  catalogPlacements: placements,
  portalGates: [],
  spatialWebObjects: [],
  transforms: {},
  behaviors: {},
  lights: [],
  skyBackgroundId: 'umhlanga_sunrise',
}

const existing = await prisma.world.findFirst({
  where: { name: 'importworld', userId: 'local-user' },
})

if (existing) {
  await prisma.world.update({
    where: { id: existing.id },
    data: {
      data: JSON.stringify(worldState),
      objectCount: placements.length,
      icon: '\u{1F4E6}',
    },
  })
  console.log(`[importworld] updated existing world id=${existing.id} with ${placements.length} placements`)
} else {
  const created = await prisma.world.create({
    data: {
      name: 'importworld',
      icon: '\u{1F4E6}',
      userId: 'local-user',
      visibility: 'private',
      data: JSON.stringify(worldState),
      objectCount: placements.length,
      creatorName: 'asset import pipeline',
    },
  })
  console.log(`[importworld] created world id=${created.id} with ${placements.length} placements`)
}

await prisma.$disconnect()
