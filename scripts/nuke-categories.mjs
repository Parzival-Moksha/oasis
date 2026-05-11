// scripts/nuke-categories.mjs
// Banish whole asset categories from the Oasis. Walks constants.ts + the
// extras-JSON additions, collects every id in the nuke set, then:
//   - removes them from data/asset-catalog-extras.json additions (if present)
//   - adds baked-in ids to data/asset-catalog-extras.json deletedIds
//   - removes their thumbnails from public/thumbs/
//   - on the disk side, deletes asset folders that are 100% nuke-category
// Safe to re-run: idempotent.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = 'c:/af_oasis'
const NUKE = new Set(['medieval', 'structures', 'nature', 'urban', 'vehicles'])
const CONSTANTS = path.join(ROOT, 'src/components/scene-lib/constants.ts')
const EXTRAS = path.join(ROOT, 'data/asset-catalog-extras.json')
const THUMBS = path.join(ROOT, 'public/thumbs')
const PUBLIC_MODELS = path.join(ROOT, 'public/models')

function parseConstantsAssets(src) {
  // Match every entry: { id: 'foo', name: 'Bar', path: '/models/...', category: 'medieval', defaultScale: 2 },
  const out = []
  const re = /\{\s*id:\s*'([^']+)'[^}]*?category:\s*'([^']+)'[^}]*?\}/g
  let m
  while ((m = re.exec(src))) {
    const id = m[1]
    const cat = m[2]
    // grab path too
    const start = src.lastIndexOf('{', re.lastIndex - 1)
    const block = src.slice(start, re.lastIndex)
    const pm = block.match(/path:\s*'([^']+)'/)
    out.push({ id, category: cat, path: pm ? pm[1] : null })
  }
  return out
}

async function main() {
  const constantsSrc = await fs.readFile(CONSTANTS, 'utf8')
  const baked = parseConstantsAssets(constantsSrc)
  console.log(`[nuke] parsed ${baked.length} baked entries from constants.ts`)
  const extras = JSON.parse(await fs.readFile(EXTRAS, 'utf8'))
  extras.deletedIds = Array.isArray(extras.deletedIds) ? extras.deletedIds : []
  extras.additions = Array.isArray(extras.additions) ? extras.additions : []

  // 1) baked-in IDs in nuke categories -> deletedIds
  const bakedToNuke = baked.filter(a => NUKE.has(a.category))
  const alreadyDeleted = new Set(extras.deletedIds)
  let newDeletes = 0
  for (const a of bakedToNuke) {
    if (!alreadyDeleted.has(a.id)) {
      extras.deletedIds.push(a.id)
      newDeletes++
    }
  }
  console.log(`[nuke] baked-in nuke targets: ${bakedToNuke.length} | new deletedIds rows: ${newDeletes}`)

  // 2) extras additions in nuke categories -> drop from additions
  const beforeAdds = extras.additions.length
  extras.additions = extras.additions.filter(a => !NUKE.has(a.category))
  const droppedAdds = beforeAdds - extras.additions.length
  console.log(`[nuke] removed extras additions: ${droppedAdds}`)

  await fs.writeFile(EXTRAS, JSON.stringify(extras, null, 2) + '\n', 'utf8')

  // 3) Remove thumbnails for nuked baked-in ids (additions never had thumbs anyway).
  let removedThumbs = 0
  for (const a of bakedToNuke) {
    const thumb = path.join(THUMBS, `${a.id}.jpg`)
    if (existsSync(thumb)) {
      await fs.unlink(thumb).catch(() => {})
      removedThumbs++
    }
  }
  console.log(`[nuke] removed thumbnails: ${removedThumbs}`)

  // 4) Disk: find directories that are 100% nuke-category. Group baked by parent dir.
  const dirsToNuke = new Map() // dir -> { totalAssets, nukeAssets }
  const allBakedByDir = new Map()
  for (const a of baked) {
    if (!a.path) continue
    const parent = path.posix.dirname(a.path)
    const acc = allBakedByDir.get(parent) || { total: 0, nuke: 0, ids: [] }
    acc.total++
    if (NUKE.has(a.category)) { acc.nuke++; acc.ids.push(a.id) }
    allBakedByDir.set(parent, acc)
  }
  const fullNukeDirs = []
  for (const [dir, stats] of allBakedByDir) {
    if (stats.total > 0 && stats.total === stats.nuke && stats.nuke >= 3) {
      fullNukeDirs.push(dir)
    }
  }
  console.log(`[nuke] full-nuke directories (100% of contents in nuke set):`)
  for (const dir of fullNukeDirs) console.log(`  ${dir} (${allBakedByDir.get(dir).nuke} models)`)

  // Translate /models/... to public/models/...
  let removedDirs = 0
  for (const dir of fullNukeDirs) {
    const stripped = dir.replace(/^\/models\/?/, '')
    const abs = path.join(PUBLIC_MODELS, stripped)
    if (existsSync(abs)) {
      await fs.rm(abs, { recursive: true, force: true })
      removedDirs++
      console.log(`[nuke] rm -rf ${abs}`)
    }
  }
  console.log(`[nuke] removed ${removedDirs} directories`)

  // Summary
  const totalNuked = bakedToNuke.length + droppedAdds
  console.log(`\n[nuke] DONE`)
  console.log(`  baked-in entries marked deleted: ${bakedToNuke.length}`)
  console.log(`  extras additions removed:        ${droppedAdds}`)
  console.log(`  thumbnails removed:              ${removedThumbs}`)
  console.log(`  full-nuke directories removed:   ${removedDirs}`)
  console.log(`  TOTAL catalog entries banished:  ${totalNuked}`)
}

main().catch(err => { console.error(err); process.exit(1) })
