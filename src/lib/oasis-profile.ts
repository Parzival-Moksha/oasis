export type OasisMode = 'local' | 'hosted'
export type OasisProfile = 'local' | 'hosted-openclaw'

type EnvLike = {
  [key: string]: string | undefined
  OASIS_MODE?: string
  OASIS_PROFILE?: string
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
  return env.OASIS_MODE === 'hosted' ? 'hosted-openclaw' : 'local'
}

export function getOasisMode(env: EnvLike = process.env): OasisMode {
  return getOasisProfile(env) === 'hosted-openclaw' ? 'hosted' : 'local'
}

export function isHostedOasis(env: EnvLike = process.env): boolean {
  return getOasisMode(env) === 'hosted'
}
