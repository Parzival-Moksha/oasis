import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'

import {
  DEFAULT_TOP_MISSION_COUNT,
  normalizeCustomModules,
  normalizeLobeModules,
  normalizeModuleValues,
  normalizeTopMissionCount,
  type CustomContextModule,
  type LobeModuleMap,
} from '@/lib/anorak-context-config'

const STORED_CONFIG_PATH = path.join(process.cwd(), 'data', 'anorak-pro.local.json')

export interface StoredAnorakProContextConfig {
  customModules: CustomContextModule[]
  lobeModules: LobeModuleMap
  topMissionCount: number
  moduleValues: Record<string, number>
  updatedAt: string
}

function createDefaultStoredConfig(): StoredAnorakProContextConfig {
  const customModules: CustomContextModule[] = []
  return {
    customModules,
    lobeModules: normalizeLobeModules(null, customModules),
    topMissionCount: DEFAULT_TOP_MISSION_COUNT,
    moduleValues: {},
    updatedAt: '',
  }
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function sanitizeStoredConfig(raw: unknown): StoredAnorakProContextConfig {
  const parsed = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const customModules = normalizeCustomModules(parsed.customModules)

  return {
    customModules,
    lobeModules: normalizeLobeModules(parsed.lobeModules, customModules),
    topMissionCount: normalizeTopMissionCount(parsed.topMissionCount),
    moduleValues: normalizeModuleValues(parsed.moduleValues),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function readStoredAnorakProContextConfig(): Promise<StoredAnorakProContextConfig> {
  try {
    const raw = await fs.readFile(STORED_CONFIG_PATH, 'utf8')
    return sanitizeStoredConfig(JSON.parse(stripUtf8Bom(raw)) as unknown)
  } catch {
    return createDefaultStoredConfig()
  }
}

export async function writeStoredAnorakProContextConfig(input: {
  customModules?: unknown
  lobeModules?: unknown
  topMissionCount?: unknown
  moduleValues?: unknown
}): Promise<StoredAnorakProContextConfig> {
  const customModules = normalizeCustomModules(input.customModules)
  const next: StoredAnorakProContextConfig = {
    customModules,
    lobeModules: normalizeLobeModules(input.lobeModules, customModules),
    topMissionCount: normalizeTopMissionCount(input.topMissionCount),
    moduleValues: normalizeModuleValues(input.moduleValues),
    updatedAt: new Date().toISOString(),
  }

  await writeJsonFile(STORED_CONFIG_PATH, next)
  return next
}
