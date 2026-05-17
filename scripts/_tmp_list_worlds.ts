import { PrismaClient } from '../node_modules/.prisma/client'

const prisma = new PrismaClient()

async function main() {
  const worlds = await prisma.world.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      name: true,
      icon: true,
      visibility: true,
      objectCount: true,
      creatorName: true,
      thumbnailUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  console.log(`\n=== WORLDS (${worlds.length} total) ===\n`)
  for (const w of worlds) {
    const created = w.createdAt.toISOString().slice(0, 16)
    const updated = w.updatedAt.toISOString().slice(0, 16)
    console.log(
      `id=${w.id.padEnd(36)} | name="${w.name}" | vis=${w.visibility.padEnd(12)} | owner=${w.userId.padEnd(16)} | objs=${String(w.objectCount).padEnd(4)} | created=${created} | updated=${updated} | creator=${w.creatorName || '-'}`,
    )
  }

  const snaps = await prisma.worldSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      worldId: true,
      source: true,
      objectCount: true,
      createdAt: true,
    },
  })
  console.log(`\n=== WORLD SNAPSHOTS (${snaps.length} total) ===\n`)
  for (const s of snaps) {
    console.log(
      `snapId=${s.id.padEnd(28)} | worldId=${s.worldId.padEnd(36)} | source=${s.source.padEnd(8)} | objs=${String(s.objectCount).padEnd(4)} | created=${s.createdAt.toISOString().slice(0, 19)}`,
    )
  }

  // Also count by visibility
  const byVis = await prisma.world.groupBy({
    by: ['visibility'],
    _count: { _all: true },
  })
  console.log('\n=== BY VISIBILITY ===')
  for (const v of byVis) console.log(`${v.visibility}: ${v._count._all}`)

  const byOwner = await prisma.world.groupBy({
    by: ['userId'],
    _count: { _all: true },
  })
  console.log('\n=== BY OWNER ===')
  for (const v of byOwner) console.log(`${v.userId}: ${v._count._all}`)
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
