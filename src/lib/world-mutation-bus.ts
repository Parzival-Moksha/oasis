'use client'

import type { CatalogPlacement, CraftedScene, ObjectBehavior, WorldLight } from '@/lib/conjure/types'
import type { PaintStroke, PaintStrokeStyle } from '@/lib/forge/paint-stroke'
import type { Text3DObject } from '@/lib/forge/text-3d-object'
import type { PortalGate } from '@/lib/portal-gates'
import type { AgentAvatar, AgentWindow, PlacementVfxType } from '@/store/oasisStore'

export type WorldMutation =
  | { kind: 'object_added'; payload: CatalogPlacement }
  | { kind: 'object_updated'; payload: { id: string; updates: Partial<CatalogPlacement> } }
  | { kind: 'object_removed'; payload: { id: string; linkedAvatarIds?: string[] } }
  | { kind: 'object_transformed'; payload: { id: string; position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number } }
  | { kind: 'crafted_scene_added'; payload: CraftedScene }
  | { kind: 'crafted_scene_updated'; payload: { id: string; updates: Partial<CraftedScene> } }
  | { kind: 'portal_added'; payload: PortalGate }
  | { kind: 'agent_window_added'; payload: AgentWindow }
  | { kind: 'agent_avatar_added'; payload: AgentAvatar }
  | { kind: 'placement_vfx'; payload: { position: [number, number, number]; typeOverride?: PlacementVfxType } }
  | { kind: 'sky_changed'; payload: { skyBackgroundId: string } }
  | { kind: 'ground_changed'; payload: { groundPresetId: string } }
  | { kind: 'ground_painted'; payload: { cx: number; cz: number; presetId: string; size: number; stretch: number } }
  | { kind: 'ground_tile_erased'; payload: { x: number; z: number } }
  | { kind: 'ground_tiles_cleared'; payload: Record<string, never> }
  | { kind: 'terrain_brushed'; payload: { x: number; z: number; radius: number; intensity: number; direction: 'up' | 'down'; deltaSeconds: number } }
  | { kind: 'terrain_reset'; payload: Record<string, never> }
  | { kind: 'behavior_updated'; payload: { id: string; updates: Partial<ObjectBehavior> & { moveTarget?: [number, number, number] | null } } }
  | { kind: 'light_added'; payload: { light: WorldLight } }
  | { kind: 'light_removed'; payload: { id: string } }
  | { kind: 'light_updated'; payload: { id: string; updates: Partial<WorldLight> } }
  // ─═̷─ Paint strokes (live broadcast, csillagszóró-tipped) ─═̷─
  | { kind: 'stroke_started'; payload: { strokeId: string; authorId: string; authorColor: string; style: PaintStrokeStyle } }
  | { kind: 'stroke_pointed'; payload: { strokeId: string; point: [number, number, number] } }
  | { kind: 'stroke_ended';   payload: { strokeId: string; finalStroke: PaintStroke } }
  | { kind: 'stroke_updated'; payload: { id: string; updates: Partial<Pick<PaintStroke, 'color' | 'thickness' | 'shininess' | 'mode' | 'varyByVelocity' | 'playbackLoop'>> } }
  | { kind: 'stroke_removed'; payload: { id: string } }
  // ─═̷─ 3D text objects ─═̷─
  | { kind: 'text3d_added';   payload: Text3DObject }
  | { kind: 'text3d_removed'; payload: { id: string } }
  | { kind: 'text3d_updated'; payload: { id: string; updates: Partial<Text3DObject> } }

type Sender = (mutation: WorldMutation) => void
type Listener = (mutation: WorldMutation) => void

class WorldMutationBus {
  private sender: Sender | null = null
  private listeners = new Set<Listener>()

  setSender(sender: Sender | null): void {
    this.sender = sender
  }

  broadcast(mutation: WorldMutation): void {
    if (!this.sender) {
      console.info('[oasis-bus] broadcast skipped (no sender):', mutation.kind)
      return
    }
    try {
      console.info('[oasis-bus] broadcast', mutation.kind)
      this.sender(mutation)
    } catch (error) {
      console.warn('[oasis-bus] sender errored', error)
    }
  }

  applyIncoming(mutation: WorldMutation): void {
    console.info('[oasis-bus] apply incoming', mutation.kind, 'listeners=', this.listeners.size)
    for (const listener of this.listeners) {
      try {
        listener(mutation)
      } catch (error) {
        console.warn('[oasis-bus] listener errored', error)
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

const globalState = globalThis as typeof globalThis & {
  __oasisWorldMutationBus?: WorldMutationBus
}

if (!globalState.__oasisWorldMutationBus) {
  globalState.__oasisWorldMutationBus = new WorldMutationBus()
}

export const worldMutationBus = globalState.__oasisWorldMutationBus
