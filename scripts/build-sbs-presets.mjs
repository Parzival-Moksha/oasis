// scripts/build-sbs-presets.mjs
// Walks public/ground/sbs1 and sbs2, builds ground-preset additions and merges them into
// data/ground-presets-extras.json (preserving any existing additions / deletedIds).

import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), '..')
const PUBLIC_GROUND = path.join(ROOT, 'public', 'ground')
const EXTRAS_PATH = path.join(ROOT, 'data', 'ground-presets-extras.json')

const ICON_BY_CATEGORY = {
  Bricks: '\u{1F9F1}',
  Brick: '\u{1F9F1}',
  Grass: '\u{1F33F}',
  Roofs: '\u{1F3D8}',
  Tile: '\u{1F532}',
  Wood: '\u{1FAB5}',
  Dirt: '\u{1F7EB}',
  Elements: '\u{1F300}',
  Metal: '\u{2699}',
  Plaster: '\u{1F532}',
  Stone: '\u{1FAA8}',
}

const COLOR_BY_CATEGORY = {
  Bricks: '#8a4a35',
  Brick: '#8a4a35',
  Grass: '#3a6e2e',
  Roofs: '#5a3a32',
  Tile: '#7a8a90',
  Wood: '#6e4a2a',
  Dirt: '#6b4e31',
  Elements: '#888888',
  Metal: '#777777',
  Plaster: '#c4b5a3',
  Stone: '#777777',
}

async function walk(dir, packKey) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out = []
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const sub = await walk(full, packKey)
      out.push(...sub)
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.png')) {
      out.push({ packKey, file: full })
    }
  }
  return out
}

function entryFromFile({ packKey, file }) {
  const rel = path.relative(PUBLIC_GROUND, file).split(path.sep).join('/')
  const parts = rel.split('/')
  // parts: [packKey, Category, FileName.png]
  const category = parts[parts.length - 2] || 'Misc'
  const fileName = parts[parts.length - 1]
  const baseId = fileName.replace(/\.png$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const numMatch = baseId.match(/(\d+)/)
  const num = numMatch ? numMatch[1] : ''
  const id = `${packKey}_${category.toLowerCase()}_${baseId}`
  const displayCat = category.replace(/s$/, '')
  const niceName = num
    ? `SBS ${displayCat} ${num}`
    : `SBS ${displayCat} ${baseId}`
  return {
    id,
    name: niceName,
    icon: ICON_BY_CATEGORY[category] || '\u{1FAA8}',
    color: COLOR_BY_CATEGORY[category] || '#888888',
    assetName: '',
    tileRepeat: 4,
    customTextureUrl: `/ground/${rel}`,
  }
}

async function main() {
  const all = []
  for (const packKey of ['sbs1', 'sbs2']) {
    const dir = path.join(PUBLIC_GROUND, packKey)
    try {
      await fs.access(dir)
    } catch {
      continue
    }
    const files = await walk(dir, packKey)
    for (const f of files) all.push(entryFromFile(f))
  }

  let extras = { _doc: '', deletedIds: [], additions: [] }
  try {
    const raw = await fs.readFile(EXTRAS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    extras._doc = parsed._doc || extras._doc
    extras.deletedIds = Array.isArray(parsed.deletedIds) ? parsed.deletedIds : []
    extras.additions = Array.isArray(parsed.additions) ? parsed.additions : []
  } catch {}

  // Replace any existing sbs1_/sbs2_ additions to make this script idempotent.
  const surviving = extras.additions.filter(a => typeof a.id === 'string' && !/^sbs[12]_/.test(a.id))
  extras.additions = [...surviving, ...all]

  await fs.writeFile(EXTRAS_PATH, JSON.stringify(extras, null, 2) + '\n', 'utf8')
  console.log(`Wrote ${all.length} SBS additions to ${EXTRAS_PATH}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
