export const ANORAK_LOBES = ['curator', 'coder', 'reviewer', 'tester', 'gamer'] as const

export type AnorakLobe = typeof ANORAK_LOBES[number]

export const BUILT_IN_MODULE_IDS = {
  rl: 'builtin:curator-rl',
  queued: 'builtin:queued-missions',
  allTodo: 'builtin:all-todo-missions',
  anorakTodo: 'builtin:anorak-todo-missions',
  topAnorak: 'builtin:top-anorak-missions',
} as const

export interface CustomContextModule {
  id: string
  name: string
  content: string
  enabled: boolean
  type: 'text' | 'file'
  filePath: string
}

export interface LegacyContextModules {
  rl: boolean
  queued: boolean
  allTodo: boolean
}

export interface LobeModuleMap {
  curator: string[]
  coder: string[]
  reviewer: string[]
  tester: string[]
  gamer: string[]
}

export interface ContextModuleCatalogEntry {
  id: string
  name: string
  description: string
  kind: 'builtin' | 'custom' | 'system'
  color: string
  type?: 'text' | 'file'
  filePath?: string
  parameterized?: boolean
}

const MAX_CUSTOM_MODULES = 20
const MAX_MODULE_NAME = 100
const MAX_MODULE_CONTENT = 400000

export const DEFAULT_LEGACY_CONTEXT_MODULES: LegacyContextModules = {
  rl: true,
  queued: true,
  allTodo: false,
}

export const DEFAULT_LOBE_MODULES: LobeModuleMap = {
  curator: [BUILT_IN_MODULE_IDS.rl, BUILT_IN_MODULE_IDS.queued],
  coder: [],
  reviewer: [],
  tester: [],
  gamer: [],
}

export const DEFAULT_TOP_MISSION_COUNT = 3

export function normalizeModuleValues(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(val)
    if (Number.isFinite(n)) out[key] = Math.min(50, Math.max(1, Math.round(n)))
  }
  return out
}

export function getModuleValue(moduleValues: Record<string, number>, moduleId: string, fallback: number = DEFAULT_TOP_MISSION_COUNT): number {
  return moduleValues[moduleId] ?? fallback
}

const BUILT_IN_MODULES: ContextModuleCatalogEntry[] = [
  {
    id: BUILT_IN_MODULE_IDS.rl,
    name: 'RL Signal',
    description: 'Ask curator to ingest curator-rl.md when present.',
    kind: 'builtin',
    color: '#14b8a6',
  },
  {
    id: BUILT_IN_MODULE_IDS.queued,
    name: 'Queued Missions',
    description: 'All queued anorak/anorak-pro missions waiting on curation.',
    kind: 'builtin',
    color: '#0ea5e9',
  },
  {
    id: BUILT_IN_MODULE_IDS.allTodo,
    name: 'All TODO Missions',
    description: 'Every TODO mission in the local mission database.',
    kind: 'builtin',
    color: '#22c55e',
  },
  {
    id: BUILT_IN_MODULE_IDS.anorakTodo,
    name: 'Anorak TODO Missions',
    description: 'All TODO missions currently assigned to anorak/anorak-pro.',
    kind: 'builtin',
    color: '#f59e0b',
  },
  {
    id: BUILT_IN_MODULE_IDS.topAnorak,
    name: 'Top Anorak Missions',
    description: 'Top N highest-priority anorak TODO missions (sorted by U×E×I score).',
    kind: 'builtin',
    color: '#fb7185',
    parameterized: true,
  },
]

function sanitizeModuleName(name: string, index: number): string {
  const trimmed = name.replace(/[#\n\r]/g, '').trim().slice(0, MAX_MODULE_NAME)
  return trimmed || `Module ${index + 1}`
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function stableHash(value: string): string {
  let hash = 0
  for (const ch of value) {
    hash = ((hash << 5) - hash) + ch.charCodeAt(0)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function ensureModuleId(rawId: string | undefined, name: string, type: 'text' | 'file', filePath: string, content: string, index: number): string {
  const cleaned = typeof rawId === 'string' ? rawId.trim() : ''
  if (cleaned) return cleaned.slice(0, 80)
  const slug = slugify(name)
  const signature = stableHash(`${type}:${name}:${filePath}:${content.slice(0, 120)}`)
  return `custom:${slug || `module-${index + 1}`}:${signature}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)))
}

export function isAnorakLobe(value: string): value is AnorakLobe {
  return (ANORAK_LOBES as readonly string[]).includes(value)
}

function isKnownModuleId(id: string, customModules: CustomContextModule[]): boolean {
  return BUILT_IN_MODULES.some(mod => mod.id === id) || customModules.some(mod => mod.id === id && mod.enabled !== false)
}

export function normalizeTopMissionCount(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_TOP_MISSION_COUNT
  return Math.min(10, Math.max(1, Math.round(n)))
}

export function normalizeCustomModules(raw: unknown): CustomContextModule[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((mod): mod is Record<string, unknown> => !!mod && typeof mod === 'object')
    .slice(0, MAX_CUSTOM_MODULES)
    .map((mod, index) => {
      const name = sanitizeModuleName(asString(mod.name), index)
      const type = mod.type === 'file' ? 'file' : 'text'
      const filePath = asString(mod.filePath).slice(0, 300)
      const content = asString(mod.content).slice(0, MAX_MODULE_CONTENT)
      return {
        id: ensureModuleId(asString(mod.id), name, type, filePath, content, index),
        name,
        content,
        enabled: mod.enabled !== false,
        type,
        filePath,
      }
    })
}

function normalizeRequestedLobeModules(raw: unknown, customModules: CustomContextModule[]): Partial<LobeModuleMap> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Partial<LobeModuleMap> = {}
  for (const [lobe, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAnorakLobe(lobe)) continue
    const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    out[lobe] = uniqueIds(ids).filter(id => isKnownModuleId(id, customModules))
  }
  return out
}

export function deriveLegacyContextModules(lobeModules: LobeModuleMap): LegacyContextModules {
  return {
    rl: lobeModules.curator.includes(BUILT_IN_MODULE_IDS.rl),
    queued: lobeModules.curator.includes(BUILT_IN_MODULE_IDS.queued),
    allTodo: lobeModules.curator.includes(BUILT_IN_MODULE_IDS.allTodo),
  }
}

export function normalizeLobeModules(
  raw: unknown,
  customModules: CustomContextModule[],
  legacy?: Partial<LegacyContextModules>,
  fallback: LobeModuleMap = DEFAULT_LOBE_MODULES,
): LobeModuleMap {
  const requested = normalizeRequestedLobeModules(raw, customModules)
  if (requested) {
    return {
      curator: requested.curator ?? fallback.curator,
      coder: requested.coder ?? fallback.coder,
      reviewer: requested.reviewer ?? fallback.reviewer,
      tester: requested.tester ?? fallback.tester,
      gamer: requested.gamer ?? fallback.gamer,
    }
  }

  const curatorDefaults = [...DEFAULT_LOBE_MODULES.curator]
  if (legacy?.rl === false) {
    const idx = curatorDefaults.indexOf(BUILT_IN_MODULE_IDS.rl)
    if (idx >= 0) curatorDefaults.splice(idx, 1)
  }
  if (legacy?.queued === false) {
    const idx = curatorDefaults.indexOf(BUILT_IN_MODULE_IDS.queued)
    if (idx >= 0) curatorDefaults.splice(idx, 1)
  }
  if (legacy?.allTodo) curatorDefaults.push(BUILT_IN_MODULE_IDS.allTodo)

  const legacyCustomIds = customModules.filter(mod => mod.enabled).map(mod => mod.id)

  return {
    curator: uniqueIds([...curatorDefaults, ...legacyCustomIds]),
    coder: [],
    reviewer: [],
    tester: [],
    gamer: [],
  }
}

export function getContextModuleCatalog(customModules: CustomContextModule[]): ContextModuleCatalogEntry[] {
  return [
    ...BUILT_IN_MODULES,
    ...customModules.map(mod => ({
      id: mod.id,
      name: mod.name,
      description: mod.type === 'file'
        ? `Linked file module${mod.filePath ? `: ${mod.filePath}` : ''}`
        : 'Saved free-text module.',
      kind: 'custom' as const,
      color: mod.type === 'file' ? '#f59e0b' : '#22c55e',
      type: mod.type,
      filePath: mod.filePath || undefined,
    })),
  ]
}

export function getDefaultConfigFields() {
  return {
    contextModules: DEFAULT_LEGACY_CONTEXT_MODULES,
    customModules: [] as CustomContextModule[],
    lobeModules: DEFAULT_LOBE_MODULES,
    topMissionCount: DEFAULT_TOP_MISSION_COUNT,
    moduleValues: {} as Record<string, number>,
  }
}

export function normalizeContextConfig<T extends {
  models?: Record<string, string>
  contextModules?: unknown
  customModules?: unknown
  lobeModules?: unknown
  topMissionCount?: unknown
  moduleValues?: unknown
}>(saved: T | null | undefined, defaults: Omit<T, 'contextModules' | 'customModules' | 'lobeModules' | 'topMissionCount' | 'moduleValues'> & {
  contextModules: LegacyContextModules
  customModules: CustomContextModule[]
  lobeModules: LobeModuleMap
  topMissionCount: number
  moduleValues: Record<string, number>
}): typeof defaults {
  if (!saved) return defaults

  const customModules = normalizeCustomModules(saved.customModules)
  const lobeModules = normalizeLobeModules(saved.lobeModules, customModules, saved.contextModules as Partial<LegacyContextModules> | undefined, defaults.lobeModules)
  const contextModules = deriveLegacyContextModules(lobeModules)

  return {
    ...defaults,
    ...saved,
    ...(typeof defaults.models === 'object' ? {
      models: {
        ...defaults.models,
        ...((saved as { models?: Record<string, string> }).models || {}),
      },
    } : {}),
    customModules,
    lobeModules,
    contextModules,
    topMissionCount: normalizeTopMissionCount(saved.topMissionCount),
    moduleValues: normalizeModuleValues(saved.moduleValues),
  }
}

export function mergeContextConfig<T extends {
  models?: Record<string, string>
  contextModules: LegacyContextModules
  customModules: CustomContextModule[]
  lobeModules: LobeModuleMap
  topMissionCount: number
  moduleValues: Record<string, number>
}>(current: T, partial: Partial<Omit<T, 'models'>> & { models?: Record<string, string> }): T {
  const customModules = partial.customModules !== undefined
    ? normalizeCustomModules(partial.customModules)
    : current.customModules

  const lobeModules = partial.lobeModules !== undefined
    ? normalizeLobeModules(partial.lobeModules, customModules, partial.contextModules as Partial<LegacyContextModules> | undefined, current.lobeModules)
    : normalizeLobeModules(current.lobeModules, customModules, current.contextModules)

  return {
    ...current,
    ...partial,
    ...(current.models || partial.models ? {
      models: {
        ...(current.models || {}),
        ...(partial.models || {}),
      },
    } : {}),
    customModules,
    lobeModules,
    contextModules: deriveLegacyContextModules(lobeModules),
    topMissionCount: normalizeTopMissionCount(partial.topMissionCount ?? current.topMissionCount),
    moduleValues: normalizeModuleValues(partial.moduleValues ?? current.moduleValues),
  }
}
