// scripts/import-megakits-v3.mjs
// Vendor-glTF importer with SHARED textures. Each pack lands as:
//   public/models/<pack>/<subdir>/<name>.gltf
//   public/models/<pack>/<subdir>/<name>.bin
//   public/models/<pack>/Textures/<texture>.png   (one copy per pack)
// .gltf URIs are rewritten to point at ../Textures/<basename> (or
// ../../Textures/ if nested two deep). No per-file texture duplication —
// keeps repo bloat sane.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')), '..')
const SCRATCH = path.join(os.tmpdir(), 'megakit-import')
const EXTRAS_PATH = path.join(ROOT, 'data', 'asset-catalog-extras.json')

const PACKS = [
  {
    key: 'scifi-megakit',
    zip: 'C:/Users/l/Downloads/Modular SciFi MegaKit[Standard].zip',
    extractName: 'scifi',
    gltfRel: 'Modular SciFi MegaKit[Standard]/glTF',
    texturesRel: 'Modular SciFi MegaKit[Standard]/Textures',
    outRel: 'public/models/scifi-megakit',
    category: 'scifi-megakit',
    namePrefix: 'SciFi',
  },
  {
    key: 'fantasy-props',
    zip: 'C:/Users/l/Downloads/Fantasy Props MegaKit[Standard].zip',
    extractName: 'fantasy-props',
    gltfRel: 'Exports/glTF',
    texturesRel: 'Textures',
    outRel: 'public/models/fantasy-props',
    category: 'fantasy-props',
    namePrefix: 'Fantasy',
  },
  {
    key: 'stylized-nature',
    zip: 'C:/Users/l/Downloads/Stylized Nature MegaKit[Standard].zip',
    extractName: 'stylized-nature',
    gltfRel: 'glTF',
    texturesRel: 'Textures',
    outRel: 'public/models/stylized-nature',
    category: 'stylized-nature',
    namePrefix: 'Nature',
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
  try { await run('unzip', ['-q', '-o', zip, '-d', dest]); return } catch {}
  await run('powershell.exe', [
    '-NoProfile', '-Command',
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

function slug(name) {
  return String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'asset'
}

function pretty(name) {
  return String(name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

async function downscaleAndConvertTextures(srcDir, destDir, maxWidth = 1024) {
  const sharp = (await import('sharp')).default
  const pngs = await walk(srcDir, p => p.toLowerCase().endsWith('.png'))
  await ensureDir(destDir)
  // Map basename -> output filename. Some packs have nested Normals-UnrealEngine
  // duplicates; later wins. We standardize to JPG for non-normal/orm/alpha maps
  // (heavy reduction) and PNG for normal/orm/alpha (preserve precision).
  const outMap = {}
  for (const png of pngs) {
    const base = path.basename(png)
    const lower = base.toLowerCase()
    const isLinear = /(normal|_orm|_metal|_rough|_alpha)/.test(lower)
    try {
      const meta = await sharp(png).metadata()
      let pipe = sharp(png)
      if ((meta.width ?? 0) > maxWidth) pipe = pipe.resize({ width: maxWidth, withoutEnlargement: true })
      const stem = base.replace(/\.png$/i, '')
      const ext = isLinear ? '.png' : '.jpg'
      const outName = stem + ext
      const outPath = path.join(destDir, outName)
      if (isLinear) {
        await pipe.png({ compressionLevel: 9, palette: false }).toFile(outPath)
      } else {
        await pipe.jpeg({ quality: 82 }).toFile(outPath)
      }
      outMap[base] = outName
    } catch (err) {
      console.warn(`[textures] ${base} failed: ${err.message}`)
    }
  }
  console.log(`[textures] processed ${Object.keys(outMap).length}/${pngs.length} -> ${destDir}`)
  return outMap
}

async function copyGltfWithRewrites(gltfPath, destPath, sharedTexturesRelFromGltf, textureRenames) {
  const dir = path.dirname(gltfPath)
  const raw = await fs.readFile(gltfPath, 'utf8')
  const gltf = JSON.parse(raw)
  await ensureDir(path.dirname(destPath))
  // Copy .bin file
  for (const buf of gltf.buffers || []) {
    if (!buf.uri || buf.uri.startsWith('data:')) continue
    const srcBin = path.join(dir, buf.uri)
    const dstBin = path.join(path.dirname(destPath), buf.uri)
    if (existsSync(srcBin)) {
      await fs.copyFile(srcBin, dstBin)
    }
  }
  // Rewrite image URIs to point to shared textures dir
  if (Array.isArray(gltf.images)) {
    for (const img of gltf.images) {
      if (!img.uri) continue
      const base = path.basename(img.uri)
      const remapped = textureRenames[base] || base
      img.uri = path.posix.join(sharedTexturesRelFromGltf, remapped)
    }
  }
  await ensureDir(path.dirname(destPath))
  await fs.writeFile(destPath, JSON.stringify(gltf), 'utf8')
}

async function importPack(pack) {
  console.log(`\n=== ${pack.key} ===`)
  const extractDir = path.join(SCRATCH, pack.extractName)
  if (!existsSync(extractDir) || (await fs.readdir(extractDir).catch(() => [])).length === 0) {
    console.log(`[${pack.key}] extracting ${pack.zip}`)
    await unzipTo(pack.zip, extractDir)
  } else {
    console.log(`[${pack.key}] reusing ${extractDir}`)
  }

  const gltfRoot = path.join(extractDir, pack.gltfRel)
  const texturesRoot = path.join(extractDir, pack.texturesRel)
  if (!existsSync(gltfRoot)) throw new Error(`gltf folder not found: ${gltfRoot}`)

  const outDir = path.join(ROOT, pack.outRel)
  const outTexturesDir = path.join(outDir, 'Textures')
  await ensureDir(outDir)

  // Process & emit shared textures.
  const textureRenames = await downscaleAndConvertTextures(texturesRoot, outTexturesDir, 1024)

  // Walk gltfs, copy each + bin + rewrite uris.
  const gltfFiles = await walk(gltfRoot, p => p.toLowerCase().endsWith('.gltf'))
  console.log(`[${pack.key}] copying ${gltfFiles.length} gltfs`)
  const additions = []
  for (const src of gltfFiles) {
    const stem = path.basename(src, '.gltf')
    const subDir = path.relative(gltfRoot, path.dirname(src))
    const subSlug = subDir ? slug(subDir) : ''
    const destDir = subSlug ? path.join(outDir, subSlug) : outDir
    const fileName = `${slug(stem)}.gltf`
    const destPath = path.join(destDir, fileName)
    // Compute relative path from this gltf back to the shared Textures dir.
    const sharedPath = path.posix.join('/', pack.outRel.replace(/^public\//, ''), 'Textures').replace(/^\//, '')
    const gltfPath = path.posix.join(pack.outRel.replace(/^public\//, ''), subSlug || '', fileName).replace(/\/+$/, '')
    const upDir = path.posix.dirname(gltfPath)
    const sharedRel = path.posix.relative(upDir, sharedPath) || './'
    await copyGltfWithRewrites(src, destPath, sharedRel, textureRenames)
    const relPath = '/' + path.posix.join(pack.outRel.replace(/^public\//, ''), subSlug || '', fileName).replace(/\/+$/, '')
    additions.push({
      id: `${pack.key}_${subSlug ? subSlug + '_' : ''}${slug(stem)}`,
      name: `${pack.namePrefix} ${pretty(stem)}${subSlug ? ` (${pretty(subSlug)})` : ''}`,
      path: relPath,
      category: pack.category,
      defaultScale: 1,
    })
  }
  console.log(`[${pack.key}] +${additions.length} additions`)
  return additions
}

async function main() {
  await ensureDir(SCRATCH)
  const extras = JSON.parse(await fs.readFile(EXTRAS_PATH, 'utf8'))
  extras.deletedIds = extras.deletedIds || []
  extras.additions = extras.additions || []

  const packKeys = new Set(PACKS.map(p => p.key))
  extras.additions = extras.additions.filter(a => {
    if (typeof a.id !== 'string') return true
    for (const k of packKeys) if (a.id.startsWith(`${k}_`)) return false
    return true
  })

  let total = 0
  for (const pack of PACKS) {
    try {
      const additions = await importPack(pack)
      extras.additions.push(...additions)
      total += additions.length
      await fs.writeFile(EXTRAS_PATH, JSON.stringify(extras, null, 2) + '\n', 'utf8')
    } catch (err) {
      console.error(`[${pack.key}] FAILED:`, err)
    }
  }
  console.log(`\nTotal additions: ${total}`)
}

main().catch(err => { console.error(err); process.exit(1) })
