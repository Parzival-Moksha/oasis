// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// SCENE LIBRARY — Every crafted scene survives, even after deletion
// ─═̷─═̷─ॐ─═̷─═̷─ The Forge remembers what was built ─═̷─═̷─ॐ─═̷─═̷─
//
// v2: File-based via API. No more localStorage origin lock.
// Crafted scenes go to the library when created.
// Deleting from a world removes the scene from THAT world,
// but the library keeps a copy. Re-place from library anytime.
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import type { CraftedScene } from '../conjure/types'

const API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/worlds/scene-library`
  : '/api/worlds/scene-library'

/** Get all scenes ever crafted */
export async function getSceneLibrary(): Promise<CraftedScene[]> {
  try {
    const res = await fetch(API_BASE)
    if (!res.ok) return []
    return await res.json() as CraftedScene[]
  } catch {
    return []
  }
}

/** Add a scene to the library (deduplicates by id on server) */
export async function addToSceneLibrary(scene: CraftedScene): Promise<void> {
  try {
    await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene),
    })
  } catch (err) {
    console.error('[SceneLibrary] Failed to add:', err)
  }
}

/** Remove a scene from the library permanently */
export async function removeFromSceneLibrary(sceneId: string): Promise<void> {
  try {
    const library = await getSceneLibrary()
    const filtered = library.filter(s => s.id !== sceneId)
    await fetch(API_BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered),
    })
  } catch (err) {
    console.error('[SceneLibrary] Failed to remove:', err)
  }
}

// ▓▓▓▓【S̸C̸E̸N̸E̸】▓▓▓▓ॐ▓▓▓▓【L̸I̸B̸R̸A̸R̸Y̸】▓▓▓▓
