import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'

export const DEFAULT_HERMES_API_BASE = 'http://127.0.0.1:8642/v1'
const STORED_CONFIG_PATH = path.join(process.cwd(), 'data', 'hermes-config.local.json')

export interface HermesStoredConfig {
  apiBase: string
  apiKey: string
  defaultModel: string
  systemPrompt: string
  updatedAt: string
}

export interface HermesResolvedConfig {
  apiBase: string
  apiKey: string
  defaultModel: string
  systemPrompt: string
  source: 'pairing' | 'env' | 'none'
  updatedAt?: string
}

interface WriteHermesConfigInput {
  apiBase: string
  apiKey: string
  defaultModel?: string
  systemPrompt?: string
}

export function normalizeHermesApiBase(rawBase: string | undefined): string {
  const trimmed = (rawBase || DEFAULT_HERMES_API_BASE).trim().replace(/\/+$/, '')
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeStoredConfig(raw: unknown): HermesStoredConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const apiKey = sanitizeString(obj.apiKey)
  if (!apiKey) return null

  return {
    apiBase: normalizeHermesApiBase(sanitizeString(obj.apiBase) || DEFAULT_HERMES_API_BASE),
    apiKey,
    defaultModel: sanitizeString(obj.defaultModel),
    systemPrompt: sanitizeString(obj.systemPrompt),
    updatedAt: sanitizeString(obj.updatedAt) || new Date().toISOString(),
  }
}

export async function readStoredHermesConfig(): Promise<HermesStoredConfig | null> {
  try {
    const raw = await fs.readFile(STORED_CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return sanitizeStoredConfig(parsed)
  } catch {
    return null
  }
}

export async function writeStoredHermesConfig(input: WriteHermesConfigInput): Promise<HermesStoredConfig> {
  const next: HermesStoredConfig = {
    apiBase: normalizeHermesApiBase(input.apiBase),
    apiKey: sanitizeString(input.apiKey),
    defaultModel: sanitizeString(input.defaultModel),
    systemPrompt: sanitizeString(input.systemPrompt),
    updatedAt: new Date().toISOString(),
  }

  if (!next.apiKey) {
    throw new Error('Hermes API key is required.')
  }

  await fs.mkdir(path.dirname(STORED_CONFIG_PATH), { recursive: true })
  await fs.writeFile(STORED_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  if (process.platform !== 'win32') {
    await fs.chmod(STORED_CONFIG_PATH, 0o600).catch(() => {})
  }

  return next
}

export async function clearStoredHermesConfig(): Promise<void> {
  await fs.unlink(STORED_CONFIG_PATH).catch(() => {})
}

export async function resolveHermesConfig(): Promise<HermesResolvedConfig> {
  const stored = await readStoredHermesConfig()
  if (stored?.apiKey) {
    return {
      apiBase: stored.apiBase,
      apiKey: stored.apiKey,
      defaultModel: stored.defaultModel,
      systemPrompt: stored.systemPrompt,
      source: 'pairing',
      updatedAt: stored.updatedAt,
    }
  }

  const apiKey = sanitizeString(process.env.HERMES_API_KEY)
  const apiBase = normalizeHermesApiBase(process.env.HERMES_API_BASE)
  const defaultModel = sanitizeString(process.env.HERMES_MODEL)
  const systemPrompt = sanitizeString(process.env.HERMES_SYSTEM_PROMPT)

  if (apiKey) {
    return {
      apiBase,
      apiKey,
      defaultModel,
      systemPrompt,
      source: 'env',
    }
  }

  return {
    apiBase,
    apiKey: '',
    defaultModel,
    systemPrompt,
    source: 'none',
  }
}
