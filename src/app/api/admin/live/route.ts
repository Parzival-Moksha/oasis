import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { demoWorldPrefix, listDemoShortCodes } from '@/lib/demo-short-codes'
import { publicOriginFromRequest } from '@/lib/public-origin'
import { getOasisCapabilities } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface RoomMetric {
  worldId: string
  players?: number
  maxClients?: number
  commandsAccepted?: number
  commandsRejected?: number
  mutationsRelayed?: number
  commandLatencyAvgMs?: number
  commandLatencyMaxMs?: number
  lastCommandAt?: number
  lastMutationAt?: number
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

async function fetchRoomHealth(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${roomHttpBase(request)}/health`, { cache: 'no-store' })
    if (!response.ok) return null
    return await response.json() as Record<string, unknown>
  } catch {
    return null
  }
}

function readMetrics(roomHealth: Record<string, unknown> | null): RoomMetric[] {
  const metrics = roomHealth?.worldMetrics
  return Array.isArray(metrics) ? metrics as RoomMetric[] : []
}

function nextProcessSnapshot() {
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      externalMb: Math.round(memory.external / 1024 / 1024),
    },
    cpu: {
      userMs: Math.round(cpu.user / 1000),
      systemMs: Math.round(cpu.system / 1000),
    },
  }
}

export async function GET(request: NextRequest) {
  try {
    const capabilities = getOasisCapabilities(request)
    if (capabilities.mode === 'hosted' && !capabilities.admin) {
      return NextResponse.json({ error: 'admin session required' }, { status: 403 })
    }

    const roomHealth = await fetchRoomHealth(request)
    const metrics = readMetrics(roomHealth)
    const metricByWorld = new Map(metrics.map(metric => [metric.worldId, metric]))
    const shortCodes = listDemoShortCodes()
    const demoEvents = [...new Set(shortCodes.map(entry => entry.event))]
    const demoWorlds = demoEvents.length
      ? await prisma.world.findMany({
          where: {
            OR: demoEvents.map(event => ({
              name: { startsWith: demoWorldPrefix(event) },
            })),
          },
          select: {
            id: true,
            name: true,
            visibility: true,
            pvpEnabled: true,
            objectCount: true,
            visitCount: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const liveWorldIds = metrics.map(metric => metric.worldId)
    const knownLiveWorlds = liveWorldIds.length
      ? await prisma.world.findMany({
          where: { id: { in: liveWorldIds } },
          select: {
            id: true,
            name: true,
            visibility: true,
            objectCount: true,
            visitCount: true,
            updatedAt: true,
          },
        })
      : []
    const worldNameById = new Map(knownLiveWorlds.map(world => [world.id, world.name]))
    const enrichedLiveRooms = metrics
      .map(metric => ({
        ...metric,
        name: worldNameById.get(metric.worldId) || metric.worldId,
      }))
      .sort((a, b) => (b.players || 0) - (a.players || 0) || a.name.localeCompare(b.name))

    const totals = metrics.reduce((acc, metric) => {
      acc.players += Math.max(0, Number(metric.players || 0))
      acc.commandsAccepted += Math.max(0, Number(metric.commandsAccepted || 0))
      acc.commandsRejected += Math.max(0, Number(metric.commandsRejected || 0))
      acc.mutationsRelayed += Math.max(0, Number(metric.mutationsRelayed || 0))
      acc.maxLatencyMs = Math.max(acc.maxLatencyMs, Number(metric.commandLatencyMaxMs || 0))
      return acc
    }, {
      players: 0,
      commandsAccepted: 0,
      commandsRejected: 0,
      mutationsRelayed: 0,
      maxLatencyMs: 0,
    })

    const responseOrigin = publicOriginFromRequest(request)
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      entry: {
        shortCodes: shortCodes.map(entry => ({
          ...entry,
          rootUrl: `${responseOrigin}/${entry.code}`,
          fallbackUrl: `${responseOrigin}/j/${entry.code}`,
          demoUrl: `${responseOrigin}/demo?event=${encodeURIComponent(entry.event)}&target=${entry.targetCap}&hard=${entry.hardCap}&maxShards=${entry.maxShards}`,
        })),
      },
      totals: {
        livePlayers: totals.players,
        liveRooms: metrics.length,
        commandsAccepted: totals.commandsAccepted,
        commandsRejected: totals.commandsRejected,
        mutationsRelayed: totals.mutationsRelayed,
        maxCommandLatencyMs: totals.maxLatencyMs,
        roomConnections: Number(roomHealth?.connections || 0),
        roomCount: Number(roomHealth?.rooms || 0),
      },
      processes: {
        next: nextProcessSnapshot(),
        room: roomHealth?.process || null,
      },
      demoWorlds: demoWorlds.map(world => {
        const metric = metricByWorld.get(world.id)
        return {
          id: world.id,
          name: world.name,
          visibility: world.visibility,
          pvpEnabled: world.pvpEnabled,
          objectCount: world.objectCount,
          visitCount: world.visitCount,
          players: metric?.players || 0,
          maxClients: metric?.maxClients || null,
          createdAt: world.createdAt.toISOString(),
          updatedAt: world.updatedAt.toISOString(),
        }
      }),
      liveRooms: enrichedLiveRooms,
      roomHealth,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin/live] GET failed:', message)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
