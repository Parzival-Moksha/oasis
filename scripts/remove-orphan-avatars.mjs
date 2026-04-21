#!/usr/bin/env node
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// REMOVE ORPHAN AGENT AVATARS
// ─═̷─═̷─ॐ─═̷─═̷─
//
// Walks every world in the local Prisma DB and removes any placedAgentAvatar
// whose agentType is NOT in the canonical set. Those are artifacts from
// beginner agents (e.g. OpenClaw placing a body as agentType "clawdling").
//
// Usage:  node scripts/remove-orphan-avatars.mjs [--dry-run]
//
// Safe to re-run. Idempotent. Prints what it touched.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { PrismaClient } from '../node_modules/.prisma/client/index.js'

const CANONICAL = new Set([
  'anorak',
  'anorak-pro',
  'merlin',
  'hermes',
  'openclaw',
  'devcraft',
  'parzival',
  'browser',
  'mission',
])

const dryRun = process.argv.includes('--dry-run')
const prisma = new PrismaClient()

function filterAvatars(avatars) {
  const kept = []
  const dropped = []
  for (const avatar of avatars) {
    if (avatar && CANONICAL.has(avatar.agentType)) {
      kept.push(avatar)
    } else {
      dropped.push(avatar)
    }
  }
  return { kept, dropped }
}

try {
  const worlds = await prisma.world.findMany({ select: { id: true, name: true, data: true } })
  let totalDropped = 0
  let worldsTouched = 0

  for (const world of worlds) {
    if (!world.data) continue
    let state
    try {
      state = JSON.parse(world.data)
    } catch {
      console.warn(`⚠ skipping ${world.id} (${world.name}) — JSON parse failed`)
      continue
    }

    const source = Array.isArray(state.agentAvatars) ? state.agentAvatars : []
    if (source.length === 0) continue

    const { kept, dropped } = filterAvatars(source)
    if (dropped.length === 0) continue

    worldsTouched++
    totalDropped += dropped.length
    console.log(`\n📍 ${world.name} (${world.id})`)
    for (const orphan of dropped) {
      console.log(`  ✗ dropping agentType='${orphan.agentType}' label='${orphan.label || ''}' id='${orphan.id}'`)
    }

    if (!dryRun) {
      state.agentAvatars = kept
      await prisma.world.update({
        where: { id: world.id },
        data: { data: JSON.stringify(state) },
      })
      console.log(`  ✓ saved`)
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] would drop' : 'Dropped'} ${totalDropped} orphan avatar(s) across ${worldsTouched} world(s).`)
  console.log('Refresh the Oasis tab to see the change.')
} finally {
  await prisma.$disconnect()
}
