import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { createWorld } from '@/lib/forge/world-server'
import {
  SESSION_COOKIE_MAX_AGE_S,
  SESSION_COOKIE_NAME,
  getOasisMode,
  mintSessionCookieValue,
  readBrowserSession,
} from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEMO_WORLD_OWNER_ID = 'oasis-demo-router'
const DEFAULT_EVENT_SLUG = 'ai-tinkerers-bogota-may-2026'
const DEFAULT_TARGET_CAP = 8
const DEFAULT_HARD_CAP = 12
const DEFAULT_MAX_SHARDS_PER_EVENT = 16
const ASSIGNMENT_RESERVATION_TTL_MS = 90_000

const globalDemoState = globalThis as typeof globalThis & {
  __oasisDemoAssignmentLocks?: Map<string, Promise<void>>
  __oasisDemoAssignmentReservations?: Map<string, Array<{ worldId: string; expiresAt: number }>>
}
const demoAssignmentLocks = globalDemoState.__oasisDemoAssignmentLocks ?? new Map<string, Promise<void>>()
globalDemoState.__oasisDemoAssignmentLocks = demoAssignmentLocks
const demoAssignmentReservations = globalDemoState.__oasisDemoAssignmentReservations ?? new Map<string, Array<{ worldId: string; expiresAt: number }>>()
globalDemoState.__oasisDemoAssignmentReservations = demoAssignmentReservations

interface RoomMetric {
  worldId: string
  players?: number
}

class DemoCapacityError extends Error {
  constructor(
    public readonly eventSlug: string,
    public readonly targetCap: number,
    public readonly hardCap: number,
    public readonly maxShards: number,
  ) {
    super('Demo shards are full')
  }
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function sanitizeSlug(value: string | null): string {
  return (value || DEFAULT_EVENT_SLUG)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || DEFAULT_EVENT_SLUG
}

function resolveEventSlug(request: NextRequest): string {
  const requested = sanitizeSlug(request.nextUrl.searchParams.get('event'))
  const allowArbitrary = getOasisMode() !== 'hosted' || process.env.OASIS_DEMO_ALLOW_ARBITRARY_EVENTS === '1'
  if (allowArbitrary) return requested
  const allowed = (process.env.OASIS_DEMO_EVENTS || DEFAULT_EVENT_SLUG)
    .split(',')
    .map(item => sanitizeSlug(item))
    .filter(Boolean)
  return allowed.includes(requested) ? requested : DEFAULT_EVENT_SLUG
}

function demoWorldPrefix(eventSlug: string): string {
  return `Demo ${eventSlug} FFA`
}

function roomHttpBase(request: NextRequest): string {
  const explicit = process.env.OASIS_ROOM_INTERNAL_URL || process.env.NEXT_PUBLIC_OASIS_ROOM_URL || ''
  if (explicit.trim()) {
    const url = new URL(explicit.trim(), request.url)
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol
    return url.toString().replace(/\/+$/, '')
  }
  const host = request.nextUrl.hostname
  const local = host === 'localhost' || host === '127.0.0.1'
  return local ? 'http://127.0.0.1:4519' : `${request.nextUrl.origin}/rooms`
}

async function fetchRoomMetrics(request: NextRequest, worldIds: string[]): Promise<Map<string, number>> {
  if (worldIds.length === 0) return new Map()
  try {
    const response = await fetch(`${roomHttpBase(request)}/room-metrics`, { cache: 'no-store' })
    if (!response.ok) return new Map()
    const data = await response.json() as { metrics?: RoomMetric[] }
    const out = new Map<string, number>()
    for (const metric of data.metrics || []) {
      if (worldIds.includes(metric.worldId)) out.set(metric.worldId, Math.max(0, Number(metric.players || 0)))
    }
    return out
  } catch {
    return new Map()
  }
}

function stampSessionCookie(response: NextResponse, cookieValue?: string): void {
  if (!cookieValue) return
  response.cookies.set(SESSION_COOKIE_NAME, cookieValue, {
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_S,
    sameSite: 'lax',
    httpOnly: true,
    secure: getOasisMode() === 'hosted',
  })
}

function readReservationCounts(eventSlug: string, now = Date.now()): Map<string, number> {
  const active = (demoAssignmentReservations.get(eventSlug) || []).filter(item => item.expiresAt > now)
  demoAssignmentReservations.set(eventSlug, active)
  const counts = new Map<string, number>()
  for (const item of active) {
    counts.set(item.worldId, (counts.get(item.worldId) || 0) + 1)
  }
  return counts
}

function reserveDemoWorld(eventSlug: string, worldId: string, now = Date.now()): void {
  const active = (demoAssignmentReservations.get(eventSlug) || []).filter(item => item.expiresAt > now)
  active.push({ worldId, expiresAt: now + ASSIGNMENT_RESERVATION_TTL_MS })
  demoAssignmentReservations.set(eventSlug, active)
}

async function withDemoAssignmentLock<T>(eventSlug: string, task: () => Promise<T>): Promise<T> {
  const previous = demoAssignmentLocks.get(eventSlug) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  demoAssignmentLocks.set(eventSlug, tail)
  await previous.catch(() => {})
  try {
    return await task()
  } finally {
    release()
    if (demoAssignmentLocks.get(eventSlug) === tail) {
      demoAssignmentLocks.delete(eventSlug)
    }
  }
}

async function assignDemoWorld(request: NextRequest, eventSlug: string, targetCap: number, hardCap: number) {
  const prefix = demoWorldPrefix(eventSlug)
  const maxShards = clampInt(
    request.nextUrl.searchParams.get('maxShards') || process.env.OASIS_DEMO_MAX_SHARDS_PER_EVENT || null,
    DEFAULT_MAX_SHARDS_PER_EVENT,
    1,
    256,
  )

  const worlds = await prisma.world.findMany({
    where: {
      name: { startsWith: prefix },
      visibility: { in: ['public_edit', 'ffa', 'unlisted_edit'] },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const playerCounts = await fetchRoomMetrics(request, worlds.map(world => world.id))
  const reservationCounts = readReservationCounts(eventSlug)
  const candidates = worlds.map(world => ({
    ...world,
    players: (playerCounts.get(world.id) || 0) + (reservationCounts.get(world.id) || 0),
  }))

  const chooseFrom = (items: typeof candidates) => items
    .slice()
    .sort((a, b) => a.players - b.players || a.createdAt.getTime() - b.createdAt.getTime())[0]

  let assigned = chooseFrom(candidates.filter(world => world.players < targetCap))
    || chooseFrom(candidates.filter(world => world.players < hardCap))
  let created = false

  if (!assigned && worlds.length < maxShards) {
    const shardNumber = worlds.length + 1
    const meta = await createWorld(`${prefix} ${shardNumber}`, 'D', DEMO_WORLD_OWNER_ID, {
      visibility: 'ffa',
      pvpEnabled: true,
    })
    assigned = {
      id: meta.id,
      name: meta.name,
      createdAt: new Date(),
      players: 0,
    }
    created = true
  }
  if (!assigned) {
    throw new DemoCapacityError(eventSlug, targetCap, hardCap, maxShards)
  }
  reserveDemoWorld(eventSlug, assigned.id)

  const payload = {
    ok: true,
    event: eventSlug,
    worldId: assigned.id,
    worldName: assigned.name,
    players: assigned.players,
    targetCap,
    hardCap,
    maxShards,
    created,
    href: `/w/${encodeURIComponent(assigned.id)}?demo=${encodeURIComponent(eventSlug)}`,
  }
  return payload
}

export async function GET(request: NextRequest) {
  const eventSlug = resolveEventSlug(request)
  const targetCap = clampInt(request.nextUrl.searchParams.get('target'), DEFAULT_TARGET_CAP, 1, 256)
  const hardCap = clampInt(request.nextUrl.searchParams.get('hard'), DEFAULT_HARD_CAP, targetCap, 256)

  const existingSession = readBrowserSession(request)
  const minted = existingSession ? null : mintSessionCookieValue()

  const wantsJson = request.nextUrl.searchParams.get('json') === '1'
    || request.headers.get('accept')?.includes('application/json')
  let payload
  try {
    payload = await withDemoAssignmentLock(eventSlug, () => assignDemoWorld(request, eventSlug, targetCap, hardCap))
  } catch (error) {
    if (error instanceof DemoCapacityError) {
      const fullPayload = {
        ok: false,
        full: true,
        event: error.eventSlug,
        targetCap: error.targetCap,
        hardCap: error.hardCap,
        maxShards: error.maxShards,
        error: error.message,
      }
      const response = wantsJson
        ? NextResponse.json(fullPayload, { status: 503 })
        : NextResponse.redirect(new URL('/', request.url))
      stampSessionCookie(response, minted?.cookieValue)
      return response
    }
    throw error
  }
  const response = wantsJson
    ? NextResponse.json(payload)
    : NextResponse.redirect(new URL(payload.href, request.url))
  stampSessionCookie(response, minted?.cookieValue)
  return response
}
