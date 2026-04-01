import { promises as fs } from 'fs'
import path from 'path'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  BUILT_IN_MODULE_IDS,
  DEFAULT_TOP_MISSION_COUNT,
  getModuleValue,
  type AnorakLobe,
  type CustomContextModule,
  type LobeModuleMap,
} from '@/lib/anorak-context-config'

export {
  ANORAK_LOBES,
  BUILT_IN_MODULE_IDS,
  DEFAULT_LEGACY_CONTEXT_MODULES,
  DEFAULT_LOBE_MODULES,
  DEFAULT_TOP_MISSION_COUNT,
  deriveLegacyContextModules,
  getContextModuleCatalog,
  getDefaultConfigFields,
  getModuleValue,
  isAnorakLobe,
  mergeContextConfig,
  normalizeContextConfig,
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeModuleValues,
  normalizeTopMissionCount,
  type AnorakLobe,
  type ContextModuleCatalogEntry,
  type CustomContextModule,
  type LegacyContextModules,
  type LobeModuleMap,
} from '@/lib/anorak-context-config'

export interface ResolvedContextModule {
  id: string
  name: string
  description: string
  kind: 'builtin' | 'custom'
  content: string
  filePath?: string
}

interface MissionContextRow {
  id: number
  name: string
  description: string | null
  carbonDescription: string | null
  siliconDescription: string | null
  flawlessPercent: number | null
  dharmaPath: string | null
  priority: number | null
  assignedTo: string | null
  status: string
  maturityLevel: number
}

const MAX_FILE_MODULE_CONTENT = 400000

function describeMission(mission: MissionContextRow): string {
  const lines: string[] = [
    `### #${mission.id} | m${mission.maturityLevel} | ${mission.status} | pri ${mission.priority?.toFixed(2) ?? '?'} | ${mission.assignedTo ?? '-'}${mission.flawlessPercent != null ? ` | ${mission.flawlessPercent}% flawless` : ''}`,
    mission.name,
  ]
  // Include all available descriptions — be generous with context
  const carbon = mission.carbonDescription?.trim()
  const silicon = mission.siliconDescription?.trim()
  const desc = mission.description?.trim()
  if (carbon) lines.push(`Carbon: ${carbon.slice(0, 500)}`)
  else if (desc) lines.push(`Desc: ${desc.slice(0, 300)}`)
  if (silicon) lines.push(`Silicon: ${silicon.slice(0, 800)}`)
  if (mission.dharmaPath) lines.push(`Dharma: ${mission.dharmaPath}`)
  return lines.join('\n')
}

function formatMissionBlock(title: string, missions: MissionContextRow[]): string {
  if (missions.length === 0) return `${title}\n(none)`
  return `${title}\n${missions.map(describeMission).join('\n\n')}`
}

async function fetchMissionRows(where: Prisma.MissionWhereInput, take?: number): Promise<MissionContextRow[]> {
  return prisma.mission.findMany({
    where,
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'asc' },
    ],
    take,
    select: {
      id: true,
      name: true,
      description: true,
      carbonDescription: true,
      siliconDescription: true,
      flawlessPercent: true,
      dharmaPath: true,
      priority: true,
      assignedTo: true,
      status: true,
      maturityLevel: true,
    },
  })
}

async function readLinkedFile(filePath: string): Promise<{ filePath: string; content: string }> {
  const target = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath)

  // Sandbox: only allow reads within OASIS_ROOT or user home
  const oasisRoot = path.resolve(process.cwd())
  const userHome = process.env.USERPROFILE || process.env.HOME || oasisRoot
  const resolved = path.resolve(target)
  if (!resolved.startsWith(oasisRoot) && !resolved.startsWith(path.resolve(userHome))) {
    throw new Error(`File path must be within project root or user home: ${resolved}`)
  }

  const content = await fs.readFile(target, 'utf8')
  const exactContent = content.length > MAX_FILE_MODULE_CONTENT
    ? `${content.slice(0, MAX_FILE_MODULE_CONTENT)}\n\n[truncated to ${MAX_FILE_MODULE_CONTENT} chars for prompt safety]`
    : content

  return { filePath: target, content: exactContent }
}

async function resolveBuiltInModule(id: string, moduleValues: Record<string, number>): Promise<ResolvedContextModule | null> {
  switch (id) {
    case BUILT_IN_MODULE_IDS.rl: {
      // Actually resolve the RL file content instead of just an instruction
      const rlPath = path.resolve(process.cwd(), 'context', 'curator-rl.md')
      let rlContent: string
      try {
        const raw = await fs.readFile(rlPath, 'utf8')
        rlContent = raw.length > MAX_FILE_MODULE_CONTENT
          ? `${raw.slice(0, MAX_FILE_MODULE_CONTENT)}\n\n[truncated]`
          : raw
      } catch {
        rlContent = '(curator-rl.md not found — no RL signal available yet. Complete some missions to generate it.)'
      }
      return {
        id,
        name: 'RL Signal',
        description: 'Curator reinforcement learning patterns from done missions',
        kind: 'builtin',
        content: rlContent,
      }
    }
    case BUILT_IN_MODULE_IDS.queued: {
      const missions = await fetchMissionRows({
        status: { not: 'done' },
        maturityLevel: { lt: 3 },
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      })
      return {
        id,
        name: 'Queued Missions',
        description: 'Queued curator backlog',
        kind: 'builtin',
        content: formatMissionBlock('Queued curator missions:', missions),
      }
    }
    case BUILT_IN_MODULE_IDS.allTodo: {
      const missions = await fetchMissionRows({ status: 'todo' })
      return {
        id,
        name: 'All TODO Missions',
        description: 'Whole TODO backlog',
        kind: 'builtin',
        content: formatMissionBlock('All TODO missions:', missions),
      }
    }
    case BUILT_IN_MODULE_IDS.anorakTodo: {
      const missions = await fetchMissionRows({
        status: 'todo',
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      })
      return {
        id,
        name: 'Anorak TODO Missions',
        description: 'TODO missions assigned to anorak/anorak-pro',
        kind: 'builtin',
        content: formatMissionBlock('Anorak TODO missions:', missions),
      }
    }
    case BUILT_IN_MODULE_IDS.topAnorak: {
      const count = getModuleValue(moduleValues, BUILT_IN_MODULE_IDS.topAnorak, DEFAULT_TOP_MISSION_COUNT)
      const missions = await fetchMissionRows({
        status: 'todo',
        assignedTo: { in: ['anorak', 'anorak-pro'] },
      }, count)
      return {
        id,
        name: 'Top Anorak Missions',
        description: 'Highest-priority anorak/anorak-pro TODO missions',
        kind: 'builtin',
        content: formatMissionBlock(`Top ${count} anorak TODO missions:`, missions),
      }
    }
    default:
      return null
  }
}

export async function resolveContextModulesForLobe(options: {
  lobe: AnorakLobe
  customModules: CustomContextModule[]
  lobeModules: LobeModuleMap
  topMissionCount?: number
  moduleValues?: Record<string, number>
}): Promise<ResolvedContextModule[]> {
  const selectedIds = options.lobeModules[options.lobe] || []
  const resolved: ResolvedContextModule[] = []

  for (const id of selectedIds) {
    const custom = options.customModules.find(mod => mod.id === id)
    if (custom) {
      if (custom.enabled === false) continue

      if (custom.type === 'file' && custom.filePath.trim()) {
        try {
          const linked = await readLinkedFile(custom.filePath)
          resolved.push({
            id: custom.id,
            name: custom.name,
            description: 'Linked file module',
            kind: 'custom',
            filePath: linked.filePath,
            content: linked.content,
          })
        } catch (error) {
          resolved.push({
            id: custom.id,
            name: custom.name,
            description: 'Linked file module',
            kind: 'custom',
            filePath: custom.filePath,
            content: `Failed to read linked file: ${(error as Error).message}`,
          })
        }
        continue
      }

      if (custom.content.trim()) {
        resolved.push({
          id: custom.id,
          name: custom.name,
          description: 'Saved text module',
          kind: 'custom',
          content: custom.content.trim(),
        })
      }
      continue
    }

    // Merge legacy topMissionCount into moduleValues for backward compat
    const values: Record<string, number> = { ...(options.moduleValues || {}) }
    if (options.topMissionCount !== undefined && !(BUILT_IN_MODULE_IDS.topAnorak in values)) {
      values[BUILT_IN_MODULE_IDS.topAnorak] = options.topMissionCount
    }
    const builtIn = await resolveBuiltInModule(id, values)
    if (builtIn) resolved.push(builtIn)
  }

  return resolved
}

export function renderContextModuleSections(modules: ResolvedContextModule[]): string {
  if (modules.length === 0) return ''
  return modules.map(mod => {
    const sourceLine = mod.filePath ? `Source: ${mod.filePath}\n` : ''
    return `## Context Module: ${mod.name}\n${sourceLine}${mod.content}`
  }).join('\n\n')
}
