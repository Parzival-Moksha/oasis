// scripts/backfill-assets.mjs
// One-shot backfill: walk data/conjured-registry.json + data/scene-library.json
// and upsert every existing user-tier asset into the `Asset` Prisma table.
// Idempotent — safe to re-run; rows are upserted by id.
//
// SAFETY: defaults to DRY RUN. Prints what it would do, then exits.
// Pass --commit to actually write.
// Pass --owner=<id> to override the ownerId (default: 'local-user').
//
// Verify twice before launching: this is a one-time mutation of the DB.

import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const require = createRequire(import.meta.url)
const { PrismaClient } = require(path.join(ROOT, 'node_modules/.prisma/client'))
const REGISTRY = path.join(ROOT, 'data', 'conjured-registry.json')
const SCENE_LIBRARY = path.join(ROOT, 'data', 'scene-library.json')

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const ownerArg = args.find(a => a.startsWith('--owner='))
const OWNER = ownerArg ? ownerArg.slice('--owner='.length) : 'local-user'

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (err) { console.warn(`[backfill] skip ${file}: ${err.message}`); return null }
}

function summarizeConjured(rows) {
  const total = rows.length
  const ready = rows.filter(r => r.status === 'ready' && r.glbPath).length
  const namedDisplay = rows.filter(r => r.displayName).length
  const sample = rows.find(r => r.status === 'ready' && r.glbPath)
  return { total, ready, namedDisplay, sample }
}

function summarizeCrafted(rows) {
  const total = rows.length
  const named = rows.filter(r => r.name).length
  const withThumb = rows.filter(r => r.thumbnailUrl).length
  const sample = rows[0]
  return { total, named, withThumb, sample }
}

async function planConjured(prisma, rows) {
  const out = []
  for (const r of rows) {
    if (r.status !== 'ready' || !r.glbPath) continue
    out.push({
      id: r.id,
      kind: 'conjured',
      path: r.glbPath,
      name: r.displayName || (r.prompt ? String(r.prompt).slice(0, 60) : r.id),
      category: 'conjured',
      defaultScale: r.scale ?? 1,
      thumbnailUrl: r.thumbnailUrl ?? null,
      bytes: typeof r.metadata?.fileSizeBytes === 'number' ? r.metadata.fileSizeBytes : null,
      scope: 'user',
      ownerId: OWNER,
      source: r.provider ? `conjure:${r.provider}:${r.tier || ''}`.replace(/:$/, '') : null,
    })
  }
  return out
}

async function planCrafted(prisma, rows) {
  const out = []
  for (const r of rows) {
    if (!r.id) continue
    out.push({
      id: r.id,
      kind: 'crafted',
      path: `crafted://${r.id}`,
      name: r.name || `Crafted scene ${r.id.slice(0, 8)}`,
      category: 'crafted',
      defaultScale: 1,
      thumbnailUrl: r.thumbnailUrl ?? null,
      scope: 'user',
      ownerId: OWNER,
      source: r.model || 'self-craft',
      data: JSON.stringify(r),  // full scene primitives + name + prompt + position + thumbnail
    })
  }
  return out
}

async function applyBatch(prisma, batch, label) {
  let inserted = 0
  let updated = 0
  for (const row of batch) {
    const existing = await prisma.asset.findUnique({ where: { id: row.id } })
    if (existing) {
      if (COMMIT) await prisma.asset.update({ where: { id: row.id }, data: row })
      updated++
    } else {
      if (COMMIT) await prisma.asset.create({ data: row })
      inserted++
    }
  }
  console.log(`[backfill] ${label}: ${COMMIT ? 'committed' : 'WOULD insert'} ${inserted} new, ${COMMIT ? 'updated' : 'would update'} ${updated} existing`)
  return { inserted, updated }
}

async function main() {
  console.log(`[backfill] mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'} | owner: ${OWNER}`)
  const conjuredAll = (await readJson(REGISTRY)) || []
  const craftedAll = (await readJson(SCENE_LIBRARY)) || []
  console.log(`\n[backfill] sources:`)
  console.log(`  conjured:  ${REGISTRY}`)
  console.log(`  crafted:   ${SCENE_LIBRARY}`)
  console.log(`\n[backfill] conjured summary:`, summarizeConjured(conjuredAll))
  console.log(`[backfill] crafted summary:`, summarizeCrafted(craftedAll))

  const prisma = new PrismaClient()
  try {
    // Show pre-state
    const preCount = await prisma.asset.count()
    const preUserCount = await prisma.asset.count({ where: { scope: 'user' } })
    console.log(`\n[backfill] Asset table pre-state: total=${preCount}, scope=user=${preUserCount}`)

    const conjuredPlan = await planConjured(prisma, conjuredAll)
    const craftedPlan = await planCrafted(prisma, craftedAll)

    console.log(`\n[backfill] plan:`)
    console.log(`  conjured rows to upsert: ${conjuredPlan.length}`)
    console.log(`  crafted rows to upsert:  ${craftedPlan.length}`)

    if (conjuredPlan.length) {
      console.log(`\n[backfill] sample conjured row:`)
      console.log(JSON.stringify(conjuredPlan[0], null, 2))
    }
    if (craftedPlan.length) {
      console.log(`\n[backfill] sample crafted row:`)
      console.log(JSON.stringify(craftedPlan[0], null, 2))
    }

    if (!COMMIT) {
      console.log(`\n[backfill] DRY RUN complete. Pass --commit to apply.`)
      return
    }

    const r1 = await applyBatch(prisma, conjuredPlan, 'conjured')
    const r2 = await applyBatch(prisma, craftedPlan, 'crafted')

    const postCount = await prisma.asset.count()
    const postUserCount = await prisma.asset.count({ where: { scope: 'user' } })
    console.log(`\n[backfill] Asset table post-state: total=${postCount}, scope=user=${postUserCount}`)
    console.log(`[backfill] DONE. Net new: ${r1.inserted + r2.inserted}, updated: ${r1.updated + r2.updated}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
