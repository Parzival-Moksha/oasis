import { ASSET_CATALOG } from '@/components/scene-lib/constants'

export interface AgentAvatarCatalogEntry {
  id: string
  name: string
  path: string
}

export interface AgentAvatarResolution {
  requested: string
  url: string
  resolved: boolean
  match: AgentAvatarCatalogEntry | null
  suggestion?: string
}

const LOOKUP_NORMALIZER = /[^a-z0-9]/g

export const AGENT_AVATAR_CATALOG: AgentAvatarCatalogEntry[] = ASSET_CATALOG
  .filter(asset => asset.category === 'avatar')
  .map(asset => ({
    id: asset.id,
    name: asset.name,
    path: asset.path,
  }))

export const DEFAULT_AGENT_AVATAR_URL = AGENT_AVATAR_CATALOG.find(entry => entry.path === '/avatars/gallery/CoolAlien.vrm')?.path
  || AGENT_AVATAR_CATALOG[0]?.path
  || '/avatars/gallery/CoolAlien.vrm'

export const DEFAULT_AGENT_AVATAR_URL_BY_TYPE: Record<string, string> = {
  anorak: '/avatars/gallery/Cyberpal.vrm',
  codex: '/avatars/gallery/CosmicBot.vrm',
  'anorak-pro': '/avatars/gallery/UnicornPerson.vrm',
  merlin: '/avatars/gallery/EYE_Diviner.vrm',
  openclaw: '/avatars/gallery/CaptainLobster.vrm',
  hermes: '/avatars/gallery/Amazonas.vrm',
}

export function getDefaultAgentAvatarUrl(agentType: string): string {
  const preferred = DEFAULT_AGENT_AVATAR_URL_BY_TYPE[agentType] || DEFAULT_AGENT_AVATAR_URL
  return AGENT_AVATAR_CATALOG.find(entry => entry.path === preferred)?.path || DEFAULT_AGENT_AVATAR_URL
}

function stripAvatarUrlDecorations(value: string): string {
  let next = value.trim().replace(/^['"`]+|['"`]+$/g, '')
  if (!next) return ''
  if (/^https?:\/\//i.test(next)) return next
  return next.replace(/[?#].*$/, '').trim()
}

function basenameOf(value: string): string {
  const stripped = stripAvatarUrlDecorations(value)
  const parts = stripped.split('/').filter(Boolean)
  return parts[parts.length - 1] || stripped
}

function normalizeLookupKey(value: string): string {
  return stripAvatarUrlDecorations(value)
    .toLowerCase()
    .replace(/\.(vrm|glb|gltf)$/i, '')
    .replace(LOOKUP_NORMALIZER, '')
}

function findAvatarMatch(requested: string): AgentAvatarCatalogEntry | null {
  const exact = AGENT_AVATAR_CATALOG.find(entry => entry.path === requested)
  if (exact) return exact

  const requestedPathKey = normalizeLookupKey(requested)
  const requestedBaseKey = normalizeLookupKey(basenameOf(requested))
  if (!requestedPathKey && !requestedBaseKey) return null

  return AGENT_AVATAR_CATALOG.find(entry => {
    const pathKey = normalizeLookupKey(entry.path)
    const baseKey = normalizeLookupKey(basenameOf(entry.path))
    const idKey = normalizeLookupKey(entry.id)
    const nameKey = normalizeLookupKey(entry.name)

    return (
      pathKey === requestedPathKey ||
      pathKey === requestedBaseKey ||
      baseKey === requestedPathKey ||
      baseKey === requestedBaseKey ||
      idKey === requestedPathKey ||
      idKey === requestedBaseKey ||
      nameKey === requestedPathKey ||
      nameKey === requestedBaseKey ||
      pathKey.includes(requestedPathKey) ||
      pathKey.includes(requestedBaseKey) ||
      nameKey.includes(requestedPathKey) ||
      nameKey.includes(requestedBaseKey) ||
      idKey.includes(requestedPathKey) ||
      idKey.includes(requestedBaseKey)
    )
  }) || null
}

export function isKnownAgentAvatarUrl(value: string): boolean {
  const stripped = stripAvatarUrlDecorations(value)
  if (!stripped) return false
  if (/^https?:\/\//i.test(stripped)) return true
  return AGENT_AVATAR_CATALOG.some(entry => entry.path === stripped)
}

export function resolveAgentAvatarUrl(rawValue: unknown, options?: {
  fallbackUrl?: string
  fallbackLabel?: string
}): AgentAvatarResolution {
  const requested = typeof rawValue === 'string' ? stripAvatarUrlDecorations(rawValue) : ''
  const fallbackUrl = options?.fallbackUrl || DEFAULT_AGENT_AVATAR_URL
  const fallback = AGENT_AVATAR_CATALOG.find(entry => entry.path === fallbackUrl) || AGENT_AVATAR_CATALOG[0] || null
  const fallbackLabel = options?.fallbackLabel || fallback?.name || 'Cool Alien'

  if (!requested) {
    return {
      requested,
      url: fallback?.path || fallbackUrl,
      resolved: false,
      match: fallback,
      suggestion: `No avatar URL was provided. Using ${fallbackLabel} (${fallback?.path || fallbackUrl}).`,
    }
  }

  if (/^https?:\/\//i.test(requested)) {
    return {
      requested,
      url: requested,
      resolved: true,
      match: null,
    }
  }

  const match = findAvatarMatch(requested)
  if (match) {
    return {
      requested,
      url: match.path,
      resolved: match.path === requested,
      match,
      ...(match.path !== requested ? { suggestion: `Resolved "${requested}" to ${match.name} (${match.path}).` } : {}),
    }
  }

  return {
    requested,
    url: fallback?.path || fallbackUrl,
    resolved: false,
    match: fallback,
    suggestion: `Avatar "${requested}" was not found. Using ${fallbackLabel} (${fallback?.path || fallbackUrl}).`,
  }
}

export function sanitizeAgentAvatarRecord<T extends { avatar3dUrl: string }>(entry: T, options?: {
  fallbackUrl?: string
  fallbackLabel?: string
}): { value: T; changed: boolean; resolution: AgentAvatarResolution } {
  const resolution = resolveAgentAvatarUrl(entry.avatar3dUrl, options)
  if (resolution.url === entry.avatar3dUrl) {
    return {
      value: entry,
      changed: false,
      resolution,
    }
  }

  return {
    value: {
      ...entry,
      avatar3dUrl: resolution.url,
    },
    changed: true,
    resolution,
  }
}

export function sanitizeAgentAvatarList<T extends { avatar3dUrl: string }>(entries: T[], options?: {
  fallbackUrl?: string
  fallbackLabel?: string
}): { entries: T[]; changed: boolean } {
  let changed = false
  const sanitized = entries.map(entry => {
    const result = sanitizeAgentAvatarRecord(entry, options)
    changed = changed || result.changed
    return result.value
  })
  return { entries: sanitized, changed }
}
