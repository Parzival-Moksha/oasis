import 'server-only'

import * as path from 'path'
import { promises as fs } from 'fs'

export const DEFAULT_OPENCLAW_GATEWAY_URL = 'ws://127.0.0.1:18789'
export const DEFAULT_OPENCLAW_CONTROL_UI_URL = 'http://127.0.0.1:18789'
export const DEFAULT_OPENCLAW_BROWSER_CONTROL_URL = 'http://127.0.0.1:18791'

const STORED_CONFIG_PATH = path.join(process.cwd(), 'data', 'openclaw-config.local.json')

export interface OpenclawDeviceIdentityStored {
  id: string          // sha256(rawPub32).hex
  publicKey: string   // base64url raw 32 bytes
  privateKey: string  // PKCS#8 PEM
}

export interface OpenclawStoredConfig {
  gatewayUrl: string
  controlUiUrl: string
  browserControlUrl: string
  sshHost: string
  deviceToken: string
  defaultSessionId: string
  lastSessionId: string
  updatedAt: string
  deviceIdentity?: OpenclawDeviceIdentityStored
}

export interface OpenclawResolvedConfig extends OpenclawStoredConfig {
  source: 'local' | 'none'
}

interface WriteOpenclawConfigInput {
  gatewayUrl?: string
  controlUiUrl?: string
  browserControlUrl?: string
  sshHost?: string
  deviceToken?: string
  defaultSessionId?: string
  lastSessionId?: string
  deviceIdentity?: OpenclawDeviceIdentityStored
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeGatewayUrl(rawUrl: string | undefined): string {
  const trimmed = sanitizeString(rawUrl) || DEFAULT_OPENCLAW_GATEWAY_URL

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol === 'wss:' ? 'wss:' : 'ws:'
    const hostname = parsed.hostname || '127.0.0.1'
    const port = parsed.port || '18789'
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
  } catch {
    return DEFAULT_OPENCLAW_GATEWAY_URL
  }
}

function normalizeHttpUrl(rawUrl: string | undefined, fallback: string): string {
  const trimmed = sanitizeString(rawUrl) || fallback

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:'
    const hostname = parsed.hostname || '127.0.0.1'
    const port = parsed.port || new URL(fallback).port
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`
  } catch {
    return fallback
  }
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function sanitizeDeviceIdentity(raw: unknown): OpenclawDeviceIdentityStored | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const id = sanitizeString(obj.id)
  const publicKey = sanitizeString(obj.publicKey)
  const privateKey = sanitizeString(obj.privateKey)
  if (!id || !publicKey || !privateKey) return undefined
  return { id, publicKey, privateKey }
}

function sanitizeStoredConfig(raw: unknown): OpenclawStoredConfig | null {
  if (!raw || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const deviceIdentity = sanitizeDeviceIdentity(obj.deviceIdentity)

  return {
    gatewayUrl: normalizeGatewayUrl(sanitizeString(obj.gatewayUrl)),
    controlUiUrl: normalizeHttpUrl(sanitizeString(obj.controlUiUrl), DEFAULT_OPENCLAW_CONTROL_UI_URL),
    browserControlUrl: normalizeHttpUrl(sanitizeString(obj.browserControlUrl), DEFAULT_OPENCLAW_BROWSER_CONTROL_URL),
    sshHost: sanitizeString(obj.sshHost),
    deviceToken: sanitizeString(obj.deviceToken),
    defaultSessionId: sanitizeString(obj.defaultSessionId),
    lastSessionId: sanitizeString(obj.lastSessionId),
    updatedAt: sanitizeString(obj.updatedAt) || new Date().toISOString(),
    ...(deviceIdentity ? { deviceIdentity } : {}),
  }
}

export async function readStoredOpenclawConfig(): Promise<OpenclawStoredConfig | null> {
  try {
    const raw = await fs.readFile(STORED_CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(stripUtf8Bom(raw)) as unknown
    return sanitizeStoredConfig(parsed)
  } catch {
    return null
  }
}

export async function writeStoredOpenclawConfig(input: WriteOpenclawConfigInput): Promise<OpenclawStoredConfig> {
  const previous = await readStoredOpenclawConfig()
  const deviceIdentity = input.deviceIdentity ?? previous?.deviceIdentity
  const next: OpenclawStoredConfig = {
    gatewayUrl: normalizeGatewayUrl(input.gatewayUrl || previous?.gatewayUrl),
    controlUiUrl: normalizeHttpUrl(input.controlUiUrl || previous?.controlUiUrl, DEFAULT_OPENCLAW_CONTROL_UI_URL),
    browserControlUrl: normalizeHttpUrl(input.browserControlUrl || previous?.browserControlUrl, DEFAULT_OPENCLAW_BROWSER_CONTROL_URL),
    sshHost: sanitizeString(input.sshHost ?? previous?.sshHost),
    deviceToken: sanitizeString(input.deviceToken ?? previous?.deviceToken),
    defaultSessionId: sanitizeString(input.defaultSessionId ?? previous?.defaultSessionId),
    lastSessionId: sanitizeString(input.lastSessionId ?? previous?.lastSessionId),
    updatedAt: new Date().toISOString(),
    ...(deviceIdentity ? { deviceIdentity } : {}),
  }

  await fs.mkdir(path.dirname(STORED_CONFIG_PATH), { recursive: true })
  await fs.writeFile(STORED_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  if (process.platform !== 'win32') {
    await fs.chmod(STORED_CONFIG_PATH, 0o600).catch(() => {})
  }

  return next
}

export async function clearStoredOpenclawConfig(): Promise<void> {
  await fs.unlink(STORED_CONFIG_PATH).catch(() => {})
}

export async function resolveOpenclawConfig(): Promise<OpenclawResolvedConfig> {
  const stored = await readStoredOpenclawConfig()
  if (stored) {
    return {
      ...stored,
      source: 'local',
    }
  }

  return {
    gatewayUrl: DEFAULT_OPENCLAW_GATEWAY_URL,
    controlUiUrl: DEFAULT_OPENCLAW_CONTROL_UI_URL,
    browserControlUrl: DEFAULT_OPENCLAW_BROWSER_CONTROL_URL,
    sshHost: '',
    deviceToken: '',
    defaultSessionId: '',
    lastSessionId: '',
    updatedAt: '',
    source: 'none',
  }
}

export function openclawGatewayHttpProbeUrl(gatewayUrl: string): string {
  try {
    const parsed = new URL(gatewayUrl)
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return DEFAULT_OPENCLAW_CONTROL_UI_URL
  }
}
