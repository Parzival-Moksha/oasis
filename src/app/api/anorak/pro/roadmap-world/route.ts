import { NextRequest, NextResponse } from 'next/server'

import { prisma } from '@/lib/db'
import { getOasisUserId } from '@/lib/session'
import { createWorld, saveWorld } from '@/lib/forge/world-server'
import { DEFAULT_WORLD_LIGHTS, type CraftedScene, type WorldLight } from '@/lib/conjure/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROADMAP_WORLD_NAME = 'Anorak Pro Roadmap'
const ROADMAP_WORLD_ICON = '🧠'
const BAND_LABELS = [
  'Para',
  'Pashyanti',
  'Madhyama',
  'Vaikhari',
  'Built',
  'Reviewed',
  'Tested',
  'Gamertested',
  'Carbontested',
  'Done',
] as const

type RoadmapMission = {
  id: number
  name: string
  status: string
  maturityLevel: number
  priority: number
  assignedTo: string | null
  updatedAt: Date
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function roadmapBandForMission(mission: Pick<RoadmapMission, 'status' | 'maturityLevel'>): number {
  if (mission.status === 'done') return 9
  return Math.max(0, Math.min(8, mission.maturityLevel || 0))
}

function topMissionSummary(missions: RoadmapMission[]): string {
  if (missions.length === 0) return 'No missions'
  return missions
    .slice(0, 3)
    .map(mission => `#${mission.id} ${mission.name}`.slice(0, 42))
    .join('\n')
}

function buildRoadmapScene(missions: RoadmapMission[]): CraftedScene {
  const grouped = Array.from({ length: BAND_LABELS.length }, () => [] as RoadmapMission[])
  for (const mission of missions) {
    grouped[roadmapBandForMission(mission)].push(mission)
  }

  for (const bucket of grouped) {
    bucket.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })
  }

  const objects: CraftedScene['objects'] = [
    {
      type: 'text',
      text: 'ANORAK PRO ROADMAP',
      position: [0, 5.5, -16],
      scale: [1, 1, 1],
      color: '#e2fdf7',
      emissive: '#14b8a6',
      emissiveIntensity: 0.9,
      fontSize: 1.8,
      anchorX: 'center',
      anchorY: 'middle',
    },
    {
      type: 'text',
      text: `Updated ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`,
      position: [0, 4.2, -16],
      scale: [1, 1, 1],
      color: '#94a3b8',
      emissive: '#0f766e',
      emissiveIntensity: 0.4,
      fontSize: 0.7,
      anchorX: 'center',
      anchorY: 'middle',
    },
  ]

  grouped.forEach((bucket, index) => {
    const column = index < 5 ? -12 : 12
    const row = index % 5
    const z = -8 + row * 5
    const count = bucket.length
    const accent = count > 0 ? '#14b8a6' : '#1f2937'

    objects.push(
      {
        type: 'box',
        position: [column, 0.4, z],
        scale: [8.5, 0.8, 4.2],
        color: '#0f172a',
        emissive: accent,
        emissiveIntensity: count > 0 ? 0.18 : 0.05,
        roughness: 0.7,
        metalness: 0.05,
      },
      {
        type: 'text',
        text: BAND_LABELS[index],
        position: [column, 2.1, z - 1.1],
        scale: [1, 1, 1],
        color: '#e2e8f0',
        emissive: accent,
        emissiveIntensity: 0.35,
        fontSize: 0.78,
        anchorX: 'center',
        anchorY: 'middle',
      },
      {
        type: 'text',
        text: `${count} missions`,
        position: [column, 1.25, z],
        scale: [1, 1, 1],
        color: count > 0 ? '#5eead4' : '#64748b',
        emissive: accent,
        emissiveIntensity: 0.3,
        fontSize: 0.56,
        anchorX: 'center',
        anchorY: 'middle',
      },
      {
        type: 'text',
        text: topMissionSummary(bucket),
        position: [column, 0.95, z + 0.95],
        scale: [1, 1, 1],
        color: '#cbd5e1',
        emissive: '#0f766e',
        emissiveIntensity: 0.18,
        fontSize: 0.34,
        anchorX: 'center',
        anchorY: 'middle',
      },
    )
  })

  return {
    id: 'anorak-pro-roadmap-scene',
    name: 'Anorak Pro Roadmap',
    prompt: 'Auto-generated mission roadmap scene',
    position: [0, 0, 0],
    createdAt: new Date().toISOString(),
    objects,
  }
}

function buildRoadmapLights(): WorldLight[] {
  const defaults = DEFAULT_WORLD_LIGHTS.map((light, index) => ({
    ...light,
    id: `roadmap-light-${light.type}-${index}`,
    visible: true,
  })) as WorldLight[]

  defaults.push({
    id: 'roadmap-light-directional-main',
    type: 'directional',
    color: '#f8fafc',
    intensity: 1.25,
    position: [0, 14, 10],
    target: [0, 0, 0],
    castShadow: false,
    visible: true,
  })

  return defaults
}

async function resolveRoadmapWorldId(userId: string): Promise<{ worldId: string; created: boolean }> {
  const existing = await prisma.world.findFirst({
    where: { userId, name: ROADMAP_WORLD_NAME },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  if (existing) return { worldId: existing.id, created: false }

  const meta = await createWorld(ROADMAP_WORLD_NAME, ROADMAP_WORLD_ICON, userId)
  return { worldId: meta.id, created: true }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getOasisUserId(request)
    const body = await request.json().catch(() => ({})) as { avatarUrl?: unknown }
    const avatarUrl = sanitizeString(body.avatarUrl)

    const missions = await prisma.mission.findMany({
      where: { status: { not: 'archived' } },
      select: {
        id: true,
        name: true,
        status: true,
        maturityLevel: true,
        priority: true,
        assignedTo: true,
        updatedAt: true,
      },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
      take: 400,
    }) as RoadmapMission[]

    const { worldId, created } = await resolveRoadmapWorldId(userId)
    await prisma.world.update({
      where: { id: worldId },
      data: { name: ROADMAP_WORLD_NAME, icon: ROADMAP_WORLD_ICON },
    })

    await saveWorld(worldId, userId, {
      terrain: null,
      groundPresetId: 'none',
      groundTiles: {},
      craftedScenes: [buildRoadmapScene(missions)],
      conjuredAssetIds: [],
      catalogPlacements: [],
      transforms: {},
      behaviors: {},
      lights: buildRoadmapLights(),
      skyBackgroundId: undefined,
      agentWindows: [],
      agentAvatars: avatarUrl ? [{
        id: 'agent-avatar-anorak-pro-roadmap',
        agentType: 'anorak-pro',
        avatar3dUrl: avatarUrl,
        position: [0, 0, 15],
        rotation: [0, Math.PI, 0],
        scale: 1,
        label: 'Anorak Pro',
      }] : [],
    })

    return NextResponse.json({
      ok: true,
      worldId,
      created,
      missionCount: missions.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[anorak-pro-roadmap-world] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
