// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// useConjure — Actions for conjuration (start, delete)
// Polling lives in useWorldLoader (WorldObjects.tsx) — always mounted.
// This hook is pure actions + store reads, no intervals.
// ─═̷─═̷─ॐ─═̷─═̷─ Lightweight, mount anywhere freely ─═̷─═̷─ॐ─═̷─═̷─
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useCallback } from 'react'
import { useOasisStore } from '../store/oasisStore'
import { awardXp } from '../hooks/useXp'
import type { ConjuredAsset, ProviderName, ConjureStatus, PostProcessAction, MeshTopology, CharacterGenerationOptions } from '../lib/conjure/types'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const TERMINAL_STATES: ConjureStatus[] = ['ready', 'failed']

export function useConjure() {
  const conjuredAssets = useOasisStore(s => s.conjuredAssets)
  const addConjuredAsset = useOasisStore(s => s.addConjuredAsset)
  const removeConjuredAsset = useOasisStore(s => s.removeConjuredAsset)
  const placeConjuredAssetInWorld = useOasisStore(s => s.placeConjuredAssetInWorld)
  const removeConjuredAssetFromWorld = useOasisStore(s => s.removeConjuredAssetFromWorld)

  // ═══════════════════════════════════════════════════════════════════════
  // Start a new conjuration
  // ═══════════════════════════════════════════════════════════════════════
  const startConjure = useCallback(async (
    prompt: string,
    provider: ProviderName,
    tier: string,
    options?: { characterMode?: boolean; characterOptions?: CharacterGenerationOptions; imageUrl?: string; autoRig?: boolean; autoAnimate?: boolean; animationPreset?: string },
  ) => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/conjure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, provider, tier, ...options }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        if (res.status === 402) {
          throw new Error(`Insufficient credits (${err.credits ?? 0} remaining, need ${err.required ?? 1})`)
        }
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()

      // Add to local store immediately for instant UI feedback
      // ░▒▓ SPAWN OFFSET — Detect active conjurations and offset new ones so VFX don't stack ▓▒░
      const activeCount = useOasisStore.getState().conjuredAssets.filter(
        a => !['ready', 'failed'].includes(a.status)
      ).length
      const spawnX = activeCount * 4  // 4 units apart along X axis
      const newAsset: ConjuredAsset = {
        id: data.id,
        prompt,
        provider,
        tier,
        providerTaskId: '',
        status: 'queued' as ConjureStatus,
        progress: 0,
        position: [spawnX, 0, 0],
        scale: 1,
        rotation: [0, 0, 0],
        createdAt: new Date().toISOString(),
      }
      addConjuredAsset(newAsset)
      // Auto-place in current world
      placeConjuredAssetInWorld(data.id)

      // Award XP for conjuration (fire-and-forget)
      const worldId = useOasisStore.getState().activeWorldId
      awardXp('CONJURE_ASSET', worldId)

      return data
    } catch (err) {
      console.error('[Forge] Conjuration failed:', err)
      throw err
    }
  }, [addConjuredAsset, placeConjuredAssetInWorld])

  // ═══════════════════════════════════════════════════════════════════════
  // Post-process a conjured asset (texture / remesh)
  // ─═̷─═̷─ Creates a new child asset linked to the source ─═̷─═̷─
  // ═══════════════════════════════════════════════════════════════════════
  const processAsset = useCallback(async (
    id: string,
    action: PostProcessAction,
    options?: { targetPolycount?: number; topology?: MeshTopology; texturePrompt?: string; heightMeters?: number; animationPresetId?: string },
  ) => {
    try {
      const res = await fetch(`${OASIS_BASE}/api/conjure/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, options }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        if (res.status === 402) {
          throw new Error(`Insufficient credits (${err.credits ?? 0} remaining, need ${err.required ?? 1})`)
        }
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()

      // Find the source to inherit its prompt for display
      const source = conjuredAssets.find(a => a.id === id)
      const ACTION_LABELS: Record<string, string> = {
        texture: 'Texturing', remesh: 'Remeshing', rig: 'Rigging', animate: 'Animating',
      }
      const TIER_LABELS: Record<string, string> = {
        texture: 'refine', remesh: 'remesh', rig: 'rig', animate: 'animate',
      }
      const actionLabel = ACTION_LABELS[action] || action

      // Add the child asset to local store for instant UI feedback
      const childAsset: ConjuredAsset = {
        id: data.id,
        prompt: `[${actionLabel}] ${source?.prompt ?? 'Unknown'}`,
        provider: source?.provider ?? 'meshy',
        tier: TIER_LABELS[action] || action,
        providerTaskId: '',
        status: 'queued' as ConjureStatus,
        progress: 0,
        position: [0, 0, 0],              // neutral origin — VFX shows here until placed
        scale: 1,
        rotation: [0, 0, 0],
        createdAt: new Date().toISOString(),
        sourceAssetId: id,
        action,
      }
      addConjuredAsset(childAsset)
      placeConjuredAssetInWorld(data.id)

      return data
    } catch (err) {
      console.error(`[Forge] ${action} failed:`, err)
      throw err
    }
  }, [conjuredAssets, addConjuredAsset, placeConjuredAssetInWorld])

  // ═══════════════════════════════════════════════════════════════════════
  // Delete a conjured asset
  // ═══════════════════════════════════════════════════════════════════════
  const deleteAsset = useCallback(async (id: string) => {
    try {
      await fetch(`${OASIS_BASE}/api/conjure/${id}`, { method: 'DELETE' })
      removeConjuredAsset(id)
      removeConjuredAssetFromWorld(id)
    } catch (err) {
      console.error('[Forge] Delete failed:', err)
    }
  }, [removeConjuredAsset, removeConjuredAssetFromWorld])

  return {
    conjuredAssets,
    startConjure,
    processAsset,
    deleteAsset,
    activeCount: conjuredAssets.filter(a => !TERMINAL_STATES.includes(a.status)).length,
  }
}
