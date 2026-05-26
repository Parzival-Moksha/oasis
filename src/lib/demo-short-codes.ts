export interface DemoShortCode {
  code: string
  event: string
  label: string
  targetCap: number
  hardCap: number
  maxShards: number
}

const DEFAULT_EVENT_SLUG = 'ai-tinkerers-bogota-may-2026'
const DEFAULT_TARGET_CAP = 8
const DEFAULT_HARD_CAP = 12
const DEFAULT_MAX_SHARDS = 16

type EnvLike = Record<string, string | undefined>

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function sanitizeDemoSlug(value: string | null | undefined, fallback = DEFAULT_EVENT_SLUG): string {
  const sanitized = (value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return sanitized || fallback
}

export function sanitizeDemoCode(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
}

function defaultShortCodes(env: EnvLike): DemoShortCode[] {
  const event = sanitizeDemoSlug(env.OASIS_DEMO_DEFAULT_EVENT || env.OASIS_DEMO_EVENTS?.split(',')[0])
  const targetCap = clampInt(env.OASIS_DEMO_TARGET_CAP, DEFAULT_TARGET_CAP, 1, 256)
  const hardCap = clampInt(env.OASIS_DEMO_HARD_CAP, DEFAULT_HARD_CAP, targetCap, 256)
  const maxShards = clampInt(env.OASIS_DEMO_MAX_SHARDS_PER_EVENT, DEFAULT_MAX_SHARDS, 1, 256)
  return [
    { code: 'ai', event, label: 'AI Tinkerers', targetCap, hardCap, maxShards },
    { code: 'ab12', event, label: 'AI Tinkerers short link', targetCap, hardCap, maxShards },
    { code: 'demo', event, label: 'Demo router', targetCap, hardCap, maxShards },
  ]
}

function parseJsonShortCodes(raw: string, env: EnvLike): DemoShortCode[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed
      .map((item): DemoShortCode | null => {
        if (!item || typeof item !== 'object') return null
        const record = item as Record<string, unknown>
        const code = sanitizeDemoCode(String(record.code || ''))
        if (!code || code.length < 2) return null
        const event = sanitizeDemoSlug(String(record.event || env.OASIS_DEMO_DEFAULT_EVENT || DEFAULT_EVENT_SLUG))
        const targetCap = clampInt(record.targetCap ?? record.target, DEFAULT_TARGET_CAP, 1, 256)
        const hardCap = clampInt(record.hardCap ?? record.hard, DEFAULT_HARD_CAP, targetCap, 256)
        const maxShards = clampInt(record.maxShards, DEFAULT_MAX_SHARDS, 1, 256)
        const label = String(record.label || event)
        return { code, event, label, targetCap, hardCap, maxShards }
      })
      .filter((item): item is DemoShortCode => Boolean(item))
  } catch {
    return null
  }
}

function parseCsvShortCodes(raw: string): DemoShortCode[] {
  return raw
    .split(',')
    .map(piece => piece.trim())
    .map((piece): DemoShortCode | null => {
      if (!piece) return null
      const [codeRaw, eventRaw, targetRaw, hardRaw, maxRaw] = piece.split(':')
      const code = sanitizeDemoCode(codeRaw)
      if (!code || code.length < 2) return null
      const event = sanitizeDemoSlug(eventRaw)
      const targetCap = clampInt(targetRaw, DEFAULT_TARGET_CAP, 1, 256)
      const hardCap = clampInt(hardRaw, DEFAULT_HARD_CAP, targetCap, 256)
      const maxShards = clampInt(maxRaw, DEFAULT_MAX_SHARDS, 1, 256)
      return { code, event, label: event, targetCap, hardCap, maxShards }
    })
    .filter((item): item is DemoShortCode => Boolean(item))
}

export function listDemoShortCodes(env: EnvLike = process.env): DemoShortCode[] {
  const raw = env.OASIS_DEMO_SHORT_CODES?.trim()
  const configured = raw
    ? (raw.startsWith('[') ? parseJsonShortCodes(raw, env) : parseCsvShortCodes(raw))
    : null
  const byCode = new Map<string, DemoShortCode>()
  for (const item of [...defaultShortCodes(env), ...(configured || [])]) {
    byCode.set(item.code, item)
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export function resolveDemoShortCode(code: string, env: EnvLike = process.env): DemoShortCode | null {
  const normalized = sanitizeDemoCode(code)
  if (!normalized || normalized.length < 2) return null
  return listDemoShortCodes(env).find(item => item.code === normalized) || null
}

export function demoEntryPath(entry: DemoShortCode): string {
  const params = new URLSearchParams()
  params.set('event', entry.event)
  params.set('target', String(entry.targetCap))
  params.set('hard', String(entry.hardCap))
  params.set('maxShards', String(entry.maxShards))
  return `/demo?${params.toString()}`
}

export function demoWorldPrefix(eventSlug: string): string {
  return `Demo ${sanitizeDemoSlug(eventSlug)} FFA`
}
