import 'server-only'

import { prisma } from './db'
import { PUBLICLY_READABLE_VISIBILITIES } from './forge/world-access'

export const WORLD_SHORT_CODE_MIN_LENGTH = 4
export const WORLD_SHORT_CODE_MAX_LENGTH = 6
export const WORLD_SHORT_CODE_RE = /^\d{4,6}$/

function randomNumericCode(length: number): string {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString()
  }
  return code
}

export function normalizeWorldShortCode(value: string | null | undefined): string | null {
  const normalized = (value || '').trim()
  return WORLD_SHORT_CODE_RE.test(normalized) ? normalized : null
}

export function isWorldShortCodeCollision(error: unknown): boolean {
  const record = error as { code?: unknown; meta?: { target?: unknown } }
  if (record?.code !== 'P2002') return false
  const target = record.meta?.target
  return Array.isArray(target)
    ? target.includes('shortCode')
    : String(target || '').includes('shortCode')
}

export async function generateWorldShortCode(): Promise<string> {
  for (let length = WORLD_SHORT_CODE_MIN_LENGTH; length <= WORLD_SHORT_CODE_MAX_LENGTH; length += 1) {
    const attempts = length === WORLD_SHORT_CODE_MIN_LENGTH ? 80 : 40
    for (let i = 0; i < attempts; i += 1) {
      const code = randomNumericCode(length)
      const existing = await prisma.world.findUnique({
        where: { shortCode: code },
        select: { id: true },
      })
      if (!existing) return code
    }
  }
  throw new Error('Could not allocate a world short code.')
}

export async function ensureWorldShortCode(worldId: string): Promise<string | null> {
  const current = await prisma.world.findUnique({
    where: { id: worldId },
    select: { id: true, shortCode: true },
  })
  if (!current) return null
  if (current.shortCode) return current.shortCode

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shortCode = await generateWorldShortCode()
    try {
      const updated = await prisma.world.updateMany({
        where: { id: worldId, shortCode: null },
        data: { shortCode },
      })
      if (updated.count > 0) return shortCode
      const refreshed = await prisma.world.findUnique({
        where: { id: worldId },
        select: { shortCode: true },
      })
      return refreshed?.shortCode || null
    } catch (error) {
      if (isWorldShortCodeCollision(error)) continue
      throw error
    }
  }
  return null
}

export async function findReadableWorldByShortCode(shortCodeInput: string): Promise<{
  id: string
  shortCode: string | null
  visibility: string
} | null> {
  const shortCode = normalizeWorldShortCode(shortCodeInput)
  if (!shortCode) return null
  return prisma.world.findFirst({
    where: {
      shortCode,
      visibility: { in: PUBLICLY_READABLE_VISIBILITIES },
    },
    select: {
      id: true,
      shortCode: true,
      visibility: true,
    },
  })
}
