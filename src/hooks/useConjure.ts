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
import { derivePlayerCastSpawn, setPlayerSpellCasting } from '../lib/player-avatar-runtime'

const OASIS_BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const TERMINAL_STATES: ConjureStatus[] = ['ready', 'failed']

function scalarFromScale(value: [number, number, number] | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isFinite(value[0])) return value[0]
  return fallback
}

async function syncAssetPlacementToRegistry(
  assetId: string,
  placement: {
    position: [number, number, number]
    rotation: [number, number, number]
    scale: number
  },
): Promise<void> {
  await fetch(`${OASIS_BASE}/api/conjure/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(placement),
  })
}

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
      setPlayerSpellCasting(true)
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
      const spawn = derivePlayerCastSpawn(3)

      // Add to local store immediately for instant UI feedback
      const newAsset: ConjuredAsset = {
        id: data.id,
        prompt,
        provider,
        tier,
        providerTaskId: '',
        status: 'queued' as ConjureStatus,
        progress: 0,
        position: spawn.position,
        scale: 1,
        rotation: spawn.rotation,
        createdAt: new Date().toISOString(),
      }
      addConjuredAsset(newAsset)
      useOasisStore.getState().setObjectTransform(data.id, {
        position: spawn.position,
        rotation: spawn.rotation,
        scale: 1,
      })
      // Auto-place in current world
      placeConjuredAssetInWorld(data.id)
      setPlayerSpellCasting(true)
      void syncAssetPlacementToRegistry(data.id, {
        position: spawn.position,
        rotation: spawn.rotation,
        scale: 1,
      }).catch(err => console.warn('[Forge] Failed to sync conjure placement:', err))

      // Award XP for conjuration (fire-and-forget)
      const worldId = useOasisStore.getState().activeWorldId
      awardXp('CONJURE_ASSET', worldId)

      return data
    } catch (err) {
      setPlayerSpellCasting(false)
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
      setPlayerSpellCasting(true)
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
      const sourceTransform = source ? useOasisStore.getState().transforms[source.id] : undefined
      const fallbackSpawn = derivePlayerCastSpawn(3)
      const childPosition = sourceTransform?.position || source?.position || fallbackSpawn.position
      const childRotation = sourceTransform?.rotation || source?.rotation || fallbackSpawn.rotation
      const childScale = scalarFromScale(sourceTransform?.scale, source?.scale || 1)
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
        position: childPosition,
        scale: childScale,
        rotation: childRotation,
        createdAt: new Date().toISOString(),
        sourceAssetId: id,
        action,
      }
      addConjuredAsset(childAsset)
      useOasisStore.getState().setObjectTransform(data.id, {
        position: childPosition,
        rotation: childRotation,
        scale: childScale,
      })
      placeConjuredAssetInWorld(data.id)
      setPlayerSpellCasting(true)
      void syncAssetPlacementToRegistry(data.id, {
        position: childPosition,
        rotation: childRotation,
        scale: childScale,
      }).catch(err => console.warn(`[Forge] Failed to sync ${action} placement:`, err))

      return data
    } catch (err) {
      setPlayerSpellCasting(false)
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
