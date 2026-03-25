// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PRISMA CLIENT SINGLETON (Prisma 6)
// Prevents hot-reload from spawning new connections in dev mode
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

// Enable WAL mode for concurrent access (MCP server + Next.js both hit oasis.db)
if (!globalForPrisma.prisma) {
  prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL').catch(() => {})
  prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000').catch(() => {})
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
