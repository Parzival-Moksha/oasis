export type OasisMode = 'local' | 'hosted'
/**
 * `village` is a local profile: the agent village (Claude Code agents from the local agent
 * engine as characters at desks) with the hosted / combat / quest / realtime-NPC / forms /
 * multiplayer layers left unmounted. It never applies to hosted deployments.
 */
export type OasisProfile = 'local' | 'hosted-openclaw' | 'village'

type EnvLike = {
  [key: string]: string | undefined
  OASIS_MODE?: string
  OASIS_PROFILE?: string
  NEXT_PUBLIC_OASIS_PROFILE?: string
}

/**
 * Product profile is the explicit behavior switch. `OASIS_MODE=hosted`
 * remains supported for current deploy scripts, while `OASIS_PROFILE` gives
 * future hosted variants a clearer name than a bare mode flag.
 */
export function getOasisProfile(env: EnvLike = process.env): OasisProfile {
  const profile = env.OASIS_PROFILE?.trim()
  if (profile === 'hosted-openclaw') return 'hosted-openclaw'
  if (profile === 'local') return 'local'
  if (env.OASIS_MODE === 'hosted') return 'hosted-openclaw'
  if (profile === 'village' || env.NEXT_PUBLIC_OASIS_PROFILE?.trim() === 'village') return 'village'
  return 'local'
}

export function getOasisMode(env: EnvLike = process.env): OasisMode {
  return getOasisProfile(env) === 'hosted-openclaw' ? 'hosted' : 'local'
}

export function isHostedOasis(env: EnvLike = process.env): boolean {
  return getOasisMode(env) === 'hosted'
}

// ─── client-visible village switch ──────────────────────────────────────────
//
// Two ways to turn the village on in the browser:
//   1. `?profile=village` on the Oasis URL (per tab, no restart)
//   2. `NEXT_PUBLIC_OASIS_PROFILE=village` in .env.local (always on; needs a `pnpm dev` restart)
// `?profile=local` turns it off for one tab even when the env var is set.
// Hosted mode always wins: the village needs the local agent engine on 127.0.0.1.

export interface VillageProfileInput {
  /** NEXT_PUBLIC_OASIS_PROFILE as inlined into the client bundle. */
  envProfile?: string | null
  /** window.location.search */
  search?: string | null
  /** This tab's remembered `?profile=` (sessionStorage), see rememberClientProfileOverride. */
  storedProfile?: string | null
  /** Client mode from the session (local | hosted). */
  mode?: OasisMode | null
}

const PROFILE_OVERRIDES = new Set(['village', 'local', 'default'])
export const CLIENT_PROFILE_STORAGE_KEY = 'oasis-profile-override'

function readProfileParam(search: string | null | undefined): string | null {
  try {
    const value = new URLSearchParams(search || '').get('profile')?.trim().toLowerCase() || null
    return value && PROFILE_OVERRIDES.has(value) ? value : null
  } catch {
    return null
  }
}

export function resolveVillageProfile({ envProfile, search, storedProfile, mode }: VillageProfileInput): boolean {
  if (mode === 'hosted') return false
  const override = readProfileParam(search) || (storedProfile && PROFILE_OVERRIDES.has(storedProfile) ? storedProfile : null)
  if (override === 'village') return true
  if (override === 'local' || override === 'default') return false
  return envProfile?.trim().toLowerCase() === 'village'
}

/**
 * OasisClient strips URL params on boot; call this first so `?profile=` survives for this tab
 * (sessionStorage: reloads keep it, other tabs and new sessions do not).
 */
export function rememberClientProfileOverride(search: string): string | null {
  const value = readProfileParam(search)
  if (!value || typeof window === 'undefined') return value
  try { window.sessionStorage.setItem(CLIENT_PROFILE_STORAGE_KEY, value) } catch { /* storage blocked */ }
  return value
}

let cachedClientVillage: boolean | null = null

/** Browser-only. Read once per page load: the profile does not change while the Oasis runs. */
export function isVillageProfileClient(): boolean {
  if (typeof window === 'undefined') return false
  if (cachedClientVillage !== null) return cachedClientVillage
  const mode = (window as typeof window & { __oasisModeFallback?: OasisMode }).__oasisModeFallback
  const hostedHost = /(?:^|\.)04515\.xyz$/.test(window.location.hostname || '')
  let storedProfile: string | null = null
  try { storedProfile = window.sessionStorage.getItem(CLIENT_PROFILE_STORAGE_KEY) } catch { storedProfile = null }
  cachedClientVillage = resolveVillageProfile({
    envProfile: process.env.NEXT_PUBLIC_OASIS_PROFILE,
    search: window.location.search,
    storedProfile,
    mode: hostedHost ? 'hosted' : mode || 'local',
  })
  return cachedClientVillage
}
