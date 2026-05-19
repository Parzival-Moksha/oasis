#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// compress-splash-screens.mjs
// ─═̷─═̷─📦─═̷─═̷─  Take the heavy PNG/JPG bakes in public/splash/ and produce
//                 ~150KB WebP variants alongside them. Optionally deletes the
//                 originals after a successful conversion.
//
// Usage:
//   node scripts/compress-splash-screens.mjs            # default: q72, delete originals
//   node scripts/compress-splash-screens.mjs --keep     # produce WebPs but keep PNGs
//   node scripts/compress-splash-screens.mjs --quality=75
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'public', 'splash')

const args = process.argv.slice(2)
const keep = args.includes('--keep')
const qArg = args.find(a => a.startsWith('--quality='))
const quality = qArg ? Math.max(50, Math.min(95, parseInt(qArg.slice('--quality='.length), 10))) : 72
const TARGET_W = 1920

// Designs we want to drop completely — don't bother re-encoding them, just nuke.
const PURGE_DESIGN_IDS = new Set(['cyber-datacenter'])

async function compressOne(filename) {
  const designId = filename.split('.')[0]
  if (PURGE_DESIGN_IDS.has(designId)) {
    fs.unlinkSync(path.join(DIR, filename))
    return { filename, action: 'deleted', from: 0, to: 0 }
  }
  const ext = path.extname(filename).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null
  const stem = filename.slice(0, -ext.length)
  const inPath = path.join(DIR, filename)
  const outPath = path.join(DIR, `${stem}.webp`)

  const beforeBytes = fs.statSync(inPath).size

  // Resize down to TARGET_W if wider — keeps 16:9-ish aspect, avoids wasting
  // bytes on >1920px that nobody will see on a desktop splash.
  const meta = await sharp(inPath).metadata()
  const pipeline = sharp(inPath)
  if ((meta.width ?? 0) > TARGET_W) {
    pipeline.resize({ width: TARGET_W, withoutEnlargement: true })
  }
  await pipeline.webp({ quality, effort: 5 }).toFile(outPath)
  const afterBytes = fs.statSync(outPath).size

  if (!keep) fs.unlinkSync(inPath)
  return { filename, designId, action: 'compressed', from: beforeBytes, to: afterBytes, out: path.basename(outPath) }
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`splash dir missing: ${DIR}`)
    process.exit(1)
  }
  const entries = fs.readdirSync(DIR).filter(f => /\.(png|jpe?g)$/i.test(f))
  if (!entries.length) {
    console.log('no PNG/JPG files in', DIR)
    return
  }
  console.log(`\n░▒▓ Compressing ${entries.length} splash images @ q${quality} (target ${TARGET_W}px wide, WebP) ▓▒░\n`)
  let total = { from: 0, to: 0, ok: 0, fail: 0, deleted: 0 }
  for (const f of entries) {
    try {
      const r = await compressOne(f)
      if (!r) continue
      if (r.action === 'deleted') {
        console.log(`  ✗ ${f.padEnd(40)}   DELETED (purged design)`)
        total.deleted += 1
        continue
      }
      const pct = ((1 - r.to / r.from) * 100).toFixed(1)
      console.log(`  ✓ ${f.padEnd(40)} → ${r.out.padEnd(42)} ${(r.from/1024).toFixed(0).padStart(5)} KB → ${(r.to/1024).toFixed(0).padStart(4)} KB  (-${pct}%)`)
      total.from += r.from
      total.to += r.to
      total.ok += 1
    } catch (err) {
      console.log(`  ✗ ${f}: ${err instanceof Error ? err.message : String(err)}`)
      total.fail += 1
    }
  }
  if (total.ok > 0) {
    console.log(`\n  Σ  ${(total.from/1024/1024).toFixed(2)} MB → ${(total.to/1024/1024).toFixed(2)} MB  (saved ${((1 - total.to/total.from)*100).toFixed(1)}%)`)
  }
  if (total.deleted > 0) console.log(`  ✗  ${total.deleted} files deleted (purged design)`)
  if (total.fail > 0)    console.log(`  ⚠  ${total.fail} failed`)

  // Regenerate manifest.
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
  manifest.designs = manifest.designs.filter(d => !PURGE_DESIGN_IDS.has(d.id))
  manifest.designs.forEach(d => {
    d.variants.forEach(v => {
      if (!v.url) return
      const ext = path.extname(v.url)
      const stem = v.url.slice(0, -ext.length)
      const webp = stem + '.webp'
      const absPath = path.join(DIR, path.basename(webp))
      if (fs.existsSync(absPath)) v.url = webp
    })
  })
  manifest.generatedAt = new Date().toISOString()
  manifest.compressed = { quality, targetWidth: TARGET_W }
  fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\n📜 manifest.json refreshed`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
