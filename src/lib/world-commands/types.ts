import type { CatalogPlacement, CraftedScene, ObjectBehavior, WorldLight } from '@/lib/conjure/types'
import type { WorldState } from '@/lib/forge/world-persistence'
import type { PaintStroke, PaintStrokeStyle } from '@/lib/forge/paint-stroke'
import type { Text3DObject } from '@/lib/forge/text-3d-object'
import type { PortalGate } from '@/lib/portal-gates'
import type { SpatialWebObject, SpatialWebValue } from '@/lib/spatial-web'
import type { AgentAvatar, AgentWindow } from '@/lib/agent-window-types'
import type { PlacementVfxType } from '@/lib/forge/placement-types'

export type Vec3 = [number, number, number]
export type ScalarOrVec3 = number | Vec3

export type WorldCommandKind =
  | 'object.add'
  | 'object.update'
  | 'object.remove'
  | 'object.transform'
  | 'object.behavior.update'
  | 'crafted.add'
  | 'crafted.update'
  | 'crafted.remove'
  | 'portal.add'
  | 'portal.update'
  | 'portal.remove'
  | 'spatial.add'
  | 'spatial.update'
  | 'spatial.remove'
  | 'spatial.value.set'
  | 'ground.setPreset'
  | 'ground.paint'
  | 'ground.tile.erase'
  | 'ground.tiles.clear'
  | 'terrain.brush'
  | 'terrain.reset'
  | 'light.add'
  | 'light.update'
  | 'light.remove'
  | 'sky.set'
  | 'stroke.start'
  | 'stroke.point'
  | 'stroke.end'
  | 'stroke.update'
  | 'stroke.remove'
  | 'text3d.add'
  | 'text3d.update'
  | 'text3d.remove'
  | 'agent.window.add'
  | 'agent.window.update'
  | 'agent.window.remove'
  | 'agent.avatar.add'
  | 'agent.avatar.update'
  | 'agent.avatar.remove'
  | 'media.playback.set'
  | 'placement.vfx'

export type SpatialWebStateScope = 'world' | 'session' | 'actor'
export type PlaybackScope = 'shared' | 'local'
export type MediaPlaybackState = 'playing' | 'paused' | 'stopped'

export type ScopedSpatialWebObject = SpatialWebObject & {
  stateScope?: SpatialWebStateScope
}

export type WorldMediaBehavior = ObjectBehavior & {
  audioPlaybackScope?: PlaybackScope
  audioPlaybackId?: string
  audioStartedAt?: string
  audioUpdatedAt?: string
}

export type WorldCommandEnvelope<K extends WorldCommandKind = WorldCommandKind> =
  K extends WorldCommandKind ? WorldCommandEnvelopeBase<K> : never

export interface WorldCommandEnvelopeBase<K extends WorldCommandKind> {
  id: string
  kind: K
  worldId: string
  actorId: string
  actorDisplayName?: string
  clientId?: string
  createdAt: string
  expectedRevision?: number
  idempotencyKey?: string
  payload: WorldCommandPayloadByKind[K]
}

export type WorldEventKind =
  | 'command.accepted'
  | 'command.rejected'
  | 'snapshot.compacted'

export interface WorldEventEnvelope {
  id: string
  kind: WorldEventKind
  worldId: string
  commandId?: string
  actorId?: string
  acceptedAt: string
  revision: number
  source?: 'local' | 'room' | 'http'
  durable?: boolean
  error?: string
  command?: WorldCommandEnvelope
}

export interface WorldCommandApplyResult {
  state: WorldState
  changed: boolean
}

export type WorldTransformPatch = {
  position?: Vec3
  rotation?: Vec3
  scale?: ScalarOrVec3
}

export type WorldCommandPayloadByKind = {
  'object.add': { object: CatalogPlacement }
  'object.update': { id: string; updates: Partial<CatalogPlacement> }
  'object.remove': { id: string; linkedAvatarIds?: string[] }
  'object.transform': { id: string } & WorldTransformPatch
  'object.behavior.update': { id: string; updates: Partial<ObjectBehavior> & { moveTarget?: Vec3 | null } }

  'crafted.add': { scene: CraftedScene }
  'crafted.update': { id: string; updates: Partial<CraftedScene> }
  'crafted.remove': { id: string }

  'portal.add': { gate: PortalGate }
  'portal.update': { id: string; updates: Partial<PortalGate> }
  'portal.remove': { id: string }

  'spatial.add': { object: ScopedSpatialWebObject }
  'spatial.update': { id: string; updates: Partial<ScopedSpatialWebObject> }
  'spatial.remove': { id: string }
  'spatial.value.set': {
    id: string
    value: SpatialWebValue
    event?: 'press' | 'change' | 'submit'
    stateScope?: SpatialWebStateScope
    statusMessage?: string
    errorMessage?: string | null
  }

  'ground.setPreset': { groundPresetId: string }
  'ground.paint': { cx: number; cz: number; presetId: string; size?: number; stretch?: number }
  'ground.tile.erase': { x: number; z: number }
  'ground.tiles.clear': Record<string, never>

  'terrain.brush': { x: number; z: number; radius: number; intensity: number; direction: 'up' | 'down'; deltaSeconds: number }
  'terrain.reset': Record<string, never>

  'light.add': { light: WorldLight }
  'light.update': { id: string; updates: Partial<WorldLight> }
  'light.remove': { id: string }
  'sky.set': { skyBackgroundId: string }

  'stroke.start': { strokeId: string; authorId: string; authorColor: string; style: PaintStrokeStyle }
  'stroke.point': { strokeId: string; point: Vec3 }
  'stroke.end': { strokeId: string; finalStroke: PaintStroke }
  'stroke.update': { id: string; updates: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>> }
  'stroke.remove': { id: string }

  'text3d.add': { object: Text3DObject }
  'text3d.update': { id: string; updates: Partial<Text3DObject> }
  'text3d.remove': { id: string }

  'agent.window.add': { window: AgentWindow }
  'agent.window.update': { id: string; updates: Partial<AgentWindow> }
  'agent.window.remove': { id: string; linkedAvatarId?: string }
  'agent.avatar.add': { avatar: AgentAvatar }
  'agent.avatar.update': { id: string; updates: Partial<AgentAvatar> }
  'agent.avatar.remove': { id: string; linkedWindowId?: string }

  'media.playback.set': {
    objectId: string
    playbackScope: PlaybackScope
    state: MediaPlaybackState
    audioUrl?: string
    volume?: number
    maxDistance?: number
    muted?: boolean
    loop?: boolean
    playbackId?: string
    startedAt?: string
    updatedAt?: string
  }

  'placement.vfx': { position: Vec3; typeOverride?: PlacementVfxType }
}

export function commandTouchesDurableWorldState(kind: WorldCommandKind): boolean {
  return kind !== 'placement.vfx'
    && kind !== 'stroke.start'
    && kind !== 'stroke.point'
}
