import { getCameraSnapshot } from './camera-bridge'

export interface PlayerAvatarPose {
  position: [number, number, number]
  yaw: number
  forward: [number, number, number]
}

export interface CastSpawn {
  position: [number, number, number]
  rotation: [number, number, number]
}

export const PLAYER_AVATAR_LIPSYNC_ID = 'player-avatar'

const DEFAULT_CAST_DISTANCE = 3
const DEFAULT_GROUND_Y = 0

let latestPlayerAvatarPose: PlayerAvatarPose | null = null
let playerSpellCasting = false
const spellListeners = new Set<() => void>()

function cloneVec3(value: [number, number, number]): [number, number, number] {
  return [value[0], value[1], value[2]]
}

function notifySpellListeners() {
  for (const listener of spellListeners) {
    listener()
  }
}

export function setPlayerAvatarPose(pose: PlayerAvatarPose | null): void {
  latestPlayerAvatarPose = pose
    ? {
        position: cloneVec3(pose.position),
        yaw: pose.yaw,
        forward: cloneVec3(pose.forward),
      }
    : null
}

export function getPlayerAvatarPose(): PlayerAvatarPose | null {
  if (!latestPlayerAvatarPose) return null
  return {
    position: cloneVec3(latestPlayerAvatarPose.position),
    yaw: latestPlayerAvatarPose.yaw,
    forward: cloneVec3(latestPlayerAvatarPose.forward),
  }
}

export function getPlayerSpellCasting(): boolean {
  return playerSpellCasting
}

export function setPlayerSpellCasting(active: boolean): void {
  if (playerSpellCasting === active) return
  playerSpellCasting = active
  notifySpellListeners()
}

export function subscribePlayerSpellCasting(listener: () => void): () => void {
  spellListeners.add(listener)
  return () => {
    spellListeners.delete(listener)
  }
}

export function derivePlayerCastSpawn(distance = DEFAULT_CAST_DISTANCE): CastSpawn {
  const pose = getPlayerAvatarPose()
  if (pose) {
    const [px, py, pz] = pose.position
    const [fx, , fz] = pose.forward
    return {
      position: [px + fx * distance, py, pz + fz * distance],
      rotation: [0, pose.yaw, 0],
    }
  }

  const camera = getCameraSnapshot()
  if (camera) {
    const [cx, , cz] = camera.position
    const [fx, , fz] = camera.forward
    const yaw = Math.atan2(fx, fz || 1)
    return {
      position: [cx + fx * distance, DEFAULT_GROUND_Y, cz + fz * distance],
      rotation: [0, yaw, 0],
    }
  }

  return {
    position: [0, DEFAULT_GROUND_Y, distance],
    rotation: [0, 0, 0],
  }
}
