// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PRISMA CLIENT SINGLETON (Prisma 6)
// Prevents hot-reload from spawning new connections in dev mode
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import path from 'node:path'
import { PrismaClient } from '../../node_modules/.prisma/client'

const PRISMA_CLIENT_SOURCE = 'generated-client-absolute-sqlite-v1'

type PrismaGlobal = {
  prisma: PrismaClient | undefined
  prismaClientSource: string | undefined
}

const globalForPrisma = globalThis as unknown as PrismaGlobal

function normalizeLocalSqliteUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('file:')) return url

  const sqlitePath = url.slice('file:'.length)
  if (!sqlitePath || path.isAbsolute(sqlitePath)) return url

  // Prisma resolves schema-relative SQLite URLs during CLI commands. At app
  // runtime we pass the URL directly, so keep the same base explicitly.
  const absolutePath = path.resolve(process.cwd(), 'prisma', sqlitePath).replace(/\\/g, '/')
  return `file:${absolutePath}`
}

const databaseUrl = normalizeLocalSqliteUrl(process.env.DATABASE_URL)

if (globalForPrisma.prisma && globalForPrisma.prismaClientSource !== PRISMA_CLIENT_SOURCE) {
  void globalForPrisma.prisma.$disconnect().catch(() => {})
  globalForPrisma.prisma = undefined
  globalForPrisma.prismaClientSource = undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient(databaseUrl ? {
  datasources: { db: { url: databaseUrl } },
} : undefined)

// Enable WAL mode for concurrent access (MCP server + Next.js both hit oasis.db)
if (!globalForPrisma.prisma) {
  prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL').catch(() => {})
  prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000').catch(() => {})
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaClientSource = PRISMA_CLIENT_SOURCE
}
