export interface AgentWindowAnchorLike {
  width?: number
  height?: number
  scale?: number
  position: [number, number, number]
  rotation?: [number, number, number]
}

export interface AgentAvatarAnchorLike {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
}

export interface TransformOverrideLike {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number] | number
}

export interface CameraSnapshotLike {
  position: [number, number, number]
  forward: [number, number, number]
}

export type LinkedWindowAnchorMode = 'detached' | 'next-to' | 'above'

const AGENT_WINDOW_PX_TO_WORLD = 8 / 400
const DEFAULT_AVATAR_OFFSET = 0.9
const DEFAULT_AVATAR_STAGE_TURN = Math.PI / 6
const DEFAULT_HERMES_SPAWN_DISTANCE = 3.2
const DEFAULT_GROUND_Y = 0
const DEFAULT_WINDOW_BOTTOM_OFFSET = 1
const DEFAULT_HERMES_AVATAR_SCALE = 1.15

export function scalarFromTransformScale(value: TransformOverrideLike['scale'], fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0])) return value[0]
  return fallback
}

export function resolveAgentWindowRenderScale(
  window: AgentWindowAnchorLike,
  transform?: TransformOverrideLike,
): number {
  const baseScale = typeof window.scale === 'number' && Number.isFinite(window.scale) ? window.scale : 1
  const transformScale = scalarFromTransformScale(transform?.scale, 1)
  return baseScale * transformScale
}

export function deriveWindowAvatarAnchor(
  window: AgentWindowAnchorLike,
  transform?: TransformOverrideLike,
): { position: [number, number, number]; rotation: [number, number, number] } {
  const position = transform?.position || window.position
  const rotation = transform?.rotation || window.rotation || [0, 0, 0]
  const scale = resolveAgentWindowRenderScale(window, transform)
  const worldWidth = (window.width || 800) * AGENT_WINDOW_PX_TO_WORLD * scale
  const yaw = rotation[1] || 0
  const offset = worldWidth / 2 + DEFAULT_AVATAR_OFFSET

  return {
    position: [
      position[0] - Math.cos(yaw) * offset,
      DEFAULT_GROUND_Y,
      position[2] + Math.sin(yaw) * offset,
    ],
    // Cant the companion slightly inward so it presents toward the viewer/window.
    rotation: [0, yaw + DEFAULT_AVATAR_STAGE_TURN, 0],
  }
}

export function deriveWindowAvatarScale(
  window: AgentWindowAnchorLike,
  transform?: TransformOverrideLike,
): number {
  const scale = resolveAgentWindowRenderScale(window, transform)
  const worldHeight = (window.height || 600) * AGENT_WINDOW_PX_TO_WORLD * scale
  return Math.max(0.7, (worldHeight / 1.7) * 0.7)
}

export function deriveAvatarAnchoredWindowPlacement(
  window: AgentWindowAnchorLike,
  avatar: AgentAvatarAnchorLike,
  avatarTransform?: TransformOverrideLike,
  anchorMode: LinkedWindowAnchorMode = 'next-to',
  windowTransform?: TransformOverrideLike,
): { position: [number, number, number]; rotation: [number, number, number] } {
  const avatarPosition = avatarTransform?.position || avatar.position
  const avatarRotation = avatarTransform?.rotation || avatar.rotation || [0, 0, 0]
  const avatarScale = scalarFromTransformScale(avatarTransform?.scale, avatar.scale || 1)
  const windowScale = resolveAgentWindowRenderScale(window, windowTransform)
  const worldWidth = (window.width || 800) * AGENT_WINDOW_PX_TO_WORLD * windowScale
  const worldHeight = (window.height || 600) * AGENT_WINDOW_PX_TO_WORLD * windowScale
  const windowYaw = (avatarRotation[1] || 0) - DEFAULT_AVATAR_STAGE_TURN
  const avatarHeight = Math.max(1.35, (avatarScale / 0.7) * 1.7)

  if (anchorMode === 'above') {
    return {
      position: [
        avatarPosition[0],
        avatarPosition[1] + avatarHeight + 0.35 + worldHeight / 2,
        avatarPosition[2],
      ],
      rotation: [0, windowYaw, 0],
    }
  }

  const offset = worldWidth / 2 + DEFAULT_AVATAR_OFFSET
  return {
    position: [
      avatarPosition[0] + Math.cos(windowYaw) * offset,
      avatarPosition[1] + DEFAULT_WINDOW_BOTTOM_OFFSET + worldHeight / 2,
      avatarPosition[2] - Math.sin(windowYaw) * offset,
    ],
    rotation: [0, windowYaw, 0],
  }
}

export function deriveStandaloneAgentAvatarSpawn(
  cameraSnapshot: CameraSnapshotLike | null | undefined,
  spawnDistance: number = DEFAULT_HERMES_SPAWN_DISTANCE,
  scale: number = DEFAULT_HERMES_AVATAR_SCALE,
): { position: [number, number, number]; rotation: [number, number, number]; scale: number } {
  if (!cameraSnapshot) {
    return {
      position: [0, DEFAULT_GROUND_Y, spawnDistance],
      rotation: [0, Math.PI, 0],
      scale,
    }
  }

  const [cx, , cz] = cameraSnapshot.position
  const [fx, , fz] = cameraSnapshot.forward
  const yaw = Math.atan2(-fx, -fz || -1)

  return {
    position: [
      cx + fx * spawnDistance,
      DEFAULT_GROUND_Y,
      cz + fz * spawnDistance,
    ],
    rotation: [0, yaw, 0],
    scale,
  }
}

export function deriveHermesAvatarSpawn(
  cameraSnapshot: CameraSnapshotLike | null | undefined,
): { position: [number, number, number]; rotation: [number, number, number]; scale: number } {
  return deriveStandaloneAgentAvatarSpawn(cameraSnapshot)
}
