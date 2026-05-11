// scripts/import-highlands.mjs
// End-to-end pipeline: extract HighLandsFantasyBuildings.zip, downscale 4K textures
// to 1K, run Blender to convert FBX -> GLB (WebP), copy GLBs into
// public/models/highlands-fantasy/, register additions in
// data/asset-catalog-extras.json.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), '..')
const ZIP = 'C:/Users/l/Downloads/HighLandsFantasyBuildings.zip'
const SCRATCH = path.join(os.tmpdir(), 'highlands-import')
const EXTRACT_DIR = path.join(SCRATCH, 'extracted')
const OUT_DIR = path.join(ROOT, 'public', 'models', 'highlands-fantasy')
const EXTRAS_PATH = path.join(ROOT, 'data', 'asset-catalog-extras.json')
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe'
const PY_SCRIPT = path.join(ROOT, 'scripts', 'highlands-blender.py')

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    p.on('error', reject)
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function extractZip() {
  await ensureDir(EXTRACT_DIR)
  console.log(`[highlands] extracting ${ZIP} -> ${EXTRACT_DIR}`)
  // Prefer `unzip` (Git Bash). Fall back to PowerShell Expand-Archive.
  try {
    await run('unzip', ['-q', '-o', ZIP, '-d', EXTRACT_DIR])
    return
  } catch {}
  await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${ZIP.replace(/'/g, "''")}' -DestinationPath '${EXTRACT_DIR.replace(/'/g, "''")}' -Force`,
  ])
}

async function walk(dir, filter) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

async function downscaleTextures() {
  const sharp = (await import('sharp')).default
  const pngs = await walk(EXTRACT_DIR, p => p.toLowerCase().endsWith('.png'))
  console.log(`[highlands] downscaling ${pngs.length} PNG textures to 1024px`)
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
    } catch (err) {
      console.warn(`[highlands] resize failed for ${png}: ${err.message}`)
    }
  }
}

async function runBlender() {
  if (!existsSync(BLENDER)) {
    throw new Error(`Blender not found at ${BLENDER}`)
  }
  console.log('[highlands] running Blender FBX -> GLB...')
  await ensureDir(OUT_DIR)
  await run(BLENDER, ['--background', '--python', PY_SCRIPT, '--', EXTRACT_DIR, OUT_DIR])
}

async function listOutputs() {
  if (!existsSync(OUT_DIR)) return []
  const files = await fs.readdir(OUT_DIR)
  return files.filter(f => f.toLowerCase().endsWith('.glb'))
}

function prettyName(stem) {
  return stem
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

async function updateExtras() {
  const glbs = await listOutputs()
  if (!glbs.length) {
    console.warn('[highlands] no GLBs produced; skipping JSON update')
    return
  }
  const raw = await fs.readFile(EXTRAS_PATH, 'utf8').catch(() => '{"deletedIds":[],"additions":[]}')
  const extras = JSON.parse(raw)
  extras.deletedIds = Array.isArray(extras.deletedIds) ? extras.deletedIds : []
  extras.additions = Array.isArray(extras.additions) ? extras.additions : []
  // Replace any existing highlands_ entries (idempotent).
  extras.additions = extras.additions.filter(a => typeof a.id !== 'string' || !a.id.startsWith('highlands_'))
  for (const file of glbs) {
    const stem = file.replace(/\.glb$/i, '')
    extras.additions.push({
      id: `highlands_${stem}`,
      name: `Highlands ${prettyName(stem)}`,
      path: `/models/highlands-fantasy/${file}`,
      category: 'highlands-fantasy',
      defaultScale: 1,
    })
  }
  await fs.writeFile(EXTRAS_PATH, JSON.stringify(extras, null, 2) + '\n', 'utf8')
  console.log(`[highlands] registered ${glbs.length} buildings in ${EXTRAS_PATH}`)
}

async function reportSize() {
  const glbs = await listOutputs()
  let total = 0
  for (const f of glbs) {
    const stat = await fs.stat(path.join(OUT_DIR, f))
    total += stat.size
  }
  console.log(`[highlands] total output: ${(total / 1024 / 1024).toFixed(1)} MB across ${glbs.length} GLBs`)
}

async function main() {
  await ensureDir(SCRATCH)
  await extractZip()
  await downscaleTextures()
  await runBlender()
  await updateExtras()
  await reportSize()
}

main().catch(err => {
  console.error('[highlands] FAILED:', err)
  process.exit(1)
})
