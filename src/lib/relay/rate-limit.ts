/**
 * In-process sliding-window rate limiter. Keyed by an arbitrary string
 * (typically client IP). Pinned to globalThis so HMR + module-cache misses
 * don't drop counters.
 *
 * Buckets default to: 10 hits per 60s. Over the limit returns the time the
 * earliest hit will fall out of the window so callers can emit a Retry-After.
 *
 * Trade-offs:
 *   - Single-process only. If we ever scale to multiple Next instances we
 *     need a shared store (Redis). For v1 single-host, in-memory is fine.
 *   - Memory bound is O(distinct keys * windowSize). Caller-side: pick keys
 *     with manageable cardinality (IP, not full URL).
 */

interface BucketStore {
  byKey: Map<string, number[]>
}

function getStore(): BucketStore {
  const g = globalThis as typeof globalThis & { __oasisRelayRateLimit?: BucketStore }
  if (!g.__oasisRelayRateLimit) g.__oasisRelayRateLimit = { byKey: new Map() }
  return g.__oasisRelayRateLimit
}

export interface RateLimitDecision {
  allowed: boolean
  /** Seconds until at least one bucket slot frees up. 0 when allowed. */
  retryAfterSeconds: number
}

export interface RateLimitOptions {
  key: string
  limit: number
  windowMs: number
  /** Override now() for testing. */
  now?: number
}

export function consumeRateLimit(opts: RateLimitOptions): RateLimitDecision {
  const now = opts.now ?? Date.now()
  const store = getStore()
  const cutoff = now - opts.windowMs
  const hits = store.byKey.get(opts.key) ?? []
  // Drop expired entries.
  const fresh = hits.filter(t => t > cutoff)
  if (fresh.length >= opts.limit) {
    store.byKey.set(opts.key, fresh)
    const earliest = fresh[0]
    const retryAfterMs = Math.max(0, earliest + opts.windowMs - now)
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
  }
  fresh.push(now)
  store.byKey.set(opts.key, fresh)
  return { allowed: true, retryAfterSeconds: 0 }
}

/** Test helper. */
export function _resetRateLimitForTests(): void {
  getStore().byKey.clear()
}

/**
 * Pick a stable client identifier from request headers. Trusts X-Forwarded-For
 * because we sit behind Nginx; if that ever stops being true, this is wrong.
 */
export function clientKeyFromRequest(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
