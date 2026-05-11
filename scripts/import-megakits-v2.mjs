// scripts/import-megakits-v2.mjs
// Uses the VENDOR-SHIPPED glTF files from each MegaKit zip instead of converting
// FBX in Blender. The vendor gltfs already have correct material->texture
// bindings; we just need to colocate textures with the gltfs so relative URIs
// resolve, and pack each gltf+bin+textures into a self-contained .glb.

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
    hasSubcategories: true,
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
    hasSubcategories: false,
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
    hasSubcategories: false,
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

function slug(name) {
  return String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'asset'
}

function pretty(name) {
  return String(name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ░▒▓ glTF + .bin + textures -> single self-contained .glb ▓▒░
async function packGlbFromGltf(gltfPath, textureSearchDirs) {
  const gltfDir = path.dirname(gltfPath)
  const gltfRaw = await fs.readFile(gltfPath, 'utf8')
  const gltf = JSON.parse(gltfRaw)

  // Resolve buffers (.bin files) into a single concatenated buffer.
  const buffers = []
  let totalBin = 0
  for (const buf of gltf.buffers || []) {
    if (!buf.uri) {
      throw new Error(`gltf has buffer without uri at ${gltfPath}`)
    }
    if (buf.uri.startsWith('data:')) {
      const b64 = buf.uri.split(',')[1] || ''
      const raw = Buffer.from(b64, 'base64')
      buffers.push(raw)
      totalBin += raw.length
    } else {
      const binPath = path.join(gltfDir, buf.uri)
      const raw = await fs.readFile(binPath)
      buffers.push(raw)
      totalBin += raw.length
    }
  }

  // Resolve images: locate each in textureSearchDirs, append to buffer, rewrite as bufferView.
  const newBufferViews = [...(gltf.bufferViews || [])]
  const concatChunks = [...buffers]
  let offset = totalBin

  if (gltf.images && gltf.images.length) {
    for (let i = 0; i < gltf.images.length; i++) {
      const img = gltf.images[i]
      if (!img.uri) continue
      let resolved = null
      // Try same dir first, then sibling Textures/ folders.
      const candidates = [path.join(gltfDir, img.uri), ...textureSearchDirs.map(d => path.join(d, path.basename(img.uri)))]
      for (const c of candidates) {
        if (existsSync(c)) { resolved = c; break }
      }
      if (!resolved) {
        // Best-effort: search recursively for the basename anywhere under any search dir.
        const baseName = path.basename(img.uri)
        for (const root of textureSearchDirs) {
          const found = await walk(root, p => path.basename(p) === baseName)
          if (found.length) { resolved = found[0]; break }
        }
      }
      if (!resolved) {
        // Drop the image; downstream texture refs will need to be cleaned.
        gltf.images[i] = { ...img, uri: undefined, bufferView: -1 }
        continue
      }
      const data = await fs.readFile(resolved)
      // Pad to 4 bytes for buffer alignment.
      const padded = data.length % 4 === 0 ? data : Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))])
      const bufferViewIndex = newBufferViews.length
      newBufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length })
      concatChunks.push(padded)
      offset += padded.length
      const ext = path.extname(resolved).toLowerCase()
      const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
      gltf.images[i] = { mimeType, bufferView: bufferViewIndex }
    }
  }

  // Drop materials' references to dropped images (bufferView: -1 sentinel above).
  if (gltf.images) {
    const dropped = new Set(gltf.images.map((img, i) => img.bufferView === -1 ? i : null).filter(x => x !== null))
    if (dropped.size > 0 && gltf.textures) {
      gltf.textures = gltf.textures.map(t => dropped.has(t.source) ? null : t)
      // Filter out broken texture references in materials.
      const cleanMaterial = m => {
        const clean = JSON.parse(JSON.stringify(m))
        for (const slot of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) {
          if (clean[slot] && gltf.textures[clean[slot].index] === null) delete clean[slot]
        }
        if (clean.pbrMetallicRoughness) {
          for (const slot of ['baseColorTexture', 'metallicRoughnessTexture']) {
            if (clean.pbrMetallicRoughness[slot] && gltf.textures[clean.pbrMetallicRoughness[slot].index] === null) {
              delete clean.pbrMetallicRoughness[slot]
            }
          }
        }
        return clean
      }
      gltf.materials = (gltf.materials || []).map(cleanMaterial)
    }
  }

  // Update buffer-views, single-buffer with combined size.
  gltf.bufferViews = newBufferViews
  const combinedBin = Buffer.concat(concatChunks)
  gltf.buffers = [{ byteLength: combinedBin.length }]

  // Build the GLB file: [header][JSON chunk][BIN chunk]
  const jsonStr = JSON.stringify(gltf)
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  const jsonPad = jsonBuf.length % 4 === 0 ? 0 : 4 - (jsonBuf.length % 4)
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)])
  const binPad = combinedBin.length % 4 === 0 ? 0 : 4 - (combinedBin.length % 4)
  const binPadded = Buffer.concat([combinedBin, Buffer.alloc(binPad, 0)])

  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546C67, 0) // 'glTF'
  header.writeUInt32LE(2, 4)
  const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length
  header.writeUInt32LE(totalLen, 8)
  const jsonChunkHeader = Buffer.alloc(8)
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4) // 'JSON'
  const binChunkHeader = Buffer.alloc(8)
  binChunkHeader.writeUInt32LE(binPadded.length, 0)
  binChunkHeader.writeUInt32LE(0x004E4942, 4) // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binPadded])
}

async function downscaleTextures(rootDir, maxWidth = 1024) {
  const sharp = (await import('sharp')).default
  const pngs = await walk(rootDir, p => p.toLowerCase().endsWith('.png'))
  let resized = 0
  for (const png of pngs) {
    try {
      const meta = await sharp(png).metadata()
      const w = meta.width ?? 0
      if (w <= maxWidth) continue
      const buf = await sharp(png).resize({ width: maxWidth, withoutEnlargement: true }).png({ compressionLevel: 9, palette: false }).toBuffer()
      await fs.writeFile(png, buf)
      resized++
    } catch {}
  }
  console.log(`[downscale] resized ${resized}/${pngs.length} PNGs in ${rootDir}`)
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

  // Downscale textures in-place BEFORE packing — embedded GLB will pick up the smaller size.
  await downscaleTextures(extractDir, 1024)

  const gltfRoot = path.join(extractDir, pack.gltfRel)
  const texturesRoot = path.join(extractDir, pack.texturesRel)
  if (!existsSync(gltfRoot)) throw new Error(`gltf folder not found: ${gltfRoot}`)
  const gltfFiles = await walk(gltfRoot, p => p.toLowerCase().endsWith('.gltf'))
  console.log(`[${pack.key}] found ${gltfFiles.length} vendor glTF files`)

  const outDir = path.join(ROOT, pack.outRel)
  await ensureDir(outDir)

  const additions = []
  let ok = 0, fail = 0
  for (const gltf of gltfFiles) {
    try {
      const stem = path.basename(gltf, '.gltf')
      const slugStem = slug(stem)
      const subDir = pack.hasSubcategories ? path.basename(path.dirname(gltf)).toLowerCase() : null
      const fileName = subDir ? `${slug(subDir)}_${slugStem}.glb` : `${slugStem}.glb`
      const outPath = path.join(outDir, fileName)
      const glb = await packGlbFromGltf(gltf, [texturesRoot, path.dirname(gltf)])
      await fs.writeFile(outPath, glb)
      const relPath = '/' + path.posix.join(pack.outRel.replace(/^public\//, ''), fileName)
      additions.push({
        id: `${pack.key}_${path.basename(fileName, '.glb')}`,
        name: `${pack.namePrefix} ${pretty(stem)}${subDir ? ` (${pretty(subDir)})` : ''}`,
        path: relPath,
        category: pack.category,
        defaultScale: 1,
      })
      ok++
    } catch (err) {
      console.warn(`[${pack.key}] FAILED ${gltf}: ${err.message}`)
      fail++
    }
  }
  console.log(`[${pack.key}] packed ${ok} GLBs, failed ${fail}`)
  return additions
}

async function main() {
  await ensureDir(SCRATCH)
  const extras = JSON.parse(await fs.readFile(EXTRAS_PATH, 'utf8'))
  extras.deletedIds = extras.deletedIds || []
  extras.additions = extras.additions || []

  // Drop prior pack additions; we'll rewrite them.
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

  console.log(`\nTotal packed additions: ${total}`)
}

main().catch(err => { console.error(err); process.exit(1) })
