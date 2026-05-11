// scripts/register-and-cleanup-assets.mjs
//
// Two-part one-shot:
//
//   1) DELETE the quaternius-fantasy/ duplicate of fantasy-props/. Adds the 24
//      `qf_*` ids to data/asset-catalog-extras.json deletedIds and removes the
//      directory from disk. Saves ~42 MB.
//
//   2) REGISTER every GLB/glTF on disk under public/models/ that doesn't yet
//      have a catalog entry. One big category per pack (e.g. `village`, `scifi`,
//      `character`, `props`). Populates the `tags` field on each new addition
//      from filename tokens + parent dir + a small vocabulary map. Writes
//      every new row into data/asset-catalog-extras.json additions.
//
// DRY RUN by default. Pass --commit to actually write + delete.
// Idempotent: re-running adds no duplicates.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')

const CONSTANTS = path.join(ROOT, 'src/components/scene-lib/constants.ts')
const EXTRAS = path.join(ROOT, 'data/asset-catalog-extras.json')
const PUBLIC_MODELS = path.join(ROOT, 'public/models')
const QUATERNIUS_FANTASY = path.join(PUBLIC_MODELS, 'quaternius-fantasy')

// Map directory name -> { category, prefix } for the unregistered-pass.
// Skip directories that are already fully registered or that we explicitly
// don't want to bulk-import.
const PACK_CATEGORIES = {
  'quaternius-medieval-village': { category: 'village', prefix: 'qmv_' },
  'quaternius-scifi':            { category: 'scifi',   prefix: 'qsc_' },
  'quaternius-base-characters':  { category: 'character', prefix: 'qbc_' },
  'scifi-essentials':            { category: 'props',   prefix: 'sce_' },
  // 'cyberpunk' is already largely registered; skip to avoid clobber
  // 'characters' is already registered (4 files)
  // 'trains', 'kenney-animated-characters' are mostly raw FBX with no GLBs
}

// Filename → tag vocabulary. Tokens from filename auto-become tags; this just
// adds common synonyms / category-helpers.
const TAG_SYNONYMS = {
  brick: ['stone', 'masonry'],
  wood: ['timber', 'plank'],
  woodlight: ['wood', 'light-wood', 'pine'],
  wooddark: ['wood', 'dark-wood', 'oak', 'walnut'],
  metal: ['steel', 'iron'],
  fabric: ['cloth'],
  banner: ['flag', 'cloth'],
  pipe: ['pipes', 'industrial'],
  rail: ['railing', 'fence'],
  light: ['lighting', 'lamp'],
  door: ['portal', 'entry'],
  window: ['glass'],
  floor: ['ground', 'tile'],
  wall: ['barrier'],
  corner: ['edge'],
  roof: ['rooftop'],
  prop: ['decor'],
  alien: ['creature', 'enemy'],
  column: ['pillar', 'support'],
  decal: ['sign', 'marking'],
  platform: ['floor', 'tile'],
}

function tokenize(name) {
  // Split CamelCase, snake_case, kebab-case → lowercase tokens
  return name
    .replace(/[._-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !/^\d+$/.test(t))
}

function deriveTags(filename, packDir, category) {
  const stem = filename.replace(/\.(glb|gltf)$/i, '')
  const tokens = new Set(tokenize(stem))
  // Add the category itself as a tag (so `category: 'village'` → tag 'village')
  tokens.add(category)
  // Add pack name tokens as tags (e.g. 'medieval' from 'quaternius-medieval-village')
  for (const t of tokenize(packDir)) tokens.add(t)
  // Apply synonyms
  for (const t of [...tokens]) {
    const syns = TAG_SYNONYMS[t]
    if (syns) for (const s of syns) tokens.add(s)
  }
  // Drop overly generic tokens that don't help search
  tokens.delete('quaternius')
  tokens.delete('the')
  return [...tokens].sort()
}

function prettyName(stem) {
  return stem
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

function slug(s) {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}

async function findFiles(dir, predicate, depth = 4) {
  if (depth < 0) return []
  const out = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...await findFiles(full, predicate, depth - 1))
    else if (predicate(full)) out.push(full)
  }
  return out
}

async function main() {
  console.log(`[register-and-cleanup] mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`)

  // ── 1) Read constants.ts + extras to know what's already registered ──────
  const constantsSrc = await fs.readFile(CONSTANTS, 'utf8')
  const knownPaths = new Set()
  const knownIds = new Set()
  for (const m of constantsSrc.matchAll(/path:\s*'([^']+)'/g)) knownPaths.add(m[1])
  for (const m of constantsSrc.matchAll(/id:\s*'([^']+)'/g)) knownIds.add(m[1])

  const extras = JSON.parse(await fs.readFile(EXTRAS, 'utf8'))
  extras.deletedIds = Array.isArray(extras.deletedIds) ? extras.deletedIds : []
  extras.additions = Array.isArray(extras.additions) ? extras.additions : []
  for (const a of extras.additions) { knownPaths.add(a.path); knownIds.add(a.id) }

  // ── 2) DELETE quaternius-fantasy: add all `qf_*` ids to deletedIds + rm dir ─
  const fantasyIds = [...constantsSrc.matchAll(/\{\s*id:\s*'([^']+)'[^}]*?path:\s*'\/models\/quaternius-fantasy\/[^']+'/g)].map(m => m[1])
  console.log(`[fantasy-dupe] found ${fantasyIds.length} fantasy-category entries pointing at quaternius-fantasy/`)
  const alreadyDeleted = new Set(extras.deletedIds)
  let newDeleteCount = 0
  for (const id of fantasyIds) {
    if (!alreadyDeleted.has(id)) {
      extras.deletedIds.push(id)
      newDeleteCount++
    }
  }
  console.log(`[fantasy-dupe] adding ${newDeleteCount} ids to extras.deletedIds`)

  // ── 3) REGISTRATION pass for under-registered packs ──────────────────────
  const newAdditions = []
  for (const [packDir, { category, prefix }] of Object.entries(PACK_CATEGORIES)) {
    const packAbs = path.join(PUBLIC_MODELS, packDir)
    if (!existsSync(packAbs)) {
      console.log(`[register] skip ${packDir}: not on disk`)
      continue
    }
    const files = await findFiles(packAbs, p => /\.(glb|gltf)$/i.test(p))
    let added = 0
    for (const abs of files) {
      const rel = '/' + path.relative(path.join(ROOT, 'public'), abs).split(path.sep).join('/')
      if (knownPaths.has(rel)) continue
      const filename = path.basename(abs)
      const stem = filename.replace(/\.(glb|gltf)$/i, '')
      let id = `${prefix}${slug(stem)}`
      // Disambiguate ID collisions (shouldn't happen, but be safe)
      let n = 1
      while (knownIds.has(id)) { id = `${prefix}${slug(stem)}_${++n}` }
      knownIds.add(id)
      knownPaths.add(rel)
      const tags = deriveTags(filename, packDir, category)
      newAdditions.push({
        id,
        name: prettyName(stem),
        path: rel,
        category,
        defaultScale: 1,
        tags,
      })
      added++
    }
    console.log(`[register] ${packDir}: +${added} entries (category=${category})`)
  }
  console.log(`[register] total new entries: ${newAdditions.length}`)
  extras.additions.push(...newAdditions)

  if (!COMMIT) {
    console.log(`\n[summary] DRY RUN`)
    console.log(`  fantasy-dupe ids to mark deleted:  ${newDeleteCount}`)
    console.log(`  new catalog additions:             ${newAdditions.length}`)
    console.log(`  quaternius-fantasy/ on disk:       ${existsSync(QUATERNIUS_FANTASY)}`)
    if (newAdditions.length) {
      console.log(`\n[sample new entries]`)
      for (const a of newAdditions.slice(0, 3)) {
        console.log('  ' + JSON.stringify(a))
      }
    }
    console.log(`\nPass --commit to write + delete.`)
    return
  }

  // ── 4) Write extras.json + rm -rf quaternius-fantasy/ ─────────────────────
  await fs.writeFile(EXTRAS, JSON.stringify(extras, null, 2) + '\n', 'utf8')
  console.log(`[commit] wrote ${EXTRAS}`)

  if (existsSync(QUATERNIUS_FANTASY)) {
    await fs.rm(QUATERNIUS_FANTASY, { recursive: true, force: true })
    console.log(`[commit] rm -rf ${QUATERNIUS_FANTASY}`)
  } else {
    console.log(`[commit] quaternius-fantasy/ already gone`)
  }

  console.log(`\n[commit] DONE`)
  console.log(`  fantasy-dupe deletes:  ${newDeleteCount}`)
  console.log(`  new catalog additions: ${newAdditions.length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
