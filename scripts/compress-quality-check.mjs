// scripts/compress-quality-check.mjs
//
// For each candidate heavy asset, produces TWO compressed variants and writes
// them to public/_quality-check/ so the quality-check world can side-by-side
// them against the originals.
//
// L1 ("Standard"):    resize to 1024px, JPEG q82 for color, PNG for normals
// L2 ("Aggressive"):  resize to 512px,  JPEG q70 for color, PNG for normals
//
// Each variant is a self-contained .glb (VRMs stay .vrm extension to preserve
// the humanoid rig + extension blocks intact).
//
// Run: node scripts/compress-quality-check.mjs
// Idempotent: re-running overwrites.

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public/_quality-check')

const CANDIDATES = [
  {
    label: 'Bruno (VRM, faces matter)',
    src: 'public/avatars/gallery/Bruno.vrm',
    outExt: '.vrm',
  },
  {
    label: 'SciFi Crate (industrial textures)',
    src: 'public/models/scifi-essentials/Prop_Crate.gltf',
    outExt: '.glb',
  },
  {
    label: 'Conjured showcase (photographic textures)',
    src: 'public/conjured/conj_mn6ogn4ae05j.glb',
    outExt: '.glb',
  },
  {
    label: 'Quaternius base character (skin/hair)',
    src: 'public/models/quaternius-base-characters/characters/Superhero_Male_FullBody.gltf',
    outExt: '.glb',
  },
]

const LEVELS = [
  {
    key: 'L1_1k',
    label: 'Standard 1024',
    colorSize: 1024,
    colorQuality: 82,
    normalSize: 1024,
  },
  {
    key: 'L2_512',
    label: 'Aggressive 512',
    colorSize: 512,
    colorQuality: 70,
    normalSize: 512,
  },
]

const io = new NodeIO()

async function safeStat(p) {
  try { return await fs.stat(p) } catch { return null }
}

async function compressOne(srcPath, outPath, level) {
  const doc = await io.read(srcPath)

  // ░▒▓ Resize + recompress every non-normal texture as JPEG (compression
  // gain dominates color quality at typical Oasis camera distance). Normals
  // stay PNG (shading-math precision); only resized. ▓▒░
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'jpeg',
      resize: [level.colorSize, level.colorSize],
      resizeFilter: 'lanczos3',
      quality: level.colorQuality,
      slots: /^(?!normalTexture$)/, // every slot EXCEPT normalTexture
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      resize: [level.normalSize, level.normalSize],
      resizeFilter: 'lanczos3',
      slots: /^normalTexture$/, // only normalTexture
    }),
  )

  await io.write(outPath, doc)
  const stat = await safeStat(outPath)
  return stat?.size ?? 0
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  console.log(`[quality-check] output dir: ${OUT_DIR}\n`)

  const report = []
  for (const c of CANDIDATES) {
    const absSrc = path.join(ROOT, c.src)
    if (!existsSync(absSrc)) {
      console.warn(`[skip] ${c.label}: source missing at ${absSrc}`)
      continue
    }
    const srcStat = await safeStat(absSrc)
    const srcMB = (srcStat.size / 1024 / 1024).toFixed(2)
    console.log(`\n=== ${c.label} ===`)
    console.log(`  source: ${c.src} (${srcMB} MB)`)

    for (const level of LEVELS) {
      const baseName = path.basename(c.src, path.extname(c.src))
      const outName = `${baseName}_${level.key}${c.outExt}`
      const outPath = path.join(OUT_DIR, outName)
      try {
        const startedAt = Date.now()
        const bytes = await compressOne(absSrc, outPath, level)
        const ms = Date.now() - startedAt
        const mb = (bytes / 1024 / 1024).toFixed(2)
        console.log(`  ${level.label.padEnd(18)} -> ${outName.padEnd(60)} ${mb} MB  (${ms}ms)`)
        report.push({ candidate: c.label, level: level.label, srcMB, outMB: mb, outPath: '/_quality-check/' + outName, srcPath: '/' + c.src.replace(/^public\//, '') })
      } catch (err) {
        console.error(`  ${level.label} FAILED:`, err.message)
      }
    }
  }

  // Write a manifest so the world-builder can read what we produced
  const manifest = path.join(OUT_DIR, 'manifest.json')
  await fs.writeFile(manifest, JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidates: CANDIDATES.map(c => ({ label: c.label, src: '/' + c.src.replace(/^public\//, '') })),
    levels: LEVELS,
    report,
  }, null, 2))
  console.log(`\n[quality-check] manifest -> ${manifest}`)
}

main().catch(err => { console.error(err); process.exit(1) })
