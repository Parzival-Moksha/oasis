export interface AgentWindowAnchorLike {
  width?: number
  height?: number
  scale?: number
  position: [number, number, number]
  rotation?: [number, number, number]
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

const AGENT_WINDOW_PX_TO_WORLD = 8 / 400
const DEFAULT_AVATAR_OFFSET = 0.9
const DEFAULT_HERMES_SPAWN_DISTANCE = 3.2
const DEFAULT_GROUND_Y = 0
const DEFAULT_HERMES_AVATAR_SCALE = 1.15

export function scalarFromTransformScale(value: TransformOverrideLike['scale'], fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0])) return value[0]
  return fallback
}

export function deriveWindowAvatarAnchor(
  window: AgentWindowAnchorLike,
  transform?: TransformOverrideLike,
): { position: [number, number, number]; rotation: [number, number, number] } {
  const position = transform?.position || window.position
  const rotation = transform?.rotation || window.rotation || [0, 0, 0]
  const scale = scalarFromTransformScale(transform?.scale, window.scale || 1)
  const worldWidth = (window.width || 800) * AGENT_WINDOW_PX_TO_WORLD * scale
  const worldHeight = (window.height || 600) * AGENT_WINDOW_PX_TO_WORLD * scale
  const yaw = rotation[1] || 0
  const offset = worldWidth / 2 + DEFAULT_AVATAR_OFFSET
  const bottomY = position[1] - worldHeight / 2

  return {
    position: [
      position[0] - Math.cos(yaw) * offset,
      Math.max(DEFAULT_GROUND_Y, bottomY + 0.85),
      position[2] + Math.sin(yaw) * offset,
    ],
    rotation: [0, yaw, 0],
  }
}

export function deriveWindowAvatarScale(
  window: AgentWindowAnchorLike,
  transform?: TransformOverrideLike,
): number {
  const scale = scalarFromTransformScale(transform?.scale, window.scale || 1)
  const worldHeight = (window.height || 600) * AGENT_WINDOW_PX_TO_WORLD * scale
  return Math.max(1, worldHeight / 1.7)
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
