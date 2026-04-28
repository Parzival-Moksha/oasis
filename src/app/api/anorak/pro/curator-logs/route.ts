// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// CURATOR LOGS — list CuratorLog entries
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Reads from Prisma per-request — must not be statically exported at build.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const logs = await prisma.curatorLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json(logs)
}
