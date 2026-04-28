import 'server-only'

import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, isAbsolute, join, resolve } from 'path'

export interface CodexModelOption {
  id: string
  label: string
  description: string
  defaultReasoningLevel: string
  supportedReasoningLevels: string[]
  supportedInApi: boolean
  visibility: string
}

export interface ParsedCodexConfig {
  model?: string
  modelCatalogJson?: string
  profile?: string
  profiles: Record<string, {
    model?: string
    modelCatalogJson?: string
  }>
}

export interface ResolvedCodexConfigValue {
  value?: string
  source: 'project' | 'user' | null
}

export interface CodexModelSettings {
  models: CodexModelOption[]
  defaultModel: string
  configuredModel?: string
  configuredModelSource: 'project' | 'user' | 'recommended' | 'fallback'
  catalogPath: string | null
  fetchedAt: string | null
}

interface RawCodexCatalog {
  fetched_at?: unknown
  models?: unknown
}

interface RawCodexModel {
  slug?: unknown
  display_name?: unknown
  description?: unknown
  default_reasoning_level?: unknown
  supported_reasoning_levels?: unknown
  supported_in_api?: unknown
  visibility?: unknown
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') {
      return line.slice(0, index)
    }
  }

  return line
}

function parseTomlValue(rawValue: string): string {
  const value = rawValue.trim()
  if (!value) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const body = value.slice(1, -1)
    if (value.startsWith("'")) return body
    return body
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
  }
  return value
}

function parseSectionName(rawSection: string): { kind: 'root' | 'profile' | 'other'; profileName?: string } {
  const section = rawSection.trim()
  if (!section) return { kind: 'root' }
  if (!section.startsWith('profiles.')) return { kind: 'other' }

  const profileName = section.slice('profiles.'.length).trim()
  if (!profileName) return { kind: 'other' }
  return {
    kind: 'profile',
    profileName: parseTomlValue(profileName),
  }
}

export function parseCodexConfig(raw: string): ParsedCodexConfig {
  const parsed: ParsedCodexConfig = { profiles: {} }
  let section: { kind: 'root' | 'profile' | 'other'; profileName?: string } = { kind: 'root' }

  for (const line of raw.split(/\r?\n/)) {
    const cleaned = stripTomlComment(line).trim()
    if (!cleaned) continue

    const sectionMatch = cleaned.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      section = parseSectionName(sectionMatch[1])
      continue
    }

    const entryMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/)
    if (!entryMatch) continue

    const key = entryMatch[1]
    const value = parseTomlValue(entryMatch[2])
    if (!value) continue

    if (section.kind === 'root') {
      if (key === 'model') parsed.model = value
      if (key === 'model_catalog_json') parsed.modelCatalogJson = value
      if (key === 'profile') parsed.profile = value
      continue
    }

    if (section.kind === 'profile' && section.profileName) {
      const profile = parsed.profiles[section.profileName] || {}
      if (key === 'model') profile.model = value
      if (key === 'model_catalog_json') profile.modelCatalogJson = value
      parsed.profiles[section.profileName] = profile
    }
  }

  return parsed
}

export function resolveCodexConfigValue(
  projectConfig: ParsedCodexConfig | null,
  userConfig: ParsedCodexConfig | null,
  key: 'model' | 'modelCatalogJson',
): ResolvedCodexConfigValue {
  const activeProfile = projectConfig?.profile || userConfig?.profile || ''

  if (activeProfile) {
    const projectProfileValue = projectConfig?.profiles[activeProfile]?.[key]
    if (projectProfileValue) {
      return { value: projectProfileValue, source: 'project' }
    }
  }

  const projectValue = projectConfig?.[key]
  if (projectValue) {
    return { value: projectValue, source: 'project' }
  }

  if (activeProfile) {
    const userProfileValue = userConfig?.profiles[activeProfile]?.[key]
    if (userProfileValue) {
      return { value: userProfileValue, source: 'user' }
    }
  }

  const userValue = userConfig?.[key]
  if (userValue) {
    return { value: userValue, source: 'user' }
  }

  return { source: null }
}

function expandCodexPath(rawPath: string, configPath: string): string {
  if (!rawPath) return rawPath
  const home = homedir()
  const expanded = rawPath.startsWith('~/') || rawPath === '~'
    ? join(home, rawPath.slice(2))
    : rawPath
  if (isAbsolute(expanded)) return expanded
  return resolve(dirname(configPath), expanded)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function normalizeReasoningLevels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(entry => asString(asRecord(entry).effort || entry))
    .filter(Boolean)
}

export function normalizeCodexModelCatalog(catalog: unknown, configuredModel?: string): CodexModelOption[] {
  const rawCatalog = asRecord(catalog) as RawCodexCatalog
  const rawModels = Array.isArray(rawCatalog.models) ? rawCatalog.models as RawCodexModel[] : []
  const seen = new Set<string>()

  const models: CodexModelOption[] = []
  for (const rawModel of rawModels) {
    const id = asString(rawModel.slug)
    if (!id || seen.has(id)) continue
    const visibility = asString(rawModel.visibility) || 'list'
    if (visibility === 'hidden') continue

    seen.add(id)
    models.push({
      id,
      label: asString(rawModel.display_name) || id,
      description: asString(rawModel.description),
      defaultReasoningLevel: asString(rawModel.default_reasoning_level),
      supportedReasoningLevels: normalizeReasoningLevels(rawModel.supported_reasoning_levels),
      supportedInApi: asBoolean(rawModel.supported_in_api),
      visibility,
    })
  }

  const safeConfiguredModel = configuredModel?.trim()
  if (safeConfiguredModel && !seen.has(safeConfiguredModel)) {
    models.unshift({
      id: safeConfiguredModel,
      label: safeConfiguredModel,
      description: 'Configured in local Codex config',
      defaultReasoningLevel: '',
      supportedReasoningLevels: [],
      supportedInApi: false,
      visibility: 'configured',
    })
  }

  return models
}

export function chooseRecommendedCodexModel(models: CodexModelOption[]): string {
  return models.find(model => model.visibility === 'list')?.id || models[0]?.id || 'gpt-5.4'
}

async function readCodexConfig(path: string): Promise<ParsedCodexConfig | null> {
  if (!existsSync(path)) return null
  try {
    return parseCodexConfig(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

export async function resolveCodexModelSettings(): Promise<CodexModelSettings> {
  const projectConfigPath = join(process.cwd(), '.codex', 'config.toml')
  const userConfigPath = join(homedir(), '.codex', 'config.toml')

  const [projectConfig, userConfig] = await Promise.all([
    readCodexConfig(projectConfigPath),
    readCodexConfig(userConfigPath),
  ])

  const configuredModel = resolveCodexConfigValue(projectConfig, userConfig, 'model')
  const configuredCatalog = resolveCodexConfigValue(projectConfig, userConfig, 'modelCatalogJson')

  const catalogPath = configuredCatalog.value
    ? expandCodexPath(
        configuredCatalog.value,
        configuredCatalog.source === 'project' ? projectConfigPath : userConfigPath,
      )
    : join(homedir(), '.codex', 'models_cache.json')

  const rawCatalog = await readJsonFile(catalogPath)
  const models = normalizeCodexModelCatalog(rawCatalog, configuredModel.value)
  const recommendedModel = chooseRecommendedCodexModel(models)
  const defaultModel = configuredModel.value || recommendedModel || 'gpt-5.4'
  const fetchedAt = asString(asRecord(rawCatalog).fetched_at) || null

  return {
    models: models.length > 0 ? models : [{
      id: defaultModel,
      label: defaultModel,
      description: '',
      defaultReasoningLevel: '',
      supportedReasoningLevels: [],
      supportedInApi: false,
      visibility: 'fallback',
    }],
    defaultModel,
    configuredModel: configuredModel.value,
    configuredModelSource: configuredModel.source || (models.length > 0 ? 'recommended' : 'fallback'),
    catalogPath: catalogPath || null,
    fetchedAt,
  }
}
