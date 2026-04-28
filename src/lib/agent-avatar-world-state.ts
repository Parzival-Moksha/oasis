export type WorldVec3 = [number, number, number]

export type AgentAvatarTransform = {
  position?: WorldVec3
  rotation?: WorldVec3
  scale?: WorldVec3 | number
}

export type AgentAvatarLike = {
  id: string
  agentType: string
  position: WorldVec3
  rotation: WorldVec3
  scale: number
  linkedWindowId?: string
  label?: string
  avatar3dUrl?: string
}

export type AgentAvatarTransformMap = Record<string, AgentAvatarTransform>

export const SHARED_AGENT_AVATAR_TYPES = ['anorak-pro', 'merlin', 'realtime', 'hermes', 'openclaw'] as const

export function isSharedAgentAvatarType(agentType: string): boolean {
  return SHARED_AGENT_AVATAR_TYPES.includes(agentType as typeof SHARED_AGENT_AVATAR_TYPES[number])
}

function isFiniteVec3(value: unknown): value is WorldVec3 {
  return Array.isArray(value)
    && value.length >= 3
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Number.isFinite(value[2])
}

function vec3Equals(a: WorldVec3 | undefined, b: WorldVec3 | undefined): boolean {
  if (!a || !b) return a === b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function scalarFromTransform(value: AgentAvatarTransform['scale']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && Number.isFinite(value[0])) return value[0]
  return null
}

export function foldTransformIntoAgentAvatar<TAvatar extends AgentAvatarLike>(
  avatar: TAvatar,
  transform: AgentAvatarTransform | undefined,
): { avatar: TAvatar; changed: boolean } {
  if (!transform) return { avatar, changed: false }

  let changed = false
  const next = { ...avatar }
  if (isFiniteVec3(transform.position) && !vec3Equals(transform.position, avatar.position)) {
    next.position = [transform.position[0], transform.position[1], transform.position[2]]
    changed = true
  }
  if (isFiniteVec3(transform.rotation) && !vec3Equals(transform.rotation, avatar.rotation)) {
    next.rotation = [transform.rotation[0], transform.rotation[1], transform.rotation[2]]
    changed = true
  }
  const scale = scalarFromTransform(transform.scale)
  if (scale != null && scale !== avatar.scale) {
    next.scale = scale
    changed = true
  }
  return { avatar: next, changed }
}

export function normalizeAgentAvatarTransforms<TAvatar extends AgentAvatarLike>(
  avatars: TAvatar[] | undefined,
  transforms: AgentAvatarTransformMap | undefined,
): {
  avatars: TAvatar[]
  transforms: AgentAvatarTransformMap
  changed: boolean
  foldedAvatarIds: string[]
} {
  const inputAvatars = avatars || []
  const inputTransforms = transforms || {}
  let changed = false
  const foldedAvatarIds: string[] = []
  const nextTransforms: AgentAvatarTransformMap = { ...inputTransforms }

  const nextAvatars = inputAvatars.map(avatar => {
    if (!Object.prototype.hasOwnProperty.call(nextTransforms, avatar.id)) return avatar
    const folded = foldTransformIntoAgentAvatar(avatar, nextTransforms[avatar.id])
    delete nextTransforms[avatar.id]
    changed = true
    foldedAvatarIds.push(avatar.id)
    return folded.avatar
  })

  if (!avatars && inputAvatars.length === 0) changed = changed || false
  if (!transforms && Object.keys(inputTransforms).length === 0) changed = changed || false

  return {
    avatars: nextAvatars,
    transforms: changed ? nextTransforms : inputTransforms,
    changed,
    foldedAvatarIds,
  }
}

export function normalizeWorldStateAgentAvatarTransforms<
  TState extends { agentAvatars?: TAvatar[]; transforms?: AgentAvatarTransformMap },
  TAvatar extends AgentAvatarLike = AgentAvatarLike,
>(state: TState): TState {
  const normalized = normalizeAgentAvatarTransforms<TAvatar>(state.agentAvatars, state.transforms)
  if (!normalized.changed) return state
  return {
    ...state,
    agentAvatars: normalized.avatars,
    transforms: normalized.transforms,
  }
}
