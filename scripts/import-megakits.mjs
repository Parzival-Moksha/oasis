// scripts/import-megakits.mjs
// One-shot importer for the four content packs the user wants visible in the
// Catalog: RandomObjects (drop-in GLBs), Modular SciFi MegaKit, Fantasy Props
// MegaKit, Stylized Nature MegaKit. Writes additions into
// data/asset-catalog-extras.json.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), '..')
const SCRATCH = path.join(os.tmpdir(), 'megakit-import')
const EXTRAS_PATH = path.join(ROOT, 'data', 'asset-catalog-extras.json')
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe'
const BLENDER_PY = path.join(ROOT, 'scripts', 'megakit-blender.py')

const PACKS = [
  {
    key: 'randomobjects',
    zip: 'C:/Users/l/Downloads/RandomObjects.zip',
    extractName: 'random',
    outRel: 'public/models/random-objects',
    category: 'random-objects',
    namePrefix: 'Random',
    mode: 'glb-passthrough',
    defaultScale: 1,
  },
  {
    key: 'scifi-megakit',
    zip: 'C:/Users/l/Downloads/Modular SciFi MegaKit[Standard].zip',
    extractName: 'scifi',
    outRel: 'public/models/scifi-megakit-glb',
    category: 'scifi-megakit',
    namePrefix: 'SciFi',
    mode: 'fbx-convert',
    defaultScale: 1,
  },
  {
    key: 'fantasy-props',
    zip: 'C:/Users/l/Downloads/Fantasy Props MegaKit[Standard].zip',
    extractName: 'fantasy-props',
    outRel: 'public/models/fantasy-props',
    category: 'fantasy-props',
    namePrefix: 'Fantasy',
    mode: 'fbx-convert',
    defaultScale: 1,
  },
  {
    key: 'stylized-nature',
    zip: 'C:/Users/l/Downloads/Stylized Nature MegaKit[Standard].zip',
    extractName: 'stylized-nature',
    outRel: 'public/models/stylized-nature',
    category: 'stylized-nature',
    namePrefix: 'Nature',
    mode: 'fbx-convert',
    defaultScale: 1,
  },
]

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

async function ensureDir(d) { await fs.mkdir(d, { recursive: true }) }

async function unzipTo(zip, dest) {
  await ensureDir(dest)
  // Prefer unzip (Git Bash / WSL); fall back to PowerShell Expand-Archive.
  try {
    await run('unzip', ['-q', '-o', zip, '-d', dest])
    return
  } catch {}
  await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
  ])
}

async function walk(dir, predicate) {
  const out = []
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, predicate)))
    else if (predicate(full)) out.push(full)
  }
  return out
}

async function downscaleTextures(extractDir) {
  const sharp = (await import('sharp')).default
  const pngs = await walk(extractDir, p => p.toLowerCase().endsWith('.png'))
  let resized = 0
  for (const png of pngs) {
    try {
      const meta = await sharp(png).metadata()
      const w = meta.width ?? 0
      if (w <= 1024) continue
      const buf = await sharp(png)
        .resize({ width: 1024, withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer()
      await fs.writeFile(png, buf)
      resized++
    } catch {}
  }
  console.log(`[megakit] resized ${resized}/${pngs.length} PNGs to 1024px (skipped already-small ones)`)
}

function slug(name) {
  return String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'asset'
}

function pretty(name) {
  return String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

async function importPack(pack) {
  console.log(`\n=== ${pack.key} ===`)
  const extractDir = path.join(SCRATCH, pack.extractName)
  if (!existsSync(extractDir) || (await fs.readdir(extractDir).catch(() => [])).length === 0) {
    console.log(`[${pack.key}] extracting ${pack.zip}`)
    await unzipTo(pack.zip, extractDir)
  } else {
    console.log(`[${pack.key}] reusing extracted dir ${extractDir}`)
  }

  const outDir = path.join(ROOT, pack.outRel)
  await ensureDir(outDir)

  if (pack.mode === 'glb-passthrough') {
    const glbs = await walk(extractDir, p => p.toLowerCase().endsWith('.glb'))
    console.log(`[${pack.key}] copying ${glbs.length} GLBs`)
    const placed = []
    for (const src of glbs) {
      const baseName = path.basename(src)
      const dst = path.join(outDir, baseName)
      await fs.copyFile(src, dst)
      placed.push(baseName)
    }
    return placed.map(file => makeEntry(pack, file))
  }

  // fbx-convert
  await downscaleTextures(extractDir)
  if (!existsSync(BLENDER)) throw new Error(`Blender not found at ${BLENDER}`)
  console.log(`[${pack.key}] running Blender FBX -> GLB...`)
  await run(BLENDER, ['--background', '--python', BLENDER_PY, '--', extractDir, outDir])

  const glbs = await fs.readdir(outDir)
  return glbs.filter(f => f.toLowerCase().endsWith('.glb')).map(file => makeEntry(pack, file))
}

function makeEntry(pack, fileName) {
  const stem = fileName.replace(/\.glb$/i, '')
  const id = `${pack.key}_${slug(stem)}`
  const name = `${pack.namePrefix} ${pretty(stem)}`
  return {
    id,
    name,
    path: '/' + path.posix.join(pack.outRel.replace(/^public\//, ''), fileName),
    category: pack.category,
    defaultScale: pack.defaultScale,
  }
}

async function readExtras() {
  try {
    return JSON.parse(await fs.readFile(EXTRAS_PATH, 'utf8'))
  } catch {
    return { _doc: '', deletedIds: [], additions: [] }
  }
}

async function writeExtras(extras) {
  await fs.writeFile(EXTRAS_PATH, JSON.stringify(extras, null, 2) + '\n', 'utf8')
}

async function main() {
  await ensureDir(SCRATCH)
  const extras = await readExtras()
  extras.deletedIds = Array.isArray(extras.deletedIds) ? extras.deletedIds : []
  extras.additions = Array.isArray(extras.additions) ? extras.additions : []

  // Drop any prior imports for the packs we touch (idempotent re-runs).
  const touchedKeys = new Set(PACKS.map(p => p.key))
  extras.additions = extras.additions.filter(a => {
    if (typeof a.id !== 'string') return true
    for (const k of touchedKeys) {
      if (a.id.startsWith(`${k}_`)) return false
    }
    return true
  })

  let totalAdded = 0
  for (const pack of PACKS) {
    try {
      const newEntries = await importPack(pack)
      extras.additions.push(...newEntries)
      totalAdded += newEntries.length
      console.log(`[${pack.key}] +${newEntries.length} additions`)
      // Save after every pack so partial progress survives a crash.
      await writeExtras(extras)
    } catch (err) {
      console.error(`[${pack.key}] FAILED:`, err)
    }
  }

  console.log(`\nTotal new additions: ${totalAdded}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
