import { PrismaClient } from '../node_modules/.prisma/client'

const prisma = new PrismaClient()

async function main() {
  const byVis = await prisma.world.groupBy({
    by: ['visibility'],
    _count: { _all: true },
  })
  console.log('=== BY VISIBILITY ===')
  for (const v of byVis) console.log(`${v.visibility}: ${v._count._all}`)

  const byOwner = await prisma.world.groupBy({
    by: ['userId'],
    _count: { _all: true },
  })
  console.log('\n=== BY OWNER ===')
  for (const v of byOwner) console.log(`${v.userId}: ${v._count._all}`)

  // Hackerspace-themed search: look for the keyword in name OR data blob.
  const hits = await prisma.world.findMany({
    where: {
      OR: [
        { name: { contains: 'hack' } },
        { name: { contains: 'Hack' } },
      ],
    },
    select: {
      id: true,
      name: true,
      userId: true,
      visibility: true,
      objectCount: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  console.log('\n=== WORLDS WITH "hack" IN NAME ===')
  for (const w of hits) {
    console.log(`${w.id} | ${w.name} | owner=${w.userId} | objs=${w.objectCount} | vis=${w.visibility} | created=${w.createdAt.toISOString()} | updated=${w.updatedAt.toISOString()}`)
  }

  // Snapshots for these worlds
  const ids = hits.map(w => w.id)
  if (ids.length > 0) {
    const snaps = await prisma.worldSnapshot.findMany({
      where: { worldId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, worldId: true, source: true, objectCount: true, createdAt: true },
    })
    console.log(`\n=== SNAPSHOTS FOR HACKERSPACE WORLDS (${snaps.length}) ===`)
    for (const s of snaps) {
      console.log(`snap=${s.id} | worldId=${s.worldId} | source=${s.source} | objs=${s.objectCount} | created=${s.createdAt.toISOString()}`)
    }
  }

  // Look in world.data JSON for any string matches the user might want
  const all = await prisma.world.findMany({
    select: { id: true, name: true, data: true },
  })
  console.log('\n=== WORLDS WHOSE data BLOB MENTIONS "hacker" OR "hackerspace" (case-insensitive) ===')
  let count = 0
  for (const w of all) {
    if (!w.data) continue
    const lower = w.data.toLowerCase()
    if (lower.includes('hacker') || lower.includes('hackspace')) {
      count += 1
      console.log(`${w.id} | ${w.name} | dataLen=${w.data.length}`)
    }
  }
  console.log(`total data-blob matches: ${count}`)

  // Also dump tail of newest 12 worlds by updatedAt
  console.log('\n=== NEWEST 12 WORLDS BY updatedAt ===')
  const recent = await prisma.world.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: { id: true, name: true, userId: true, visibility: true, objectCount: true, updatedAt: true },
  })
  for (const w of recent) {
    console.log(`${w.id} | ${w.name} | owner=${w.userId} | objs=${w.objectCount} | vis=${w.visibility} | updated=${w.updatedAt.toISOString()}`)
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
