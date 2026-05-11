// scripts/build-quality-check-world.mjs
//
// Creates (or replaces) the "quality-check" SQLite world: a grid of compressed
// asset variants side-by-side so the user can walk between them and eyeball
// the quality/size tradeoff.
//
// Rows = assets, columns = variants (Original / L1 1K / L2 512). Each row sits
// at a different z; you walk -z → +z to see all assets, walk -x → +x to see
// each compression level.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const { PrismaClient } = require(path.join(ROOT, 'node_modules/.prisma/client'))
const prisma = new PrismaClient()

function fileSizeMb(p) {
  try { return (require('fs').statSync(p).size / 1024 / 1024).toFixed(2) } catch { return '?' }
}

// Each row defines one asset + 3 variants.
const ROWS = [
  {
    label: 'SciFi Crate (Prop_Crate)',
    z: -10,
    variants: [
      { tag: 'ORIGINAL',       glb: '/models/scifi-essentials/Prop_Crate.gltf',           file: path.join(ROOT, 'public/models/scifi-essentials/Prop_Crate.gltf') },
      { tag: 'L1 · 1K JPEG',   glb: '/_quality-check/Prop_Crate_L1_1k.glb',               file: path.join(ROOT, 'public/_quality-check/Prop_Crate_L1_1k.glb') },
      { tag: 'L2 · 512 JPEG',  glb: '/_quality-check/Prop_Crate_L2_512.glb',              file: path.join(ROOT, 'public/_quality-check/Prop_Crate_L2_512.glb') },
    ],
    scale: 1,
  },
  {
    label: 'SciFi Crate Large',
    z: 0,
    variants: [
      { tag: 'ORIGINAL',       glb: '/models/scifi-essentials/Prop_Crate_Large.gltf',     file: path.join(ROOT, 'public/models/scifi-essentials/Prop_Crate_Large.gltf') },
      { tag: 'L1 · 1K JPEG',   glb: '/_quality-check/Prop_Crate_Large_L1_1k.glb',         file: path.join(ROOT, 'public/_quality-check/Prop_Crate_Large_L1_1k.glb') },
      { tag: 'L2 · 512 JPEG',  glb: '/_quality-check/Prop_Crate_Large_L2_512.glb',        file: path.join(ROOT, 'public/_quality-check/Prop_Crate_Large_L2_512.glb') },
    ],
    scale: 1,
  },
  {
    label: 'Conjured showcase (mesh-heavy)',
    z: 10,
    variants: [
      { tag: 'ORIGINAL',       glb: '/conjured/conj_mn6ogn4ae05j.glb',                    file: path.join(ROOT, 'public/conjured/conj_mn6ogn4ae05j.glb') },
      { tag: 'L1 · 1K JPEG',   glb: '/_quality-check/conj_mn6ogn4ae05j_L1_1k.glb',        file: path.join(ROOT, 'public/_quality-check/conj_mn6ogn4ae05j_L1_1k.glb') },
      { tag: 'L2 · 512 JPEG',  glb: '/_quality-check/conj_mn6ogn4ae05j_L2_512.glb',       file: path.join(ROOT, 'public/_quality-check/conj_mn6ogn4ae05j_L2_512.glb') },
    ],
    scale: 0.5,
  },
]

const COLUMN_X = [-8, 0, 8]
const Y = 0.5
const LABEL_Y = 4.5

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function main() {
  const baseTs = Date.now()
  const placements = []
  const craftedScenes = []

  for (const row of ROWS) {
    row.variants.forEach((v, i) => {
      const exists = existsSync(v.file)
      const mb = exists ? fileSizeMb(v.file) : 'MISSING'
      const x = COLUMN_X[i]
      const placeId = `catalog-quality-check-${baseTs}-${placements.length}`
      placements.push({
        id: placeId,
        catalogId: `qc_${row.label.replace(/\s+/g, '_').toLowerCase()}_${v.tag.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()}`,
        name: `${row.label} · ${v.tag} · ${mb} MB`,
        glbPath: v.glb,
        position: [x, Y, row.z],
        rotation: [0, 0, 0],
        scale: row.scale,
      })

      // Floating 3D text label above each (crafted scene with a single `text` primitive)
      craftedScenes.push({
        id: `craft-quality-check-${baseTs}-${craftedScenes.length}`,
        name: `${row.label} · ${v.tag} · ${mb} MB`,
        prompt: `Label for quality check`,
        objects: [
          {
            type: 'text',
            position: [0, 0, 0],
            scale: [0.5, 0.5, 0.05],
            color: '#ffffff',
            text: `${v.tag}\n${mb} MB`,
            fontSize: 0.4,
            emissive: '#aaccff',
            emissiveIntensity: 0.6,
          },
        ],
        position: [x, LABEL_Y, row.z],
        createdAt: new Date().toISOString(),
      })

      console.log(`  ${row.label.padEnd(36)} ${v.tag.padEnd(16)} ${mb.padStart(8)} MB  ${exists ? '✓' : '✗ MISSING'}`)
    })
  }

  const worldState = {
    version: 1,
    terrain: null,
    groundPresetId: 'concrete',
    groundTiles: {},
    craftedScenes,
    conjuredAssetIds: [],
    catalogPlacements: placements,
    portalGates: [],
    spatialWebObjects: [],
    transforms: {},
    behaviors: {},
    lights: [],
    skyBackgroundId: 'evening_road',
  }

  const existing = await prisma.world.findFirst({
    where: { name: 'quality-check', userId: 'local-user' },
  })

  if (existing) {
    await prisma.world.update({
      where: { id: existing.id },
      data: {
        data: JSON.stringify(worldState),
        objectCount: placements.length + craftedScenes.length,
        icon: '\u{1F50D}',
      },
    })
    console.log(`\nupdated existing world id=${existing.id}`)
  } else {
    const created = await prisma.world.create({
      data: {
        name: 'quality-check',
        icon: '\u{1F50D}',
        userId: 'local-user',
        visibility: 'private',
        data: JSON.stringify(worldState),
        objectCount: placements.length + craftedScenes.length,
        creatorName: 'compression audit',
      },
    })
    console.log(`\ncreated world id=${created.id}`)
  }

  console.log(`  placements: ${placements.length}`)
  console.log(`  labels:     ${craftedScenes.length}`)
}

main().catch(err => { console.error(err); process.exit(1) }).finally(() => prisma.$disconnect())
