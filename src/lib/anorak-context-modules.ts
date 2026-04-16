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
const LINKED_FILE_SEARCH_SKIP_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'generated-images',
  'generated-videos',
  'generated-voices',
  'coverage',
  'dist',
  'build',
])
const LINKED_FILE_SEARCH_PRIORITY_PREFIXES = ['carbondir', 'context', 'tools', 'docs']
const LINKED_FILE_SEARCH_MAX_DEPTH = 6
const LINKED_FILE_SEARCH_MAX_CANDIDATES = 24

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

  const toPromptSafeContent = (content: string) => {
    const exactContent = content.length > MAX_FILE_MODULE_CONTENT
      ? `${content.slice(0, MAX_FILE_MODULE_CONTENT)}\n\n[truncated to ${MAX_FILE_MODULE_CONTENT} chars for prompt safety]`
      : content
    return exactContent
  }

  const readCandidate = async (candidatePath: string) => {
    const candidateResolved = path.resolve(candidatePath)
    if (!candidateResolved.startsWith(oasisRoot) && !candidateResolved.startsWith(path.resolve(userHome))) {
      throw new Error(`File path must be within project root or user home: ${candidateResolved}`)
    }

    const content = await fs.readFile(candidateResolved, 'utf8')
    return { filePath: candidateResolved, content: toPromptSafeContent(content) }
  }

  const collectRepoMatches = async (
    rootDir: string,
    basename: string,
    depth = 0,
    matches: string[] = [],
  ): Promise<string[]> => {
    if (depth > LINKED_FILE_SEARCH_MAX_DEPTH || matches.length >= LINKED_FILE_SEARCH_MAX_CANDIDATES) return matches

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = []
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    } catch {
      return matches
    }

    for (const entry of entries) {
      if (matches.length >= LINKED_FILE_SEARCH_MAX_CANDIDATES) break
      if (LINKED_FILE_SEARCH_SKIP_DIRS.has(entry.name)) continue

      const entryPath = path.join(rootDir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === basename.toLowerCase()) {
        matches.push(entryPath)
        continue
      }

      if (entry.isDirectory()) {
        await collectRepoMatches(entryPath, basename, depth + 1, matches)
      }
    }

    return matches
  }

  const rankCandidate = (candidatePath: string): number => {
    const relative = path.relative(oasisRoot, candidatePath).replace(/\\/g, '/')
    const prefixIndex = LINKED_FILE_SEARCH_PRIORITY_PREFIXES.findIndex(prefix => relative === prefix || relative.startsWith(`${prefix}/`))
    const pathDepth = relative.split('/').length
    return (prefixIndex >= 0 ? prefixIndex * 100 : 900) + pathDepth
  }

  try {
    return await readCandidate(target)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
    if (path.isAbsolute(filePath) || (code !== 'ENOENT' && code !== 'ENOTDIR')) {
      throw error
    }
  }

  const trimmed = filePath.trim()
  const basename = path.basename(trimmed)
  if (!basename || basename !== trimmed) {
    throw new Error(`ENOENT: no such file or directory, open '${resolved}'`)
  }

  const preferredCandidates = LINKED_FILE_SEARCH_PRIORITY_PREFIXES.map(prefix => path.join(oasisRoot, prefix, basename))
  const discoveredCandidates = await collectRepoMatches(oasisRoot, basename)
  const fallbackCandidates = Array.from(new Set([...preferredCandidates, ...discoveredCandidates]))
    .filter(candidate => path.resolve(candidate) !== resolved)
    .sort((a, b) => rankCandidate(a) - rankCandidate(b))

  let lastError: unknown = null
  for (const candidate of fallbackCandidates) {
    try {
      return await readCandidate(candidate)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : ''
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      lastError = error
    }
  }

  if (lastError) throw lastError
  throw new Error(`ENOENT: no such file or directory, open '${resolved}'`)
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
    case BUILT_IN_MODULE_IDS.pipeline: {
      const [todo, wip, recentDone, immature] = await Promise.all([
        prisma.mission.findMany({ where: { status: 'todo' }, orderBy: { priority: 'desc' }, select: { id: true, name: true, maturityLevel: true, priority: true, assignedTo: true, dharmaPath: true } }),
        prisma.mission.findMany({ where: { status: 'wip' }, select: { id: true, name: true, executionPhase: true, executionRound: true, assignedTo: true } }),
        prisma.mission.findMany({ where: { status: 'done' }, orderBy: { endedAt: 'desc' }, take: 10, select: { id: true, name: true, reviewerScore: true, testerScore: true, valor: true, score: true, endedAt: true } }),
        prisma.mission.findMany({ where: { maturityLevel: { lt: 3 }, assignedTo: { in: ['anorak', 'anorak-pro'] } }, orderBy: { priority: 'desc' }, select: { id: true, name: true, maturityLevel: true, priority: true } }),
      ])
      const vaikhariCount = todo.filter(m => m.maturityLevel >= 3).length
      const dharmaCounts: Record<string, number> = {}
      for (const m of todo) {
        if (m.dharmaPath) for (const p of m.dharmaPath.split(',').map(s => s.trim())) dharmaCounts[p] = (dharmaCounts[p] || 0) + 1
      }
      const dharmaLines = Object.entries(dharmaCounts).sort(([, a], [, b]) => b - a).map(([p, c]) => `  ${p}: ${c}`)
      const lines = [
        `Total TODO: ${todo.length} (${vaikhariCount} vaikhari, ${todo.length - vaikhariCount} immature)`,
        `WIP: ${wip.length}${wip.length > 0 ? ` — ${wip.map(m => `#${m.id} "${m.name}" (${m.executionPhase || '?'} r${m.executionRound})`).join(', ')}` : ''}`,
        `Immature (curator queue): ${immature.length}${immature.length > 0 ? ` — ${immature.slice(0, 5).map(m => `#${m.id} m${m.maturityLevel}`).join(', ')}${immature.length > 5 ? '...' : ''}` : ''}`,
        `Recent done (last 10): ${recentDone.length > 0 ? recentDone.map(m => `#${m.id} (rev:${m.reviewerScore ?? '?'} test:${m.testerScore ?? '?'} valor:${m.valor ?? '?'})`).join(', ') : '(none)'}`,
        '',
        'Dharma distribution (TODO):',
        ...(dharmaLines.length > 0 ? dharmaLines : ['  (no dharma tags yet)']),
      ]
      return { id, name: 'Pipeline Status', description: 'Live pipeline snapshot', kind: 'builtin', content: lines.join('\n') }
    }
    case BUILT_IN_MODULE_IDS.memory: {
      const memoryPath = path.resolve(process.cwd(), 'tools', 'anorak-memory.md')
      let memoryContent: string
      try {
        const raw = await fs.readFile(memoryPath, 'utf8')
        memoryContent = raw.length > MAX_FILE_MODULE_CONTENT
          ? `${raw.slice(0, MAX_FILE_MODULE_CONTENT)}\n\n[truncated]`
          : raw
      } catch {
        memoryContent = '(anorak-memory.md not found — no persistent memory yet.)'
      }
      return {
        id,
        name: 'Anorak Memory',
        description: 'Persistent memory — ship targets, blockers, patterns, velocity',
        kind: 'builtin',
        content: memoryContent,
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
